/**
 * DAM — deterministic command-risk heuristics.
 *
 * This module is intentionally pure: it does not read files, spawn processes,
 * call the network, or use an LLM. It only classifies the text of a shell
 * command into display-only risk tags. The tags must never participate in an
 * approval decision; `lib/host.js` continues to ignore them.
 */

import { createHash } from 'node:crypto';

const DEFAULT_MAX_CHARS = 4096;
const MAX_TAGS = 8;
const MAX_TARGETS = 5;

export const RISK_TAG_ORDER = [
  'delete-recursive',
  'git-history',
  'permission-change',
  'system-level',
  'download-exec',
  'secret-access',
  'outbound-send',
];

const TAG_LEVEL = {
  'delete-recursive': 'high',
  'git-history': 'high',
  'permission-change': 'medium',
  'system-level': 'high',
  'download-exec': 'high',
  'secret-access': 'high',
  'outbound-send': 'medium',
};

const COMMAND_PREFIXES = new Set(['sudo', 'doas', 'nohup', 'time', 'env']);
const SECRET_NON_ACCESS = new Set([
  'echo', 'printf', 'write-output', 'write-host', 'set', 'export',
]);
const SECRET_WORDS = /(?:^|[\\/\s"'`=:(])(?:\.ssh|\.aws|\.env|id_rsa|credentials)(?=$|[\\/\s"'`),;:.])/i;
const DOWNLOAD_SOURCE = new Set(['curl', 'wget', 'iwr', 'invoke-webrequest']);
const DOWNLOAD_SHELL = new Set([
  'sh', 'bash', 'zsh', 'pwsh', 'powershell', 'iex', 'invoke-expression',
]);
const NESTED_SHELL = new Set(['bash', 'sh', 'zsh', 'pwsh', 'powershell', 'cmd']);

function stripQuotes(value) {
  const text = String(value ?? '').trim();
  if (text.length >= 2 && ((text[0] === '"' && text.at(-1) === '"')
    || (text[0] === "'" && text.at(-1) === "'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function tokens(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  return text.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
}

function baseCommand(token) {
  let value = stripQuotes(token).replace(/^&+/, '');
  value = value.split(/[\\/]/).at(-1) ?? value;
  value = value.toLowerCase();
  return value.endsWith('.exe') ? value.slice(0, -4) : value;
}

function flagsOf(args) {
  const flags = new Set();
  for (const raw of args) {
    const value = stripQuotes(raw).toLowerCase();
    if (value.startsWith('--') || value.startsWith('/')) {
      flags.add(value);
      continue;
    }
    if (value.startsWith('-') && value.length > 1) {
      flags.add(value);
      for (const char of value.slice(1)) flags.add(`-${char}`);
    }
  }
  return flags;
}

function has(flags, ...names) {
  return names.some((name) => flags.has(name.toLowerCase()));
}

function commandInfo(raw) {
  const all = tokens(raw);
  let index = 0;
  while (index < all.length) {
    const value = stripQuotes(all[index]);
    if (value.length === 0) {
      index += 1;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) {
      index += 1;
      continue;
    }
    if (COMMAND_PREFIXES.has(baseCommand(value))) {
      index += 1;
      continue;
    }
    break;
  }
  if (index >= all.length) return null;
  return {
    raw,
    command: baseCommand(all[index]),
    args: all.slice(index + 1),
    flags: flagsOf(all.slice(index + 1)),
  };
}

function splitSegments(text) {
  const result = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ';' || char === '\n') {
      result.push(current);
      current = '';
      continue;
    }
    if ((char === '&' && text[index + 1] === '&')
      || (char === '|' && text[index + 1] === '|')) {
      result.push(current);
      current = '';
      index += 1;
      continue;
    }
    if (char === '|') {
      result.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  result.push(current);
  return result.map((value) => value.trim()).filter((value) => value.length > 0);
}

function commandInfos(text) {
  return splitSegments(text).map(commandInfo).filter((info) => info !== null);
}

function addTarget(output, value) {
  const cleaned = stripQuotes(value)
    .replace(/^[`"'([{]+/, '')
    .replace(/[`"')\]}.,;:]+$/, '');
  if (cleaned.length === 0 || output.includes(cleaned)) return;
  output.push(cleaned);
}

function targetLike(value) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/]|\.{1,2}[\\/]|https?:\/\/)/i.test(value)
    || /^[A-Za-z0-9_.-]+@[^:]+:/.test(value)
    || /(?:^|[\\/])(?:\.ssh|\.aws|\.env|id_rsa|credentials)(?:[\\/]|$)/i.test(value)
    || /^(?:\.ssh|\.aws|\.env|id_rsa|credentials)$/i.test(value);
}

function targetsOf(text) {
  const output = [];
  for (const token of tokens(text)) {
    let value = stripQuotes(token);
    if (value.includes('=')) value = value.split('=').slice(1).join('=');
    if (targetLike(value)) addTarget(output, value);
  }
  return output;
}

function nestedCommand(info) {
  if (!NESTED_SHELL.has(info.command)) return null;
  const args = info.args.map(stripQuotes);
  for (let index = 0; index < args.length - 1; index += 1) {
    const flag = args[index].toLowerCase();
    if (flag === '-c' || flag === '-command' || flag === '/c' || flag === '/command') {
      return args[index + 1];
    }
  }
  return null;
}

function analyzeText(text, depth = 0) {
  const infos = commandInfos(text);
  const tags = new Set();
  const targets = targetsOf(text);

  for (let index = 0; index < infos.length; index += 1) {
    const info = infos[index];
    const { command, args, flags } = info;
    const lowerArgs = args.map((value) => stripQuotes(value).toLowerCase());

    if (command === 'git') {
      const sub = lowerArgs.find((value) => ['reset', 'push', 'filter-branch', 'clean'].includes(value));
      if (sub === 'reset' && has(flags, '--hard')) tags.add('git-history');
      if (sub === 'push' && (has(flags, '--force', '-f'))) tags.add('git-history');
      if (sub === 'filter-branch') tags.add('git-history');
      if (sub === 'clean' && has(flags, '-f') && (has(flags, '-d') || has(flags, '-x'))) {
        tags.add('delete-recursive');
      }
    }

    if (command === 'rm') {
      const recursive = has(flags, '-r', '--recursive', '-recursive');
      const force = has(flags, '-f', '--force', '-force');
      if (recursive && force) tags.add('delete-recursive');
    }

    if (['remove-item', 'ri', 'del', 'erase'].includes(command)) {
      const recursive = has(flags, '-recurse', '/recurse', '/s', '-recursive');
      const force = has(flags, '-force', '/f', '/q');
      if (recursive && force) tags.add('delete-recursive');
    }

    if (['rd', 'rmdir'].includes(command) && has(flags, '/s', '-s', '--recursive') && has(flags, '/q', '-q')) {
      tags.add('delete-recursive');
    }

    if (command === 'chmod' && lowerArgs.includes('777')) tags.add('permission-change');
    if (['icacls', 'takeown'].includes(command)) tags.add('permission-change');

    if (command === 'dd' || command.startsWith('mkfs') || command === 'format-volume'
      || (command === 'reg' && lowerArgs[0] === 'delete')) {
      tags.add('system-level');
    }
    if (command === 'shutdown') tags.add('system-level');

    if (DOWNLOAD_SOURCE.has(command) && index + 1 < infos.length
      && DOWNLOAD_SHELL.has(infos[index + 1].command)) {
      tags.add('download-exec');
    }
    if (command === 'invoke-expression' || command === 'iex') tags.add('download-exec');

    for (let argIndex = 0; argIndex < lowerArgs.length; argIndex += 1) {
      if (['-d', '--data', '--data-binary', '--data-raw'].includes(lowerArgs[argIndex])) {
        const next = lowerArgs[argIndex + 1] ?? '';
        if (next.startsWith('@')) tags.add('outbound-send');
      }
      if (lowerArgs[argIndex].startsWith('--data=') && lowerArgs[argIndex].includes('@')) {
        tags.add('outbound-send');
      }
    }
    if (['nc', 'netcat', 'ncat'].includes(command)) tags.add('outbound-send');
    if (['scp', 'rsync'].includes(command)
      && lowerArgs.some((value) => /^[^:]+@[^:]+:/.test(value) || /^[^:]+:/.test(value))) {
      tags.add('outbound-send');
    }

    if (depth < 2) {
      const nested = nestedCommand(info);
      if (nested !== null) {
        const nestedResult = analyzeText(nested, depth + 1);
        for (const tag of nestedResult.tags) tags.add(tag);
        for (const target of nestedResult.targets) addTarget(targets, target);
      }
    }
  }

  if (SECRET_WORDS.test(text)
    && !infos.every((info) => SECRET_NON_ACCESS.has(info.command))) {
    tags.add('secret-access');
    for (const token of tokens(text)) {
      const value = stripQuotes(token);
      if (/(?:\.ssh|\.aws|\.env|id_rsa|credentials)/i.test(value)) addTarget(targets, value);
    }
  }

  return { tags, targets };
}

/**
 * Normalize a command for analysis and storage hashing.
 * @param {unknown} command - raw command text.
 * @param {number} [maxChars] - truncation length.
 * @returns {{text: string, truncated: boolean}} normalized text.
 */
export function normalizeCommand(command, maxChars = DEFAULT_MAX_CHARS) {
  const limit = Number.isInteger(maxChars) && maxChars > 0
    ? Math.min(maxChars, 65536)
    : DEFAULT_MAX_CHARS;
  if (typeof command !== 'string') return { text: '', truncated: false };
  const text = command.replace(/\r\n?/g, '\n').trim();
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

/**
 * Hash the normalized command together with the tool name.
 * The hash is stable across sessions and contains no raw command text.
 * @param {unknown} command - command text.
 * @param {string} [toolName] - tool that will execute it.
 * @returns {string} first 16 hex chars of SHA-256.
 */
export function commandHash(command, toolName = '') {
  const normalized = normalizeCommand(command).text.replace(/\s+/g, ' ').trim();
  const prefix = typeof toolName === 'string' ? toolName : '';
  return createHash('sha256').update(`${prefix}\u0000${normalized}`, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Analyze one shell command into display-only risk tags.
 * @param {unknown} command - command text.
 * @param {object} [options] - `{ maxChars }`.
 * @returns {{level: 'high'|'medium'|'unknown', tags: string[], targets: string[], truncated: boolean}}
 */
export function analyzeCommand(command, options = {}) {
  const normalized = normalizeCommand(command, options.maxChars);
  if (normalized.text.length === 0) {
    return { level: 'unknown', tags: [], targets: [], truncated: normalized.truncated };
  }

  const result = analyzeText(normalized.text);
  const tags = RISK_TAG_ORDER.filter((tag) => result.tags.has(tag)).slice(0, MAX_TAGS);
  const targets = result.targets.slice(0, MAX_TARGETS);
  const level = tags.some((tag) => TAG_LEVEL[tag] === 'high')
    ? 'high'
    : tags.some((tag) => TAG_LEVEL[tag] === 'medium') ? 'medium' : 'unknown';

  return { level, tags, targets, truncated: normalized.truncated };
}
