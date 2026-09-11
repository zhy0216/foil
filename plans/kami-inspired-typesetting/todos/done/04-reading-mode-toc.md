difficulty: hard
agent: inherit

# 阅读模式、标题与目录接入各宿主

对应 plan.md「方案 4」。依赖 `02-cjk-fonts-paper.md` 与 `03-semantic-reader-mapping.md`。分享的仍是相同 DocState；旧链接用新应用打开可获得新阅读器，已导出的旧 HTML 内置旧运行时、不做升级。

## T1 · 本地 Read / Write 切换

- 要做什么：在 `App.tsx` 为本地编辑增加 Read / Write 切换，使用独立的 `localView` 状态，不复用 `readOnly`（后者关联分享导入、保存抑制与 fork 行为）。进入阅读前取得当前完整编辑快照并妥善结束输入法组合；切换本身不标记文档已修改；保留 Markdown、评论与 dirty/save-error 状态；回到 Write 恢复光标与编辑上下文。本地文档显示 Back to editing；导入分享继续通过 Edit anyway 创建本地副本。
- 预计修改文件：`packages/editor/src/App.tsx`、`packages/editor/src/components/ReadOnlyDocument.tsx`、必要的 App 测试（如 `App.reading.test.tsx`）。
- 验收：多次切换无内容丢失、无意外保存、无 dirty 误标；中文 IME 组合在切换前结束且不产生重复字符；Write 恢复后光标与滚动可用；只读分享不出现 Write 入口。
- 前置依赖：03 已合入。

## T2 · 阅读默认与 Source 切换

- 要做什么：网站分享、扩展分享与独立 HTML 都通过 `ReadOnlyDocument` 使用同一阅读实现；正式阅读默认使用 Reading（03 的 ReadingPreview），提供 Source 切换。新增 `readerView` 偏好只存在接收方本地、默认 Reading，缺失或非法值回退 Reading；旧 Source 精确复制 Markdown 的行为保持。解锁与密码/时间门禁完全在阅读内容挂载之前，未解锁不显示正文、目录或阅读结构。
- 预计修改文件：`packages/editor/src/components/ReadOnlyDocument.tsx`、`packages/editor/src/components/ReadOnlyDocument.test.tsx`、`packages/editor/src/standalone/StandaloneApp.tsx`、`packages/editor/src/standalone/StandaloneApp.test.tsx`、`packages/editor/src/App.tsx`。
- 验收：三种宿主默认 Reading 且可切 Source；非法 `readerView` 回退；未解锁状态不挂载明文；旧测试的分享读取、评论与文件再导出路径不回退；不向快照回写接收方偏好。
- 前置依赖：本文件 T1。

## T3 · 文档标题与目录导航

- 要做什么：正文页首显示可阅读的文档标题；标题与首个 Markdown 标题重复时去重显示，原文保持不变；标题、目录文本和正文结构来自同一次解析。从正文标题生成目录：建议至少三个标题才显示，重复标题生成确定且唯一的内部 ID。桌面复用可收起导航区域，移动端使用紧凑章节菜单，评论区域优先复用现有布局、不建立挤压正文的第三个固定宽栏。章节跳转通过内部元素定位与滚动完成，不覆写承载分享载荷的 URL fragment；支持键盘定位与标题顶部滚动留白。字体、宽度、模式、评论高度和视口变化均触发布局重算；无匹配锚点的评论保留现有可达入口。
- 预计修改文件：`packages/editor/src/components/ReadOnlyDocument.tsx`、`packages/editor/src/components/ReadingPreview.tsx`、`packages/editor/src/styles/styles.css`、相关测试与 `apps/web/tests/e2e/` 中针对性 spec。
- 验收：标题去重正确；少于三个标题不显示固定导航；目录跳转不改 `location.hash`（分享 fragment 不受影响）；键盘可达；移动端菜单可用；评论锚点与未定位入口仍可达。浏览器断言至少覆盖 375 / 1280px。

## T4 · 各宿主与评论/再导出回归

- 要做什么：确认本地 Read/Write、网站分享阅读、扩展分享、独立 `file://` HTML 四个路径行为一致；评论定位、跨块与重叠评论、移动抽屉、未定位评论在 Reading/Source 两种模式都可达；独立 HTML 再次导出与分享入口正常；阅读器不依赖编辑器逐行函数。
- 预计修改文件：相关组件测试与浏览器 spec；只在必要时小幅修正 03 暴露的接口问题（保持 03 的契约）。
- 验收：四宿主回归通过；Reading/Source 切换后评论仍可定位；文件再导出正常；无新增外部网络请求；`bun run test:e2e` 相关套件通过。

## 验证

在任务 worktree 中顺序运行：

~~~bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run test:e2e
~~~

