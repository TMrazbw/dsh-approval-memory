/**
 * DAM — pure display and redaction helpers.
 * No DSH services, no timers, no storage.
 */

import { OPERATION_LABELS, RISK_LABELS } from './classes.js';

const ZH = 'zh';
const EN = 'en';

function localeKey(locale) {
  return String(locale || '').toLowerCase().startsWith('en') ? EN : ZH;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

/**
 * Format one count split into the UI's compact text.
 * @param {object} counts - `{ total, allowed, rejected, auto, cancelledOrUnavailable }`.
 * @param {'zh'|'en'|string} [locale] - display language.
 * @returns {string} e.g. `27 次（允许 24 / 拒绝 2 / 自动 1）`.
 */
export function formatCounts(counts = {}, locale = ZH) {
  const total = nonNegativeInteger(counts.total);
  const allowed = nonNegativeInteger(counts.allowed);
  const rejected = nonNegativeInteger(counts.rejected);
  const auto = nonNegativeInteger(counts.auto);
  const cancelled = nonNegativeInteger(counts.cancelledOrUnavailable);
  const parts = [];
  if (allowed > 0) parts.push(localeKey(locale) === EN ? `allowed ${allowed}` : `允许 ${allowed}`);
  if (rejected > 0) parts.push(localeKey(locale) === EN ? `rejected ${rejected}` : `拒绝 ${rejected}`);
  if (auto > 0) parts.push(localeKey(locale) === EN ? `auto ${auto}` : `自动 ${auto}`);
  if (cancelled > 0) parts.push(localeKey(locale) === EN ? `cancelled ${cancelled}` : `取消 ${cancelled}`);

  if (localeKey(locale) === EN) {
    if (total === 0) return '0';
    return parts.length === 0 ? `${total} total` : `${total} total (${parts.join(' / ')})`;
  }
  if (total === 0) return '0 次';
  return parts.length === 0 ? `${total} 次` : `${total} 次（${parts.join(' / ')}）`;
}

/**
 * Format a timestamp in a fixed, locale-independent shape.
 * @param {number} milliseconds - epoch milliseconds.
 * @param {{locale?: string, timeZone?: string}} [options] - display options.
 * @returns {string} `YYYY-MM-DD HH:mm`, or empty for invalid input.
 */
export function formatTime(milliseconds, options = {}) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value)) return '';
  const timeZone = typeof options.timeZone === 'string' && options.timeZone.length > 0
    ? options.timeZone
    : 'Asia/Shanghai';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(value));
    const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
    const hour = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}`;
  } catch {
    return '';
  }
}

/**
 * Format a timestamp relative to a caller-supplied `now`.
 * @param {number} milliseconds - epoch milliseconds.
 * @param {number} [now] - reference time in epoch milliseconds.
 * @param {'zh'|'en'|string} [locale] - display language.
 * @returns {string} relative time, or an absolute time after 7 days.
 */
export function formatRelativeTime(milliseconds, now = Date.now(), locale = ZH) {
  const value = Number(milliseconds);
  const reference = Number(now);
  if (!Number.isFinite(value)) return '';
  const diff = Number.isFinite(reference) ? reference - value : 0;
  const en = localeKey(locale) === EN;
  if (diff < 60_000) return en ? 'just now' : '刚刚';
  if (diff < 3_600_000) {
    const minutes = Math.floor(diff / 60_000);
    return en ? `${minutes} min ago` : `${minutes} 分钟前`;
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return en ? `${hours} h ago` : `${hours} 小时前`;
  }
  if (diff < 604_800_000) {
    const days = Math.floor(diff / 86_400_000);
    return en ? `${days} d ago` : `${days} 天前`;
  }
  return formatTime(value);
}

/**
 * Remove common secrets and user-specific paths, then bound the text.
 * @param {unknown} value - raw text.
 * @param {{maxLength?: number, redactEmails?: boolean}} [options] - bounds.
 * @returns {string} redacted text.
 */
export function redactText(value, options = {}) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  const maxLength = Number.isInteger(options.maxLength) && options.maxLength > 0
    ? options.maxLength
    : 600;

  text = text.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[private key]',
  );
  text = text.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***');
  text = text.replace(/\bAuthorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi, 'Authorization=***');
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***');
  text = text.replace(
    /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret)\s*[:=]\s*["']?[^\s"',;]{4,}/gi,
    '$1=***',
  );
  text = text.replace(/([A-Za-z]:\\Users\\)[^\\\s]+/g, '$1***');
  text = text.replace(/\/home\/[^/\s]+/g, '/home/***');
  if (options.redactEmails !== false) {
    text = text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '***@***');
  }

  if (text.length > maxLength) {
    text = `${text.slice(0, Math.max(0, maxLength - 1))}…`;
  }
  return text;
}

/**
 * Shorten a branded id for display.
 * @param {unknown} value - id.
 * @returns {string} shortened id.
 */
export function shortId(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

/**
 * Localized risk label.
 * @param {string} level - low | medium | high | unknown.
 * @param {'zh'|'en'|string} [locale] - display language.
 * @returns {string} label.
 */
export function riskLabel(level, locale = ZH) {
  const labels = RISK_LABELS[level] ?? RISK_LABELS.unknown;
  return localeKey(locale) === EN ? labels.en : labels.zh;
}

/**
 * Localized operation label.
 * @param {string} operation - operation category.
 * @param {'zh'|'en'|string} [locale] - display language.
 * @returns {string} label.
 */
export function operationLabel(operation, locale = ZH) {
  const labels = OPERATION_LABELS[operation] ?? OPERATION_LABELS.unknown;
  return localeKey(locale) === EN ? labels.en : labels.zh;
}
