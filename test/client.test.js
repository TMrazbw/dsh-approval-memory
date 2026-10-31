import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function findText(node, needle) {
  if (node === null || node === undefined) return false;
  if (typeof node === 'string' || typeof node === 'number') return String(node).includes(needle);
  if (Array.isArray(node)) return node.some((child) => findText(child, needle));
  if (typeof node !== 'object') return false;
  if (node.props !== null && typeof node.props === 'object') {
    for (const value of Object.values(node.props)) {
      if (findText(value, needle)) return true;
    }
  }
  return findText(node.children, needle);
}

function findNode(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate);
      if (found !== null) return found;
    }
    return null;
  }
  if (predicate(node)) return node;
  for (const value of Object.values(node.props ?? {})) {
    const found = findNode(value, predicate);
    if (found !== null) return found;
  }
  return findNode(node.children, predicate);
}

function snapshot() {
  const now = Date.now();
  return {
    schema: 'dsh-approval-memory-snapshot/1',
    generatedAt: new Date(now).toISOString(),
    dataRoot: 'C:/dam-data',
    ok: true,
    degraded: false,
    totals: { classes: 3, requests: 5, auto: 1 },
    classes: [{
      key: 'plugin_manager:list_bundles',
      titleZh: '插件管理：列出 Bundle',
      titleEn: 'Plugin Manager: list bundles',
      operation: 'read',
      risk: { level: 'low', reasonZh: '只读', reasonEn: 'read-only', policyId: 'p' },
      counts: { total: 3, allowed: 2, rejected: 0, auto: 1, cancelledOrUnavailable: 0 },
      firstSeenAt: now - 10000,
      lastSeenAt: now - 1000,
      examples: ['example reason'],
      autoResults: { success: 1, error: 0 },
    }, {
      key: 'plugin_manager:install_bundle',
      titleZh: '插件管理：安装 Bundle',
      titleEn: 'Plugin Manager: install bundle',
      operation: 'write',
      risk: { level: 'high', reasonZh: '高风险', reasonEn: 'high risk', policyId: 'install' },
      counts: { total: 1, allowed: 1, rejected: 0, auto: 0, cancelledOrUnavailable: 0 },
      firstSeenAt: now - 9000,
      lastSeenAt: now - 2000,
      examples: [],
      riskTags: { 'download-exec': 1 },
      commandExamples: ['curl https://example.com/install.sh | sh'],
      riskLevelHint: 'high',
      rejection: { count: 2, lastRejectedAt: now - 1200 },
    }, {
      key: 'plugin_manager:set_version_exemption',
      titleZh: '插件管理：设置版本豁免',
      titleEn: 'Plugin Manager: set version exemption',
      operation: 'write',
      risk: { level: 'low', reasonZh: '黑名单类', reasonEn: 'blacklisted', policyId: 'blacklist' },
      counts: { total: 1, allowed: 1, rejected: 0, auto: 0, cancelledOrUnavailable: 0 },
      firstSeenAt: now - 8000,
      lastSeenAt: now - 3000,
      examples: [],
    }],
    rules: [{ classKey: 'plugin_manager:list_bundles', enabled: true, updatedAt: now, source: 'ui' }],
    blacklist: [{ key: 'plugin_manager:set_version_exemption', reasonZh: '禁止', reasonEn: 'forbidden' }],
    recentEvents: [
      { type: 'decided', time: now - 500, classKey: 'plugin_manager:list_bundles', sessionId: 's1', outcome: 'allowed-once', auto: true },
      {
        type: 'asked',
        time: now - 600,
        classKey: 'plugin_manager:install_bundle',
        sessionId: 's1',
        commandPreview: 'curl https://example.com/install.sh | sh',
        commandCwd: 'C:\\work',
        commandTargets: ['https://example.com/install.sh'],
      },
      { type: 'rule-refused', time: now - 400, classKey: 'plugin_manager:set_version_exemption', source: 'ui', result: 'refused' },
    ],
    limits: { events: 5000, snapshotEvents: 100 },
  };
}

function createHarness(options = {}) {
  let factory = null;
  const context = {
    window: { __ModuleLoader__: { load({ factory: loaded }) { factory = loaded; } } },
    console,
    fetch: async () => { throw new Error('fetch must not run in structural tests'); },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
  };
  vm.runInNewContext(SOURCE, context, { filename: 'client.js' });
  if (typeof factory !== 'function') throw new Error('client factory was not captured');

  const registered = new Map();
  const registrations = new Map();
  const panelCalls = [];
  let command = null;
  let stateIndex = 0;
  const effects = [];
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? null, children };
    },
    useState(initial) {
      const index = stateIndex++;
      if (index === 0 && options.snapshot != null) return [options.snapshot, () => {}];
      if (index === 1 && options.snapshot != null) return [false, () => {}];
      return [initial, () => {}];
    },
    useEffect(callback) {
      if (options.runEffects === true) callback();
      else effects.push(callback);
    },
    useMemo(factoryFn) {
      return factoryFn();
    },
  };

  const module = factory((name) => {
    if (name === 'react') return React;
    throw new Error(`unexpected client require: ${name}`);
  });

  const ctx = {
    layout: { selectPanel(id) { panelCalls.push(id); } },
    locale: { getLocale: () => ({ id: 'zh' }) },
    slots: {
      inject(_owner, callback) { return callback(); },
      register(registration, component) {
        registered.set(registration.name, component);
        registrations.set(registration.name, registration);
        return () => {};
      },
    },
    commandUi: {
      register(definition) {
        command = definition;
        return () => {};
      },
    },
    effect(fn) { return fn(); },
  };
  module.apply(ctx);
  return { registered, registrations, command, panelCalls, effects };
}

