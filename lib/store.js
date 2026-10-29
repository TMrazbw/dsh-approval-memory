/**
 * DAM — durable store for class aggregates, rules, and recent audit events.
 *
 * Step 4 is file-backed (no DSH services) and intentionally degrades instead of
 * throwing into the approval path: every public write returns `{ok:false}` on a
 * storage failure. A later Host step can mount the same interface over
 * `ctx.storageDomain` if desired.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listKnownClasses } from './classes.js';
import { isBlacklisted, listBlacklist, refusalFor } from './blacklist.js';

const STORE_VERSION = 2;
const CLASSES_FILE = 'classes.json';
const RULES_FILE = 'rules.json';
const EVENTS_FILE = 'events.jsonl';
const LOG_FILE = '_plugin.log';
const DEFAULT_MAX_EVENTS = 5000;
const DEFAULT_MAX_EXAMPLES = 3;
const DEFAULT_LOG_MAX_BYTES = 1024 * 1024;
const MAX_RISK_TAGS = 8;

function nowDefault() {
  return Date.now();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function dedupeKey(sessionId, approvalId) {
  return `${typeof sessionId === 'string' ? sessionId : ''}\u0000${approvalId}`;
}

function normalizeCounts(counts = {}) {
  return {
    total: toCount(counts.total),
    allowed: toCount(counts.allowed),
    rejected: toCount(counts.rejected),
    auto: toCount(counts.auto),
    cancelledOrUnavailable: toCount(counts.cancelledOrUnavailable),
  };
}

function normalizeRisk(risk) {
  const level = ['low', 'medium', 'high', 'unknown'].includes(risk?.level)
    ? risk.level
    : 'unknown';
  return {
    level,
    reasonZh: typeof risk?.reasonZh === 'string' ? risk.reasonZh : '',
    reasonEn: typeof risk?.reasonEn === 'string' ? risk.reasonEn : '',
    policyId: typeof risk?.policyId === 'string' ? risk.policyId : 'unknown',
  };
}

function normalizeRiskHint(value) {
  return ['high', 'medium', 'unknown'].includes(value) ? value : 'unknown';
}

function normalizeRiskTags(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const tags = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof key !== 'string' || key.length === 0) continue;
    tags[key] = toCount(count);
    if (Object.keys(tags).length >= MAX_RISK_TAGS) break;
  }
  return tags;
}

function riskRank(value) {
  if (value === 'high') return 2;
  if (value === 'medium') return 1;
  return 0;
}

function normalizeAutoResults(value) {
  return {
    success: toCount(value?.success),
    error: toCount(value?.error),
  };
}

function normalizeClass(classKey, input = {}) {
  const now = toCount(input.time);
  return {
    key: classKey,
    titleZh: typeof input.titleZh === 'string' && input.titleZh.length > 0
      ? input.titleZh : classKey,
    titleEn: typeof input.titleEn === 'string' && input.titleEn.length > 0
      ? input.titleEn : classKey,
    operation: typeof input.operation === 'string' ? input.operation : 'unknown',
    risk: normalizeRisk(input.risk),
    counts: normalizeCounts(input.counts),
    firstSeenAt: toCount(input.firstSeenAt) || now,
    lastSeenAt: toCount(input.lastSeenAt) || now,
    examples: Array.isArray(input.examples)
      ? input.examples.filter((value) => typeof value === 'string').slice(0, DEFAULT_MAX_EXAMPLES)
      : [],
    riskTags: normalizeRiskTags(input.riskTags),
    commandExamples: Array.isArray(input.commandExamples)
      ? input.commandExamples.filter((value) => typeof value === 'string').slice(0, DEFAULT_MAX_EXAMPLES)
      : [],
    riskLevelHint: normalizeRiskHint(input.riskLevelHint),
    lastCommandHash: typeof input.lastCommandHash === 'string' && input.lastCommandHash.length > 0
      ? input.lastCommandHash
      : null,
    autoResults: normalizeAutoResults(input.autoResults),
  };
}

function cloneClass(entry) {
  return {
    ...entry,
    risk: { ...entry.risk },
    counts: { ...entry.counts },
    examples: [...entry.examples],
    riskTags: { ...entry.riskTags },
    commandExamples: [...entry.commandExamples],
    autoResults: { ...entry.autoResults },
  };
}

function cloneRule(entry) {
  return entry === undefined ? undefined : { ...entry };
}

/**
 * Create one file-backed store.
 * @param {object} [options] - store options.
 * @param {string} options.root - data directory.
 * @param {number} [options.maxEvents] - retained audit events.
 * @param {number} [options.maxExamples] - retained examples per class.
 * @param {number} [options.logMaxBytes] - plugin log rotation size.
 * @param {() => number} [options.clock] - injectable clock for tests.
 * @returns {object} the store facade.
 */
