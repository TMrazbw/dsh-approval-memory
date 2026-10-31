/**
 * DAM — pure request/arguments extraction.
 *
 * The approval event itself carries no tool arguments. These helpers turn an
 * optional `callId` + session events (and, for `plugin_manager`, the reason
 * text) into the structured fields used by the classifier.
 */

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parse one lossless JSON object; arrays, scalars, empty text, and malformed
 * JSON all yield `null`.
 * @param {unknown} text - JSON text or an already-parsed object.
 * @returns {object | null} the object, or null.
 */
export function parseJsonObject(text) {
  if (isRecord(text)) return text;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Find the latest `tool/call` event for one call id.
 * @param {ReadonlyArray<object>} events - session event-like records.
 * @param {string | null | undefined} callId - approval call id.
 * @returns {null | {name: string, argumentsText: string | null, args: object | null, event: object}}
 */
export function findToolCall(events, callId) {
  if (!Array.isArray(events) || typeof callId !== 'string' || callId.length === 0) return null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'tool/call') continue;
    const data = event.data;
    if (!isRecord(data) || data.callId !== callId) continue;
    const argumentsText = typeof data.arguments === 'string' ? data.arguments : null;
    return {
      name: typeof data.name === 'string' ? data.name : 'unknown',
      argumentsText,
      args: parseJsonObject(data.arguments),
      event,
    };
  }
  return null;
}

/**
 * Extract the first balanced JSON object after a marker.
 * Handles braces inside JSON strings and escaped quotes.
 * @param {string} text - source text.
 * @param {string} marker - marker before the object (for example `plugin_manager`).
 * @returns {object | null} parsed object, or null.
 */
export function extractJsonObjectAfter(text, marker) {
  if (typeof text !== 'string' || typeof marker !== 'string' || marker.length === 0) return null;
  const markerAt = text.indexOf(marker);
  if (markerAt < 0) return null;
  const start = text.indexOf('{', markerAt + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return parseJsonObject(text.slice(start, index + 1));
    }
  }
  return null;
}

/**
 * Recover `plugin_manager` arguments from the reason fallback.
 * The built-in tool emits `escalate sandbox to <mode>: plugin_manager {json}. ...`.
 * @param {string} reason - approval reason text.
 * @returns {object | null} parsed arguments, or null.
 */
export function extractPluginManagerArgsFromReason(reason) {
  return extractJsonObjectAfter(reason, 'plugin_manager');
}

/**
 * Read the requested sandbox mode from a reason line.
 * @param {string} reason - approval reason text.
 * @returns {string | null} mode such as `workspace-write`, or null.
 */
export function extractRequestedModeFromReason(reason) {
  if (typeof reason !== 'string') return null;
  const match = /escalate sandbox to ([a-z-]+):/i.exec(reason);
  return match === null ? null : match[1].toLowerCase();
}

/**
 * Resolve the structured fields for one approval request.
 * @param {object} input - `{ toolName, callId?, reason?, events? }`.
 * @returns {object} extracted request, including `source` for diagnostics.
 */
export function extractRequest(input = {}) {
  const toolName = typeof input.toolName === 'string' && input.toolName.length > 0
    ? input.toolName
    : 'unknown';
  const callId = typeof input.callId === 'string' && input.callId.length > 0 ? input.callId : null;
  const reason = typeof input.reason === 'string' ? input.reason : null;

  const call = findToolCall(input.events, callId);
  let args = call === null ? null : call.args;
  let source = call === null ? 'none' : 'tool_call';

  if (args === null && toolName === 'plugin_manager') {
    const fallback = extractPluginManagerArgsFromReason(reason);
    if (fallback !== null) {
      args = fallback;
      source = 'reason';
    }
  }

  const action = typeof args?.action === 'string' ? args.action : null;
  const requestedMode = typeof args?.sandbox_permissions === 'string'
    ? args.sandbox_permissions
    : extractRequestedModeFromReason(reason);
  const innerTool = typeof args?.tool === 'string'
    ? args.tool
    : (typeof args?.name === 'string' ? args.name : null);
  const command = typeof args?.command === 'string' && args.command.trim().length > 0
    ? args.command
    : null;
  const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : null;
  const filePath = typeof args?.path === 'string' && args.path.length > 0
    ? args.path
    : (typeof args?.file_path === 'string' && args.file_path.length > 0
      ? args.file_path
      : (typeof args?.filePath === 'string' && args.filePath.length > 0 ? args.filePath : null));

  return {
    toolName,
    callId,
    action,
    requestedMode,
    innerTool,
    args,
    argumentsText: call === null ? null : call.argumentsText,
    command,
    cwd,
    path: filePath,
    commandSource: command === null ? 'none' : 'tool_call',
    source,
    reason,
  };
}