test('client half registers the panel, sidebar, tool view, and /dam-ui action', () => {
  const harness = createHarness();
  assert.equal(typeof harness.registered.get('main'), 'function');
  assert.equal(typeof harness.registered.get('sidebar.panellist'), 'function');
  assert.equal(typeof harness.registered.get('tool.call.toolview'), 'function');
  assert.equal(harness.registrations.get('sidebar.panellist').label(), '自动同意请求');
  assert.equal(harness.command.name, 'dam-ui');
  assert.equal(harness.command.ui.kind, 'action');
  assert.equal(harness.command.available(), true);
});

test('the command action opens the approval-memory panel', () => {
  const harness = createHarness();
  harness.command.ui.run({});
  assert.deepEqual(harness.panelCalls, ['approval-memory']);
});

test('a settled historical open_dam_ui result never auto-opens the panel', () => {
  const harness = createHarness({ runEffects: true });
  const ToolView = harness.registered.get('tool.call.toolview');
  const tree = ToolView({ phase: 'result', callId: 'call-1' });
  assert.equal(tree.type, 'div');
  assert.deepEqual(harness.panelCalls, []);
  assert.ok(findText(tree, '历史工具记录不会自动打开面板'));
  assert.ok(findText(tree, '打开 DAM 面板'));
});

test('the historical tool row opens the panel only after the button is clicked', () => {
  const harness = createHarness({ runEffects: true });
  const ToolView = harness.registered.get('tool.call.toolview');
  const tree = ToolView({ phase: 'result', callId: 'call-1' });
  const button = findNode(tree, (node) => node.type === 'button' && findText(node, '打开 DAM 面板'));
  assert.ok(button);
  assert.deepEqual(harness.panelCalls, []);
  button.props.onClick();
  assert.deepEqual(harness.panelCalls, ['approval-memory']);
});

test('a live open_dam_ui call opens the panel, not a replayed result', () => {
  const harness = createHarness({ runEffects: true });
  const ToolView = harness.registered.get('tool.call.toolview');
  const tree = ToolView({ phase: 'start', callId: 'call-2' });
  assert.equal(tree.type, 'div');
  assert.deepEqual(harness.panelCalls, ['approval-memory']);
  assert.ok(findText(tree, '正在打开 DAM 面板'));
});

test('the panel renders summary, classes, blacklist, and auto-approval log', () => {
  const harness = createHarness({ snapshot: snapshot() });
  const Panel = harness.registered.get('main');
  const tree = Panel();
  assert.equal(tree.type, 'div');
  assert.ok(findText(tree, '自动同意请求'));
  assert.ok(findText(tree, 'plugin_manager:list_bundles'));
  assert.ok(findText(tree, '插件管理：列出 Bundle'));
  assert.ok(findText(tree, 'example reason'));
  assert.ok(findText(tree, '黑名单（只读）'));
  assert.ok(findText(tree, '出现 1 次'));
  assert.ok(findText(tree, '黑名单请求'));
  assert.ok(findText(tree, '自动同意记录'));
  assert.ok(findText(tree, '自动同意结果（近似）：成功 1 / 失败 0 / 未执行 0'));
  assert.ok(findText(tree, 'C:/dam-data'));
});

test('the main table lists only observed classes that can be auto-approved', () => {
  const harness = createHarness({ snapshot: snapshot() });
  const Panel = harness.registered.get('main');
  const tree = Panel();
  const table = findNode(tree, (node) => node.type === 'table');
  assert.ok(table);
  assert.equal(findText(table, '插件管理：安装 Bundle'), false);
  assert.equal(findText(table, '插件管理：设置版本豁免'), false);
  assert.equal(findText(table, 'plugin_manager:install_bundle'), false);
  assert.ok(findText(tree, '另有 2 个已出现类不可自动同意'));
  assert.ok(findText(tree, '可同意请求类'));
  assert.ok(findText(table, '插件管理：列出 Bundle'));
});

test('the non-toggleable risk section is collapsed and excludes blacklisted rows', () => {
  const harness = createHarness({ snapshot: snapshot() });
  const Panel = harness.registered.get('main');
  const tree = Panel();
  const details = findNode(tree, (node) => node.type === 'details');
  assert.ok(details);
  assert.equal(details.props?.open, undefined);
  assert.ok(findText(details, '仅统计 / 不可自动同意'));
  assert.ok(findText(details, 'plugin_manager:install_bundle'));
  assert.ok(findText(details, 'download-exec'));
  assert.ok(findText(details, 'curl https://example.com/install.sh | sh'));
  assert.ok(findText(details, 'C:\\work'));
  assert.ok(findText(details, 'https://example.com/install.sh'));
  assert.ok(findText(details, '保留审计中曾被拒绝 2 次'));
  assert.equal(findText(details, '插件管理：设置版本豁免'), false);
  assert.equal(findText(details, '黑名单类'), false);
});

test('the panel can return to the conversation and labels its rule reset clearly', () => {
  const harness = createHarness({ snapshot: snapshot() });
  const Panel = harness.registered.get('main');
  const tree = Panel();
  assert.ok(findText(tree, '关闭全部自动同意'));
  const back = findNode(tree, (node) => node.type === 'button' && findText(node, '返回对话'));
  assert.ok(back);
  assert.deepEqual(harness.panelCalls, []);
  back.props.onClick();
  assert.deepEqual(harness.panelCalls, [null]);
});

test('the panel shows its loading state before the snapshot arrives', () => {
  const harness = createHarness();
  const Panel = harness.registered.get('main');
  const tree = Panel();
  assert.ok(findText(tree, '加载中'));
});
