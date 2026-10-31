# dsh-approval-memory 请求类总表

> 本表是插件“请求分类 + 风险 + 开关状态 + 实际计数”的唯一依据。
> 修改本表前先取得用户明确同意，并记录变更。
>
> - 生成日期：2026-10-22
> - 最近更新：2026-10-22（Step 1.1：可开类默认开启；移除主表“永不”行；新增实际出现次数）
> - 适用版本：V1（只读类自动同意）
> - 风险口径：**静态规则推断，不是安全保证**
> - 出现频率：**典型插件开发会话的预估**
> - 实际出现次数：当前插件尚未安装，全部为 **0**；安装后由 `session/event` 实时更新
>
> 按用户要求：**所有 ✅ 可开类默认开启**；“建议永不”的类已从主表移除，
> 但内部仍保留硬禁止（不会自动同意，仍会计数到内部审计）。

---

## 1. 图例

### 操作类别

| 值 | 含义 |
|---|---|
| 读取 | 只读查询，不改变磁盘、配置或外部状态 |
| 写入 | 修改文件/目录内容 |
| 配置变更 | 修改 profile / 插件启用状态 |
| 安装 | 下载、安装、运行构建脚本 |
| 删除/卸载 | 删除文件、卸载依赖、移除配置 |
| 执行 | 运行命令/脚本/内层工具 |
| 权限/安全 | 修改权限、沙箱模式、版本兼容性豁免 |
| 未知 | 无法从参数可靠解析 |

### 危险等级

| 等级 | 含义 | V1 是否允许自动同意 |
|---|---|---|
| 低 | 确定性只读，无持久副作用 | ✅ 默认开启，用户可关 |
| 中 | 有持久副作用但可回滚 | ⚠️ 仅展示，V1 不开 |
| 高 | 安装/卸载/权限/沙箱完全访问/不可逆 | ❌ 仅统计 |
| 未知 | 无结构化参数或第三方工具 | ❌ 仅统计 |

> “永不”类（版本豁免、完全访问等）已按用户要求从主表移除；
> 内部仍保留硬禁止，见 §3。它们仍然不会被自动同意。

### V1 状态

| 标记 | 含义 |
|---|---|
| ✅ 开（默认） | V1 默认开启；用户可在 UI 逐类关闭 |
| ⚠️ 关（仅展示） | V1 展示但开关禁用；留到 V1.5 评估“二次确认” |
| ❌ 仅统计 | 只记录、不提供开关；自动同意一律不发生 |

### 出现频率 / 实际出现次数

- **出现频率（预计）**：典型插件开发会话的预估，不是实测。
- **实际出现次数**：`counts.total`，每次 `approval/asked` 加 1；没有出现就是 **0**。
- 安装后表格显示真实次数；已有类 +1，新类新增一行。

---

## 2. 请求类总表

| # | 请求名（UI） | 类键 | 操作类别 | 危险性 | 出现频率（预计） | 实际出现次数 | V1 状态 | 说明 / 判定依据 |
|---:|---|---|---|---|---|---:|---|---|
| 1 | 插件管理 · 列出已安装插件 | `plugin_manager:list_plugins` | 读取 | 低 | 很高 | 0 | ✅ 开（默认） | 只返回条目列表，不修改 profile |
| 2 | 插件管理 · 列出 Bundle | `plugin_manager:list_bundles` | 读取 | 低 | 很高 | 0 | ✅ 开（默认） | 只读已安装/可选 bundle 目录 |
| 3 | 插件管理 · 列出版本豁免 | `plugin_manager:list_version_exemptions` | 读取 | 低 | 中 | 0 | ✅ 开（默认） | 只读兼容性豁免表 |
| 4 | 插件管理 · 检查包（若版本提供） | `plugin_manager:inspect` | 读取 | 低 | 中 | 0 | ✅ 开（默认，预留） | 当前工具 schema 无此 action；若未来出现按只读类处理 |
| 5 | 插件管理 · 启用/禁用插件 | `plugin_manager:set_plugin` | 配置变更 | 中 | 中 | 0 | ⚠️ 关（仅展示） | 持久修改 profile，影响所有会话 |
| 6 | 插件管理 · 启用/禁用 Bundle | `plugin_manager:set_bundle` | 配置变更 | 中 | 中 | 0 | ⚠️ 关（仅展示） | 可能改变其他会话的加载行为 |
| 7 | 插件管理 · 安装 Bundle | `plugin_manager:install_bundle` | 安装 | 高 | 中 | 0 | ❌ 仅统计 | 会运行 pnpm / 构建脚本；第三方代码进入进程 |
| 8 | 插件管理 · 卸载 Bundle | `plugin_manager:remove_bundle` | 删除/卸载 | 高 | 低-中 | 0 | ❌ 仅统计 | 可能删除依赖、破坏 profile |
| 9 | Bash · 沙箱升级到 workspace-write | `bash:sandbox:workspace-write` | 执行/写入 | 高（保守） | 高 | 0 | ❌ 仅统计 | 命令是自由文本，无法静态判定副作用 |
| 10 | PowerShell · 沙箱升级到 workspace-write | `pwsh:sandbox:workspace-write` | 执行/写入 | 高（保守） | 高 | 0 | ❌ 仅统计 | PowerShell 有别名/脚本块/编码命令 |
| 11 | 文件写入 · 越界到 workspace-write | `write:sandbox:workspace-write` | 写入 | 高（保守） | 中 | 0 | ❌ 仅统计 | 目标路径决定风险 |
| 12 | 文件编辑 · 越界到 workspace-write | `edit:sandbox:workspace-write` | 写入 | 高（保守） | 中 | 0 | ❌ 仅统计 | 同文件写入 |
| 13 | PTC / run_code 内层请求 | `run_code:<innerTool>` | 执行 | 高/未知 | 低 | 0 | ❌ 仅统计 | 当前 profile 未启用 PTC；内层参数可能不可得 |
| 14 | MCP / 第三方工具请求 | `mcp:<toolName>` / `<toolName>` | 未知 | 未知 | 未知 | 0 | ❌ 仅统计 | 无结构化 action；不能安全分类 |
| 15 | 其他未知请求 | `unknown:<toolName>` | 未知 | 未知 | 未知 | 0 | ❌ 仅统计 | 默认不可自动同意 |
| 16 | 文件读取 | `read:file` | 读取 | 低 | 高 | 0 | ✅ 开（默认） | 普通路径自动；敏感路径按会话精确信任 |

