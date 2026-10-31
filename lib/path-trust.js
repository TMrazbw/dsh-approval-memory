/**
 * DAM — file-path normalization and sensitivity checks for session-scoped trust.
 *
 * No approval decision is made here. The Host only uses the returned fields to
 * decide whether a file request is:
 * - a normal read (auto-approvable),
 * - a sensitive read (manual until trusted once), or
 * - a structured write/edit (manual until trusted once).
 *
 * Shell commands are intentionally not accepted by this module.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILE_TOOLS = new Set(['read', 'write', 'edit']);

const SENSITIVE_SEGMENTS = new Set([
  '.ssh', '.aws', '.azure', '.gnupg', '.kube', '.docker',
  'secrets', 'credentials', 'passwords', 'tokens',
]);

const SENSITIVE_BASENAMES = new Set([
  '.env', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
  '.npmrc', '.netrc', '.pypirc', 'credentials', 'secrets',
  'cookies', 'login data', 'keychain', 'wallet',
]);

const SENSITIVE_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore'];

const SENSITIVE_SEQUENCES = [
  '/.config/gcloud/',
  '/.config/gh/',
  '/appdata/local/microsoft/credentials/',
  '/appdata/roaming/microsoft/credentials/',
  '/appdata/local/microsoft/vault/',
  '/appdata/local/google/chrome/user data/',
  '/appdata/roaming/mozilla/firefox/',
  '/appdata/local/microsoft/edge/user data/',
];

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function realpathOrResolved(value) {
  try {
    return fs.realpathSync.native(value);
  } catch {
    // A new file may not exist yet; resolve its parent when possible.
    try {
      const parent = path.dirname(value);
      const base = path.basename(value);
      return path.join(fs.realpathSync.native(parent), base);
    } catch {
      return value;
    }
  }
}

/**
 * Normalize a path for trust comparison and sensitive-path checks.
 * @param {unknown} value - raw path from tool arguments.
 * @returns {string | null} normalized path, or null when unusable.
 */
export function normalizePath(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/^["']|["']$/g, '');
  if (raw.length === 0) return null;
  let resolved;
  try {
    resolved = path.resolve(expandHome(raw));
    resolved = realpathOrResolved(resolved);
  } catch {
    return null;
  }
  let normalized = resolved.replace(/\\/g, '/');
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

/**
 * Whether a normalized path matches a strict sensitive-path rule.
 * @param {string | null | undefined} normalized - result of normalizePath().
 * @returns {boolean} true for credentials, keys, browser profiles, and similar.
 */
export function isSensitivePath(normalized) {
  if (typeof normalized !== 'string' || normalized.length === 0) return false;
  const lower = normalized.toLowerCase();
  const padded = `/${lower}/`;
  const segments = lower.split('/').filter(Boolean);
  const base = segments.at(-1) ?? '';

  if (segments.some((segment) => SENSITIVE_SEGMENTS.has(segment))) return true;
  if (SENSITIVE_BASENAMES.has(base)) return true;
  if (base.startsWith('.env')) return true;
  if (base.startsWith('credentials') || base.startsWith('secrets')) return true;
  if (SENSITIVE_SUFFIXES.some((suffix) => base.endsWith(suffix))) return true;
  if (SENSITIVE_SEQUENCES.some((sequence) => padded.includes(sequence))) return true;
  return false;
}

/**
 * Extract the structured file target for read/write/edit requests.
 * Shell tools intentionally return null.
 * @param {string} toolName - approval tool name.
 * @param {object | null} args - parsed tool-call arguments.
 * @returns {{toolName: string, path: string | null, sensitive: boolean} | null}
 */
export function pathInfoFor(toolName, args) {
  if (!FILE_TOOLS.has(toolName)) return null;
  const raw = args?.path ?? args?.file_path ?? args?.filePath ?? args?.target ?? null;
  const normalized = normalizePath(raw);
  return {
    toolName,
    path: normalized,
    sensitive: normalized !== null && isSensitivePath(normalized),
  };
}
