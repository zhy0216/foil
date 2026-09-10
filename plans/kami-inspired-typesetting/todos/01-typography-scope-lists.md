difficulty: medium
agent: inherit

# 修正正文设置、行盒与列表显示，建立文档样式作用域

对应 plan.md「方案 1」。依赖：无。只调整样式和必要的块类型标识，不改变 Markdown 字符、行序、DOM 偏移含义或输入流程。

## T1 · 文档样式作用域

- 要做什么：把 `design-tokens.css` 中的文档块排版规则（`p, .p`、`h1..h6` 等）与 UI token 分离，作用域限定在正文容器（编辑区 `.editor`、`.preview`、只读文档正文）内；避免全局 `.p`/`.h*` 覆盖正文的 `--prose-size`/`--prose-leading`，也不让文档规则反向影响弹层、按钮、设置卡片和状态栏。保留现有变量名、主题与 accent 控制；更新共享 token 的 Foil 归属说明，移除遗留的 Alumnium 注释但保留品牌资源。
- 预计修改文件：`packages/editor/src/styles/design-tokens.css`、`packages/editor/src/styles/styles.css`。
- 验收：在 17/19/21px 三档字号与 compact/comfortable 下，编辑与预览正文的计算字号、行高都来自当前设置且一致；弹层/设置/状态栏字号不随正文设置变化；现有主题与 accent 外观不回归。用浏览器样本实测计算样式，不能只断言 CSS 常量。
- 前置依赖：无。

## T2 · 字号、行盒与密度

- 要做什么：编辑正文和预览正文都继承 `--prose-size` 与 `--prose-leading`；把 `.editor .ln` 的通用固定 `min-height: 1.7em` 改为按块类型（正文/空行/标题/代码/列表）处理——正文与空行保持可放置光标的行盒并完整响应密度，标题按自身行高计算而不套正文最小高度，代码行不被额外撑高。校准 17/19/21px、1.55/1.7 的实际行盒；标题上方间距大于下方间距，标题/正文/列表/代码各用有限层次。
- 预计修改文件：`packages/editor/src/styles/styles.css`、必要时 `packages/editor/src/styles/design-tokens.css`、`packages/editor/src/hooks/useReadingSettings.ts`。
- 验收：21px + compact 下编辑与预览正文实际字号 21px、行高约 1.55×；普通列表行盒不再固定偏高；标题行盒不再被通用 min-height 额外撑高；空行仍可点击并放置光标；光标/选区偏移回归通过（Editor、editor-dom 现有测试不改语义）。
- 前置依赖：本文件 T1。

## T3 · 列表类型与原始标记

- 要做什么：为有序、无序、任务列表输出可区分的类型 class（如 `olist`/`ulist`/`task`，保留现有 `task`/`done` 语义）；有序列表直接显示原始编号文本（含 `1.`、`2.`、`42)`），取消 `.syn-bullet` 对有序列表统一伪造圆点的规则；无序列表可沿用现有标记显示方式；缩进、Tab 与任务状态按原文保留且层级可读。
- 预计修改文件：`packages/editor/src/lib/markdown.ts`、`packages/editor/src/lib/markdown.test.ts`、`packages/editor/src/styles/styles.css`。
- 验收：`1. First` / `2. Second` / `42) Answer` 在编辑器中显示原始编号而非圆点；`-`/`*`/`+` 与 `[ ]`/`[x]` 语义不丢失；每行 `.ln` 的 `textContent` 仍等于原始 Markdown 行（含标记，ZWSP 除外）；markdown/Editor/editor-dom 的原文偏移测试通过。
- 前置依赖：本文件 T1。

## T4 · 引用样式与浏览器样本

- 要做什么：正文引用默认使用正常字形和较弱文字色，降低整块斜体与高饱和边框的干扰；用户显式输入的强调（`*`/`_`/`**`/`==`/`~~`）仍保留可辨识语义。新增可复现字号覆盖、有序编号、密度行盒问题的固定浏览器样本；放在 `apps/web/tests/e2e/` 并复用现有 helpers，供 07 扩展。
- 预计修改文件：`packages/editor/src/styles/styles.css`、`apps/web/tests/e2e/` 下新增 spec（名称自定，如 `typography.spec.ts`）、必要时 `apps/web/tests/e2e/helpers/`。
- 验收：浏览器中断言 21px 设置在编辑与预览都实际生效、compact 与 comfortable 行盒高度确有差异、有序编号可见、正文无页面级横向溢出、引用在 light/dark 下可读且强调仍可区分。构建 CSP 不变（不得新增外部请求）。
- 前置依赖：本文件 T1–T3。

## 验证

在任务 worktree 中顺序运行：

~~~bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bunx --no-install turbo run build --filter=@foil/web
bun run --cwd apps/web test:e2e tests/e2e/<新增 spec> --workers=2
~~~

若 KDF 相关单测因并行负载超时，单独重跑确认，不修改这些测试，也不放宽其超时预算。`git diff --check` 通过。
