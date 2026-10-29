import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../lib/store.js';
import { createApprovalRuntime } from '../lib/host.js';

function toolCall(callId, name, args) {
  return { type: 'tool/call', data: { callId, name, arguments: args } };
}

function asked(id, toolName, options = {}) {
  return {
    type: 'approval/asked',
    time: options.time ?? 100,
    data: {
      id,
      toolName,
      ...options.callId === undefined ? {} : { callId: options.callId },
      ...options.reason === undefined ? {} : { reason: options.reason },
    },
  };
}

function decided(id, outcome, time = 110) {
  return { type: 'approval/decided', time, data: { id, outcome } };
}

function toolResult(callId, isError, time = 120) {
  return {
    type: 'tool/result',
    time,
    data: { message: { toolCallId: callId, isError } },
  };
}

function session(id, events) {
  return { id, snapshotEvents: () => events };
}

async function makeRuntime() {
  const root = await mkdtemp(path.join(tmpdir(), 'dam-host-'));
  const store = createStore({ root, clock: () => 1000 });
  const runtime = createApprovalRuntime({ store });
  return { root, store, runtime };
}

async function cleanup(root, store) {
  await store.close();
  await rm(root, { recursive: true, force: true });
}

test('asked events create a class and count every conversation', async () => {
  const { root, store, runtime } = await makeRuntime();
  try {
    const session1 = session('s1', []);
    await runtime.onSessionEvent(session1, asked('a1', 'plugin_manager', {
      reason: 'escalate sandbox to danger-full-access: plugin_manager {"action":"list_bundles"}. done',
    }));
    assert.equal(store.getClass('plugin_manager:list_bundles').counts.total, 1);

    const session2 = session('s2', []);
    await runtime.onSessionEvent(session2, asked('a2', 'plugin_manager', {
      reason: 'escalate sandbox to danger-full-access: plugin_manager {"action":"list_bundles"}. done',
    }));
    assert.equal(store.getClass('plugin_manager:list_bundles').counts.total, 2);
  } finally {
    await cleanup(root, store);
  }
});

test('asked + decided update the human allow split', async () => {
  const { root, store, runtime } = await makeRuntime();
  try {
    const askedEvent = asked('a1', 'plugin_manager', {
      callId: 'c1',
      reason: 'list bundles',
    });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"list_bundles"}'), askedEvent];
    const s = session('s1', events);
    await runtime.onSessionEvent(s, askedEvent);
    await runtime.onSessionEvent(s, decided('a1', 'allowed-once'));
    const entry = store.getClass('plugin_manager:list_bundles');
    assert.equal(entry.counts.total, 1);
    assert.equal(entry.counts.allowed, 1);
    assert.equal(entry.counts.auto, 0);
  } finally {
    await cleanup(root, store);
  }
});

test('a shell approval stores command risk without changing auto-approval', async () => {
  const { root, store, runtime } = await makeRuntime();
  try {
    const command = 'rm -rf .ssh';
    const askedEvent = asked('a1', 'bash', {
      callId: 'c1',
      reason: 'escalate sandbox to workspace-write: need shell access',
    });
    const events = [
      toolCall('c1', 'bash', JSON.stringify({
        sandbox_permissions: 'workspace-write',
        command,
        cwd: 'C:\\work',
      })),
      askedEvent,
    ];
    const s = session('s1', events);
    await runtime.onSessionEvent(s, askedEvent);

    const entry = store.getClass('bash:sandbox:workspace-write');
    assert.equal(entry.counts.total, 1);
    assert.deepEqual(entry.riskTags, { 'delete-recursive': 1, 'secret-access': 1 });
    assert.equal(entry.riskLevelHint, 'high');
    assert.deepEqual(entry.commandExamples, [command]);

    const askedRow = store.recentEvents(10).find((event) => event.type === 'asked');
    assert.equal(askedRow.commandHash.length, 16);
    assert.equal(askedRow.commandPreview, command);
    assert.equal(askedRow.commandCwd, 'C:\\work');
    assert.deepEqual(askedRow.commandTargets, ['.ssh']);
    assert.equal(askedRow.truncated, false);

    await runtime.onSessionEvent(s, decided('a1', 'rejected'));
    const decidedRow = store.recentEvents(10).find((event) => event.type === 'decided');
    assert.equal(decidedRow.commandHash, askedRow.commandHash);

    const snapshotRow = store.snapshot().classes.find((row) => row.key === 'bash:sandbox:workspace-write');
    assert.deepEqual(snapshotRow.rejection, { count: 1, lastRejectedAt: 110 });
  } finally {
    await cleanup(root, store);
  }
});

