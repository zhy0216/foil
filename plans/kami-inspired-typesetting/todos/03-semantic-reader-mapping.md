difficulty: hard
agent: inherit

# 语义 Markdown 阅读结构与评论源映射

对应 plan.md「方案 3」。依赖 `01-typography-scope-lists.md`。这是正式阅读排版的主要技术成本，不能通过对现有 Preview 隐藏 `.syn` 来替代。现有 `renderDecorated`、Editor 与 `Preview` 继续负责逐行原文视图，本任务新建独立模块，不改它们的既有契约。

## T1 · 解析器验证与语义文档模块

- 要做什么：新建 `lib/reading-document.ts`（文件名可小幅调整），把规范化 Markdown 解析为文档结构；支持 ATX 标题、段落与软/硬换行、分隔线、有序/无序/任务及嵌套列表、引用、围栏代码、行内强调/删除线/代码/链接、GFM 表格，并兼容 Foil 已有的 `==高亮==` 扩展。首步用包含嵌套结构、转义字符、实体、CRLF、emoji、组合字符和表格的样本验证候选解析器的块级/行内 source position、浏览器构建、扩展 CSP 与独立 IIFE 输出；所选依赖放在实际使用它的 `packages/editor`，更新唯一 `bun.lock`，记录版本与网站主资源/阅读运行时的体积增量，不预先承诺未验证的库接口。
- 预计修改文件：`packages/editor/src/lib/reading-document.ts`、`packages/editor/src/lib/reading-document.test.ts`、`packages/editor/package.json`、根 `bun.lock`（如新增依赖）。
- 验收：上述 Markdown 结构全部生成正确块/行内结构；转义与实体正确解码且不丢字；CRLF 归一化；解析器无远程加载；浏览器构建与 standalone IIFE 构建通过；记录依赖版本、体积增量和 `bun audit` / `bun audit --prod` 结果。
- 前置依赖：01 已合入。

## T2 · 源偏移到可见文本的映射

- 要做什么：新建 `lib/reading-source-map.ts`，按 UTF-16 源偏移记录每个可见文本片段；正确处理转义、实体解码、被折叠的语法标记、软换行和表格单元格边界，不能假设可见字数等于源字符数。评论锚点仍使用 quote / before / after：先在规范化 Markdown 中定位原始范围，再映射到阅读 DOM；跨块与重叠评论映射为多个可见片段；仅引用语法标记、目标不可见或无法可靠定位的评论进入「未定位」列表保持可达。激活评论只更新状态，不重建选区。阅读 DOM 不调用 `getMarkdown`、`setSelectionOffsets` 等逐行编辑器函数。
- 预计修改文件：`packages/editor/src/lib/reading-source-map.ts`、`packages/editor/src/lib/reading-source-map.test.ts`。
- 验收：固定样本覆盖转义、实体、折叠标记、软换行、表格、emoji/组合字符；跨块和重叠评论映射到多个片段；不可定位评论可靠回退到未定位列表而不是错误挂载；激活/切换评论不破坏其他高亮与滚动位置。
- 前置依赖：本文件 T1。

## T3 · React 阅读渲染与安全边界

- 要做什么：新建 `components/ReadingPreview.tsx`，用 React 白名单节点输出 T1 的文档结构，不执行原始 HTML（原始 HTML 作为文本显示）；未知扩展与无法完整处理的内容可读回退、不丢弃。阅读链接仅允许明确的安全协议（HTTP(S)、mailto、已解析的文内目标），不把 `file:`、`javascript:`、`data:` 等直接转成导航，外部链接仅用户主动点击、禁止自动预取。Markdown 图片先显示替代文字与可读目标说明，不自动请求远程资源；公式、Mermaid 围栏继续按源文本/代码显示。阅读模式复制用户看到的文本，另提供 Copy Markdown；Source/Preview 保留当前精确复制原始 Markdown 的行为，两个契约分别测试。
- 预计修改文件：`packages/editor/src/components/ReadingPreview.tsx`、`packages/editor/src/components/ReadingPreview.test.tsx`、`packages/editor/src/styles/styles.css`（阅读结构样式）、必要时新增样式文件。
- 验收：内容覆盖样本无缺失、无重复；危险链接与原始 HTML 不产生导航或脚本执行；图片不发远程请求；可见文本复制与 Copy Markdown 行为分别通过测试；现有 `Preview.test.tsx` 的原始 Markdown 复制契约保持不变。

## T4 · 构建边界与回归

- 要做什么：验证新模块在网站、扩展 CSP 与 standalone 输出中的边界：阅读资源不得引入编辑器、文档库依赖或外部 chunk；`build/standalone.ts` 的构建断言继续通过；CSP 不新增外部来源。为 04 的接入保留稳定接口（解析结果结构、评论映射查找、可见文本复制），在 todo 完成记录中写清。
- 预计修改文件：受影响的构建/类型文件、`packages/editor/build/standalone.ts`（仅当确有必要）、针对性的构建断言测试。
- 验收：`bun run typecheck`、`bun run test`、`bun run build` 通过；standalone 构建断言通过；扩展构建不因新依赖失败；记录网站与导出文件的体积增量。

## 验证

在任务 worktree 中顺序运行：

~~~bash
bun install
bun run typecheck
bun run test
bun run build
bun audit
bun audit --prod
~~~

新增依赖时提交更新后的 `bun.lock`（只此一份）。若 KDF 相关单测因并行负载超时，单独重跑确认，不修改这些测试。`git diff --check` 通过。
