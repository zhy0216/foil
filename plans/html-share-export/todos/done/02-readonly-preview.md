difficulty: hard
agent: inherit

# 网站与文件共用只读预览

阅读 `../../plan.md` 和 `CLAUDE.md` 的 Markdown/锚点约束。保持与现有分享阅读的正文表示一致。一个独立 worktree、一个最终 commit。

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


## 完成记录

状态：已完成。仅实现 02 所有权内的阅读 UI、App 接入及验证；未改 codec、文件格式、ShareModal、构建配置、依赖或其他任务状态，未部署。归档后方案路径为 [../../plan.md](../../plan.md)。

### 逐项验收证据

- T1：新增 `Preview.tsx`，只用 `renderDecorated`、原锚点/选区纯函数。DOM 为 `.editor.readonly.preview[contenteditable="false"][role="document"]`，不挂载 Editor，不暴露写入回调或编辑命令。渲染沿用 CRLF→LF、U+200B 占位符的既有规则，原 DocState 不改写。
- T1：`Preview.test.tsx` 的 6 项用例验证 renderer DOM 一致、Unicode/组合字符/空行/围栏/列表、重复文本上下文、重叠及跨行锚点、异常字符 ID、键盘激活、激活不重建正文或丢失选区、锚点刷新不嵌套增长。选区 copy 输出原 Markdown 文本；常用按键、粘贴、拖放和输入事件不改文。实际 Chromium/WebKit 也验证选择/复制、键入、删除、格式/撤销快捷键、粘贴事件和 `execCommand('insertText')` 不改文。
- T2：新增 `ReadOnlyDocument.tsx`，展示完整标题、正文、每个线程和全部回复；缺失锚点保留在桌面列表和移动抽屉并提示未定位。`Thread readOnly` 隐藏 Reply/Delete/姓名/回复输入框，类型接口不接受写入 handler；原编辑模式回复/删除及模式切换测试通过。
- T2：跨行锚点可鼠标/Enter/Space 激活，评论引用可定位回正文。移动顶栏计数按钮打开全部评论，抽屉具备命名 dialog、Tab 焦点循环、Escape/关闭按钮/背景关闭、背景 inert 与滚动锁，关闭或跨断点 resize 后恢复到原按钮/锚点。桌面按锚点和实际卡片高度排列，未定位卡片接在后面；设置、窗口 resize、ResizeObserver 的重新排版均会重算。
- T2：`ReadOnlyDocument.test.tsx` 的 6 项用例覆盖阅读无文档存储访问、只读控件、跨行/缺失锚点、移动抽屉/焦点、实际高度布局重算、全部 Settings 参数与原 SettingsModal/HelpModal 的回调接入，以及 Thread 编辑模式回归。修复只读正文受全局 `.p` 16px 样式覆盖、首个标题 margin 引发卡片定位偏差这两处浏览器实测问题；普通编辑器表示不变。
- T3：App 解锁后提前返回共用阅读组件；Share、Settings、Help、Edit anyway 均由 App 显式注入。SettingsModal/ShareModal/HelpModal 继续复用原组件。密码/时间胶囊保持原接收流程，bootstrap 等待期间无编辑器；初始 fragment 独立保存，StrictMode effect 重放不再创建示例文档，已取消的旧解码结果被忽略。
- T3：`App.persistence.test.tsx` 新增 5 项回归：延迟/旧 bootstrap 结果，以及 d/e/td/te 四类接收分支（codec mock 隔离 UI 测试）。验证标题、正文和评论只读、阅读设置/帮助/分享有效、阅读/pagehide 不改已有作者文档、不创建副本；只有 Edit anyway 才 fork，新副本可编辑并保存，作者原始存储字节保持一致。原持久化、Editor 及全库回归通过。

### 供 03 使用的实际 API

```tsx
import { ReadOnlyDocument } from '../components/ReadOnlyDocument'; // src/standalone/ 内调用

<ReadOnlyDocument
  doc={state}                 // DocState: { title, md, comments }
  settings={settings}        // Settings，受控阅读偏好
  onShare={() => setShareOpen(true)}
  onSettings={() => setSettingsOpen(true)}
  onHelp={() => setHelpOpen(true)}
/>
```

