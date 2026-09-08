difficulty: hard
agent: inherit

# 网站与文件共用只读预览

阅读 `../plan.md` 和 `CLAUDE.md` 的 Markdown/锚点约束。保持与现有分享阅读的正文表示一致。一个独立 worktree、一个最终 commit。

## T1 · 无编辑器输入依赖的预览组件

- 要做什么：新增 `Preview.tsx`，用 `renderDecorated` 及现有锚点纯函数显示 Markdown/评论高亮。声明只读 DOM，不引用 `Editor.tsx` 或其输入/IME/撤销/格式工具。支持高亮激活与文本选择/复制；可保留 `.editor.readonly` 样式兼容标识。
- 要做什么：保留原始逐行文本及 Unicode、空行、围栏、列表、跨行锚点的表示。不要新引 Markdown 库、改变现有语法标记或改写保存的文档。
- 预计修改文件：新增 `src/components/Preview.tsx`、`src/components/Preview.test.tsx`；需要时小幅调整 `src/styles/styles.css`。复用 `src/lib/markdown.ts` 和 `src/lib/editor-dom.ts`，仅确有共用问题时最小调整。
- 验收条件：只读 preview 呈现与现有 renderer 相同，锚点正确且激活后文本未改变，常用编辑输入/快捷键/粘贴不修改内容；没有 contenteditable=true 或编辑器依赖。
- 前置依赖：无。

## T2 · 共用阅读界面及只读评论

- 要做什么：新增 `ReadOnlyDocument.tsx`，接受 DocState、Settings 和可选动作插槽/回调，负责标题、Preview、评论阅读/锚点定位、移动抽屉、阅读统计。默认没有修改正文/标题/评论或进入编辑器的动作。设置改变和窗口大小改变后保持评论布局；缺失锚点的评论也能从列表查看。
- 要做什么：为 `Thread.tsx` 提供只读模式，隐藏 Reply/Delete/输入框；编辑模式原功能保持。阅读设置效果按需抽到 `src/hooks/useReadingSettings.ts` 或等价小模块，不引入文档库依赖。复用 SettingsModal/HelpModal，不复制整套交互。
- 预计修改文件：新增 `src/components/ReadOnlyDocument.tsx`、`src/components/ReadOnlyDocument.test.tsx`；修改 `src/components/Thread.tsx`、`src/styles/styles.css`；可新增阅读设置 hook 及必要测试。
- 验收条件：标题/正文/全部既有评论可读；桌面锚点与移动抽屉可访问、关闭后焦点合理；阅读主题/字体/字号/宽度/密度/强调色生效，写入控件缺席，不要求先创建本地文档。
- 测试要求：覆盖不可编辑、跨行/缺失锚点可访问、阅读动作与只读评论。尺寸和浏览器真实布局的完整验证交给 05。
- 前置依赖：本文件 T1。

## T3 · 网站 readOnly 分支接入

- 要做什么：`App.tsx` 在分享已解锁时使用共用阅读组件；网站现有 Share、Settings、Help、Edit anyway 由 App 显式提供，后者仍 fork 到本地库。维持密码/时间胶囊的原接收流程，避免空白编辑器闪现。
- 要做什么：网站编辑器、本地文档保存/切换以及 `.editor` 相关现有回归保持。新阅读组件本身不能 import App、Editor、DocSwitcher、Composer、codec 或 doc-store，以供 03 独立打包。
- 预计修改文件：`src/App.tsx`、必要的 `src/App.persistence.test.tsx`；若现有 e2e 仅定位方式受影响，优先兼容，确需更新只做对应选择器修正，不提前加入 05 用例。
- 验收条件：现有四类网站链接仍只读，Edit anyway 明确 fork 后才可编辑；阅读前后不改写作者文档；正常编辑/保存测试通过。
- 前置依赖：本文件 T2。

## 本任务验证与交接

- 运行 `bun run typecheck`、`bun run test`、`bun run test:e2e`（含生产构建和现有 Chromium/WebKit 分享回归）。记录实际结果和组件/设置 API。
- 可与 01 并行；不修改 url-codec、文件数据格式、ShareModal 或构建配置。
- 交接给 03：只读组件如何接收 DocState/Settings、如何提供分享/设置/帮助动作，确认 standalone 不传编辑动作时无编辑依赖。
