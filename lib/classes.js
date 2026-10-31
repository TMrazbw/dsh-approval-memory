/**
 * DAM — request class catalog.
 *
 * Pure classification only: no storage, no DSH services, no I/O. The class key
 * never contains `reason`, `displayReason`, `callId`, pagination offsets, or
 * model-generated justification text.
 */

import { isBlacklisted } from './blacklist.js';

/** Closed risk vocabulary. */
export const RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'unknown']);

/** Closed operation vocabulary. */
export const OPERATIONS = Object.freeze([
  'read', 'write', 'delete', 'execute', 'network',
  'install', 'config', 'permission', 'sandbox-escalation', 'unknown',
]);

/** Human labels used by the UI and by pure formatting helpers. */
export const OPERATION_LABELS = Object.freeze({
  read: { zh: '读取', en: 'Read' },
  write: { zh: '写入', en: 'Write' },
  delete: { zh: '删除', en: 'Delete' },
  execute: { zh: '执行', en: 'Execute' },
  network: { zh: '网络', en: 'Network' },
  install: { zh: '安装', en: 'Install' },
  config: { zh: '配置变更', en: 'Config change' },
  permission: { zh: '权限/安全', en: 'Permission/security' },
  'sandbox-escalation': { zh: '沙箱升级', en: 'Sandbox escalation' },
  unknown: { zh: '未知', en: 'Unknown' },
});

export const RISK_LABELS = Object.freeze({
  low: { zh: '低', en: 'Low' },
  medium: { zh: '中', en: 'Medium' },
  high: { zh: '高', en: 'High' },
  unknown: { zh: '未知', en: 'Unknown' },
});

const PLUGIN_MANAGER_ACTIONS = Object.freeze({
  list_plugins: {
    zh: '插件管理：列出已安装插件',
    en: 'Plugin Manager: list plugins',
    operation: 'read',
    level: 'low',
    reasonZh: '确定性只读操作，不修改 profile',
    reasonEn: 'Deterministic read-only operation; does not modify the profile',
    autoApprove: true,
  },
  list_bundles: {
    zh: '插件管理：列出 Bundle',
    en: 'Plugin Manager: list bundles',
    operation: 'read',
    level: 'low',
    reasonZh: '确定性只读操作，只读取 bundle 目录',
    reasonEn: 'Deterministic read-only operation; only reads the bundle catalog',
    autoApprove: true,
  },
  list_version_exemptions: {
    zh: '插件管理：列出版本豁免',
    en: 'Plugin Manager: list version exemptions',
    operation: 'read',
    level: 'low',
    reasonZh: '确定性只读操作，只读取兼容性豁免表',
    reasonEn: 'Deterministic read-only operation; only reads the compatibility table',
    autoApprove: true,
  },
  inspect: {
    zh: '插件管理：检查包',
    en: 'Plugin Manager: inspect package',
    operation: 'read',
    level: 'low',
    reasonZh: '确定性只读检查（若当前版本提供）',
    reasonEn: 'Deterministic read-only inspection (when exposed by this version)',
    autoApprove: true,
  },
  set_plugin: {
    zh: '插件管理：启用/禁用插件',
    en: 'Plugin Manager: enable/disable plugin',
    operation: 'config',
    level: 'medium',
    reasonZh: '会持久修改 profile，影响所有会话',
    reasonEn: 'Persistently modifies the profile and affects every session',
    autoApprove: false,
  },
  set_bundle: {
    zh: '插件管理：启用/禁用 Bundle',
    en: 'Plugin Manager: enable/disable bundle',
    operation: 'config',
    level: 'medium',
    reasonZh: '会持久修改 profile，可能改变其他会话的加载行为',
    reasonEn: 'Persistently modifies the profile and may change other sessions',
    autoApprove: false,
  },
  install_bundle: {
    zh: '插件管理：安装 Bundle',
    en: 'Plugin Manager: install bundle',
    operation: 'install',
    level: 'high',
    reasonZh: '会下载并运行第三方代码/构建脚本',
    reasonEn: 'Downloads and runs third-party code or build scripts',
    autoApprove: false,
  },
  remove_bundle: {
    zh: '插件管理：卸载 Bundle',
    en: 'Plugin Manager: remove bundle',
    operation: 'delete',
    level: 'high',
    reasonZh: '可能删除依赖或破坏 profile',
    reasonEn: 'May remove dependencies or break the profile',
    autoApprove: false,
  },
  set_version_exemption: {
    zh: '插件管理：版本豁免',
    en: 'Plugin Manager: version exemption',
    operation: 'permission',
    level: 'high',
    reasonZh: '绕过 DSH 版本兼容检查，可能导致崩溃或数据丢失',
    reasonEn: 'Bypasses DSH version compatibility checks; may cause crashes or data loss',
    autoApprove: false,
  },
});