- 组件导出 `ReadOnlyDocumentProps`。必填 `doc: DocState`、`settings: Settings`；可选 `onShare/onSettings/onHelp: () => void`，缺省时对应按钮不出现。`viewingLabel?: string` 默认 `Read-only preview`；`viewingActions?: ReactNode` 是宿主动作插槽，网站以此传入 Edit anyway。standalone 不传 `viewingActions`，组件无默认编辑/fork/文档库入口。
- 宿主用上述回调打开现有 `SettingsModal`、`HelpModal`、`ShareModal`，在阅读组件外渲染这些 modal；组件本身不加载 codec 或 modal 的宿主逻辑。SettingsModal 的 `onChange` 回写宿主 settings，`onReset` 可设为 `{ ...DEFAULT_SETTINGS }`。保存设置、存储失败回退和 toast 都属于宿主；本阅读组件及 hook 完全不读写 localStorage/sessionStorage，不要求先创建本地文档。
- `useReadingSettings(settings: Settings, enabled = true)` 导出 `{ editorWrapStyle, canvasStyle }`，前者含 `--prose-font/--prose-size/--prose-leading`，后者含 `--editor-width`；hook 应用 documentElement 的主题/强调色与系统主题监听。ReadOnlyDocument 内部已调用，无需 standalone 再调用。入口仍需包含现有 `styles/design-tokens.css` 和 `styles/styles.css`。
- 底层 `Preview` 导出 `PreviewProps`：`markdown: string`、`anchors: CommentThread[]`、`activeAnchorId: string | null`、可选 `onAnchorClick(id)`；可选 ref 为 `HTMLDivElement`，用于宿主测量/定位，没有 EditorHandle。高亮激活只改 class/ARIA，保留文本 DOM 和选区。每个跨行引用只有一个键盘停靠点。
- `Thread` 的只读调用：`<Thread thread={thread} active={active} onActivate={locate} readOnly mode="sheet" />`；不传 `onReply/onDelete/defaultName`。阅读组件已处理布局、缺失锚点和移动交互。
- 独立 Vite/Rollup 入口检查：以 ReadOnlyDocument 为 lib.entry，`configFile:false`、`write:false`、React 外置检查生成 chunk.modules；仅包含 settings-config、useReadingSettings、Icons、markdown、editor-dom、Preview、Thread、ReadOnlyDocument。禁止依赖 App/Editor/DocSwitcher/Composer/url-codec/doc-store 的检查结果为 `[]`。editor-dom 实际保留的导出仅 `normalizeMarkdown/getSelectionOffsets/setSelectionOffsets/findAnchorRange/wrapRangeInEditor`，编辑输入/撤销/格式函数未打入。

### 实际校验结果（独立任务阶段，rebase 前）

- `bun install --frozen-lockfile`：退出 0，锁文件未变。
- `bun run typecheck`：最终退出 0。
- `bun run test`：最终退出 0，13 个文件、402/402 通过。新增/修改组件和 App 定向测试为 20/20。
- `bun run build`：最终退出 0。主 JS 227.97 kB（gzip 73.42 kB），CSS 30.64 kB（gzip 6.38 kB）；原动态 crypto 148.74 kB 与其独立 chunk 保留。这里是网站构建体积，不是 03 的 standalone 产物。
- `bun run test:e2e`：首次退出 1，原因是 Playwright webServer 的 4173 端口已被另一任务使用，尚未运行浏览器用例；未停止其他进程。端口释放后重跑 12/12 通过；阅读字号/布局修正后再次完整重跑，最终退出 0、Chromium/WebKit 共 12/12（21.3s），含生产构建、密码重试、两类定时设置、到期后密码要求和正常编辑保存/CSP。未改既有 e2e 文件或选择器。
- `node /tmp/foil-readonly-browser-check.mjs`：隔离 4273 端口，实际生产页面两种浏览器通过普通 d 分享、文本复制及不可编辑、零文档库写入、阅读动作与设置、1440px 桌面和 390px 抽屉/焦点检查。正文实测 21px、紧凑行高约 32.55px；首卡与锚点偏差 Chromium 0px、WebKit 0.0078125px，无卡片重叠或桌面横向溢出，无控制台错误或外部请求。
- `node /tmp/foil-readonly-timecapsule-check.mjs`：隔离 4273 端口，Chromium/WebKit 实际生成并打开 td 链接；使用原 e2e 固定 quicknet round 992/beacon 和真实 tlock，未到期无编辑器/明文，到期解密后标题/跨行正文/评论进入 Preview，零文档库写入。网络均为拦截 fixture，未访问公网 drand。上述两份临时检查脚本及截图保留在 `/tmp`，不加入本任务文件或抢占 05 的测试所有权。
- `git diff --check`：通过。所有验收完成后归档本文件，仅修改队列 README 的 02 链接和状态。

无本 todo blocker。实际单文件构建/自包含、file:// 离线/保护及完整尺寸矩阵按队列继续由 03/05 验证；本任务未生成或部署 standalone 文件。

### 集成阶段复验（基线 c5338d6）

- 按协调器授权，将当前任务分支 rebase 到 `c5338d64b8d5b8ba0f36df403d27082ee6cb1df4`。唯一冲突为队列 README 相邻的 01/02 表格行；手工保留 01 的归档链接、完成/API 记录及原状态，并保留 02 的归档链接、验收和接口说明。01 业务文件及归档 todo 与该基线完全一致，未修改其他任务状态。
- 本 todo 开头的方案路径已修正为 `../../plan.md`。业务源码与 rebase 前一致，无需代码修复；本阶段文档修正和复验记录仅 amend 当前任务 commit，基线上仍只有一个任务 commit。
- `bun run typecheck`：退出 0。
- `bun run test`：退出 0，14 个测试文件、531/531 通过（24.61s），包含 01 的文件 payload/格式测试和 02 的阅读/持久化回归。
- `bun run build`：退出 0。主 JS 228.47 kB（gzip 73.61 kB），CSS 30.64 kB（gzip 6.38 kB）；动态 crypto chunk 保留。
- `bun run test:e2e`：退出 0，生产构建及现有 Chromium/WebKit 共 12/12 通过（20.5s）。本轮使用原 4173 端口，无端口冲突，未停止任何其他任务进程。
- `git diff --check`：通过。未执行 merge/push、切换原 checkout、部署或清理 worktree；其他已合入 todo 的状态由协调器统一收尾。
