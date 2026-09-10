difficulty: medium
agent: inherit

# 中文字体回退、统一标题字体与 Paper 外观

对应 plan.md「方案 2」。依赖 `01-typography-scope-lists.md`。只使用系统字体候选，不打包、不下载字体，不引入网络请求。

## T1 · 中文字体回退与 cjk-serif 选项

- 要做什么：为现有 `serif`、`modern-serif`、`mono` 字体链补齐本地中文回退（如 Songti SC、Noto Serif CJK SC、Source Han Serif SC、SimSun、Noto Sans CJK SC 等，按字形与可用性排序），使代码注释中的中文也有合理回退。新增 `cjk-serif` 字体选项：中文 serif 优先（Source Han Serif SC/CN、Noto Serif CJK SC/SC、Songti SC、STSong、SimSun），后接现有 Latin serif 回退。所有名字都是系统字体候选，不做跨平台像素一致承诺；缺字体时保持系统回退。
- 预计修改文件：`packages/editor/src/types.ts`、`packages/editor/src/lib/settings-config.ts`、`packages/editor/src/lib/settings-config.test.ts`。
- 验收：`PROSE_FONTS`/`PROSE_FONT_MAP` 含全部旧选项与新 `cjk-serif`；旧设置中未知字体值独立回退到默认；字体链是纯 CSS 系统栈，dev 与生产构建都无字体网络请求（浏览器样本断言无外部请求）。
- 前置依赖：01 已合入。

## T2 · 设置卡片中文预览与文档字体层次

- 要做什么：字体选择卡片改用「中文 Aa 123」样例展示实际字体；正文标题跟随所选文档字体（`--prose-heading-font` 等语义变量），按钮、设置、状态栏继续使用 UI 字体。默认正文 tracking 保持 0；CJK 选项的 `0–0.02em` 微调必须来自视觉样本验证后才落地，不向代码、URL、所有拉丁文本套用固定字距。
- 预计修改文件：`packages/editor/src/components/SettingsModal.tsx`、`packages/editor/src/styles/styles.css`、必要时 `packages/editor/src/components/SettingsModal.test.tsx`（若无则新建小型渲染测试）。
- 验收：字体卡片显示中英文样例且切换后正文/标题实际使用所选字体栈；UI 控件不受文档字体影响；设置组件测试与现有测试通过。
- 前置依赖：本文件 T1。

## T3 · readingStyle: standard | paper

- 要做什么：新增 `ReadingStyle = 'standard' | 'paper'` 与 `Settings.readingStyle`。`standard` 使用现有界面语义色；`paper` 只调整文档区域（正文、阅读标题、代码、评论区域）的纸面、文字与分隔层次，浅色用暖纸色与深墨色、深色用暖暗面与清晰文字，集中定义 `--doc-bg`、`--doc-fg`、`--doc-muted`、`--doc-rule`、`--doc-code-bg` 等语义变量。旧设置缺字段回退 `standard`；现有 theme、accent、字号、宽度、密度、字体继续独立生效；`parseSettings`、默认值、非法值回退、重置与独立文件（standalone）的偏好内存回退一次处理。Paper 保留用户选择的 accent，链接与评论定位在两种主题下都有清晰状态表达。
- 预计修改文件：`packages/editor/src/types.ts`、`packages/editor/src/lib/settings-config.ts`、`packages/editor/src/lib/settings-config.test.ts`、`packages/editor/src/hooks/useReadingSettings.ts`、`packages/editor/src/components/SettingsModal.tsx`、`packages/editor/src/styles/design-tokens.css`、`packages/editor/src/styles/styles.css`、必要时 `packages/editor/src/standalone/StandaloneApp.tsx`。
- 验收：旧 `foil_settings`（无 `readingStyle`）解析为 `standard` 且其余偏好不丢；非法值只影响该字段；standard/paper × light/dark 下正文与代码可读；5 个 accent 在 paper 浅色纸面与深色纸面上链接/定位仍清晰（浏览器样本或组件级断言）；页面宽度仍是响应式阅读列，不模拟固定 A4、不增加纸纹图片或装饰阴影。
- 前置依赖：本文件 T1、T2。

## 验证

在任务 worktree 中顺序运行：

~~~bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
~~~

若新增浏览器断言，先 `bunx --no-install turbo run build --filter=@foil/web` 再运行对应 spec。若 KDF 相关单测因并行负载超时，单独重跑确认，不修改这些测试。`git diff --check` 通过。
