import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../lib/store.js';
import { createApprovalRuntime } from '../lib/host.js';
import {
  SNAPSHOT_ROUTE,
  createMutateRoute,
  createSnapshotRoute,
} from '../lib/bridge.js';

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

function decided(id, outcome, options = {}) {
  return {
    type: 'approval/decided',
    time: options.time ?? 110,
    data: { id, outcome },
  };
}

function session(id, events, header) {
  return {
    id,
    ...header === undefined ? {} : { header },
    snapshotEvents: () => events,
  };
}

async function makeHarness(runtimeOptions = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'dam-integration-'));
  const store = createStore({ root, clock: () => 1000 });
  await store.init();
  const runtime = createApprovalRuntime({ store, ...runtimeOptions });
  return { root, store, runtime };
}

async function cleanup(root, store) {
  await store.close();
  await rm(root, { recursive: true, force: true });
}

function snapshotRequest() {
  return new Request(`http://127.0.0.1${SNAPSHOT_ROUTE}`, {
    headers: { accept: 'application/json' },
  });
}

function mutateRequest(payload) {
  return new Request('http://127.0.0.1/api/approval-memory.mutate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function readSnapshot(store) {
  const route = createSnapshotRoute({ store, dataRoot: 'C:/dam-integration' });
  const response = await route.fetch(snapshotRequest());
  assert.equal(response.status, 200);
  return response.json();
}

async function mutate(store, payload) {
  const route = createMutateRoute({ store });
  const response = await route.fetch(mutateRequest(payload));
  return { status: response.status, body: await response.json() };
}

function request(s, toolName, options = {}) {
  return {
    agent: { session: s },
    toolName,
    ...options.callId === undefined ? {} : { callId: options.callId },
    ...options.reason === undefined ? {} : { reason: options.reason },
  };
}

test('integration: one auto approval appears in the class table and audit', async () => {
  const { root, store, runtime } = await makeHarness();
  try {
    const askedEvent = asked('a1', 'plugin_manager', { callId: 'c1', reason: 'list bundles' });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"list_bundles"}'), askedEvent];
    const s = session('s1', events);
    await runtime.onSessionEvent(s, askedEvent);

    let nextCalls = 0;
    const outcome = await runtime.onApprovalRequest(request(s, 'plugin_manager', {
      callId: 'c1',
      reason: 'list bundles',
    }), async () => {
      nextCalls += 1;
      return 'rejected';
    });
    assert.equal(outcome, 'allowed-once');
    assert.equal(nextCalls, 0);
    await runtime.onSessionEvent(s, decided('a1', 'allowed-once'));

    const snapshot = await readSnapshot(store);
    assert.equal(snapshot.classes.length, 1);
    assert.equal(snapshot.classes[0].key, 'plugin_manager:list_bundles');
    assert.equal(snapshot.classes[0].counts.total, 1);
    assert.equal(snapshot.classes[0].counts.auto, 1);
    assert.equal(snapshot.classes[0].counts.allowed, 0);
    assert.equal(snapshot.totals.auto, 1);
    const autoEvent = snapshot.recentEvents.find((event) => event.type === 'decided');
    assert.equal(autoEvent.auto, true);
    assert.equal(autoEvent.outcome, 'allowed-once');
  } finally {
    await cleanup(root, store);
  }
});

test('integration: a user rule-off delegates and records a human allow', async () => {
  const { root, store, runtime } = await makeHarness();
  try {
    const rule = await mutate(store, {
      action: 'setRule',
      classKey: 'plugin_manager:list_bundles',
      enabled: false,
    });
    assert.equal(rule.status, 200);
    assert.equal(rule.body.ok, true);

    const askedEvent = asked('a1', 'plugin_manager', { callId: 'c1', reason: 'list bundles' });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"list_bundles"}'), askedEvent];
    const s = session('s1', events);
    await runtime.onSessionEvent(s, askedEvent);

    let nextCalls = 0;
    const outcome = await runtime.onApprovalRequest(request(s, 'plugin_manager', {
      callId: 'c1',
      reason: 'list bundles',
    }), async () => {
      nextCalls += 1;
      return 'allowed-once';
    });
    assert.equal(outcome, 'allowed-once');
    assert.equal(nextCalls, 1);
    await runtime.onSessionEvent(s, decided('a1', 'allowed-once'));

    const snapshot = await readSnapshot(store);
    const entry = snapshot.classes[0];
    assert.equal(entry.counts.allowed, 1);
    assert.equal(entry.counts.auto, 0);
    assert.equal(snapshot.rules.find((row) => row.classKey === entry.key).enabled, false);
  } finally {
    await cleanup(root, store);
  }
});