const SANDBOX_TOOLS = Object.freeze({
  bash: { zh: 'Bash', en: 'Bash', operation: 'execute' },
  pwsh: { zh: 'PowerShell', en: 'PowerShell', operation: 'execute' },
  write: { zh: '文件写入', en: 'File write', operation: 'write' },
  edit: { zh: '文件编辑', en: 'File edit', operation: 'write' },
});

const MODE_LABELS = Object.freeze({
  'workspace-write': { zh: 'workspace-write', en: 'workspace-write' },
  'danger-full-access': { zh: '完全访问', en: 'full access' },
});

function cloneRisk(level, reasonZh, reasonEn, policyId) {
  return { level, reasonZh, reasonEn, policyId };
}

function makeClass({
  key,
  titleZh,
  titleEn,
  toolName,
  action,
  operation,
  level,
  reasonZh,
  reasonEn,
  policyId,
  scope = 'profile',
  autoApprove = false,
  escalation = false,
  known = true,
}) {
  return {
    key,
    titleZh,
    titleEn,
    toolName,
    action,
    operation,
    risk: cloneRisk(level, reasonZh, reasonEn, policyId),
    scope,
    autoApprove: autoApprove === true,
    escalation: escalation === true,
    known,
    blacklisted: isBlacklisted(key),
  };
}

function readClass() {
  return makeClass({
    key: 'read:file',
    titleZh: '文件读取',
    titleEn: 'File read',
    toolName: 'read',
    action: null,
    operation: 'read',
    level: 'low',
    reasonZh: '只读文件操作；敏感路径由 Host 单独判定',
    reasonEn: 'Read-only file operation; sensitive paths are handled separately by the Host',
    policyId: 'file-read',
    scope: 'workspace',
    autoApprove: true,
  });
}

function pluginManagerClass(action) {  const spec = PLUGIN_MANAGER_ACTIONS[action];
  if (spec === undefined) {
    return makeClass({
      key: `plugin_manager:${action || 'unknown'}`,
      titleZh: `插件管理：${action || '未知操作'}`,
      titleEn: `Plugin Manager: ${action || 'unknown action'}`,
      toolName: 'plugin_manager',
      action: action || null,
      operation: 'unknown',
      level: 'unknown',
      reasonZh: '当前规则表未收录该 action，无法安全分类',
      reasonEn: 'This action is not in the rule table and cannot be classified safely',
      policyId: 'plugin-manager-unknown',
      scope: 'profile',
      autoApprove: false,
      known: false,
    });
  }
  return makeClass({
    key: `plugin_manager:${action}`,
    titleZh: spec.zh,
    titleEn: spec.en,
    toolName: 'plugin_manager',
    action,
    operation: spec.operation,
    level: spec.level,
    reasonZh: spec.reasonZh,
    reasonEn: spec.reasonEn,
    policyId: `plugin-manager-${action}`,
    scope: 'profile',
    autoApprove: spec.autoApprove,
  });
}

function sandboxClass(toolName, requestedMode) {
  const tool = SANDBOX_TOOLS[toolName];
  const mode = MODE_LABELS[requestedMode];
  if (tool === undefined || mode === undefined) {
    return makeClass({
      key: `${toolName}:sandbox:${requestedMode || 'unknown'}`,
      titleZh: `${tool?.zh || toolName}：未识别的沙箱升级`,
      titleEn: `${tool?.en || toolName}: unknown sandbox escalation`,
      toolName,
      action: null,
      operation: tool?.operation || 'unknown',
      level: 'unknown',
      reasonZh: '无法识别沙箱升级目标模式',
      reasonEn: 'The sandbox escalation target mode is not recognized',
      policyId: 'sandbox-unknown',
      scope: 'workspace',
      autoApprove: false,
      escalation: true,
      known: false,
    });
  }
  return makeClass({
    key: `${toolName}:sandbox:${requestedMode}`,
    titleZh: `${tool.zh}：沙箱升级到 ${mode.zh}`,
    titleEn: `${tool.en}: sandbox escalation to ${mode.en}`,
    toolName,
    action: null,
    operation: tool.operation,
    level: 'high',
    reasonZh: '沙箱升级执行自由文本命令或写入，静态分析无法证明只读',
    reasonEn: 'Sandbox escalation runs free-form commands or writes; static analysis cannot prove read-only',
    policyId: `sandbox-${toolName}-${requestedMode}`,
    scope: 'workspace',
    autoApprove: false,
    escalation: true,
  });
}