按 CLAUDE.md 补充替代 base 变体（构建 `/`、`FOIL_E2E_BASE=/` 运行网站 e2e），最后恢复默认 `/foil/` 构建。若 KDF 相关单测因并行负载超时，单独重跑确认，不修改这些测试。`git diff --check` 通过。

## 完成记录（任务分支 herdr/plan-kami-ts-04-reading-mode-toc，最终 commit 见分支头）

- 执行：opencode（接管会话续跑并完成验证），模型 `alibaba-token-plan-cn/qwen3.8-max`。
- T1 本地 Read/Write：`App.tsx` 新增独立 `localView` 状态（不复用 `readOnly`）；进入阅读 `setComposer(null)/setSelection(null)` 后经 Editor 自身 `readOnly` 转换结束 IME 组合；编辑树保持挂载仅 `display:none`，Markdown/评论/undo/dirty/save-error 跨切换保留；回到 Write 由 `replaceSelection('')` 恢复光标；本地阅读显示 Back to editing，分享只读仍只有 Edit anyway、无 Read/Write 入口。测试：`App.reading.test.tsx`（多轮切换无写盘无 dirty、IME 组合不重复字符、光标恢复、QuotaExceeded 下 dirty 跨切换并由 pagehide 补写）。
- T2 阅读默认与 Source：`ReadOnlyDocument` 受控/非受控双模 `readerView`（缺失/非法回退 Reading）；`parseReaderView` + `READER_VIEW_KEY='foil_reader_view'`（独立于 `foil_settings`，永不进快照）；App 网站/扩展接收方与 StandaloneApp 各自本地持久化，storage 拒绝时回退内存。门禁前挂载断言扩展到 `.reading-preview/.reading-toc/.reading-doc-title`（StandaloneApp.test、sharing.spec、html-export helper）。StandaloneApp.test 断言再分享载荷只含 `comments,md,title`。
- T3 标题与目录：`ReadOnlyDocument` 单次 `parseReadingDocument` 同时供页首标题、TOC 与正文（经 `ReadingPreview` 新增 `doc` prop，测试断言与内部解析字节一致）；标题与首个 heading 规范化去重（trim/折叠空白/小写），原文不变；≥3 标题才渲染 TOC；重复标题用 03 的确定性去重 id（`features`/`features-1`）；原生 `<details>` 桌面默认展开、移动收起且限高滚动，位于内容列内、无第三固定栏；跳转 preventDefault + `scrollIntoView` + heading `tabIndex={-1}` focus，`location.hash` 不变（单测与 e2e 均断言）；标题 `scroll-margin-block:120px` 顶部留白；布局重算依赖加入 `view/parsed`。浏览器断言覆盖 375px（移动菜单/抽屉/无横向溢出）与 1280px（Desktop Chrome/Safari 项目默认视口）。
- T4 回归：四宿主 e2e 全绿；评论定位/跨块/未定位入口在 Reading 与 Source 双模式断言（ReadOnlyDocument.test、reading-mode.spec、html-export.spec）；独立 HTML 再导出与分享入口正常；阅读路径不调用 `getMarkdown`/`setSelectionOffsets`（03 的 vi.mock + 构建断言继续把关，reading-build 断言通过）。
- 体积（相对 03 归档记录）：网站主 JS 257,024 → 359,420 B（+102,396 B，解析器+阅读模块接入应用入口，与 03 预估 ≈98.6 KB 一致）；网站 CSS 33,346 → 36,181 B（+2,835 B，front matter/TOC/view-toggle 样式）；`foil-standalone.js` 443,345 → 550,192 B（+106,847 B，阅读运行时含解析器）；扩展主 JS 359.92 kB。CSP、分享协议、加密、存储格式与 URL 上限未动，无新增外部网络请求（reading-mode.spec 对接收方上下文全量拦截并断言 external=[]）。
- 校验（顺序执行）：`bun install --frozen-lockfile` ✓；`bun run typecheck` ✓（3 任务）；`bun run test` ✓（editor 26 文件 736 通过，含本任务新增 29 项；KDF 未超时）；`bun run build` ✓（standalone/manifest 断言通过）；网站 e2e 默认 `/foil/` ✓ 50 通过（含 reading-mode.spec 5 项 × chromium/webkit）；扩展 e2e ✓ 27 通过（先 `bun run --cwd apps/extension package` 产出 ZIP，首跑 package.spec 因缺 ZIP 失败属环境步骤遗漏、非代码问题）；替代 base：`turbo build --filter=@foil/web -- --base /` + `FOIL_E2E_BASE=/` 网站 e2e ✓ 50 通过；最终 `bun run build` 恢复 `/foil/` 产物（index.html 引用已确认）；`git diff --check` ✓。
