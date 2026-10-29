# dsh-approval-memory（DAM）

A profile-level **Host + Client plugin for DeepSeek Harness (DSH)** that records approval requests,
groups them into request classes, shows counts and possible risk, and lets the user auto-approve
selected read-only classes.

- **DAM = DSH Approval Memory**
- No DSH core changes
- No custom session event types
- One-shot grants only: auto-approval still returns `allowed-once`

## Features

- Collects `approval/asked` / `approval/decided` from every session in the current profile.
- Groups requests into stable classes such as `plugin_manager:list_bundles` and
  `bash:sandbox:danger-full-access`.
- Shows request name, operation, actual count, split count, possible risk, and last seen time.
- Per-class switch for low-risk read-only classes.
- Collapsible **statistics-only** section for observed classes that cannot be auto-approved;
  it shows command previews, risk tags, targets, and cwd. Blacklisted classes stay out of it.
- Repeated-rejection hint for the latest command hash, queried from retained audit events
  (no fixed 30-day window; the retained window may be shorter).
- Approximate auto-approval outcomes (ok / error / no-result) from `tool/result` events.
- Read-only blacklist for classes that must never be auto-approved.
- Audit log of auto-approved requests.
- Sidebar panel, `/dam-ui` command, and the `open_dam_ui` agent tool for natural-language opening.
- Panel loads when opened; manual refresh is available.
- Horizontal and vertical scrolling for long tables.

## Install from GitHub

In a DSH Web session, install this repository as a profile bundle:

```text
plugin_manager
  action: install_bundle
  target: https://github.com/TMrazbw/dsh-approval-memory
```

Or with the DSH CLI:

```bash
dsh plugin --profile <profile> add https://github.com/TMrazbw/dsh-approval-memory
```

The installation action requires approval and may need a DSH restart depending on the profile's
HMR setup.

The plugin targets the public DSH 0.2.x plugin/event APIs. It was verified against DSH
`0.2.1-rc.2`. API changes in other DSH versions may require adjustments.

## Usage

After installation:

- Open **自动同意请求** from the left sidebar, or type `/dam-ui`.
- Say “我要看 DAM 的界面” / “open the DAM UI”; the agent can call `open_dam_ui`.
- The panel shows only request classes that actually occurred **and can be auto-approved**.
- Classes that cannot be auto-approved (blacklist, medium/high/unknown risk) are counted but
  are not listed in the toggle table; the blacklist has its own read-only section.
- Use the switch to enable or disable auto-approval for a low-risk read-only class.
- **关闭全部自动同意** disables every known rule; it does not close the panel.
- **返回对话** closes the panel and returns to the conversation.

Command names are lowercase; the typed command is `/dam-ui`, while the menu label is `DAM-UI`.

## Default auto-approval

V1 enables these low-risk read-only classes by default:

- `plugin_manager:list_plugins`
- `plugin_manager:list_bundles`
- `plugin_manager:list_version_exemptions`
- `plugin_manager:inspect` (if the installed DSH exposes it)

Everything else is conservative:

| Class | Behavior |
|---|---|
| `plugin_manager:set_plugin` / `set_bundle` | displayed, switch disabled (medium risk) |
| `plugin_manager:install_bundle` / `remove_bundle` | statistics only |
| `plugin_manager:set_version_exemption` | blacklisted, never auto-approved |
| `bash` / `pwsh` sandbox escalation | statistics only |
| `write` / `edit` sandbox escalation | statistics only |
| `bash` / `pwsh` / `write` / `edit` full access | blacklisted |
| unknown / MCP / PTC | statistics only |

Risk labels are static inferences, not a security guarantee.

## Scope

- Applies to **all sessions in the current DSH profile** where the plugin is installed.
- Subagent sessions are counted; auto-approval is disabled for subagents by default.
- Other DSH profiles, other processes, and requests made before installation are not covered.
- Data is stored under `%DSH_HOME%/approval-memory` by default:
  - `classes.json`
  - `rules.json`
  - `events.jsonl`
  - `_plugin.log`

Optional plugin config:

| Field | Default | Meaning |
|---|---|---|
| `dataRoot` | `%DSH_HOME%/approval-memory` | data directory |
| `maxEvents` | `5000` | retained audit events |
| `maxExamples` | `3` | examples retained per class |
| `includeSubagents` | `false` | allow auto-approval in subagent sessions |

Environment override: `DSH_APPROVAL_MEMORY_ROOT`.

## Security boundaries

- Auto-approval is a user-enabled rule, not an inferred “the user surely agrees” judgment.
- Repeating a request does not automatically create a rule.
- A request class with any rejection can be reviewed; V1 never treats repetition as consent.
- The blacklist is code-owned and cannot be removed through the UI/API.
- The `open_dam_ui` tool only opens the panel; it never changes rules.
- The panel uses authenticated `connection.fetch` routes:
  - `GET /api/approval-memory.snapshot`
  - `POST /api/approval-memory.mutate` (`setRule` / `closeAll`)

## Development

```bash
node --test --test-isolation=none
```

Current test suite: **126 tests**, covering classification, extraction, redaction, storage,
Host runtime, data bridge, Client registration, command-risk parsing, result tracking, and integration flows.

```text
index.js            Host entry
client.js           Client entry: panel, sidebar, /dam-ui, open_dam_ui tool view
lib/
  classes.js        request class catalog
  blacklist.js      permanent deny list
  extract.js        callId/tool-call, command/cwd, and reason extraction
  format.js         counts, time, redaction
  store.js          file-backed persistence (v2 risk metadata)
  host.js           approval runtime
  open-tool.js      plain ToolDefinition for open_dam_ui
  bridge.js         authenticated snapshot/mutate routes
  command-risk.js   pure command-risk heuristics (recorded; UI pending)
test/               126 Node tests
locale/             en / zh display metadata
```

No build step is required. The plugin uses only public DSH events/services and the browser
module loader.

## License

MIT. See [LICENSE](./LICENSE).
