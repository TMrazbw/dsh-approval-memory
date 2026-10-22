import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../lib/store.js';
import { classifyRequest } from '../lib/classes.js';

function pm(action) {
  return classifyRequest({ toolName: 'plugin_manager', action });
}

async function makeStore(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'dam-store-'));
  const store = createStore({ root, clock: () => 1000, ...options });
  return { root, store };
}

async function cleanup(root, store) {
  if (store) await store.close();
  await rm(root, { recursive: true, force: true });
}

test('init creates the file layout and starts empty', async () => {
  const { root, store } = await makeStore();
  try {
    const result = await store.init();
    assert.equal(result.ok, true);
    assert.deepEqual(await readFile(path.join(root, 'classes.json'), 'utf8').then(JSON.parse), {
      version: 1,
      classes: {},
    });
    assert.deepEqual(await readFile(path.join(root, 'rules.json'), 'utf8').then(JSON.parse), {
      version: 1,
      rules: {},
    });
    assert.equal(await readFile(path.join(root, 'events.jsonl'), 'utf8'), '');
    assert.equal(await readFile(path.join(root, '_plugin.log'), 'utf8'), '');
    assert.equal(store.listClasses().length, 0);
    assert.equal(store.snapshot().blacklist.length, 5);
  } finally {
    await cleanup(root, store);
  }
});

test('recordAsked creates a class and increments an existing one', async () => {
  const { root, store } = await makeStore();
  try {
    await store.init();
    const first = await store.recordAsked({
      classDef: pm('list_bundles'),
      sessionId: 's1',
      approvalId: 'a1',
      time: 100,
    });
    assert.equal(first.ok, true);
    assert.equal(first.duplicate, false);
    assert.equal(first.class.counts.total, 1);
    assert.equal(first.class.firstSeenAt, 100);

    const second = await store.recordAsked({
      classDef: pm('list_bundles'),
      sessionId: 's1',
      approvalId: 'a2',
      time: 200,
    });
    assert.equal(second.ok, true);
    assert.equal(second.class.counts.total, 2);
    assert.equal(second.class.firstSeenAt, 100);
    assert.equal(second.class.lastSeenAt, 200);

    await store.recordAsked({
      classDef: pm('list_plugins'),
      sessionId: 's2',
      approvalId: 'b1',
      time: 150,
    });
    assert.equal(store.listClasses().length, 2);
    assert.equal(store.snapshot().totals.requests, 3);
  } finally {
    await cleanup(root, store);
  }
});

test('duplicate asked ids do not increment counts', async () => {
  const { root, store } = await makeStore();
  try {
    await store.init();
    const input = {
      classDef: pm('list_bundles'),
      sessionId: 's1',
      approvalId: 'same',
      time: 100,
    };
    assert.equal((await store.recordAsked(input)).duplicate, false);
    const duplicate = await store.recordAsked(input);
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.duplicate, true);
    assert.equal(store.getClass('plugin_manager:list_bundles').counts.total, 1);
  } finally {
    await cleanup(root, store);
  }
});

test('the same approval id in different sessions is not a duplicate', async () => {
  const { root, store } = await makeStore();
  try {
    await store.init();
    await store.recordAsked({ classDef: pm('list_bundles'), sessionId: 's1', approvalId: 'same', time: 100 });
    await store.recordAsked({ classDef: pm('list_bundles'), sessionId: 's2', approvalId: 'same', time: 101 });
    assert.equal(store.getClass('plugin_manager:list_bundles').counts.total, 2);
  } finally {
    await cleanup(root, store);
  }
});

