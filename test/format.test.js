import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCounts,
  formatRelativeTime,
  formatTime,
  operationLabel,
  redactText,
  riskLabel,
  shortId,
} from '../lib/format.js';

test('formatCounts handles the empty state', () => {
  assert.equal(formatCounts({}), '0 次');
  assert.equal(formatCounts({ total: 0 }), '0 次');
  assert.equal(formatCounts({}, 'en'), '0');
});

test('formatCounts keeps the split visible', () => {
  assert.equal(
    formatCounts({ total: 27, allowed: 24, rejected: 2, auto: 1 }),
    '27 次（允许 24 / 拒绝 2 / 自动 1）',
  );
  assert.equal(
    formatCounts({ total: 3, allowed: 0, rejected: 1, auto: 2, cancelledOrUnavailable: 0 }),
    '3 次（拒绝 1 / 自动 2）',
  );
});

test('formatCounts clamps invalid and negative values', () => {
  assert.equal(
    formatCounts({ total: -5, allowed: 'x', rejected: -1, auto: Number.NaN }),
    '0 次',
  );
});

test('formatCounts localizes labels', () => {
  assert.equal(
    formatCounts({ total: 5, allowed: 3, rejected: 2 }, 'en'),
    '5 total (allowed 3 / rejected 2)',
  );
});

test('formatRelativeTime uses the supplied now', () => {
  const now = Date.UTC(2026, 9, 22, 10, 37);
  assert.equal(formatRelativeTime(now - 30_000, now), '刚刚');
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5 分钟前');
  assert.equal(formatRelativeTime(now - 2 * 3_600_000, now), '2 小时前');
  assert.equal(formatRelativeTime(now - 3 * 86_400_000, now), '3 天前');
  assert.equal(formatRelativeTime(now - 8 * 86_400_000, now), '2026-10-14 18:37');
  assert.equal(formatRelativeTime(now - 5 * 60_000, now, 'en'), '5 min ago');
});

test('formatTime renders Asia/Shanghai time deterministically', () => {
  const value = Date.UTC(2026, 9, 22, 10, 37);
  assert.equal(formatTime(value), '2026-10-22 18:37');
  assert.equal(formatTime(value, { timeZone: 'UTC' }), '2026-10-22 10:37');
  assert.equal(formatTime(Number.NaN), '');
});

test('redactText removes common secrets', () => {
  const raw = [
    'token=sk-abcdefghijklmnop',
    'Authorization: Bearer abcdefghijklmnop',
    'password=hunter2',
    'api_key=abcd1234',
    'user C:\\Users\\Administrator\\secret.txt',
    'home /home/alice/private',
    'mail alice@example.com',
    '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----',
  ].join('\n');
  const redacted = redactText(raw);
  assert.ok(!redacted.includes('sk-abcdefghijklmnop'));
  assert.ok(!redacted.includes('hunter2'));
  assert.ok(!redacted.includes('abcd1234'));
  assert.ok(!redacted.includes('Administrator'));
  assert.ok(!redacted.includes('alice'));
  assert.ok(!redacted.includes('alice@example.com'));
  assert.ok(!redacted.includes('MIIE'));
  assert.match(redacted, /\[private key\]/);
});

test('redactText can keep emails when asked', () => {
  assert.equal(redactText('mail alice@example.com', { redactEmails: false }), 'mail alice@example.com');
});

test('redactText truncates and is idempotent', () => {
  const long = 'x'.repeat(50);
  const once = redactText(long, { maxLength: 10 });
  assert.equal(once.length, 10);
  assert.ok(once.endsWith('…'));
  const twice = redactText(once, { maxLength: 10 });
  assert.equal(twice, once);
});

test('shortId shortens only long ids', () => {
  assert.equal(shortId('abc'), 'abc');
  assert.equal(shortId('1234567890123'), '123456…0123');
  assert.equal(shortId(null), '');
});

test('risk and operation labels are localized', () => {
  assert.equal(riskLabel('low'), '低');
  assert.equal(riskLabel('low', 'en'), 'Low');
  assert.equal(riskLabel('medium'), '中');
  assert.equal(riskLabel('unknown'), '未知');
  assert.equal(operationLabel('read'), '读取');
  assert.equal(operationLabel('read', 'en'), 'Read');
  assert.equal(operationLabel('sandbox-escalation'), '沙箱升级');
  assert.equal(operationLabel('missing'), '未知');
});
