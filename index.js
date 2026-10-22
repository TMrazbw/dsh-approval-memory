/**
 * dsh-approval-memory (DAM) — Host half.
 *
 * Registers:
 * - `session/event` approval collection (authoritative counts);
 * - prepended `approval/request` auto-approval for user-enabled read-only classes;
 * - the `open_dam_ui` tool and a short system-prompt hint for natural language.
 *
 * No session event type is added and no DSH core file is modified.
 */

import os from 'node:os';
import path from 'node:path';
import { createBridgeRoutes } from './lib/bridge.js';
import { createApprovalRuntime } from './lib/host.js';
import { createOpenDamUiTool } from './lib/open-tool.js';
import { createStore } from './lib/store.js';

const DEFAULT_MAX_EVENTS = 5000;
const DEFAULT_MAX_EXAMPLES = 3;

function defaultDataRoot() {
  if (typeof process.env.DSH_APPROVAL_MEMORY_ROOT === 'string'
    && process.env.DSH_APPROVAL_MEMORY_ROOT.length > 0) {
    return process.env.DSH_APPROVAL_MEMORY_ROOT;
  }
  const dshHome = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh');
  return path.join(dshHome, 'approval-memory');
}

function warn(ctx, message) {
  try {
    ctx.logger?.warn?.(`[dsh-approval-memory] ${message}`);
  } catch {
    // Logging must never affect the approval path.
  }
}

/**
 * Host plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} [config] - optional row config.
 */
export function apply(ctx, config = {}) {
  const dataRoot = typeof config.dataRoot === 'string' && config.dataRoot.length > 0
    ? config.dataRoot
    : defaultDataRoot();
  const maxEvents = Number.isInteger(config.maxEvents) && config.maxEvents > 0
    ? config.maxEvents
    : DEFAULT_MAX_EVENTS;
  const maxExamples = Number.isInteger(config.maxExamples) && config.maxExamples > 0
    ? config.maxExamples
    : DEFAULT_MAX_EXAMPLES;

  const store = createStore({ root: dataRoot, maxEvents, maxExamples });
  const approval = typeof ctx.get === 'function' ? ctx.get('approval') : undefined;
  const policyOf = (session) => {
    try {
      const override = approval?.overrideOf?.(session);
      if (override === 'never' || override === 'ask') return override;
      return approval?.config?.policy === 'never' ? 'never' : 'ask';
    } catch {
      return 'ask';
    }
  };
  const runtime = createApprovalRuntime({
    store,
    logger: (message) => warn(ctx, message),
    policyOf,
    includeSubagents: config.includeSubagents === true,
  });

  void store.init().then((result) => {
    if (result?.ok !== true) warn(ctx, `store init failed: ${result?.code ?? 'unknown'}`);
  }).catch((error) => {
    warn(ctx, `store init threw: ${error instanceof Error ? error.message : String(error)}`);
  });

  ctx.effect(() => {
    const disposeSession = ctx.on('session/event', (session, event) => {
      void runtime.onSessionEvent(session, event);
    });
    const disposeApproval = ctx.on(
      'approval/request',
      (req, next) => runtime.onApprovalRequest(req, next),
      { prepend: true },
    );
    return async () => {
      disposeSession();
      disposeApproval();
      await store.close();
    };
  });

  ctx.inject(['tools'], (scope) => {
    scope.effect(() => scope.tools.register(createOpenDamUiTool()));
  });

  ctx.inject(['connection'], (scope) => {
    scope.effect(() => {
      const disposers = createBridgeRoutes({ store, dataRoot })
        .map((route) => scope.connection.fetch.register(route));
      return async () => {
        for (const dispose of disposers.reverse()) await dispose();
      };
    });
  });

  ctx.inject(['systemPrompt'], (scope) => {
    scope.effect(() => scope.systemPrompt.section({
      name: 'dam:open-ui',
      order: 1450,
      text: 'When the user asks to see, open, or show the DAM approval-memory UI (DAM 审批记忆 / DAM-UI), call `open_dam_ui`. Do not only describe how to open it.',
    }));
  });
}