> “高（保守）”“高/未知”等复合值是保守表达：只要存在高风险可能，就不允许自动同意。

---

## 3. 内部硬禁止（不在主表展示）

按用户要求，以下类已从主表移除；它们默认**永远不会自动同意**，
也不得在 UI 中提供开关；`write/edit` 的精确路径例外见下方 Step 21 说明。

| 类键 | 原因 |
|---|---|
| `plugin_manager:set_version_exemption` | 绕过 DSH 版本兼容检查，可能崩溃/数据丢失 |
| `bash:sandbox:danger-full-access` | 直接绕过沙箱 |
| `pwsh:sandbox:danger-full-access` | 直接绕过沙箱 |
| `write:sandbox:danger-full-access` | 绕过文件沙箱 |
| `edit:sandbox:danger-full-access` | 绕过文件沙箱 |

> 这张表是**安全兜底**，不是“可开启请求表”。移除主表行不等于取消硬禁止。
> 任何规则创建/导入/自动建议命中上表时，必须**拒绝**、记录 `refused`，
> 并在 UI 顶部提醒“该类永远不能自动开启”。黑名单不能通过 UI 删除。
>
> **例外（Step 21）**：`write:sandbox:danger-full-access` / `edit:sandbox:danger-full-access`
> 在同一会话中，某个**精确文件路径**被人工允许一次后，后续同一路径可自动同意；
> 不信任父目录、目录子树或 shell。其它路径仍按硬禁止处理。
> `pwsh:sandbox:danger-full-access`、`bash:sandbox:danger-full-access` 永远不参与路径信任。

## 3.1 会话级路径信任

- 只适用于 `read` / `write` / `edit` 的结构化 `path` / `file_path`；
- 会话级：A 会话的信任不影响 B 会话；
- 不持久化：DSH 重启后清空；
- 只信任精确文件，不信任父目录；
- 普通 `read` 自动同意；
- 敏感路径（`.ssh`、`.aws`、`.env*`、credentials、`*.pem`、浏览器配置、Windows 凭据等）
  默认不自动；人工允许一次后，同一会话的同一精确路径才自动；
- `pwsh` / `bash` 不参与路径信任。

---

## 4. V1 默认开关

V1 默认开启以下类（用户 2026-10-22 决定）：

- `plugin_manager:list_plugins`
- `plugin_manager:list_bundles`
- `plugin_manager:list_version_exemptions`
- `plugin_manager:inspect`（若未来出现）

规则：

- 入口：侧栏图标、`/dam-ui` 命令、或自然语言（模型调用 `open_dam_ui`）；三者都只打开页面，不改开关。
  自然语言只在**新发生的**工具调用上打开；历史工具记录不自动打开，避免重新进入旧对话被抢占主区域。
- 所有类初始 **开**；用户可逐类关闭；提供“关闭全部自动同意”（只关闭规则，不关闭面板；
  关闭面板用“返回对话”）。
- 只对 `ask` 策略生效；`never` 会话直接显示“不可用”。
- 只对 root agent 生效；子代理默认只统计、不自动同意。
- 只影响后续请求；已经在等待的请求不被追溯放行。
- 自动同意仍返回一次性 `allowed-once`，不是持久工具授权。
- 首次打开侧栏面板（或输入 `/dam-ui` / 自然语言）必须显示“当前默认开启 N 类”，可立即关闭。
- **不得**把开关暴露为 agent tool；只能由页面上的用户点击操作。

