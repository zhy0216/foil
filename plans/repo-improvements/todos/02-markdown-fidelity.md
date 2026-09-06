difficulty: medium
agent: inherit

# 保留 Markdown 原始字符

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