test('a default-on read-only class is auto-approved once and counted as auto', async () => {
  const { root, store, runtime } = await makeRuntime();
  try {
    const askedEvent = asked('a1', 'plugin_manager', {
      callId: 'c1',
      reason: 'list bundles',
    });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"list_bundles"}'), askedEvent];
    const s = session('s1', events);
    await runtime.onSessionEvent(s, askedEvent);

    let nextCalls = 0;
    const outcome = await runtime.onApprovalRequest({
      agent: { session: s },
      toolName: 'plugin_manager',
      callId: 'c1',
      reason: 'list bundles',
    }, async () => {
      nextCalls += 1;
      return 'rejected';
    });
    assert.equal(outcome, 'allowed-once');
    assert.equal(nextCalls, 0);

    await runtime.onSessionEvent(s, decided('a1', 'allowed-once'));
    const entry = store.getClass('plugin_manager:list_bundles');
    assert.equal(entry.counts.total, 1);
    assert.equal(entry.counts.allowed, 0);
    assert.equal(entry.counts.auto, 1);
  } finally {
    await cleanup(root, store);
  }
});

test('auto-approved tool results are counted success/error and deduped', async () => {
  const { root, store, runtime } = await makeRuntime();
  try {
    const asked1 = asked('a1', 'plugin_manager', { callId: 'c1', reason: 'list bundles' });
    const asked2 = asked('a2', 'plugin_manager', { callId: 'c2', reason: 'list bundles' });
    const events = [
      toolCall('c1', 'plugin_manager', '{"action":"list_bundles"}'),
      toolCall('c2', 'plugin_manager', '{"action":"list_bundles"}'),
      asked1,
      asked2,
    ];
    const s = session('s1', events);
    await runtime.onSessionEvent(s, asked1);
    await runtime.onSessionEvent(s, asked2);

    for (const callId of ['c1', 'c2']) {
      const outcome = await runtime.onApprovalRequest({
        agent: { session: s },
        toolName: 'plugin_manager',
        callId,
        reason: 'list bundles',
      }, async () => 'rejected');
      assert.equal(outcome, 'allowed-once');
    }

    await runtime.onSessionEvent(s, decided('a1', 'allowed-once'));
    await runtime.onSessionEvent(s, decided('a2', 'allowed-once'));
    await runtime.onSessionEvent(s, toolResult('c1', false));
    await runtime.onSessionEvent(s, toolResult('c1', false));
    await runtime.onSessionEvent(s, toolResult('c2', true));

    const entry = store.getClass('plugin_manager:list_bundles');
    assert.equal(entry.counts.auto, 2);
    assert.deepEqual(entry.autoResults, { success: 1, error: 1 });
    const autoResultEvents = store.recentEvents(20).filter((event) => event.type === 'auto-result');
    assert.equal(autoResultEvents.length, 2);
  } finally {
    await cleanup(root, store);
  }
});

test('never policy delegates even for a default-on class', async () => {
  const { root, store } = await makeRuntime();
  try {
    const runtime = createApprovalRuntime({ store, policyOf: () => 'never' });
    const askedEvent = asked('a1', 'plugin_manager', {
      callId: 'c1',
      reason: 'list bundles',
    });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"list_bundles"}'), askedEvent];
    const s = session('s1', events);
    await runtime.onSessionEvent(s, askedEvent);

    let nextCalls = 0;
    const outcome = await runtime.onApprovalRequest({
      agent: { session: s },
      toolName: 'plugin_manager',
      callId: 'c1',
      reason: 'list bundles',
    }, async () => {
      nextCalls += 1;
      return 'rejected';
    });
    assert.equal(outcome, 'rejected');
    assert.equal(nextCalls, 1);
  } finally {
    await cleanup(root, store);
  }
});

