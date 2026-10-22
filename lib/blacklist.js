/**
 * DAM — hard blacklist.
 *
 * These request classes can never be auto-approved, regardless of UI state,
 * imported rules, or a future classifier suggestion. The list is code-owned:
 * it cannot be removed or bypassed through the UI/API.
 */

/** Human-readable reasons for every forbidden class. */
export const BLACKLIST_REASONS = Object.freeze({
  'plugin_manager:set_version_exemption': {
    zh: '绕过 DSH 版本兼容检查，可能导致崩溃或数据丢失',
    en: 'Bypasses DSH version compatibility checks; may cause crashes or data loss',
  },
  'bash:sandbox:danger-full-access': {
    zh: '直接绕过沙箱执行自由文本命令',
    en: 'Runs free-form commands outside the sandbox',
  },
  'pwsh:sandbox:danger-full-access': {
    zh: '直接绕过沙箱执行自由文本命令',
    en: 'Runs free-form commands outside the sandbox',
  },
  'write:sandbox:danger-full-access': {
    zh: '绕过文件沙箱，可写入任意路径',
    en: 'Bypasses the file sandbox and can write any path',
  },
  'edit:sandbox:danger-full-access': {
    zh: '绕过文件沙箱，可编辑任意路径',
    en: 'Bypasses the file sandbox and can edit any path',
  },
});

/** Stable list of forbidden class keys. */
export const BLACKLIST_KEYS = Object.freeze(Object.keys(BLACKLIST_REASONS));

/**
 * Whether one class key is permanently forbidden.
 * @param {string} classKey - stable request class key.
 * @returns {boolean} true when no rule may ever enable it.
 */
export function isBlacklisted(classKey) {
  return typeof classKey === 'string'
    && Object.prototype.hasOwnProperty.call(BLACKLIST_REASONS, classKey);
}

/**
 * Build the refusal returned when a rule creation/import/auto-suggestion
 * targets a blacklisted class.
 * @param {string} classKey - stable request class key.
 * @param {'zh'|'en'} locale - message locale.
 * @returns {null | {ok: false, code: 'denied-by-policy', key: string, message: string, messageZh: string, messageEn: string}}
 */
export function refusalFor(classKey, locale = 'zh') {
  if (!isBlacklisted(classKey)) return null;
  const reason = BLACKLIST_REASONS[classKey];
  const messageZh = `该类永远不能自动开启：${reason.zh}`;
  const messageEn = `This class can never be auto-approved: ${reason.en}`;
  return {
    ok: false,
    code: 'denied-by-policy',
    key: classKey,
    message: locale === 'en' ? messageEn : messageZh,
    messageZh,
    messageEn,
  };
}

/**
 * Read-only blacklist rows for the UI.
 * @returns {Array<{key: string, reasonZh: string, reasonEn: string}>}
 */
export function listBlacklist() {
  return BLACKLIST_KEYS.map((key) => ({
    key,
    reasonZh: BLACKLIST_REASONS[key].zh,
    reasonEn: BLACKLIST_REASONS[key].en,
  }));
}
