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