test('subagent sessions are counted but not auto-approved by default', async () => {
  const { root, store, runtime } = await makeRuntime();
  try {
    const askedEvent = asked('a1', 'plugin_manager', {
      callId: 'c1',
      reason: 'list bundles',
    });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"list_bundles"}'), askedEvent];
    const s = session('sub', events);
    s.header = { origin: 'subagent', parentSession: 'parent', delegationDepth: 1 };
    await runtime.onSessionEvent(s, askedEvent);

    let nextCalls = 0;
    const outcome = await runtime.onApprovalRequest({
      agent: { session: s },
      toolName: 'plugin_manager',
      callId: 'c1',
      reason: 'list bundles',
    }, async () => {
      nextCalls += 1;
      return 'allowed-once';
    });
    assert.equal(outcome, 'allowed-once');
    assert.equal(nextCalls, 1);
    await runtime.onSessionEvent(s, decided('a1', 'allowed-once'));
    const entry = store.getClass('plugin_manager:list_bundles');
    assert.equal(entry.counts.total, 1);
    assert.equal(entry.counts.auto, 0);
  } finally {
    await cleanup(root, store);
  }
});

test('includeSubagents=true allows subagent auto-approval', async () => {
  const { root, store } = await makeRuntime();
  try {
    const runtime = createApprovalRuntime({ store, includeSubagents: true });
    const askedEvent = asked('a1', 'plugin_manager', {
      callId: 'c1',
      reason: 'list bundles',
    });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"list_bundles"}'), askedEvent];
    const s = session('sub', events);
    s.header = { origin: 'subagent', parentSession: 'parent', delegationDepth: 1 };
    await runtime.onSessionEvent(s, askedEvent);

    let nextCalls = 0;
    const outcome = await runtime.onApprovalRequest({
      agent: { session: s },
      toolName: 'plugin_manager',
      callId: 'c1',
      reason: 'list bundles',
    }, async () => {
      nextCalls += 1;
      return 'rejected';
    });
    assert.equal(outcome, 'allowed-once');
    assert.equal(nextCalls, 0);
    await runtime.onSessionEvent(s, decided('a1', 'allowed-once'));
    assert.equal(store.getClass('plugin_manager:list_bundles').counts.auto, 1);
  } finally {
    await cleanup(root, store);
  }
});

test('auto marker survives when approval/request runs before the asked handler', async () => {
  const { root, store, runtime } = await makeRuntime();
  try {
    const askedEvent = asked('a1', 'plugin_manager', {
      callId: 'c1',
      reason: 'list bundles',
    });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"list_bundles"}'), askedEvent];
    const s = session('s1', events);

    const outcome = await runtime.onApprovalRequest({
      agent: { session: s },
      toolName: 'plugin_manager',
      callId: 'c1',
      reason: 'list bundles',
    }, async () => 'rejected');
    assert.equal(outcome, 'allowed-once');

    await runtime.onSessionEvent(s, askedEvent);
    await runtime.onSessionEvent(s, decided('a1', 'allowed-once'));
    assert.equal(store.getClass('plugin_manager:list_bundles').counts.auto, 1);
  } finally {
    await cleanup(root, store);
  }
});

test('medium-risk classes delegate to the human answerer', async () => {
  const { root, store, runtime } = await makeRuntime();
  try {
    const askedEvent = asked('a1', 'plugin_manager', {
      callId: 'c1',
      reason: 'set plugin',
    });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"set_plugin"}'), askedEvent];
    const s = session('s1', events);
    await runtime.onSessionEvent(s, askedEvent);

    let nextCalls = 0;
    const outcome = await runtime.onApprovalRequest({
      agent: { session: s },
      toolName: 'plugin_manager',
      callId: 'c1',
      reason: 'set plugin',
    }, async () => {
      nextCalls += 1;
      return 'allowed-once';
    });
    assert.equal(outcome, 'allowed-once');
    assert.equal(nextCalls, 1);

    await runtime.onSessionEvent(s, decided('a1', 'allowed-once'));
    const entry = store.getClass('plugin_manager:set_plugin');
    assert.equal(entry.counts.allowed, 1);
    assert.equal(entry.counts.auto, 0);
  } finally {
    await cleanup(root, store);
  }
});