export function createStore(options = {}) {
  const root = path.resolve(typeof options.root === 'string' && options.root.length > 0
    ? options.root
    : path.join(process.cwd(), '.dam-store'));
  const maxEvents = Number.isInteger(options.maxEvents) && options.maxEvents > 0
    ? options.maxEvents
    : DEFAULT_MAX_EVENTS;
  const maxExamples = Number.isInteger(options.maxExamples) && options.maxExamples > 0
    ? options.maxExamples
    : DEFAULT_MAX_EXAMPLES;
  const logMaxBytes = Number.isInteger(options.logMaxBytes) && options.logMaxBytes > 0
    ? options.logMaxBytes
    : DEFAULT_LOG_MAX_BYTES;
  const clock = typeof options.clock === 'function' ? options.clock : nowDefault;
  const logger = typeof options.logger === 'function' ? options.logger : null;

  const state = {
    ready: false,
    closed: false,
    degraded: false,
    classes: new Map(),
    rules: new Map(),
    events: [],
    seenAsked: new Set(),
    seenDecided: new Set(),
    seenAutoResults: new Set(),
  };

  let initPromise = null;
  let queue = Promise.resolve();

  const classesPath = path.join(root, CLASSES_FILE);
  const rulesPath = path.join(root, RULES_FILE);
  const eventsPath = path.join(root, EVENTS_FILE);
  const logPath = path.join(root, LOG_FILE);

  function reportError(scope, error) {
    const message = `[${scope}] ${errorMessage(error)}`;
    if (logger !== null) {
      try { logger(message); } catch { /* logging must never throw */ }
    }
    void appendLog(message);
  }

  async function appendLog(message) {
    try {
      await fs.mkdir(root, { recursive: true });
      try {
        const info = await fs.stat(logPath);
        if (info.size > logMaxBytes) {
          await fs.rm(`${logPath}.1`, { force: true });
          await fs.rename(logPath, `${logPath}.1`);
        }
      } catch {
        // Missing log is normal.
      }
      await fs.appendFile(logPath, `${new Date(clock()).toISOString()} ${message}\n`, 'utf8');
    } catch {
      // Logging must never affect the caller.
    }
  }

  async function readJson(file, fallback) {
    try {
      const text = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(text);
      return parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') reportError('read', error);
      return fallback;
    }
  }

  async function writeJsonAtomic(file, value) {
    const temporary = `${file}.tmp`;
    const text = `${JSON.stringify(value, null, 2)}\n`;
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(temporary, text, 'utf8');
    try {
      await fs.rename(temporary, file);
    } catch {
      await fs.rm(file, { force: true });
      await fs.rename(temporary, file);
    }
  }

  async function readEvents() {
    try {
      const text = await fs.readFile(eventsPath, 'utf8');
      const parsed = [];
      for (const line of text.split(/\r?\n/)) {
        if (line.trim().length === 0) continue;
        try {
          const event = JSON.parse(line);
          if (event !== null && typeof event === 'object') parsed.push(event);
        } catch {
          reportError('events', new Error('discarding malformed event line'));
        }
      }
      return parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') reportError('events', error);
      return [];
    }
  }

  async function ensureFile(file, content) {
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, content, 'utf8');
    }
  }

  async function load() {
    await fs.mkdir(root, { recursive: true });
    await ensureFile(classesPath, `${JSON.stringify({ version: STORE_VERSION, classes: {} }, null, 2)}\n`);
    await ensureFile(rulesPath, `${JSON.stringify({ version: STORE_VERSION, rules: {} }, null, 2)}\n`);
    await ensureFile(eventsPath, '');
    await ensureFile(logPath, '');

    const classesDoc = await readJson(classesPath, { version: STORE_VERSION, classes: {} });
    const classes = classesDoc?.classes !== null && typeof classesDoc?.classes === 'object'
      ? classesDoc.classes : {};
    for (const [key, entry] of Object.entries(classes)) {
      if (typeof key !== 'string' || key.length === 0) continue;
      state.classes.set(key, normalizeClass(key, entry));
    }

    const rulesDoc = await readJson(rulesPath, { version: STORE_VERSION, rules: {} });
    const rules = rulesDoc?.rules !== null && typeof rulesDoc?.rules === 'object'
      ? rulesDoc.rules : {};
    for (const [key, entry] of Object.entries(rules)) {
      if (typeof key !== 'string' || key.length === 0) continue;
      if (isBlacklisted(key)) {
        await appendEvent({
          type: 'rule-refused',
          time: clock(),
          classKey: key,
          source: 'load',
          result: 'refused',
        });
        continue;
      }
      state.rules.set(key, {
        enabled: entry?.enabled === true,
        updatedAt: toCount(entry?.updatedAt),
        source: typeof entry?.source === 'string' ? entry.source : 'unknown',
      });
    }

    const events = await readEvents();
    state.events = events.slice(-maxEvents);
    for (const event of state.events) {
      if (event.type === 'asked' && typeof event.approvalId === 'string') {
        state.seenAsked.add(dedupeKey(event.sessionId, event.approvalId));
      }
      if (event.type === 'decided' && typeof event.approvalId === 'string') {
        state.seenDecided.add(dedupeKey(event.sessionId, event.approvalId));
      }
      if (event.type === 'auto-result' && typeof event.callId === 'string') {
        state.seenAutoResults.add(dedupeKey(event.sessionId, event.callId));
      }
    }
    if (events.length > state.events.length) {
      await rewriteEvents();
    }

    state.ready = true;
  }

  async function init() {
    if (state.ready) return { ok: true };
    if (initPromise !== null) return initPromise;
    initPromise = (async () => {
      try {
        await load();
        return { ok: true };
      } catch (error) {
        state.degraded = true;
        reportError('init', error);
        return { ok: false, code: 'store-error', error: errorMessage(error) };
      }
    })();
    return initPromise;
  }

  async function ensureReady() {
    if (state.closed) return { ok: false, code: 'store-closed' };
    if (!state.ready) {
      const result = await init();
      if (!result.ok) return result;
    }
    return { ok: true };
  }

  function enqueue(task) {
    const run = queue.then(task, task);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function persistClasses() {
    const classes = {};
    for (const [key, value] of state.classes) classes[key] = value;
    await writeJsonAtomic(classesPath, { version: STORE_VERSION, classes });
  }

  async function persistRules() {
    const rules = {};
    for (const [key, value] of state.rules) rules[key] = value;
    await writeJsonAtomic(rulesPath, { version: STORE_VERSION, rules });
  }

  async function rewriteEvents() {
    const text = state.events.map((event) => JSON.stringify(event)).join('\n');
    const temporary = `${eventsPath}.tmp`;
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(temporary, text.length > 0 ? `${text}\n` : '', 'utf8');
    try {
      await fs.rename(temporary, eventsPath);
    } catch {
      await fs.rm(eventsPath, { force: true });
      await fs.rename(temporary, eventsPath);
    }
  }

  async function appendEvent(event) {
    state.events.push(event);
    if (state.events.length > maxEvents) {
      state.events = state.events.slice(-maxEvents);
      await rewriteEvents();
      return;
    }
    try {
      await fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
    } catch {
      await rewriteEvents();
    }
  }

  function addExample(entry, example) {
    if (typeof example !== 'string' || example.length === 0) return;
    if (entry.examples.includes(example)) return;
    entry.examples.push(example);
    if (entry.examples.length > maxExamples) entry.examples = entry.examples.slice(-maxExamples);
  }

  function addCommandExample(entry, example) {
    if (typeof example !== 'string' || example.length === 0) return;
    if (entry.commandExamples.includes(example)) return;
    entry.commandExamples.push(example);
    if (entry.commandExamples.length > maxExamples) {
      entry.commandExamples = entry.commandExamples.slice(-maxExamples);
    }
  }

  function ensureClass(classDef, time) {
    const key = classDef.key;
    let entry = state.classes.get(key);
    if (entry === undefined) {
      entry = normalizeClass(key, { ...classDef, time });
      state.classes.set(key, entry);
      return entry;
    }
    entry.titleZh = classDef.titleZh || entry.titleZh;
    entry.titleEn = classDef.titleEn || entry.titleEn;
    entry.operation = classDef.operation || entry.operation;
    entry.risk = normalizeRisk(classDef.risk);
    return entry;
  }

  function success(value) {
    return { ok: true, ...value };
  }

  function failure(error, code = 'store-error') {
    state.degraded = true;
    reportError('write', error);
    return { ok: false, code, error: errorMessage(error) };
  }

  return {
    root,
    maxEvents,

    init,

    /**
     * Record one observed approval request. Increments the class total once per
     * `(sessionId, approvalId)`.
     * @param {object} input - `{ classDef, sessionId, approvalId, time, source, example }`.
     * @returns {Promise<object>} ok/duplicate/failure.
     */
    async recordAsked(input = {}) {
      return enqueue(async () => {
        const ready = await ensureReady();
        if (!ready.ok) return ready;
        const classKey = input.classDef?.key;
        if (typeof classKey !== 'string' || classKey.length === 0) {
          return { ok: false, code: 'invalid-class' };
        }
        const approvalId = typeof input.approvalId === 'string' ? input.approvalId : null;
        const key = approvalId === null ? null : dedupeKey(input.sessionId, approvalId);
        if (key !== null && state.seenAsked.has(key)) {
          return success({ duplicate: true, class: cloneClass(state.classes.get(classKey) || normalizeClass(classKey, input.classDef)) });
        }
        try {
          const time = toCount(input.time) || clock();
          const entry = ensureClass(input.classDef, time);
          const riskTags = Array.isArray(input.riskTags)
            ? input.riskTags.filter((tag) => typeof tag === 'string' && tag.length > 0).slice(0, MAX_RISK_TAGS)
            : [];
          const riskLevelHint = normalizeRiskHint(input.riskLevelHint);
          entry.counts.total += 1;
          entry.lastSeenAt = time;
          addExample(entry, input.example);
          if (typeof input.commandPreview === 'string' && input.commandPreview.length > 0) {
            addCommandExample(entry, input.commandPreview);
          }
          if (typeof input.commandHash === 'string' && input.commandHash.length > 0) {
            entry.lastCommandHash = input.commandHash;
          }
          for (const tag of riskTags) entry.riskTags[tag] = (entry.riskTags[tag] || 0) + 1;
          if (riskRank(riskLevelHint) > riskRank(entry.riskLevelHint)) {
            entry.riskLevelHint = riskLevelHint;
          }
          if (key !== null) state.seenAsked.add(key);
          await appendEvent({
            type: 'asked',
            time,
            classKey,
            sessionId: input.sessionId ?? null,
            approvalId,
            source: input.source ?? 'unknown',
            reason: typeof input.reason === 'string' ? input.reason : null,
            riskTags,
            commandHash: typeof input.commandHash === 'string' ? input.commandHash : null,
            commandPreview: typeof input.commandPreview === 'string' ? input.commandPreview : null,
            commandCwd: typeof input.commandCwd === 'string' ? input.commandCwd : null,
            commandTargets: Array.isArray(input.commandTargets)
              ? input.commandTargets.filter((value) => typeof value === 'string').slice(0, 5)
              : [],
            truncated: input.truncated === true,
          });
          await persistClasses();
          return success({ duplicate: false, class: cloneClass(entry), total: entry.counts.total });
        } catch (error) {
          return failure(error);
        }
      });
    },

    /**
     * Record one approval outcome. Auto approvals increment `auto`, not
     * `allowed` (which means a human allow).
     * @param {object} input - `{ classKey, sessionId, approvalId, outcome, auto, time }`.
     * @returns {Promise<object>} ok/duplicate/failure.
     */
    async recordDecided(input = {}) {
      return enqueue(async () => {
        const ready = await ensureReady();
        if (!ready.ok) return ready;
        const classKey = input.classKey;
        if (typeof classKey !== 'string' || classKey.length === 0) {
          return { ok: false, code: 'invalid-class' };
        }
        const approvalId = typeof input.approvalId === 'string' ? input.approvalId : null;
        const key = approvalId === null ? null : dedupeKey(input.sessionId, approvalId);
        if (key !== null && state.seenDecided.has(key)) {
          return success({ duplicate: true });
        }
        const outcome = ['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(input.outcome)
          ? input.outcome : 'unavailable';
        try {
          const time = toCount(input.time) || clock();
          const entry = state.classes.get(classKey);
          if (entry === undefined) {
            return { ok: false, code: 'unknown-class' };
          }
          if (outcome === 'allowed-once' && input.auto === true) entry.counts.auto += 1;
          else if (outcome === 'allowed-once') entry.counts.allowed += 1;
          else if (outcome === 'rejected') entry.counts.rejected += 1;
          else entry.counts.cancelledOrUnavailable += 1;
          entry.lastSeenAt = time;
          if (key !== null) state.seenDecided.add(key);
          await appendEvent({
            type: 'decided',
            time,
            classKey,
            sessionId: input.sessionId ?? null,
            approvalId,
            outcome,
            auto: input.auto === true,
            commandHash: typeof input.commandHash === 'string' ? input.commandHash : null,
          });
          await persistClasses();
          return success({ duplicate: false, class: cloneClass(entry) });
        } catch (error) {
          return failure(error);
        }
      });
    },

    /**
     * Record the observed result of one auto-approved tool call.
     * Deduplicates by `(sessionId, callId)`.
     * @param {object} input - `{ classKey, sessionId, callId, result, time }`.
     * @returns {Promise<object>} ok/duplicate/failure.
     */
    async recordAutoResult(input = {}) {
      return enqueue(async () => {
        const ready = await ensureReady();
        if (!ready.ok) return ready;
        const classKey = input.classKey;
        if (typeof classKey !== 'string' || classKey.length === 0) {
          return { ok: false, code: 'invalid-class' };
        }
        const callId = typeof input.callId === 'string' && input.callId.length > 0
          ? input.callId
          : null;
        if (callId === null) return { ok: false, code: 'invalid-call' };
        const key = dedupeKey(input.sessionId, callId);
        if (state.seenAutoResults.has(key)) return success({ duplicate: true });
        const entry = state.classes.get(classKey);
        if (entry === undefined) return { ok: false, code: 'unknown-class' };
        const result = input.result === 'error' ? 'error' : 'success';
        try {
          const time = toCount(input.time) || clock();
          entry.autoResults[result] += 1;
          state.seenAutoResults.add(key);
          await appendEvent({
            type: 'auto-result',
            time,
            classKey,
            sessionId: input.sessionId ?? null,
            callId,
            result,
          });
          await persistClasses();
          return success({ duplicate: false, result, class: cloneClass(entry) });
        } catch (error) {
          return failure(error);
        }
      });
    },

    /**
     * Set one rule. A blacklisted class is refused and audited; nothing is written.
     * @param {string} classKey - stable class key.
     * @param {boolean} enabled - desired switch.
     * @param {object} [metadata] - `{ time, source }`.
     * @returns {Promise<object>} rule or refusal/failure.
     */
    async setRule(classKey, enabled, metadata = {}) {
      return enqueue(async () => {
        const ready = await ensureReady();
        if (!ready.ok) return ready;
        if (typeof classKey !== 'string' || classKey.length === 0) {
          return { ok: false, code: 'invalid-class' };
        }
        const refusal = refusalFor(classKey);
        if (refusal !== null) {
          try {
            await appendEvent({
              type: 'rule-refused',
              time: toCount(metadata.time) || clock(),
              classKey,
              source: metadata.source ?? 'unknown',
              result: 'refused',
            });
          } catch (error) {
            return failure(error);
          }
          return refusal;
        }
        try {
          const rule = {
            enabled: enabled === true,
            updatedAt: toCount(metadata.time) || clock(),
            source: typeof metadata.source === 'string' ? metadata.source : 'user',
          };
          state.rules.set(classKey, rule);
          await persistRules();
          return success({ rule: cloneRule(rule) });
        } catch (error) {
          return failure(error);
        }
      });
    },

    /**
     * Effective switch value: stored rule, else the class default.
     * @param {string} classKey - stable class key.
     * @param {boolean} [defaultEnabled] - classifier default.
     * @returns {boolean} effective value.
     */
    effectiveEnabled(classKey, defaultEnabled = false) {
      if (isBlacklisted(classKey)) return false;
      const rule = state.rules.get(classKey);
      return rule === undefined ? defaultEnabled === true : rule.enabled === true;
    },

    /**
     * Return the raw stored rule for one class.
     * @param {string} classKey - stable class key.
     * @returns {object | undefined} cloned rule.
     */
    ruleFor(classKey) {
      return cloneRule(state.rules.get(classKey));
    },

    /**
     * Turn every known/observed class off. Blacklisted classes never get rules.
     * @param {object} [metadata] - `{ time, source }`.
     * @returns {Promise<object>} count of written rules.
     */
    async disableAll(metadata = {}) {
      return enqueue(async () => {
        const ready = await ensureReady();
        if (!ready.ok) return ready;
        try {
          const time = toCount(metadata.time) || clock();
          const keys = new Set(state.classes.keys());
          for (const def of listKnownClasses()) keys.add(def.key);
          let count = 0;
          for (const key of keys) {
            if (isBlacklisted(key)) continue;
            state.rules.set(key, {
              enabled: false,
              updatedAt: time,
              source: typeof metadata.source === 'string' ? metadata.source : 'user',
            });
            count += 1;
          }
          await persistRules();
          return success({ count });
        } catch (error) {
          return failure(error);
        }
      });
    },

    /**
     * Read one class aggregate.
     * @param {string} classKey - stable class key.
     * @returns {object | undefined} cloned aggregate.
     */
    getClass(classKey) {
      const entry = state.classes.get(classKey);
      return entry === undefined ? undefined : cloneClass(entry);
    },

    /**
     * List all class aggregates, most frequent first.
     * @returns {Array<object>} cloned aggregates.
     */
    listClasses() {
      return [...state.classes.values()]
        .map(cloneClass)
        .sort((left, right) => right.counts.total - left.counts.total
          || right.lastSeenAt - left.lastSeenAt);
    },

    /**
     * List all explicit rules.
     * @returns {Array<object>} cloned rules with keys.
     */
    listRules() {
      return [...state.rules.entries()].map(([classKey, rule]) => ({ classKey, ...cloneRule(rule) }));
    },

    /**
     * Read recent audit events.
     * @param {number} [limit] - maximum rows.
     * @returns {Array<object>} cloned events.
     */
    recentEvents(limit = 50) {
      const count = Number.isInteger(limit) && limit > 0 ? limit : 50;
      return state.events.slice(-count).map((event) => ({ ...event }));
    },

    /**
     * Build the UI-facing snapshot.
     * @returns {object} classes, rules, blacklist, totals, recent events.
     */
    snapshot() {
      const rejectionByHash = new Map();
      for (const event of state.events) {
        if (event?.type !== 'decided' || event?.outcome !== 'rejected') continue;
        if (typeof event.commandHash !== 'string' || event.commandHash.length === 0) continue;
        const row = rejectionByHash.get(event.commandHash);
        if (row === undefined) {
          rejectionByHash.set(event.commandHash, { count: 1, lastRejectedAt: toCount(event.time) });
        } else {
          row.count += 1;
          row.lastRejectedAt = Math.max(row.lastRejectedAt, toCount(event.time));
        }
      }
      const classes = this.listClasses().map((entry) => ({
        ...entry,
        rejection: entry.lastCommandHash === null
          ? null
          : (rejectionByHash.get(entry.lastCommandHash) ?? null),
      }));
      const totals = classes.reduce((sum, entry) => {
        sum.requests += entry.counts.total;
        sum.auto += entry.counts.auto;
        return sum;
      }, { classes: classes.length, requests: 0, auto: 0 });
      return {
        ok: state.ready && !state.closed,
        degraded: state.degraded,
        classes,
        rules: this.listRules(),
        blacklist: listBlacklist(),
        totals,
        recentEvents: this.recentEvents(100),
      };
    },

    /**
     * Wait for queued writes and mark the store closed.
     * @returns {Promise<void>} settlement.
     */
    async close() {
      await queue.catch(() => {});
      state.closed = true;
    },
  };
}
