# DAM 改造计划（2026-11-03）

> 依据：项目根目录的 `DSH-Agent效率与防错改造说明.md`
> 范围：DAM（dsh-approval-memory）自身；GATE 已作为独立项目 `dsh-danger-gate` 实现，不在本计划的代码范围内。
> 当前基线：143 项测试，GitHub `2072f3c`；GATE 0.1.0 + DAM 0.3.1 已完成。

## 1. 结论

从说明文档中，DAM 能独立完成的部分只有：

1. **不可逆动作标签**（P1-1）——做；
2. 更新 DAM 测试基线 107 → 143——做；
3. Ship/合并审批归档（P2-2）——不做（无素材、低价值）；
4. GATE 联动——**契约已定义，DAM 侧护栏已实现**；GATE 已作为独立项目 `dsh-danger-gate` 0.1.0 实现；
5. 路径信任与 GATE 的优先级——**已保证**：GATE ask 不会被 DAM 自动同意绕过。

## 2. 不可逆动作标签（第一步）

### 目标

在已有命令风险管线中增加四个展示标签：

- `force-push`
- `deploy`
- `data-delete`
- `send-message`

### 边界

- 只用于展示、筛选、审计；
- **不参与** `approval/request` 自动同意；
- 不做命令阻断（GATE 的职责）；
- 不调用 LLM；
- 不新增 session event type。

### 识别范围（第一版）

| 标签 | 识别 |
|---|---|
| `force-push` | `git push --force` / `-f` |
| `deploy` | `kubectl apply/delete/rollout/scale`、`terraform apply/destroy`、`helm install/upgrade/uninstall`、`npm/pnpm/yarn publish`、`docker push`、`vercel/firebase/serverless deploy`、`gh release create` |
| `data-delete` | `DROP TABLE/DATABASE/SCHEMA`、`TRUNCATE TABLE`、`DELETE FROM`、`flushall`、`dropDatabase` |
| `send-message` | `sendmail`、`mail`、`mutt`、`swaks`、`Send-MailMessage`；`curl` 到 Slack/Discord/Webhook；`gh issue/pr comment` |

`delete-recursive` 不重复打 `data-delete`；文件递归删除仍由 `delete-recursive` 表示。

### 落点

- `lib/command-risk.js`：新增标签和规则；
- `test/command-risk.test.js`：新增阳性/阴性样本；
- `client.js`：复用现有风险 chips，不新增开关；
- `README.md` / `PROJECT.md` / `PROGRESS.md`：文档与版本。

### 验收

- 新标签只出现在风险标签中；
- 自动同意判定零变化；
- 现有测试全过；
- 新增样本覆盖四类标签与误报边界。

## 3. GATE 联动（第二步：契约 + DAM 侧护栏，已完成）

### 3.1 契约

- 保留标记：`GATE-ASK:`；
- GATE 必须把它放在审批 `reason` 的最开头；如提供 `displayReason`，也必须以它开头；
- 只对 `ask` 使用；`observe` / `block` 不使用；
- GATE 仍负责真正拦截；DAM 只拒绝自动同意，不替 GATE 做判断；
- 完整契约、示例与测试向量见 `GATE-CONTRACT.md`。

### 3.2 DAM 侧实现

- 新增 `lib/gate.js`：导出 `GATE_ASK_PREFIX`、`isGateAsk()`；
- `lib/host.js` 在自动同意判定前检查，命中即直接 `next()`；
- 命中后仍由 `approval/asked` / `approval/decided` 记录、分类、计数、审计；
- 不 import GATE、不新增 session event type、不改变 gated 工具本身。

### 3.3 仍不做

- DAM 不实现 GATE 插件、规则表、`block` 或 GATE 自身审计；这些在独立项目 `dsh-danger-gate` 中实现；
- GATE `block` 不产生审批，DAM 不记录（除非将来另定审计通道）；
- 不把 GATE 规则塞进 DAM。

## 4. 测试基线

说明文档写 DAM 107 项；实际当前为 **143 项**。更新文档引用，验收以实际全量测试为准。

## 5. 不做

- 不做 Ship/合并审批归档；
- 不让 DAM 做命令阻断；
- 不让不可逆标签参与自动同意；
- 不擅自放开 shell 黑名单；
- DAM 不实现 GATE 代码；GATE 在独立项目 `dsh-danger-gate` 中实现。

## 6. 完成标准

### 6.1 第一步（Step 22）

1. 四个标签可从命令解析器输出；
2. 风险 UI 能显示标签；
3. 自动同意判定不变；
4. 全量测试通过；
5. 版本升到 `0.2.0`；
6. 更新 `PROGRESS.md`。

### 6.2 第二步（Step 23）

1. `GATE-ASK:` 标记有纯函数识别与测试向量；
2. GATE ask 在类规则开启时仍回落人工；
3. GATE ask 在路径已信任时仍回落人工；
4. GATE ask 仍被 DAM 计数/审计，且不记为自动同意；
5. 普通 ask 的自动同意行为不变；
6. 全量测试通过；
7. 版本升到 `0.3.0`；
8. 新增 `GATE-CONTRACT.md` 并更新 `PROGRESS.md`。
