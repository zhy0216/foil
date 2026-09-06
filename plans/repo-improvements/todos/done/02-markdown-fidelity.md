difficulty: medium
agent: inherit

# 保留 Markdown 原始字符

状态：已完成（2026-09-06）。

对应发现：F06、F07、F31。依赖：无。独占 `markdown.ts` 及其测试，不修改 Editor/editor-dom 或格式化整个仓库。

## T1 · 修复渲染回读不变量

- 要做什么：`classifyLine` 使用实际捕获的标题/引用/列表/task 空白，保留只有空白的行。不要把 `\s+` 替换为一个空格，不给 `>quote` 添加空格。保持所有语法标记可见、`.ln` 分行约定和仅真正空内容所需的 ZWSP。
- 预计修改文件：`src/lib/markdown.ts`、`src/lib/markdown.test.ts`。
- 验收：`getMarkdown(renderDecorated(md))` 对 `#  heading`、`-   item`、`1.  item`、`>quote`、`\t  `、`-\t[x]\titem` 精确相等。扩展覆盖 CRLF 的明确策略、前后空白、空行、围栏、嵌套样式、中文/emoji、链接/图片文字；不得引入真实 href/src 或执行 HTML。
- 前置依赖：无。

## T2 · 完整转义契约

- 要做什么：为 `escapeHtml` 补双/单引号转义，说明它仍不能替代 URL/CSS 上下文校验。检查字符保真和现有 XSS 回归，不以 HTML 序列化字符串必须完全相同为验收。
- 预计修改文件：`src/lib/markdown.ts`、`src/lib/markdown.test.ts`。
- 验收：引号、实体、代码围栏中的 HTML 及全部现有恶意样本安全；DOM textContent 保留原字符，原有测试不因改写期望而失去覆盖。
- 前置依赖：本文件 T1。

验证：`bun run typecheck`、`bun run test`、`bun run build`。不把编辑器迁移/完整 Markdown 语法扩展混入此次修复。

## 完成与验收证据

- T1：标题、引用、无序/有序列表及 task 使用捕获到的原始空白；只有真正空行插入 ZWSP。六个指定样例全部经真实 `getMarkdown` 回读精确相等。新增逐行 `textContent`、`.ln` 数量、`data-i` 顺序及混合文档重复渲染验证，覆盖前后空白、空行、围栏、嵌套样式、中文/emoji、链接/图片文字。
- 换行策略：渲染前将 CRLF 与单独 CR 统一为 LF，与 DOM 读取器逐行使用 LF 拼接一致；四组测试覆盖混合换行、末尾空行、纯空白行与围栏，避免 HTML 解析将 CR 留成块内额外换行。
- T2：补全双/单引号转义，契约注明不能替代 URL/CSS 校验，也不适用于无引号属性及可执行上下文。用 DOM 文本与双/单引号属性验证字符保真、实体不重复解码；保留所有原有恶意样本及断言，额外限制渲染结果仅包含 div/span 与 class/data-i 属性，无真实 href/src、事件属性或可执行 HTML。
- `bun install --frozen-lockfile`：通过，package/lock 未修改。
- `bun run test src/lib/markdown.test.ts`：79 项通过。最初仅加入回归、尚未修复时，59 项中有 27 项失败，包含六个指定样例、换行和引号边界。
- `bun run typecheck`：通过。
- `bun run test`：2 个文件、83 项通过；测试未访问真实 drand。
- `bun run build`：通过，Vite 5.4.21，194 modules。
- `git diff --check`：通过。
- 剩余限制：本任务验证使用现有 JSDOM；Chromium/WebKit 属于后续任务。基线 Vite/React 插件的 esbuild/oxc 三条警告仍由 09 处理。
