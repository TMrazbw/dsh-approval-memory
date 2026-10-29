import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonObjectAfter,
  extractPluginManagerArgsFromReason,
  extractRequest,
  extractRequestedModeFromReason,
  findToolCall,
  parseJsonObject,
} from '../lib/extract.js';

const EVENTS = [
  {
    type: 'tool/call',
    data: {
      callId: 'call-list',
      name: 'plugin_manager',
      arguments: '{"action":"list_bundles","offset":0,"limit":25}',
    },
  },
  {
    type: 'tool/call',
    data: {
      callId: 'call-shell',
      name: 'bash',
      arguments: '{"sandbox_permissions":"workspace-write","command":"Get-ChildItem","cwd":"C:\\\\work"}',
    },
  },
  {
    type: 'tool/call',
    data: {
      callId: 'call-shell',
      name: 'bash',
      arguments: '{"sandbox_permissions":"danger-full-access","command":"Get-ChildItem","cwd":"C:\\\\work"}',
    },
  },
];

test('parseJsonObject accepts objects and rejects arrays/scalars/malformed text', () => {
  assert.deepEqual(parseJsonObject('{"action":"list_bundles"}'), { action: 'list_bundles' });
  assert.deepEqual(parseJsonObject('  {"a":1}  '), { a: 1 });
  assert.deepEqual(parseJsonObject({ a: 1 }), { a: 1 });
  assert.equal(parseJsonObject('[1,2]'), null);
  assert.equal(parseJsonObject('"text"'), null);
  assert.equal(parseJsonObject(''), null);
  assert.equal(parseJsonObject('{broken'), null);
  assert.equal(parseJsonObject(null), null);
});

test('findToolCall returns the latest matching call', () => {
  const call = findToolCall(EVENTS, 'call-shell');
  assert.ok(call);
  assert.equal(call.name, 'bash');
  assert.equal(call.args.sandbox_permissions, 'danger-full-access');
  assert.match(call.argumentsText, /danger-full-access/);
});

test('findToolCall returns null for missing or empty ids', () => {
  assert.equal(findToolCall(EVENTS, 'missing'), null);
  assert.equal(findToolCall(EVENTS, ''), null);
  assert.equal(findToolCall(undefined, 'call-list'), null);
});

test('extractJsonObjectAfter handles nested braces and braces inside strings', () => {
  const text = 'prefix plugin_manager {"action":"install_bundle","target":"a}b","meta":{"x":1}} suffix';
  assert.deepEqual(extractJsonObjectAfter(text, 'plugin_manager'), {
    action: 'install_bundle',
    target: 'a}b',
    meta: { x: 1 },
  });
});

test('extractJsonObjectAfter handles escaped quotes', () => {
  const text = 'plugin_manager {"target":"a\\\"b","action":"list_bundles"}';
  assert.deepEqual(extractJsonObjectAfter(text, 'plugin_manager'), {
    target: 'a"b',
    action: 'list_bundles',
  });
});

test('extractJsonObjectAfter returns null without a marker or object', () => {
  assert.equal(extractJsonObjectAfter('nothing here', 'plugin_manager'), null);
  assert.equal(extractJsonObjectAfter('plugin_manager no object', 'plugin_manager'), null);
  assert.equal(extractJsonObjectAfter('plugin_manager {"a":1', 'plugin_manager'), null);
});

test('plugin_manager reason fallback recovers action and pagination', () => {
  const reason = 'escalate sandbox to danger-full-access: plugin_manager {"action":"list_bundles","offset":0,"limit":25}. Profile changes persist across sessions; installed Host code runs outside the workspace sandbox.';
  assert.deepEqual(extractPluginManagerArgsFromReason(reason), {
    action: 'list_bundles',
    offset: 0,
    limit: 25,
  });
});

test('requested mode is read from the escalation reason', () => {
  assert.equal(
    extractRequestedModeFromReason('escalate sandbox to workspace-write: need temp files'),
    'workspace-write',
  );
  assert.equal(
    extractRequestedModeFromReason('escalate sandbox to danger-full-access: need ACL repair'),
    'danger-full-access',
  );
  assert.equal(extractRequestedModeFromReason('no escalation here'), null);
  assert.equal(extractRequestedModeFromReason(undefined), null);
});

test('extractRequest prefers the tool/call arguments', () => {
  const request = extractRequest({
    toolName: 'plugin_manager',
    callId: 'call-list',
    reason: 'escalate sandbox to danger-full-access: plugin_manager {"action":"install_bundle"}',
    events: EVENTS,
  });
  assert.equal(request.source, 'tool_call');
  assert.equal(request.action, 'list_bundles');
  assert.equal(request.args.offset, 0);
  assert.match(request.argumentsText, /list_bundles/);
});

test('extractRequest falls back to the plugin_manager reason without a callId', () => {
  const request = extractRequest({
    toolName: 'plugin_manager',
    callId: null,
    reason: 'escalate sandbox to danger-full-access: plugin_manager {"action":"list_bundles","offset":25}. done',
    events: EVENTS,
  });
  assert.equal(request.source, 'reason');
  assert.equal(request.action, 'list_bundles');
  assert.equal(request.args.offset, 25);
});

test('extractRequest recovers a shell requested mode from the reason', () => {
  const request = extractRequest({
    toolName: 'bash',
    callId: null,
    reason: 'escalate sandbox to workspace-write: write temp files',
    events: EVENTS,
  });
  assert.equal(request.source, 'none');
  assert.equal(request.requestedMode, 'workspace-write');
});

test('extractRequest returns shell command and cwd', () => {
  const request = extractRequest({
    toolName: 'bash',
    callId: 'call-shell',
    events: EVENTS,
  });
  assert.equal(request.command, 'Get-ChildItem');
  assert.equal(request.cwd, 'C:\\work');
  assert.equal(request.commandSource, 'tool_call');
});

test('extractRequest returns empty fields when nothing can be resolved', () => {
  const request = extractRequest({ toolName: 'unknown', callId: null, reason: null, events: [] });
  assert.equal(request.source, 'none');
  assert.equal(request.action, null);
  assert.equal(request.requestedMode, null);
  assert.equal(request.args, null);
  assert.equal(request.argumentsText, null);
  assert.equal(request.command, null);
  assert.equal(request.cwd, null);
  assert.equal(request.commandSource, 'none');
});

test('extractRequest exposes a run_code inner tool when present', () => {
  const events = [{
    type: 'tool/call',
    data: {
      callId: 'call-run',
      name: 'run_code',
      arguments: '{"tool":"plugin_manager","arguments":{}}',
    },
  }];
  const request = extractRequest({ toolName: 'run_code', callId: 'call-run', events });
  assert.equal(request.innerTool, 'plugin_manager');
});
