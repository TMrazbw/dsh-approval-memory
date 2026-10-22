import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../lib/store.js';
import {
  SNAPSHOT_ROUTE,
  createBridgeRoutes,
  createMutateRoute,
  createSnapshotRoute,
} from '../lib/bridge.js';

async function makeStore() {
  const root = await mkdtemp(path.join(tmpdir(), 'dam-bridge-'));
  const store = createStore({ root, clock: () => 1000 });
  await store.init();
  return { root, store };
}

async function cleanup(root, store) {
  await store.close();
  await rm(root, { recursive: true, force: true });
}

function request(url, options = {}) {
  return new Request(`http://127.0.0.1${url}`, options);
}

function post(body) {
  return request('/api/approval-memory.mutate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('snapshot route returns classes, rules, blacklist, totals, and recent events', async () => {
  const { root, store } = await makeStore();
  try {
    const classDef = {
      key: 'plugin_manager:list_bundles',
      titleZh: '插件管理：列出 Bundle',
      titleEn: 'Plugin Manager: list bundles',
      operation: 'read',
      risk: { level: 'low', reasonZh: 'read', reasonEn: 'read', policyId: 'p' },
    };
    await store.recordAsked({ classDef, sessionId: 's1', approvalId: 'a1', time: 100 });
    await store.recordDecided({ classKey: classDef.key, sessionId: 's1', approvalId: 'a1', outcome: 'allowed-once', auto: true, time: 110 });
    await store.setRule(classDef.key, false, { time: 120, source: 'ui' });

    const route = createSnapshotRoute({ store, dataRoot: 'C:/dam-data' });
    assert.equal(route.path, SNAPSHOT_ROUTE);
    const response = await route.fetch(request(SNAPSHOT_ROUTE));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schema, 'dsh-approval-memory-snapshot/1');
    assert.equal(body.dataRoot, 'C:/dam-data');
    assert.equal(body.classes.length, 1);
    assert.equal(body.rules.length, 1);
    assert.equal(body.blacklist.length, 5);
    assert.equal(body.totals.requests, 1);
    assert.equal(body.totals.auto, 1);
    assert.equal(body.recentEvents.length, 2);
    assert.equal(body.limits.events, 5000);
  } finally {
    await cleanup(root, store);
  }
});

test('snapshot route rejects non-GET', async () => {
  const { root, store } = await makeStore();
  try {
    const route = createSnapshotRoute({ store });
    const response = await route.fetch(request(SNAPSHOT_ROUTE, { method: 'POST' }));
    assert.equal(response.status, 405);
  } finally {
    await cleanup(root, store);
  }
});

test('mutate setRule persists a switch', async () => {
  const { root, store } = await makeStore();
  try {
    const route = createMutateRoute({ store });
    const response = await route.fetch(post({
      action: 'setRule',
      classKey: 'plugin_manager:list_bundles',
      enabled: false,
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.rule.enabled, false);
    assert.equal(store.effectiveEnabled('plugin_manager:list_bundles', true), false);
  } finally {
    await cleanup(root, store);
  }
});

test('mutate blacklisted rule returns denied-by-policy without a rule', async () => {
  const { root, store } = await makeStore();
  try {
    const route = createMutateRoute({ store });
    const response = await route.fetch(post({
      action: 'setRule',
      classKey: 'plugin_manager:set_version_exemption',
      enabled: true,
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'denied-by-policy');
    assert.equal(store.ruleFor('plugin_manager:set_version_exemption'), undefined);
  } finally {
    await cleanup(root, store);
  }
});

test('mutate closeAll turns all known classes off', async () => {
  const { root, store } = await makeStore();
  try {
    const route = createMutateRoute({ store });
    const response = await route.fetch(post({ action: 'closeAll' }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.ok(body.count >= 12);
    assert.equal(store.effectiveEnabled('plugin_manager:list_bundles', true), false);
  } finally {
    await cleanup(root, store);
  }
});

test('mutate validates method, body, class, enabled, and action', async () => {
  const { root, store } = await makeStore();
  try {
    const route = createMutateRoute({ store });
    assert.equal((await route.fetch(request('/api/approval-memory.mutate'))).status, 405);
    assert.equal((await route.fetch(request('/api/approval-memory.mutate', {
      method: 'POST',
      body: 'not-json',
    }))).status, 415);
    assert.equal((await route.fetch(request('/api/approval-memory.mutate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    }))).status, 400);
    assert.equal((await route.fetch(post({ action: 'setRule', classKey: '', enabled: true }))).status, 400);
    assert.equal((await route.fetch(post({ action: 'setRule', classKey: 'x', enabled: 'yes' }))).status, 400);
    assert.equal((await route.fetch(post({ action: 'unknown' }))).status, 400);
  } finally {
    await cleanup(root, store);
  }
});

test('createBridgeRoutes returns snapshot then mutation route', () => {
  const { store } = { store: { init: async () => ({ ok: true }), snapshot: () => ({}), setRule: async () => ({ ok: true }) } };
  const routes = createBridgeRoutes({ store });
  assert.equal(routes.length, 2);
  assert.equal(routes[0].path, SNAPSHOT_ROUTE);
  assert.equal(routes[1].path, '/api/approval-memory.mutate');
});

test('snapshot route returns 503 when the store cannot initialize', async () => {
  const route = createSnapshotRoute({
    store: {
      init: async () => ({ ok: false, code: 'store-error' }),
      snapshot: () => ({}),
    },
  });
  const response = await route.fetch(request(SNAPSHOT_ROUTE));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, 'store-error');
});
