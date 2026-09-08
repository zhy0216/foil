# HTML 分享导出任务队列

方案：[../plan.md](../plan.md)。目标是 Share 导出可直接发送、单文件自包含、仅 preview 的 HTML，保留普通/密码/时间胶囊/密码加时间胶囊和全部阅读功能。

## 执行偏好

default_agent: codex

来源：发起 auto-dev 的 Codex 宿主；用户未指定模型、推理强度或单任务 agent。每项 `agent: inherit`，按照当前共享分发规则解析，不把协调器的 high 当成任务默认强度。

协调器：`codex` / `gpt-6-astra` / `high`。任务：hard 用 `gpt-6-astra` / `max`，medium 用 `gpt-6-astra` / `xhigh`。所有启动使用 agent-routing 规定的 auto/YOLO 参数。本机 CLI 和模型元数据已确认这些档位可用，执行前按 skill 复核实际环境。

## 优先级

| 文件 | 优先级 | 难度 | agent | 模型 / Codex 推理强度 | 说明 |
| --- | --- | --- | --- | --- | --- |
| [01-html-payload.md](01-html-payload.md) | P1 | hard | codex，继承默认 | gpt-6-astra / max | 共用四种密码学模式，增加有界文件 payload 和版本格式 |
| [02-readonly-preview.md](02-readonly-preview.md) | P1 | hard | codex，继承默认 | gpt-6-astra / max | 网站/文件共用预览，保留评论与设置，移除文件编辑依赖 |
| [03-standalone-html.md](03-standalone-html.md) | P1 | hard | codex，继承默认 | gpt-6-astra / max | 独立阅读入口、全部资源内嵌、文件 CSP 与导出组装 |
| [04-share-export.md](04-share-export.md) | P1 | medium | codex，继承默认 | gpt-6-astra / xhigh | Share 下载 HTML，保护选项/快照一致，文件可再次分享 |
| [05-file-regressions.md](05-file-regressions.md) | P1 | medium | codex，继承默认 | gpt-6-astra / xhigh | 真实下载/file 打开浏览器回归、四种模式与使用文档 |

## 文件

1. `01-html-payload.md`

   依赖：无。可与 02 并行；只拥有 codec、文件格式及其测试。

2. `02-readonly-preview.md`

   依赖：无。可与 01 并行；拥有阅读 UI、App 阅读分支、Thread 与阅读样式，不能改 codec。

3. `03-standalone-html.md`

   依赖 01-html-payload、02-readonly-preview。等待两项合入后创建 worktree，消费它们的真实 API。

4. `04-share-export.md`

   依赖 03-standalone-html（传递依赖 01、02）。Share UI、网站/文件出口注入一起提交。

5. `05-file-regressions.md`

   依赖 04-share-export（传递依赖 01、02、03）。验证最终构建和真实用户下载流程。

执行顺序：`01 + 02` 并行 → `03` → `04` → `05`。每项一个独立 worktree、一个最终 commit。遇到同文件修改按依赖串行处理；不要同时执行其他 plans 的历史队列。

## 交接约定

- 当前默认产品范围：普通/密码文件离线；时间胶囊仍需 drand；正文和评论只读，阅读设置、帮助、继续分享保留。后续用户答复覆盖默认假设。
- 01 提供 `encodeHtmlPayload`、`decodeHtmlPayload` 和版本数据格式。02 提供不引用 Editor 的 `Preview`、`ReadOnlyDocument`，输入为 DocState、Settings、动作插槽/回调，不依赖 01。
- 03 提供运行资源、HTML 组装/下载 API、独立 App；网站加载模板与文件复用自身程序的边界必须独立，不能循环导入生成模板。
- 04 注入导出与网站链接 base，支持文件二次导出，不能拼出 file/null URL，不能把复制链接是否成功作为文件导出的条件。
- 每项完成说明记录真实接口与验证；建议落点允许小幅调整，但变更所有权/依赖需通知协调器。不得通过跳过测试、削减保护模式或放宽网站 CSP 让任务通过。
- 仓库检查：`bun run typecheck`、`bun run test`、`bun run build`。最终 `bun run test:e2e` 构建后覆盖 Chromium/WebKit。依赖变更时加 `bun audit`、`bun audit --prod`；不部署。
