# DAM 改造计划（2026-11-03）

> 依据：项目根目录的 `DSH-Agent效率与防错改造说明.md`
> 范围：DAM（dsh-approval-memory）自身；不含其他插件。
> 当前基线：136 项测试（GATE 相关用例已随插件删除移除），GitHub `2072f3c`（0.3.1）；本地 0.3.2 待发布。

## 1. 结论

从说明文档中，DAM 能独立完成的部分只有：

1. **不可逆动作标签**（P1-1）——做；
2. 更新 DAM 测试基线 107 → 143——做；
3. Ship/合并审批归档（P2-2）——不做（无素材、低价值）；
4. 原 GATE 联动——**已移除**：GATE 插件于 2026-11-04 删除，DAM 侧契约代码与测试同步删除。

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
- 不做命令阻断（不属于 DAM 职责）；
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

## 3. GATE 联动（已移除 2026-11-04）

- GATE 插件已删除；DAM 侧契约识别、`gate:<rule>` 分类与相关测试一并移除。
- 历史实现见本项目 `PROGRESS.md` 2026-11-03 记录。

## 4. 测试基线

说明文档写 DAM 107 项；当前为 **136 项**（GATE 用例移除后）。更新文档引用，验收以实际全量测试为准。

## 5. 不做

- 不做 Ship/合并审批归档；
- 不让 DAM 做命令阻断；
- 不让不可逆标签参与自动同意；
- 不擅自放开 shell 黑名单。

## 6. 完成标准

### 6.1 第一步（Step 22）

1. 四个标签可从命令解析器输出；
2. 风险 UI 能显示标签；
3. 自动同意判定不变；
4. 全量测试通过；
5. 版本升到 `0.2.0`；
6. 更新 `PROGRESS.md`。

### 6.2 第二步（Step 23/24，已移除）

- 原 GATE 契约与分类验收项随 GATE 插件删除作废。
