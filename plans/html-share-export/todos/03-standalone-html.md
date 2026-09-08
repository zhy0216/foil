difficulty: hard
agent: inherit

# 独立入口与自包含 HTML 构建

阅读 `../plan.md`，必须在 01、02 已合入的最新基线上开始。一个独立 worktree、一个最终 commit。

## T1 · 仅从嵌入数据启动的阅读程序

- 要做什么：新增 `src/standalone/main.tsx`、`StandaloneApp.tsx`，读取固定 ID 的非可执行数据块，调用 01 的 schema/文件解码入口。通过 loading、password、time capsule、preview、error/cancelled 状态组织流程，成功后使用 02 的 ReadOnlyDocument。
- 要做什么：复用 PasswordPromptModal、TimeCapsuleUnlock、SettingsModal、HelpModal；取消/错误停留在文件阅读中，可重试，不能载入示例或本地文档库。旧异步结果及卸载回调不能重新显示内容。仅阅读设置可按需使用防失败存储，文档不写入 storage，存储被拒绝时仍可读/调整设置。
- 要做什么：检测 Web Crypto/gzip 等必需能力，失败明确且不泄露载荷/密码。未通过密码或时间门控前不渲染明文正文/标题/评论。
- 预计修改文件：新增 `src/standalone/main.tsx`、`src/standalone/StandaloneApp.tsx`、`src/standalone/StandaloneApp.test.tsx`；确有必要时最小扩展现有解锁组件以支持生命周期/文案，不改密码学协议。
- 验收条件：四种输入进入正确门控状态，错误密码可重试，取消不会进入 editor，格式错误/未知版本可理解地失败，StrictMode 或异步完成不会读出其他文档。
- 前置依赖：`01-html-payload.md`、`02-readonly-preview.md`。

## T2 · 内嵌运行资源的构建与开发集成

- 要做什么：通过现有 Vite/Rollup 增加 standalone 专用生产构建，输出包含 React、Buffer、tlock、drand、阅读 UI 的完整脚本和全部样式。推荐程序化单入口 IIFE 输出与 CSS 收集；如使用插件/虚拟模块，嵌套构建禁用自身插件，防止无限递归。提供网站按需获取运行资源的模块/API，dev 和 build 都能生成当前版本。
- 要做什么：处理内联动态导入导致的提前初始化，保证全局 Buffer 在 tlock 的传递依赖执行前存在。可用独立 bootstrap/polyfill 或专用构建 alias，不让网站普通编辑入口提前加载整个 crypto/standalone 程序。
- 要做什么：网站 `build --base /` 和默认 `/foil/` 都工作，保持原网站 CSP。输出无必须外链的脚本/CSS/font/chunk/CDN，不把 node_modules 或 build 中间资源提交到 git。
- 预计修改文件：`vite.config.ts`；新增 `build/standalone.ts` 或等价构建模块、必要的 `src/standalone/bootstrap.ts`/声明文件；如确实需要可调整 `package.json`、`tsconfig.json`、`.gitignore`、`vitest.config.ts`，尽量复用现有依赖。
- 验收条件：生产构建成功，浏览器运行产物没有外部模块解析、缺失 Buffer 或 process/global 错误；调试/生产均有可用导出资源；读取构建结果确认无 Editor/App/DocSwitcher/Composer 依赖，只有阅读/分享所需功能。
- 前置依赖：本文件 T1。

## T3 · 安全 HTML 组装、资源复用与下载 API

- 要做什么：新增 `src/lib/html-export.ts`（可拆小模块）把编码 payload、运行资源和可选 shareBaseUrl 组装成完整 UTF-8 HTML。静态脚本/样式用稳定 ID；数据为经过 HTML 安全转义的非可执行 JSON。处理关闭标签、HTML 字符、Unicode、恶意标题和评论，不能把用户内容直接拼进可执行代码。
- 要做什么：文件 CSP 以最终内联脚本字节的 hash 授权，禁止脚本 unsafe-inline/unsafe-eval，只允许现有 drand connect-src，object/base/form-action 封闭。受保护文件外壳/title/下载名保持通用，原始文件不含文档 title/md/comment 或密码明文。
- 要做什么：提供安全 `.html` 文件名、Blob 下载和资源释放工具，组装与下载分离以便 04 在最后一步检查快照后再触发下载。普通 HTML 可按标题命名，保护文件通用命名。
- 要做什么：提供文件从自身固定运行资源重新组装的 API；不要序列化解锁后的 DOM。组装器/共用 UI 不静态导入生成模板，网站专用资源加载器与 standalone 自身资源读取分开。为 04 接入 ShareModal 预留回调与有效 shareBaseUrl。
- 预计修改文件：新增 `src/lib/html-export.ts`、`src/lib/html-export.test.ts`、网站专用运行资源加载模块及所需类型声明；更新 standalone 的资源读取接缝。
- 验收条件：组装出的文件移到任意目录仍包含全部程序；受保护文件扫描无特定明文 sentinel；恶意内容不能逃逸数据块/执行脚本；CSP hash 与实际内容相符。新文件可复用原程序再次组装且不会指数膨胀或将旧明文 DOM 纳入模板。
- 前置依赖：本文件 T2。

## 本任务验证与交接

- 运行 `bun run typecheck`、`bun run test`、`bun run build`，并验证 `bun run build --base /`；如果改了依赖，运行相应审计。不要把不同 base 的构建并发写到同一 dist。
- 从真实构建程序组装文件做浏览器 file 打开验证，至少确认普通/密码和真实 tlock 初始化；05 负责完整从 Share 点击到下载的两浏览器矩阵。报告已跑的范围，不能只检查 HTML 字符串就声称离线通过。
- 交接给 04：网站运行资源加载器、HTML 组装/下载 API、standalone 复用自身资源 API、可注入的 Share 操作位置。此任务不提前修改 ShareModal 的生成状态机。
