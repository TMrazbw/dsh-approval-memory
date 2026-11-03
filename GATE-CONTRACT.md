# GATE ask contract

> Status: **defined** (DAM 0.3.x; GATE 0.1.0 implemented).
> Scope: only the hand-off between GATE and DAM; it does not add DAM rules or blocking.

## Decision

GATE asks must never be auto-approved by DAM. Because the DSH tools pipeline
turns a `tools/pre-execute` `ask` into an ordinary `approval/request`, GATE and
DAM need one stable signal that survives the hand-off.

**Reserved marker:** `GATE-ASK:`

GATE must put the marker at the very beginning of the approval request's
`reason` string. DAM checks for that exact prefix and delegates the request to
the human answerer even when a class rule or a Session path trust would
otherwise auto-approve it.

```text
GATE-ASK:<rule-id> <short, stable summary>
```

Example:

```js
// inside the GATE tools/pre-execute listener
return {
  kind: 'ask',
  reason: `GATE-ASK:recursive-delete ${summary}`,
  displayReason: {
    en: `GATE detected a risky shell command. Allow this one call? ${summary}`,
    zh: `GATE 检测到高风险 shell 命令。是否允许这一次调用？${summary}`,
  },
};
```

The text after the marker may contain spaces. The marker itself is ASCII and
never localized. A space after the colon is recommended but not required.
`displayReason` is optional localized UI copy and is not used for detection;
`approval/asked` does not log it.

## GATE obligations

1. Only GATE writes the `GATE-ASK:` prefix. Do not use it for `observe` or
   `block`; those do not create an approval request.
2. Set `reason` to a string that starts with `GATE-ASK:`. Do not put the marker
   later in the string and do not add leading whitespace.
3. `displayReason` may be a localized object (`{ en, zh, ... }`) or a string.
   It is UI copy only: it need not contain the marker, because detection and
   audit use `reason`.
4. Emit one `ask` per tool call. Do not retry the same ask in a loop.
5. Keep the rule id stable. The human explanation may change; the prefix must
   not.
6. GATE still owns the actual gate: `block` is GATE's decision, and GATE must
   not depend on DAM to deny anything. DAM only declines to auto-approve.
7. If a future GATE release changes the marker, update this contract and DAM's
   `lib/gate.js` together. The marker is a versioned compatibility point.

## DAM obligations

`lib/gate.js` exposes:

- `GATE_ASK_PREFIX` — the exact reserved prefix;
- `isGateAsk(request)` — true when `reason`, or a string `displayReason`,
  starts with the prefix. A localized object `displayReason` is not inspected;
  GATE's `reason` carries the marker.

When `isGateAsk` is true, `lib/host.js` returns `next()` before any class-rule,
path-trust, or auto-approval logic. DAM still observes the normal
`approval/asked` / `approval/decided` pair, classifies the request, records
counts, and audits the human outcome. No new session event type is created.

Consequences:

| Situation | Result |
|---|---|
| GATE ask, low-risk class enabled | human answerer decides |
| GATE ask, Session path already trusted | human answerer decides |
| GATE ask, user rejects | counted as a human rejection |
| GATE ask, user allows | counted as a human allow, not `auto` |
| normal ask (no marker) | existing DAM behavior unchanged |
| forged marker in a normal ask | human review; safe false positive |

## Why this signal

- `toolName` is the real tool (`pwsh`, `write`, …); GATE cannot rename it from
  `tools/pre-execute`.
- `callId` is assigned by the tools pipeline, not by GATE.
- `reason` is the only GATE-controlled string that reaches both DAM's
  `approval/request` listener and the durable `approval/asked` audit event.
- `displayReason` can be localized and is not logged by `approval/asked`, so it
  cannot be the sole marker. GATE 0.1.0 sends `{ en, zh }`; detection uses
  `reason`.

## Limits

- The marker is a **contract**, not a security boundary. A forged marker can
  force a manual prompt (safe) but cannot bypass the human answerer.
- DAM cannot record a GATE `block`; a block never produces an approval. GATE
  must keep its own audit if blocks need to be visible.
- DAM does not import GATE and GATE does not import DAM.
- The marker only covers approval asks. GATE's rule table, defaults, and
  blocking behavior are out of DAM's scope.

## Test vectors

| Input | Is a GATE ask? |
|---|---|
| `GATE-ASK:recursive-delete rm -rf ./build` | yes |
| `GATE-ASK:` | yes |
| `GATE-ASK` | no |
| `gate-ask:recursive-delete` | no |
| `prefix GATE-ASK:recursive-delete` | no |
| `""` | no |
| missing / non-string | no |

DAM's tests cover these vectors in `test/gate.test.js`, and the end-to-end guard
in `test/host.test.js`.
