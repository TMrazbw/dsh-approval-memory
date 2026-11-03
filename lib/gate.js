/**
 * DAM — GATE ask contract.
 *
 * `dsh-danger-gate` (GATE) asks from the `tools/pre-execute` waterfall. The
 * tools pipeline turns that ask into a normal `approval/request` carrying the
 * real tool name, so the only stable, cross-plugin signal is the request
 * `reason`. GATE MUST begin its ask reason with `GATE-ASK:`; DAM then refuses
 * to auto-approve it, even when a class rule or a session path trust would
 * otherwise allow the request.
 *
 * The marker is a contract, not a security boundary: forcing a manual prompt
 * is safe, so a forged marker only creates extra review work.
 */

export const GATE_ASK_PREFIX = 'GATE-ASK:';

function startsWithGateMarker(value) {
  return typeof value === 'string' && value.startsWith(GATE_ASK_PREFIX);
}

/**
 * Whether an `approval/request` came from GATE.
 * @param {object} request - approval request; `reason` is the logged marker,
 *   `displayReason` is the optional localized presentation text.
 * @returns {boolean} true when either field starts with the reserved prefix.
 */
export function isGateAsk(request) {
  if (request === null || typeof request !== 'object') return false;
  return startsWithGateMarker(request.reason)
    || startsWithGateMarker(request.displayReason);
}
