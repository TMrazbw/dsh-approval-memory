import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLACKLIST_KEYS,
  isBlacklisted,
  listBlacklist,
  refusalFor,
} from '../lib/blacklist.js';
import { classifyRequest } from '../lib/classes.js';

test('blacklist contains the five hard-forbidden classes', () => {
  assert.equal(BLACKLIST_KEYS.length, 5);
  assert.deepEqual([...BLACKLIST_KEYS].sort(), [
    'bash:sandbox:danger-full-access',
    'edit:sandbox:danger-full-access',
    'plugin_manager:set_version_exemption',
    'pwsh:sandbox:danger-full-access',
    'write:sandbox:danger-full-access',
  ]);
});

test('every listed key is recognized as blacklisted', () => {
  for (const key of BLACKLIST_KEYS) assert.equal(isBlacklisted(key), true, key);
});

test('ordinary keys are not blacklisted', () => {
  assert.equal(isBlacklisted('plugin_manager:list_bundles'), false);
  assert.equal(isBlacklisted('plugin_manager:install_bundle'), false);
  assert.equal(isBlacklisted('unknown:bash'), false);
  assert.equal(isBlacklisted(undefined), false);
});

test('refusalFor returns a stable denied-by-policy refusal', () => {
  const refusal = refusalFor('plugin_manager:set_version_exemption');
  assert.equal(refusal.ok, false);
  assert.equal(refusal.code, 'denied-by-policy');
  assert.equal(refusal.key, 'plugin_manager:set_version_exemption');
  assert.match(refusal.messageZh, /永远不能自动开启/);
  assert.match(refusal.messageEn, /can never be auto-approved/);
});

test('refusalFor localizes its message', () => {
  const refusal = refusalFor('bash:sandbox:danger-full-access', 'en');
  assert.match(refusal.message, /can never be auto-approved/);
  assert.match(refusal.message, /outside the sandbox/);
});

test('refusalFor returns null for ordinary classes', () => {
  assert.equal(refusalFor('plugin_manager:list_plugins'), null);
});

test('listBlacklist returns read-only rows with reasons', () => {
  const rows = listBlacklist();
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.equal(typeof row.key, 'string');
    assert.ok(row.reasonZh.length > 0);
    assert.ok(row.reasonEn.length > 0);
  }
});

test('classifier marks blacklisted classes and disables auto-approval', () => {
  for (const key of BLACKLIST_KEYS) {
    let def;
    if (key.startsWith('plugin_manager:')) {
      def = classifyRequest({ toolName: 'plugin_manager', action: key.slice('plugin_manager:'.length) });
    } else {
      const [toolName, , mode] = key.split(':');
      def = classifyRequest({ toolName, requestedMode: mode });
    }
    assert.equal(def.key, key);
    assert.equal(def.blacklisted, true);
    assert.equal(def.autoApprove, false);
  }
});
