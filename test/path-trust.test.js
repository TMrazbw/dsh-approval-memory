import test from 'node:test';
import assert from 'node:assert/strict';
import { isSensitivePath, normalizePath, pathInfoFor } from '../lib/path-trust.js';

test('normalizePath rejects empty paths and normalizes separators', () => {
  assert.equal(normalizePath(null), null);
  assert.equal(normalizePath('  '), null);
  const normalized = normalizePath('/tmp/dam/report.docx');
  assert.ok(normalized.endsWith('/tmp/dam/report.docx'));
  assert.equal(normalized.includes('\\'), false);
});

test('sensitive paths are strict', () => {
  const sensitive = [
    '/home/user/.ssh/id_rsa',
    '/home/user/.aws/credentials',
    '/home/user/project/.env',
    '/home/user/project/.env.local',
    '/home/user/project/secrets.json',
    '/home/user/project/server.pem',
    '/home/user/project/client.p12',
    '/home/user/.config/gcloud/application_default_credentials.json',
    '/home/user/AppData/Local/Google/Chrome/User Data/Default/Cookies',
    '/home/user/AppData/Local/Microsoft/Credentials/ABC',
  ];
  for (const value of sensitive) {
    assert.equal(isSensitivePath(normalizePath(value)), true, value);
  }
  for (const value of [
    '/home/user/project/report.docx',
    '/home/user/project/photo.png',
    '/tmp/dam/data.json',
  ]) {
    assert.equal(isSensitivePath(normalizePath(value)), false, value);
  }
});

test('pathInfoFor only accepts structured file tools', () => {
  const read = pathInfoFor('read', { path: '/tmp/dam/report.txt' });
  assert.equal(read.toolName, 'read');
  assert.ok(read.path.endsWith('/tmp/dam/report.txt'));
  assert.equal(read.sensitive, false);

  const write = pathInfoFor('write', { file_path: '/tmp/dam/.env' });
  assert.equal(write.toolName, 'write');
  assert.equal(write.sensitive, true);

  const edit = pathInfoFor('edit', { path: '/tmp/dam/report.txt' });
  assert.equal(edit.toolName, 'edit');
  assert.equal(edit.sensitive, false);

  assert.equal(pathInfoFor('bash', { path: '/tmp/dam/report.txt' }), null);
  assert.equal(pathInfoFor('pwsh', { path: '/tmp/dam/report.txt' }), null);
  assert.equal(pathInfoFor('read', {}).path, null);
});
