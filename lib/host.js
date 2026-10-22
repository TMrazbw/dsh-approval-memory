/**
 * DAM — Host approval runtime.
 *
 * Pure orchestration over the store and the approval/session events:
 * - `session/event` keeps the class table current for every conversation.
 * - `approval/request` only decides whether a known read-only class is
 *   auto-approved; it never creates or changes rules.
 *
 * No DSH imports here, so the runtime can be simulated with fake sessions.
 */

import { classifyRequest, isAutoApprovable } from './classes.js';
import { extractRequest } from './extract.js';
import { redactText } from './format.js';

function safeSessionId(session) {
  return session !== null && typeof session?.id === 'string' ? session.id : 'unknown';
}

function sessionEvents(session) {
  try {
    if (typeof session?.snapshotEvents === 'function') {
      const events = session.snapshotEvents();
      return Array.isArray(events) ? events : [];
    }
    if (typeof session?.ownEvents === 'function') {
      const events = session.ownEvents();
      return Array.isArray(events) ? events : [];
    }
  } catch {
    // A missing/read-failing log means "cannot classify"; fail closed.
  }
  return [];
}

function isSubagentSession(session) {
  const header = session?.header;
  if (header === null || typeof header !== 'object') return false;
  if (header.origin === 'subagent') return true;
  if (typeof header.parentSession === 'string' && header.parentSession.length > 0) return true;
  return Number.isFinite(header.delegationDepth) && header.delegationDepth > 0;
}

function eventTime(event, clock) {
  return Number.isFinite(event?.time) ? event.time : clock();
}

function findLatestAskedId(session, request) {
  const events = sessionEvents(session);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'approval/asked') continue;
    const data = event.data;
    if (data === null || typeof data !== 'object') continue;
    if (data.toolName !== request.toolName) continue;
    if (typeof request.callId === 'string' && typeof data.callId === 'string'
      && request.callId !== data.callId) continue;
    if (typeof request.reason === 'string' && typeof data.reason === 'string'
      && request.reason !== data.reason) continue;
    return typeof data.id === 'string' ? data.id : null;
  }
  return null;
}

/**
 * Create the approval runtime used by the Host plugin and by local tests.
 * @param {object} options - runtime dependencies.
 * @param {object} options.store - store facade created by `lib/store.js`.
 * @param {() => number} [options.clock] - injectable clock.
 * @param {(message: string) => void} [options.logger] - optional logger.
 * @param {(session: object) => string} [options.policyOf] - effective approval policy.
 * @param {boolean} [options.includeSubagents] - allow auto-approval in subagent sessions.
 * @returns {object} runtime with `onSessionEvent` and `onApprovalRequest`.
 */
export function createApprovalRuntime(options = {}) {
  const store = options.store;
  if (!store || typeof store.recordAsked !== 'function') {
    throw new TypeError('createApprovalRuntime requires a store');
  }
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const logger = typeof options.logger === 'function' ? options.logger : null;
  const policyOf = typeof options.policyOf === 'function' ? options.policyOf : () => 'ask';
  const includeSubagents = options.includeSubagents === true;
  const pending = new Map();
  const autoApprovalIds = new Set();

  function log(message) {
    if (logger === null) return;
    try { logger(message); } catch { /* logging must never throw */ }
  }

  function pendingKey(sessionId, approvalId) {
    return `${sessionId}\u0000${approvalId}`;
  }

  return {
    /**
     * Fold one durable session event into the store.
     * @param {object} session - session carrying the event.
     * @param {object} event - session event record.
     * @returns {Promise<void>} settlement; never rejects to the event bus.
     */
    async onSessionEvent(session, event) {
      if (session === null || typeof session !== 'object') return;
      if (event === null || typeof event !== 'object') return;
      const sessionId = safeSessionId(session);

      try {
        if (event.type === 'approval/asked') {
          const data = event.data ?? {};
          const approvalId = typeof data.id === 'string' ? data.id : null;
          const extracted = extractRequest({
            toolName: data.toolName,
            callId: data.callId,
            reason: data.reason,
            events: sessionEvents(session),
          });
          const classDef = classifyRequest(extracted);
          const key = approvalId === null ? null : pendingKey(sessionId, approvalId);
          const auto = key !== null && autoApprovalIds.has(key);
          pending.set(key ?? `${sessionId}\u0000${event.seq ?? ''}`, {
            approvalId,
            classKey: classDef.key,
            toolName: data.toolName,
            callId: data.callId,
            reason: data.reason,
            auto,
          });
          const result = await store.recordAsked({
            classDef,
            sessionId,
            approvalId,
            time: eventTime(event, clock),
            source: 'session-event',
            example: redactText(data.reason, { maxLength: 160 }),
          });
          if (result?.ok !== true) {
            log(`recordAsked failed: ${result?.code ?? 'unknown'}`);
          }
          return;
        }

        if (event.type === 'approval/decided') {
          const data = event.data ?? {};
          const approvalId = typeof data.id === 'string' ? data.id : null;
          if (approvalId === null) return;
          const key = pendingKey(sessionId, approvalId);
          const record = pending.get(key);
          if (record === undefined) return;
          const auto = record.auto === true || autoApprovalIds.has(key);
          const result = await store.recordDecided({
            classKey: record.classKey,
            sessionId,
            approvalId,
            outcome: data.outcome,
            auto,
            time: eventTime(event, clock),
          });
          if (result?.ok !== true) {
            log(`recordDecided failed: ${result?.code ?? 'unknown'}`);
          }
          pending.delete(key);
          autoApprovalIds.delete(key);
        }
      } catch (error) {
        log(`session event failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    /**
     * Decide one approval request. The only possible grant is `allowed-once`
     * for a known low-risk class whose effective rule is enabled.
     * @param {object} req - approval request event.
     * @param {() => Promise<object|string>} next - delegate to later answerers.
     * @returns {Promise<string>} approval outcome.
     */
    async onApprovalRequest(req, next) {
      let auto = false;
      try {
        const ready = await store.init();
        if (ready?.ok === true) {
          const session = req?.agent?.session;
          if (session !== null && typeof session === 'object'
            && typeof req?.toolName === 'string' && req.toolName.length > 0) {
            const policy = policyOf(session);
            const subagent = isSubagentSession(session);
            const allowedScope = subagent ? includeSubagents : true;
            const extracted = extractRequest({
              toolName: req.toolName,
              callId: req.callId,
              reason: req.reason,
              events: sessionEvents(session),
            });
            const classDef = classifyRequest(extracted);
            if (policy !== 'never'
              && allowedScope
              && isAutoApprovable(classDef)
              && store.effectiveEnabled(classDef.key, classDef.autoApprove) === true) {
              const approvalId = findLatestAskedId(session, req);
              if (approvalId !== null) {
                const key = pendingKey(safeSessionId(session), approvalId);
                autoApprovalIds.add(key);
                const record = pending.get(key);
                if (record !== undefined) record.auto = true;
              }
              auto = true;
            }
          }
        }
      } catch (error) {
        log(`approval request failed: ${error instanceof Error ? error.message : String(error)}`);
        auto = false;
      }
      return auto ? 'allowed-once' : next();
    },
  };
}