所有 `⚠️`、`❌` 类在 V1 **没有可点击的自动同意开关**。  
它们仍然出现在统计表中，以便用户知道“哪些请求在发生、为什么不能自动同意”。

---

## 5. 风险判定依据（实现时的规则）

### 5.1 `plugin_manager`

从 `tool/call.arguments`（优先）或 `reason` 中的 JSON（兜底）提取 `action`：

| action | 操作类别 | 风险 | 主表状态 |
|---|---|---|---|
| `list_plugins` | 读取 | 低 | ✅ 开 |
| `list_bundles` | 读取 | 低 | ✅ 开 |
| `list_version_exemptions` | 读取 | 低 | ✅ 开 |
| `inspect`（若存在） | 读取 | 低 | ✅ 开 |
| `set_plugin` | 配置变更 | 中 | ⚠️ 关 |
| `set_bundle` | 配置变更 | 中 | ⚠️ 关 |
| `install_bundle` | 安装 | 高 | ❌ 仅统计 |
| `remove_bundle` | 删除 | 高 | ❌ 仅统计 |
| `set_version_exemption` | 权限/安全 | 高 | 内部硬禁止 |

`plugin_manager` 的所有 action 都会请求 `danger-full-access`；但“只读 action”本身不写文件，
所以风险由 action 决定，而不是由请求的沙箱模式决定。

### 5.2 沙箱升级（Bash / PowerShell / 文件）

- 从参数提取 `sandbox_permissions`（目标模式）。
- 从 `tool/call.arguments` 提取命令或路径，但 **V1 不据此自动同意**。
- `danger-full-access` → 内部硬禁止，永不自动同意（主表不展示）。
- `workspace-write` 且工具是 shell/文件 → `❌ 仅统计`。
- 原因：shell 命令是自由文本，静态分析无法证明“只读”；文件路径也无法证明不覆盖重要内容。

### 5.3 未知 / 第三方

- 无 `callId`、无 `tool/call`、参数无法解析、工具不是已知类别 → `unknown`。
- `unknown` 一律 `❌ 仅统计`，没有开关。

---

## 6. 统计与写入（每次对话都计数）

### 6.1 采集入口

- `session/event` 的 `approval/asked`：每次审批请求落日志时触发。
- `session/event` 的 `approval/decided`：人工/自动结果落日志时触发。
- 插件是 profile 级，root 监听器接收所有 Agent 的会话事件；子代理也计数。

### 6.2 写入规则

1. 解析 `approval/asked` 的 `toolName`、`callId`、`reason`。
2. 优先用 `callId` 回查同会话 `tool/call.arguments`；缺失时用 `reason` 兜底（仅 `plugin_manager`）。
3. 生成稳定类键，查 `classes` 表：
   - **已有**：`counts.total += 1`，更新 `lastSeenAt`、`examples`、`sessions`。
   - **没有**：新增一行，`counts.total = 1`，写入标题/操作类别/风险/类键。
4. `approval/decided`：按 `(sessionId, approval id)` 更新 `allowed` / `rejected` / `cancelledOrUnavailable`。
5. 自动同意：`approval/request` 处理器决定；统计侧按自动标记归入 `auto`，不重复计入人工允许。
6. 幂等：同一 `(sessionId, approval id)` 或 `(sessionId, seq)` 只计一次。
7. 失败：存储/解析失败时只写插件日志并继续；不阻断审批，不清空已有计数。

### 6.3 “实际出现次数”的显示

- 初始：全部 **0**（插件未安装）。
- 安装后：随每次对话的 `approval/asked` 增长。
- 新类：第一次出现时自动新增一行，实际次数为 1。
- 已有类：每次出现 +1，不重复建行。

### 6.4 UI 刷新

- 侧栏面板打开时（点击图标、输入 `/dam-ui`、或自然语言触发 `open_dam_ui`）拉取一次快照。
- 页面停留期间定时刷新（建议 5 秒）或手动刷新。
- 切换开关后立即更新本地状态，并显示保存失败提示。
- 不要求实时推送；审批链不依赖 UI 刷新。

---

## 7. 与实现文档的关系

- 本表是公开的请求分类与安全边界说明。
- 具体实现、Host 规则和存储格式见 [`README.md`](./README.md) 与 `lib/` 源码。
- 修改本表前先取得用户明确同意。

---

## 8. 待确认

1. `/dam-ui` 作为主命令（显示名 DAM-UI）；是否保留 `/dam` 别名？（命令名只能小写字母/数字/`_`/`-`）
2. 自然语言已确定由 `open_dam_ui` 工具支持；是否需要比 `systemPrompt` 更强的触发方式？
3. 中风险类（`set_plugin` / `set_bundle`）是否在 V1.5 加“二次确认后自动同意”？
4. 是否在 V1 回扫历史审批事件？（当前：可选，Step 5 评估）
5. 规则 TTL 默认多少天？（当前建议 30 天）
6. 某类出现过 `rejected` 后，是否自动停用该类的自动同意？（建议是）
7. 审计保留多少条/多少天？（当前建议 5000 条 / 90 天）
