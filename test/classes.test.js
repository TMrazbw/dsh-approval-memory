import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRequest,
  getKnownClass,
  isAutoApprovable,
  listKnownClasses,
} from '../lib/classes.js';

test('classifies list_bundles as a low-risk read-only class', () => {
  const def = classifyRequest({ toolName: 'plugin_manager', action: 'list_bundles' });
  assert.equal(def.key, 'plugin_manager:list_bundles');
  assert.equal(def.operation, 'read');
  assert.equal(def.risk.level, 'low');
  assert.equal(def.autoApprove, true);
  assert.equal(def.blacklisted, false);
  assert.match(def.titleZh, /列出 Bundle/);
});

test('pagination arguments do not change the class key', () => {
  const first = classifyRequest({
    toolName: 'plugin_manager',
    action: 'list_bundles',
    args: { action: 'list_bundles', offset: 0, limit: 25 },
  });
  const second = classifyRequest({
    toolName: 'plugin_manager',
    action: 'list_bundles',
    args: { action: 'list_bundles', offset: 50, limit: 100 },
  });
  assert.equal(first.key, second.key);
});

test('all three list_* actions are auto-approvable low risk', () => {
  for (const action of ['list_plugins', 'list_bundles', 'list_version_exemptions']) {
    const def = classifyRequest({ toolName: 'plugin_manager', action });
    assert.equal(def.risk.level, 'low');
    assert.equal(isAutoApprovable(def), true, action);
  }
});

test('set_plugin is medium risk and not auto-approved', () => {
  const def = classifyRequest({ toolName: 'plugin_manager', action: 'set_plugin' });
  assert.equal(def.operation, 'config');
  assert.equal(def.risk.level, 'medium');
  assert.equal(def.autoApprove, false);
  assert.equal(isAutoApprovable(def), false);
});

test('install_bundle is high risk and not auto-approved', () => {
  const def = classifyRequest({ toolName: 'plugin_manager', action: 'install_bundle' });
  assert.equal(def.operation, 'install');
  assert.equal(def.risk.level, 'high');
  assert.equal(def.autoApprove, false);
});

test('set_version_exemption is blacklisted', () => {
  const def = classifyRequest({ toolName: 'plugin_manager', action: 'set_version_exemption' });
  assert.equal(def.blacklisted, true);
  assert.equal(def.autoApprove, false);
  assert.equal(isAutoApprovable(def), false);
});

test('bash workspace-write escalation is high risk and not auto-approved', () => {
  const def = classifyRequest({ toolName: 'bash', requestedMode: 'workspace-write' });
  assert.equal(def.key, 'bash:sandbox:workspace-write');
  assert.equal(def.operation, 'execute');
  assert.equal(def.risk.level, 'high');
  assert.equal(def.escalation, true);
  assert.equal(def.scope, 'workspace');
  assert.equal(def.autoApprove, false);
});

test('bash danger-full-access is blacklisted', () => {
  const def = classifyRequest({ toolName: 'bash', requestedMode: 'danger-full-access' });
  assert.equal(def.key, 'bash:sandbox:danger-full-access');
  assert.equal(def.blacklisted, true);
  assert.equal(def.autoApprove, false);
});

test('pwsh workspace-write is recognized', () => {
  const def = classifyRequest({ toolName: 'pwsh', requestedMode: 'workspace-write' });
  assert.equal(def.key, 'pwsh:sandbox:workspace-write');
  assert.equal(def.risk.level, 'high');
});

test('file write workspace-write is recognized', () => {
  const def = classifyRequest({ toolName: 'write', requestedMode: 'workspace-write' });
  assert.equal(def.key, 'write:sandbox:workspace-write');
  assert.equal(def.operation, 'write');
  assert.equal(def.blacklisted, false);
  assert.equal(def.autoApprove, false);
});

test('file edit danger-full-access is blacklisted', () => {
  const def = classifyRequest({ toolName: 'edit', requestedMode: 'danger-full-access' });
  assert.equal(def.blacklisted, true);
});

test('missing sandbox mode becomes an unknown, non-approvable class', () => {
  const def = classifyRequest({ toolName: 'bash' });
  assert.equal(def.key, 'bash:sandbox:unknown');
  assert.equal(def.risk.level, 'unknown');
  assert.equal(def.known, false);
  assert.equal(def.autoApprove, false);
});

test('unknown plugin_manager action is visible but not auto-approved', () => {
  const def = classifyRequest({ toolName: 'plugin_manager', action: 'future_action' });
  assert.equal(def.key, 'plugin_manager:future_action');
  assert.equal(def.risk.level, 'unknown');
  assert.equal(def.known, false);
  assert.equal(def.autoApprove, false);
});

test('unknown tool becomes unknown:<toolName>', () => {
  const def = classifyRequest({ toolName: 'mcp:database' });
  assert.equal(def.key, 'unknown:mcp:database');
  assert.equal(def.operation, 'unknown');
  assert.equal(def.risk.level, 'unknown');
  assert.equal(def.autoApprove, false);
});

test('run_code keeps the inner tool in the key when available', () => {
  const def = classifyRequest({ toolName: 'run_code', innerTool: 'plugin_manager' });
  assert.equal(def.key, 'run_code:plugin_manager');
  assert.equal(def.risk.level, 'unknown');
  assert.equal(def.autoApprove, false);
});

test('class key never includes callId or reason text', () => {
  const def = classifyRequest({
    toolName: 'plugin_manager',
    action: 'list_bundles',
    callId: 'call-abc',
    reason: 'some model-generated justification',
  });
  assert.equal(def.key, 'plugin_manager:list_bundles');
  assert.equal(def.key.includes('call-abc'), false);
  assert.equal(def.key.includes('justification'), false);
});

test('static catalog includes plugin_manager and sandbox classes', () => {
  const classes = listKnownClasses();
  assert.ok(classes.length >= 17);
  assert.ok(classes.some((entry) => entry.key === 'plugin_manager:list_plugins'));
  assert.ok(classes.some((entry) => entry.key === 'write:sandbox:danger-full-access'));
});

test('getKnownClass returns a fresh copy', () => {
  const first = getKnownClass('plugin_manager:list_bundles');
  assert.ok(first);
  first.risk.level = 'high';
  const second = getKnownClass('plugin_manager:list_bundles');
  assert.equal(second.risk.level, 'low');
});
