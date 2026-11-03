# DAM 改造计划（2026-11-03）

> 依据：项目根目录的 `DSH-Agent效率与防错改造说明.md`
> 范围：仅 DAM（dsh-approval-memory）；不包含 DFL / DSK / GATE 代码。
> 当前基线：135 项测试，GitHub `e44dbf0`；本计划第一步已完成。

## 1. 结论

从说明文档中，DAM 能独立完成的部分只有：

1. **不可逆动作标签**（P1-1）——做；
2. 更新 DAM 测试基线 107 → 134——做；
3. Ship/合并审批归档（P2-2）——不做（无素材、低价值）；
4. GATE 联动——**条件可行**，必须先定义“GATE ask 永不自动同意”的契约；
5. 路径信任与 GATE 的优先级——必须保证 GATE 优先，不能被 DAM 自动同意绕过。

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

## 3. GATE 联动（后续，不在第一步）

需要先定契约：

- GATE 的 ask 必须带可识别标记（专用 toolName、source，或 reason 前缀）；
- DAM 命中 GATE ask 时**永远不自动同意**，直接回落人工；
- GATE ask 仍由 DAM 记录/分类/审计；
- GATE block 不产生审批，DAM 不记录（除非另有审计通道）。

没有这个契约前，不实现 GATE，也不把 GATE 的规则塞进 DAM。

## 4. 测试基线

说明文档写 DAM 107 项；实际当前为 134 项。更新文档引用，验收以实际全量测试为准。

## 5. 不做

- 不做 Ship/合并审批归档；
- 不让 DAM 做命令阻断；
- 不让不可逆标签参与自动同意；
- 不擅自放开 shell 黑名单；
- 不实现 GATE 代码。

## 6. 第一步完成标准

1. 四个标签可从命令解析器输出；
2. 风险 UI 能显示标签；
3. 自动同意判定不变；
4. 全量测试通过；
5. 版本升到 `0.2.0`；
6. 更新 `PROGRESS.md`。