test('integration: blacklisted rule is refused and audited without a rule', async () => {
  const { root, store } = await makeHarness();
  try {
    const result = await mutate(store, {
      action: 'setRule',
      classKey: 'plugin_manager:set_version_exemption',
      enabled: true,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.code, 'denied-by-policy');

    const snapshot = await readSnapshot(store);
    assert.equal(snapshot.rules.some((row) => row.classKey === 'plugin_manager:set_version_exemption'), false);
    assert.equal(snapshot.blacklist.some((row) => row.key === 'plugin_manager:set_version_exemption'), true);
    assert.equal(snapshot.recentEvents.some((event) => event.type === 'rule-refused'), true);
  } finally {
    await cleanup(root, store);
  }
});

test('integration: never policy delegates safely', async () => {
  const { root, store, runtime } = await makeHarness({ policyOf: () => 'never' });
  try {
    const askedEvent = asked('a1', 'plugin_manager', { callId: 'c1', reason: 'list bundles' });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"list_bundles"}'), askedEvent];
    const s = session('s1', events);
    await runtime.onSessionEvent(s, askedEvent);

    let nextCalls = 0;
    const outcome = await runtime.onApprovalRequest(request(s, 'plugin_manager', {
      callId: 'c1',
      reason: 'list bundles',
    }), async () => {
      nextCalls += 1;
      return 'rejected';
    });
    assert.equal(outcome, 'rejected');
    assert.equal(nextCalls, 1);
  } finally {
    await cleanup(root, store);
  }
});

test('integration: subagent is counted but not auto-approved by default', async () => {
  const { root, store, runtime } = await makeHarness();
  try {
    const askedEvent = asked('a1', 'plugin_manager', { callId: 'c1', reason: 'list bundles' });
    const events = [toolCall('c1', 'plugin_manager', '{"action":"list_bundles"}'), askedEvent];
    const s = session('sub', events, { origin: 'subagent', parentSession: 'parent', delegationDepth: 1 });
    await runtime.onSessionEvent(s, askedEvent);

    let nextCalls = 0;
    const outcome = await runtime.onApprovalRequest(request(s, 'plugin_manager', {
      callId: 'c1',
      reason: 'list bundles',
    }), async () => {
      nextCalls += 1;
      return 'allowed-once';
    });
    assert.equal(outcome, 'allowed-once');
    assert.equal(nextCalls, 1);
    await runtime.onSessionEvent(s, decided('a1', 'allowed-once'));

    const snapshot = await readSnapshot(store);
    assert.equal(snapshot.classes[0].counts.total, 1);
    assert.equal(snapshot.classes[0].counts.allowed, 1);
    assert.equal(snapshot.classes[0].counts.auto, 0);
  } finally {
    await cleanup(root, store);
  }
});

test('integration: two sessions produce separate classes and distinguish auto from human', async () => {
  const { root, store, runtime } = await makeHarness();
  try {
    const firstAsked = asked('a1', 'plugin_manager', { callId: 'c1', reason: 'list bundles' });
    const firstEvents = [toolCall('c1', 'plugin_manager', '{"action":"list_bundles"}'), firstAsked];
    const firstSession = session('s1', firstEvents);
    await runtime.onSessionEvent(firstSession, firstAsked);
    await runtime.onApprovalRequest(request(firstSession, 'plugin_manager', {
      callId: 'c1',
      reason: 'list bundles',
    }), async () => 'rejected');
    await runtime.onSessionEvent(firstSession, decided('a1', 'allowed-once'));

    await store.setRule('plugin_manager:list_plugins', false, { time: 150, source: 'ui' });
    const secondAsked = asked('a2', 'plugin_manager', { callId: 'c2', reason: 'list plugins' });
    const secondEvents = [toolCall('c2', 'plugin_manager', '{"action":"list_plugins"}'), secondAsked];
    const secondSession = session('s2', secondEvents);
    await runtime.onSessionEvent(secondSession, secondAsked);
    let nextCalls = 0;
    const outcome = await runtime.onApprovalRequest(request(secondSession, 'plugin_manager', {
      callId: 'c2',
      reason: 'list plugins',
    }), async () => {
      nextCalls += 1;
      return 'allowed-once';
    });
    assert.equal(outcome, 'allowed-once');
    assert.equal(nextCalls, 1);
    await runtime.onSessionEvent(secondSession, decided('a2', 'allowed-once'));

    const snapshot = await readSnapshot(store);
    assert.equal(snapshot.classes.length, 2);
    assert.equal(snapshot.totals.requests, 2);
    assert.equal(snapshot.totals.auto, 1);
    assert.equal(snapshot.recentEvents.filter((event) => event.type === 'decided' && event.auto === true).length, 1);
    assert.equal(snapshot.recentEvents.filter((event) => event.type === 'decided' && event.auto === false).length, 1);
  } finally {
    await cleanup(root, store);
  }
});