/** Static catalog of the known classes (plugin_manager + sandbox modes). */
export const KNOWN_CLASSES = (() => {
  const map = new Map();
  for (const action of Object.keys(PLUGIN_MANAGER_ACTIONS)) {
    const def = pluginManagerClass(action);
    map.set(def.key, def);
  }
  map.set('read:file', readClass());
  for (const toolName of Object.keys(SANDBOX_TOOLS)) {
    for (const requestedMode of Object.keys(MODE_LABELS)) {
      const def = sandboxClass(toolName, requestedMode);
      map.set(def.key, def);
    }
  }
  return map;
})();

/**
 * Read the static catalog as plain objects.
 * @returns {Array<object>} one object per known class.
 */
export function listKnownClasses() {
  return [...KNOWN_CLASSES.values()].map((def) => ({
    ...def,
    risk: { ...def.risk },
  }));
}

/**
 * Read one static class definition.
 * @param {string} classKey - stable class key.
 * @returns {object | undefined} the definition, or undefined for a dynamic class.
 */
export function getKnownClass(classKey) {
  const def = KNOWN_CLASSES.get(classKey);
  return def === undefined ? undefined : {
    ...def,
    risk: { ...def.risk },
  };
}

/**
 * Whether a class may be auto-approved by default under V1 rules.
 * @param {object | null | undefined} classDef - classified request.
 * @returns {boolean} true only for low-risk, non-blacklisted, auto-approvable classes.
 */
export function isAutoApprovable(classDef) {
  return Boolean(
    classDef
    && classDef.autoApprove === true
    && classDef.blacklisted !== true
    && classDef.risk?.level === 'low',
  );
}

/**
 * Classify one approval request descriptor.
 * @param {object} input - `{ toolName, action?, requestedMode?, innerTool? }`.
 * @returns {object} the stable class definition.
 */
export function classifyRequest(input = {}) {
  const toolName = typeof input.toolName === 'string' && input.toolName.length > 0
    ? input.toolName
    : 'unknown';
  const action = typeof input.action === 'string' ? input.action : null;
  const requestedMode = typeof input.requestedMode === 'string' ? input.requestedMode : null;
  const innerTool = typeof input.innerTool === 'string' ? input.innerTool : null;

  let def;
  if (toolName === 'plugin_manager') {
    def = pluginManagerClass(action);
  } else if (toolName === 'read') {
    def = readClass();
  } else if (Object.prototype.hasOwnProperty.call(SANDBOX_TOOLS, toolName)) {
    def = requestedMode === null
      ? makeClass({
        key: `${toolName}:sandbox:unknown`,
        titleZh: `${SANDBOX_TOOLS[toolName].zh}：未识别的审批请求`,
        titleEn: `${SANDBOX_TOOLS[toolName].en}: unknown approval request`,
        toolName,
        action: null,
        operation: SANDBOX_TOOLS[toolName].operation,
        level: 'unknown',
        reasonZh: '没有可识别的沙箱升级目标模式',
        reasonEn: 'No recognized sandbox escalation target mode',
        policyId: 'sandbox-missing-mode',
        scope: 'workspace',
        autoApprove: false,
        escalation: true,
        known: false,
      })
      : sandboxClass(toolName, requestedMode);
  } else if (toolName === 'run_code') {
    def = makeClass({
      key: `run_code:${innerTool || 'unknown'}`,
      titleZh: `PTC / run_code：${innerTool || '未知内层工具'}`,
      titleEn: `PTC / run_code: ${innerTool || 'unknown inner tool'}`,
      toolName,
      action: null,
      operation: 'execute',
      level: 'unknown',
      reasonZh: 'PTC 内层调用的参数和副作用无法在此层可靠判定',
      reasonEn: 'PTC inner-call effects cannot be reliably classified at this layer',
      policyId: 'ptc-inner',
      scope: 'profile',
      autoApprove: false,
      known: false,
    });
  } else {
    def = makeClass({
      key: `unknown:${toolName}`,
      titleZh: `未知请求：${toolName}`,
      titleEn: `Unknown request: ${toolName}`,
      toolName,
      action: null,
      operation: 'unknown',
      level: 'unknown',
      reasonZh: '没有结构化 action/参数，无法安全分类',
      reasonEn: 'No structured action/arguments; cannot classify safely',
      policyId: 'unknown-tool',
      scope: 'profile',
      autoApprove: false,
      known: false,
    });
  }

  return {
    ...def,
    risk: { ...def.risk },
    blacklisted: isBlacklisted(def.key),
    autoApprove: def.autoApprove === true && !isBlacklisted(def.key),
  };
}