test('decisions update the correct split and dedupe by session + id', async () => {
  const { root, store } = await makeStore();
  try {
    await store.init();
    for (const id of ['a1', 'a2', 'a3', 'a4']) {
      await store.recordAsked({
        classDef: pm('list_bundles'),
        sessionId: 's1',
        approvalId: id,
        time: 100,
      });
    }
    await store.recordDecided({ classKey: 'plugin_manager:list_bundles', sessionId: 's1', approvalId: 'a1', outcome: 'allowed-once', time: 110 });
    await store.recordDecided({ classKey: 'plugin_manager:list_bundles', sessionId: 's1', approvalId: 'a2', outcome: 'rejected', time: 111 });
    await store.recordDecided({ classKey: 'plugin_manager:list_bundles', sessionId: 's1', approvalId: 'a3', outcome: 'allowed-once', auto: true, time: 112 });
    await store.recordDecided({ classKey: 'plugin_manager:list_bundles', sessionId: 's1', approvalId: 'a4', outcome: 'unavailable', time: 113 });

    const entry = store.getClass('plugin_manager:list_bundles');
    assert.equal(entry.counts.total, 4);
    assert.equal(entry.counts.allowed, 1);
    assert.equal(entry.counts.rejected, 1);
    assert.equal(entry.counts.auto, 1);
    assert.equal(entry.counts.cancelledOrUnavailable, 1);

    const duplicate = await store.recordDecided({
      classKey: 'plugin_manager:list_bundles',
      sessionId: 's1',
      approvalId: 'a1',
      outcome: 'rejected',
      time: 120,
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(store.getClass('plugin_manager:list_bundles').counts.rejected, 1);
  } finally {
    await cleanup(root, store);
  }
});

test('decision for an unknown class fails without throwing', async () => {
  const { root, store } = await makeStore();
  try {
    await store.init();
    const result = await store.recordDecided({
      classKey: 'unknown:none',
      sessionId: 's1',
      approvalId: 'x',
      outcome: 'allowed-once',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unknown-class');
  } finally {
    await cleanup(root, store);
  }
});

test('rules override defaults and disableAll turns every known class off', async () => {
  const { root, store } = await makeStore();
  try {
    await store.init();
    assert.equal(store.effectiveEnabled('plugin_manager:list_bundles', true), true);
    assert.equal(store.effectiveEnabled('plugin_manager:set_plugin', false), false);

    const disabled = await store.setRule('plugin_manager:list_bundles', false, { time: 10, source: 'ui' });
    assert.equal(disabled.ok, true);
    assert.equal(store.effectiveEnabled('plugin_manager:list_bundles', true), false);
    assert.equal(store.ruleFor('plugin_manager:list_bundles').enabled, false);

    await store.setRule('plugin_manager:list_bundles', true, { time: 11, source: 'ui' });
    assert.equal(store.effectiveEnabled('plugin_manager:list_bundles', true), true);
    assert.equal(store.listRules().length, 1);

    const all = await store.disableAll({ time: 12, source: 'ui' });
    assert.equal(all.ok, true);
    assert.ok(all.count >= 12);
    assert.equal(store.effectiveEnabled('plugin_manager:list_bundles', true), false);
    assert.equal(store.effectiveEnabled('plugin_manager:set_plugin', false), false);
    assert.ok(store.listRules().every((rule) => rule.enabled === false));
  } finally {
    await cleanup(root, store);
  }
});

test('blacklisted rule creation is refused and audited', async () => {
  const { root, store } = await makeStore();
  try {
    await store.init();
    const result = await store.setRule('plugin_manager:set_version_exemption', true, { time: 5, source: 'ui' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'denied-by-policy');
    assert.equal(store.ruleFor('plugin_manager:set_version_exemption'), undefined);
    assert.equal(store.effectiveEnabled('plugin_manager:set_version_exemption', true), false);
    assert.ok(store.recentEvents(10).some((event) => event.type === 'rule-refused'));
  } finally {
    await cleanup(root, store);
  }
});

test('a blacklisted rule found on disk is dropped and audited on load', async () => {
  const { root, store } = await makeStore();
  try {
    await writeFile(path.join(root, 'rules.json'), JSON.stringify({
      version: 1,
      rules: {
        'plugin_manager:set_version_exemption': {
          enabled: true,
          updatedAt: 1,
          source: 'manual-edit',
        },
      },
    }), 'utf8');
    const init = await store.init();
    assert.equal(init.ok, true);
    assert.equal(store.ruleFor('plugin_manager:set_version_exemption'), undefined);
    assert.equal(store.effectiveEnabled('plugin_manager:set_version_exemption', true), false);
    assert.ok(store.recentEvents(10).some((event) => (
      event.type === 'rule-refused' && event.source === 'load'
    )));
  } finally {
    await cleanup(root, store);
  }
});

test('classes and rules survive reopening the store', async () => {
  const { root, store } = await makeStore();
  try {
    await store.init();
    await store.recordAsked({ classDef: pm('list_bundles'), sessionId: 's1', approvalId: 'a1', time: 100 });
    await store.recordDecided({ classKey: 'plugin_manager:list_bundles', sessionId: 's1', approvalId: 'a1', outcome: 'allowed-once', time: 110 });
    await store.setRule('plugin_manager:list_bundles', false, { time: 120, source: 'ui' });
    await store.close();

    const reopened = createStore({ root, clock: () => 1000 });
    const init = await reopened.init();
    try {
      assert.equal(init.ok, true);
      const entry = reopened.getClass('plugin_manager:list_bundles');
      assert.equal(entry.counts.total, 1);
      assert.equal(entry.counts.allowed, 1);
      assert.equal(reopened.ruleFor('plugin_manager:list_bundles').enabled, false);
      assert.ok(reopened.recentEvents(10).length >= 2);
    } finally {
      await reopened.close();
    }
  } finally {
    await cleanup(root, null);
  }
});

test('events are capped and compaction survives reopening', async () => {
  const { root, store } = await makeStore({ maxEvents: 3 });
  try {
    await store.init();
    for (let index = 0; index < 5; index += 1) {
      await store.recordAsked({
        classDef: pm('list_bundles'),
        sessionId: 's1',
        approvalId: `a${index}`,
        time: 100 + index,
      });
    }
    assert.equal(store.recentEvents(10).length, 3);
    assert.equal(store.getClass('plugin_manager:list_bundles').counts.total, 5);
    await store.close();

    const reopened = createStore({ root, maxEvents: 3, clock: () => 1000 });
    try {
      await reopened.init();
      assert.equal(reopened.recentEvents(10).length, 3);
      assert.equal(reopened.getClass('plugin_manager:list_bundles').counts.total, 5);
    } finally {
      await reopened.close();
    }
  } finally {
    await cleanup(root, null);
  }
});

test('twenty concurrent asks do not lose counts', async () => {
  const { root, store } = await makeStore();
  try {
    await store.init();
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => store.recordAsked({
      classDef: pm('list_bundles'),
      sessionId: 's1',
      approvalId: `c${index}`,
      time: 100 + index,
    })));
    assert.ok(results.every((result) => result.ok === true));
    assert.equal(store.getClass('plugin_manager:list_bundles').counts.total, 20);
    assert.equal(store.recentEvents(100).length, 20);
  } finally {
    await cleanup(root, store);
  }
});

test('a storage root that is a file degrades without throwing', async () => {
  const root = path.join(tmpdir(), `dam-store-bad-${process.pid}-${Date.now()}`);
  await writeFile(root, 'not a directory', 'utf8');
  const store = createStore({ root, clock: () => 1000 });
  try {
    const init = await store.init();
    assert.equal(init.ok, false);
    assert.equal(init.code, 'store-error');
    const result = await store.recordAsked({
      classDef: pm('list_bundles'),
      sessionId: 's1',
      approvalId: 'a1',
      time: 100,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'store-error');
  } finally {
    await store.close();
    await rm(root, { force: true });
  }
});

test('corrupt classes JSON falls back to an empty store', async () => {
  const { root, store } = await makeStore();
  try {
    await writeFile(path.join(root, 'classes.json'), '{broken', 'utf8');
    const init = await store.init();
    assert.equal(init.ok, true);
    assert.equal(store.listClasses().length, 0);
    const result = await store.recordAsked({
      classDef: pm('list_bundles'),
      sessionId: 's1',
      approvalId: 'a1',
      time: 100,
    });
    assert.equal(result.ok, true);
    assert.equal(store.getClass('plugin_manager:list_bundles').counts.total, 1);
  } finally {
    await cleanup(root, store);
  }
});

test('invalid class and closed-store writes fail explicitly', async () => {
  const { root, store } = await makeStore();
  try {
    await store.init();
    const invalid = await store.recordAsked({ classDef: { key: '' }, sessionId: 's1', approvalId: 'a1' });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, 'invalid-class');
    await store.close();
    const closed = await store.recordAsked({
      classDef: pm('list_bundles'),
      sessionId: 's1',
      approvalId: 'a2',
    });
    assert.equal(closed.ok, false);
    assert.equal(closed.code, 'store-closed');
  } finally {
    await cleanup(root, null);
  }
});

test('snapshot contains classes, rules, blacklist, totals, and events', async () => {
  const { root, store } = await makeStore();
  try {
    await store.init();
    await store.recordAsked({ classDef: pm('list_bundles'), sessionId: 's1', approvalId: 'a1', time: 100 });
    await store.recordDecided({ classKey: 'plugin_manager:list_bundles', sessionId: 's1', approvalId: 'a1', outcome: 'allowed-once', auto: true, time: 110 });
    await store.setRule('plugin_manager:list_bundles', true, { time: 120, source: 'ui' });
    const snapshot = store.snapshot();
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.classes.length, 1);
    assert.equal(snapshot.rules.length, 1);
    assert.equal(snapshot.blacklist.length, 5);
    assert.equal(snapshot.totals.requests, 1);
    assert.equal(snapshot.totals.auto, 1);
    assert.equal(snapshot.recentEvents.length, 2);
  } finally {
    await cleanup(root, store);
  }
});