test('an explicitly disabled rule delegates even for a read-only class', async () => {
  const { root, store, runtime } = await makeRuntime();
  try {
    await store.init();
    await store.setRule('plugin_manager:list_bundles', false, { time: 1, source: 'ui' });
    const askedEvent = asked('a1', 'plugin_manager', {
      callId: 'c1',
      reason: 'list bundles',
    });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"list_bundles"}'), askedEvent];
    const s = session('s1', events);
    await runtime.onSessionEvent(s, askedEvent);

    let nextCalls = 0;
    const outcome = await runtime.onApprovalRequest({
      agent: { session: s },
      toolName: 'plugin_manager',
      callId: 'c1',
      reason: 'list bundles',
    }, async () => {
      nextCalls += 1;
      return 'allowed-once';
    });
    assert.equal(outcome, 'allowed-once');
    assert.equal(nextCalls, 1);
  } finally {
    await cleanup(root, store);
  }
});

test('blacklisted classes never auto-approve', async () => {
  const { root, store, runtime } = await makeRuntime();
  try {
    const askedEvent = asked('a1', 'plugin_manager', {
      callId: 'c1',
      reason: 'version exemption',
    });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"set_version_exemption"}'), askedEvent];
    const s = session('s1', events);
    await runtime.onSessionEvent(s, askedEvent);

    let nextCalls = 0;
    const outcome = await runtime.onApprovalRequest({
      agent: { session: s },
      toolName: 'plugin_manager',
      callId: 'c1',
      reason: 'version exemption',
    }, async () => {
      nextCalls += 1;
      return 'allowed-once';
    });
    assert.equal(outcome, 'allowed-once');
    assert.equal(nextCalls, 1);
  } finally {
    await cleanup(root, store);
  }
});

test('missing session delegates safely', async () => {
  const { root, store, runtime } = await makeRuntime();
  try {
    let nextCalls = 0;
    const outcome = await runtime.onApprovalRequest({ toolName: 'plugin_manager' }, async () => {
      nextCalls += 1;
      return 'unavailable';
    });
    assert.equal(outcome, 'unavailable');
    assert.equal(nextCalls, 1);
  } finally {
    await cleanup(root, store);
  }
});

test('store init failure delegates safely', async () => {
  const store = {
    init: async () => ({ ok: false, code: 'store-error' }),
    effectiveEnabled: () => true,
    recordAsked: async () => ({ ok: false }),
    recordDecided: async () => ({ ok: false }),
  };
  const runtime = createApprovalRuntime({ store });
  const s = session('s1', []);
  let nextCalls = 0;
  const outcome = await runtime.onApprovalRequest({
    agent: { session: s },
    toolName: 'plugin_manager',
  }, async () => {
    nextCalls += 1;
    return 'unavailable';
  });
  assert.equal(outcome, 'unavailable');
  assert.equal(nextCalls, 1);
});

test('decided without asked is ignored', async () => {
  const { root, store, runtime } = await makeRuntime();
  try {
    const s = session('s1', []);
    await runtime.onSessionEvent(s, decided('a1', 'allowed-once'));
    assert.equal(store.listClasses().length, 0);
  } finally {
    await cleanup(root, store);
  }
});

test('next rejection is propagated once, not retried', async () => {
  const { root, store, runtime } = await makeRuntime();
  try {
    const askedEvent = asked('a1', 'plugin_manager', {
      callId: 'c1',
      reason: 'set plugin',
    });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"set_plugin"}'), askedEvent];
    const s = session('s1', events);
    await runtime.onSessionEvent(s, askedEvent);
    let nextCalls = 0;
    await assert.rejects(runtime.onApprovalRequest({
      agent: { session: s },
      toolName: 'plugin_manager',
      callId: 'c1',
      reason: 'set plugin',
    }, async () => {
      nextCalls += 1;
      throw new Error('answerer failed');
    }));
    assert.equal(nextCalls, 1);
  } finally {
    await cleanup(root, store);
  }
});
