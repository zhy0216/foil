# repo-improvements 执行队列

方案：[../plan.md](../plan.md)。基线：`9057cc4`。每个 todo 对应一个独立 worktree 和一个最终 commit；任务内包含实现及相应回归。R01–R06 为 roadmap，不执行。

## 执行偏好

default_agent: codex

来源：发起 auto-dev 的 Codex 宿主。用户没有指定模型、推理强度或单任务 agent；各文件 `agent: inherit`。不要因为换了协调器宿主而重新推断默认值，也不要把协调器的 high 当成所有任务的档位。

按共享规则解析：easy → Codex `gpt-6-astra` / `high`；medium → `gpt-6-astra` / `xhigh`；hard → `gpt-6-astra` / `max`。所有启动显式使用 YOLO 参数；先检查本机 CLI 和模型元数据是否支持，不静默换模型或降档。

## 优先级

| 文件 | 优先级 | 难度 | agent | 模型 / Codex 推理强度 | 说明 |
| --- | --- | --- | --- | --- | --- |
| [01-share-boundaries.md](01-share-boundaries.md) | P1 | hard | codex，继承默认 | gpt-6-astra / max | 分享数据、大小与协议边界 |
| [02-markdown-fidelity.md](done/02-markdown-fidelity.md) | P1 | medium | codex，继承默认 | gpt-6-astra / xhigh | 已完成：原始 Markdown 字符保真 |
| [03-editor-input.md](done/03-editor-input.md) | P1 | hard | codex，继承默认 | gpt-6-astra / max | 已完成：输入、选区、评论高亮生命周期 |
| [04-local-persistence.md](04-local-persistence.md) | P1 | hard | codex，继承默认 | gpt-6-astra / max | 保存与 storage 失败恢复 |
| [05-import-lifecycle.md](05-import-lifecycle.md) | P1 | hard | codex，继承默认 | gpt-6-astra / max | 初始化、解锁取消、只读与文档切换 |
| [06-comment-layout.md](06-comment-layout.md) | P1 | hard | codex，继承默认 | gpt-6-astra / max | 评论定位与实际尺寸布局 |
| [07-timecapsule-network.md](07-timecapsule-network.md) | P1 | hard | codex，继承默认 | gpt-6-astra / max | drand 超时、回退与类型 |
| [08-share-generation.md](08-share-generation.md) | P1 | medium | codex，继承默认 | gpt-6-astra / xhigh | 链接结果必须兑现当前选项 |
| [09-toolchain-ci.md](09-toolchain-ci.md) | P1 | hard | codex，继承默认 | gpt-6-astra / max | 依赖漏洞、相容工具链及 CI |
| [10-accessible-dialogs.md](10-accessible-dialogs.md) | P2 | medium | codex，继承默认 | gpt-6-astra / xhigh | 弹层、菜单、控件与键盘 |
| [11-documentation.md](11-documentation.md) | P2 | easy | codex，继承默认 | gpt-6-astra / high | 实现、隐私与历史审计文档一致 |
| [12-browser-regressions.md](12-browser-regressions.md) | P1 | hard | codex，继承默认 | gpt-6-astra / max | Chromium/WebKit 完整行为回归 |

## 文件

1. `01-share-boundaries.md` — 依赖：无。
2. [02-markdown-fidelity.md](done/02-markdown-fidelity.md) — 已完成；依赖：无。
3. [03-editor-input.md](done/03-editor-input.md) — 已完成；依赖 `02-markdown-fidelity.md`。
4. `04-local-persistence.md` — 依赖 `01-share-boundaries.md`。
5. `05-import-lifecycle.md` — 依赖 `03-editor-input.md`、`04-local-persistence.md`。
6. `06-comment-layout.md` — 依赖 `05-import-lifecycle.md`。
7. `07-timecapsule-network.md` — 依赖：无。
8. `08-share-generation.md` — 依赖 `01-share-boundaries.md`。
9. `09-toolchain-ci.md` — 依赖：无。
10. `10-accessible-dialogs.md` — 依赖 `06-comment-layout.md`、`08-share-generation.md`。
11. `11-documentation.md` — 依赖 `01-share-boundaries.md`、`02-markdown-fidelity.md`、`03-editor-input.md`、`04-local-persistence.md`、`05-import-lifecycle.md`、`06-comment-layout.md`、`07-timecapsule-network.md`、`08-share-generation.md`、`09-toolchain-ci.md`、`10-accessible-dialogs.md`。
12. `12-browser-regressions.md` — 依赖 `01-share-boundaries.md`、`02-markdown-fidelity.md`、`03-editor-input.md`、`04-local-persistence.md`、`05-import-lifecycle.md`、`06-comment-layout.md`、`07-timecapsule-network.md`、`08-share-generation.md`、`09-toolchain-ci.md`、`10-accessible-dialogs.md`。

## 调度与文件边界

- 初始并行：01、02、07、09。02 完成后 03 可启动；01 完成后 04、08 可启动。
- `04 → 05 → 06 → 10` 共用 App 或评论组件，按依赖串行。03 在 Editor 的修改完成后，05 才接入新接口，06 才扩展定位。
- 09 独占 package/lock/Vite/Vitest/Playwright/CI 配置和最小浏览器 smoke；其他任务使用已有 React/Vitest 写回归。12 在这些配置合并后补行为测试，不与 09 同时改脚本。
- 11 和 12 可在 01–10 合并后并行。11 负责 README/CLAUDE/Help/历史审计；12 负责浏览器 specs、fixtures 和本计划内验证报告。
- 每次完成依赖后，从已合并基线建 worktree。发现必须修改其他活跃任务拥有的文件时，先沟通并串行化，不能通过冲突覆盖别人的实现。

## 共同验收

每个任务运行 `bun run typecheck`、`bun run test`、`bun run build`，另跑本任务要求的定点验证。保持四类合法分享及存量文档兼容，密码学参数不变，无新增后端/遥测。审计与版本范围以执行时实际结果为准。09/12 补充冻结安装、依赖审计、Chromium/WebKit；IME 无法自动化的部分保留人工步骤与实际限制，不冒充已测。

不要仅为使测试通过而改写验收要求；跨任务发现的新失败交回对应实现任务修复后继续集成。当前 auto-dev 只提交计划；之后的实现提交、rebase、验证和合并由 herdr-finish-plan 协调器执行，不自动 push 或发布。
