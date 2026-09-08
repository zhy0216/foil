difficulty: hard
agent: inherit

# 独立入口与自包含 HTML 构建

阅读 `../../plan.md`，必须在 01、02 已合入的最新基线上开始。一个独立 worktree、一个最终 commit。

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

## 完成记录 · 2026-09-08

状态：03 验收完成，待协调器集成。基线 `38c1b84`，已完整阅读 01/02 的归档 API；README 的 01 历史状态未作依赖阻塞，也未修改。仅在本任务分支工作，未 rebase/merge/push、切换 main、部署或启动额外 agent。未改依赖、锁文件、ShareModal、App、codec、ReadOnlyDocument/Preview 或其他 todo 状态。

### 04 可直接使用的接口

网站专用资源加载器：`src/lib/standalone-runtime-loader.ts`

```ts
loadStandaloneRuntime(): Promise<StandaloneRuntime>;
// StandaloneRuntime = { script: string; styles: string }
```

- Vite 在生产构建输出 `<base>/foil-standalone.js`，内容为 `export default { script, styles }`；网站通过上述函数按需动态导入。该 JS 模块只携带资源字符串，不执行文件阅读程序。原网站 CSP 的 `script-src 'self'` 允许加载；不使用被原 `connect-src` 阻止的同源 JSON fetch。
- dev 在相同路径按需构建当前源码，返回 `no-store`；加载器追加时间戳，避免原生模块缓存使同一标签页再次导出时拿到旧程序。Vite 自行追加的 `?import` 同样可用。默认 `/foil/` 和 `/` 已实际浏览器验证。
- **此模块只能由网站宿主导入**。不要在 ShareModal、html-export、StandaloneApp 或文件阅读入口中导入它，否则构建的依赖检查会失败。

组装器与下载工具：`src/lib/html-export.ts`

```ts
interface HtmlExportInput {
  payload: string;             // 01 的 encodeHtmlPayload(snapshot, options) 的结果
  runtime: StandaloneRuntime;
  shareBaseUrl?: string;       // 来源 HTTP(S) URL；组装器会规范化并去掉 query/hash
  title?: string;              // 仅 #d= 使用；任何保护模式都忽略此标题
}
interface HtmlExport { html: string; filename: string }

assembleHtmlShare(input: HtmlExportInput): Promise<HtmlExport>;
htmlFileName(title: string, payload: string): string;
createHtmlDownload(file: HtmlExport): {
  download(): void;
  dispose(): void;
};
```

- `assembleHtmlShare` 校验 payload/base/resources，返回完整 UTF-8 HTML 字符串与安全文件名；不创建下载、读取 DOM 或访问 storage。04 用捕获的文档/选项快照调用 `encodeHtmlPayload` 和此 API，保留自己的异步代次/过期检查。
- 普通外壳 title 安全转义，普通文件名去除路径/控制字符/双向文本控制符、处理 Windows 保留名并限制 UTF-8 字节数，扩展名固定 `.html`。e/td/te 的外壳标题都是 `Foil shared document`，下载名都是 `foil-shared-document.html`。
- `createHtmlDownload` 创建 `text/html;charset=utf-8` Blob 与 Object URL，但不点击；04 在最后快照检查后调用 `download()`。点击只允许一次；1 秒后自动 revoke，点击异常时立即 revoke 并移除临时 anchor。准备阶段取消可调用 `dispose()`，该方法幂等，之后不能下载。返回值只表示启动浏览器下载，不是操作系统保存完成的回执。
- 所有 encode/组装/下载错误继续交由 04 的状态机展示，不应回落到明文或旧结果。文件导出不需要先生成成功的 URL。

文件自身入口：`src/standalone/resources.ts`

```ts
readEmbeddedShareData(doc?: Document): HtmlShareData; // 缺省 document
readStandaloneRuntime(doc?: Document): StandaloneRuntime;
HTML_SHARE_DATA_MAX_CHARS; // 5_605_780，JSON.parse 前检查
```

- 固定 ID 由 `src/lib/standalone-runtime.ts` 的 `STANDALONE_IDS` 导出：data=`foil-share-data`、script=`foil-share-runtime`、styles=`foil-share-styles`、root=`root`。
- 数据块必须是唯一的 `<script type="application/json">`，不能带 src。读取只消费这一块及 01 的格式/schema/文件解码入口；重复 ID、错误类型、缺失/超长 JSON、未知版本失败。URL fragment、本地文档库及修改后的数据块都不能替换当前已捕获的文件快照。
- 自身资源 API 只读固定 script/style 的文本；不读 root、document.title 或整个 DOM。将返回值交给同一个 `assembleHtmlShare` 可再次导出，无需回源。`parseStandaloneRuntime` 校验并规范化资源，供两种加载方式共用；没有模板递归导入。

Share 注入位置：`src/standalone/StandaloneApp.tsx`

```tsx
interface StandaloneShareContext {
  doc: DocState;
  shareBaseUrl?: string;
  loadRuntime: () => Promise<StandaloneRuntime>;
}
<StandaloneApp onShare={(context: StandaloneShareContext) => { /* 04 打开 ShareModal */ }} />
```

- 只有完整解锁后的 `ReadOnlyDocument.onShare` 能触发回调，传入当前文档、规范化来源路径和读取自身资源的加载函数。`src/standalone/main.tsx` 是 04 可接入宿主 Share UI 的位置；当前 main 不传此回调，文件中 Share 按钮及 ShareModal 导出状态机按队列由 04 接入。
- 未提供来源元数据的文件，`shareBaseUrl` 为 undefined；不能用 file:// 的 origin/path 补链接。再次导出仍可使用自身资源。
- SettingsModal/HelpModal 已接入阅读动作。阅读设置只尝试读写 `foil_settings`，拒绝存储时继续用内存设置；没有文档持久化、样例库、editor 或 fork。
- PasswordPromptModal 新增可选 `busy`（默认 false）以阻止重复提交；TimeCapsuleUnlock 会在取消、卸载或 envelope 变化时废弃在途结果并清除后续重试等待。已有 crypto 请求不增加新的 abort 协议，其迟到结果失效；密码学协议与网络预算保持原样。

### 逐条验收证据

| 验收 | 实际证据 |
| --- | --- |
| T1：四模式门控、密码重试、取消/错误不进 editor | `StandaloneApp.test.tsx` 验证 d/e/td/te；密码忙时禁重入，错误可重试；未来时间不提供 Decrypt，drand 失败可重试；实际 Chromium 四模式、WebKit d/e/td 文件均解锁成功 |
| T1：StrictMode/卸载/旧异步失效且无其他文档 | 单测包含 StrictMode 两个 bootstrap 结果乱序、取消/重试后旧结果、密码和 tlock 在 cancel/unmount 后完成、drand 重试 timer 取消；预置其他本地文档与 fragment，不读入、不覆盖、不创建副本 |
| T1：能力检测、保密与无存储阅读 | 缺 Web Crypto/gzip 的单测与真实 Chromium file 均显示明确错误、无未捕获异常；禁止 localStorage/sessionStorage getter 的实际 file 仍能阅读和改字号；普通/密码模式无网络请求，保护模式标题/正文/评论在通过门控前无渲染 |
| T1：完整阅读接入 | 真实文件显示标题、跨行原文与评论，只有 contenteditable=false 的 Preview；可改 Settings、普通文件刷新后偏好仍有效；Settings/Help 与回调注入单测通过，没有 Editor/Composer/DocSwitcher/文档库依赖 |
| T2：单文件运行与 Buffer 顺序 | 单独 Buffer bootstrap IIFE 物理置于主 IIFE 前，主构建 alias 复用同一个全局 Buffer；浏览器初始 Buffer 为 undefined，产物启动后为 function，真实 tlock 验签/解密通过，无 Buffer/process/global 错误 |
| T2：无外部 chunk、仅阅读依赖 | 每次构建检查 Rollup output：单 chunk、imports/dynamicImports 空、仅 CSS 资产；拒绝 App/Editor/DocSwitcher/Composer/doc-store/网站加载器/development JSX 及重复 Buffer；CSS 无 import/url 资源。真实 file 零脚本/CSS/font 请求 |
| T2：dev 与生产、两种 base | dev/production `/foil/` 及 production `/` 在原 CSP 下用真实网站加载器导入成功；普通编辑首屏和导入资源后都没有提前初始化 Buffer/tlock，也不被文件程序接管。dev 两次请求使用不同时间戳，当前 dev 与生产脚本/样式逐字节相同 |
| T3：安全包装与 CSP | `html-export.test.ts` 验证恶意关闭标签/标题/评论、HTML 字符/Unicode、受保护通用壳与真实 AES 文件 sentinel 扫描；JSON 非可执行且安全转义，compiled raw-text 危险序列拒绝。按实际 UTF-8/LF/孤立 surrogate 规范化后的脚本 hash 授权，浏览器实际 hash 一致且无 CSP 违规 |
| T3：源文件不含受保护明文 | 从真实构建 + 真实 codec 生成 e/td/te 文件，原字节扫描无 FILE_TITLE/MD/COMMENT/PASSWORD_SENTINEL；恶意正文/评论不会执行，浏览器 pwned 为 undefined，Preview 无注入的 img/script |
| T3：资源复用与下载清理 | 单测三轮相同输入重组字节完全一致，即使原 DOM 加入已解锁明文/标题也不被保存。实际从已解锁密码文件抽取固定资源、以及使用 dev 资源，重组的新密码文件均可真正离线打开，无旧文档 sentinel；下载单测验证 Blob 类型、只点击一次、取消/异常/定时 revoke 与 anchor 清理 |

### 校验命令与结果

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | 退出 0，安装 162 packages；依赖声明和锁文件无改动，无需依赖变更审计 |
| `bunx vitest run src/lib/html-export.test.ts src/standalone/StandaloneApp.test.tsx` | 47/47 通过 |
| `bun run typecheck` | 最终退出 0 |
| `bun run test` | 最终退出 0，16 文件、578/578（24.02s）；最终与下面两种构建串行运行 |
| `bun run build` | 最终退出 0（3.05s），默认 `/foil/` |
| `bun run build --base /` | 在默认 build 完成后运行，最终退出 0（2.84s） |
| `bun run test:e2e --workers=2` | 包含生产重建，原网站 Chromium/WebKit 12/12 通过（27.6s） |
| `git diff --check` | 通过 |

首次完整 test 与构建并发时，上游 01 的 `rejects invalid metadata in #te= before exposing an envelope` 达到原 5 秒 timeout，577 项通过。停止并发构建后，原 `bun run test` 两次通过全部 578 项；没有修改上游测试或 timeout。

本任务临时浏览器验证脚本及生成文件放在 `/tmp`，未占用 05 的 e2e 文件：

- `bun /tmp/foil-standalone-generate.ts`：导入真实 `dist/foil-standalone.js`，用真实 encodeHtmlPayload/AES/tlock 生成四模式文件并扫描保护层明文，保存到 `/tmp/foil-standalone-03-AI6MM0/moved 文档/`。当前路径同时记录在 `/tmp/foil-standalone-current-dir`。
- `node /tmp/foil-standalone-file-check.mjs`：Chromium d/e/td/te 通过；WebKit 首轮因 Playwright offline 开关导航失败。静态 `<p>` 文件也由 `/tmp/foil-standalone-webkit-navigation.mjs` 复现同错；改为拦截并拒绝所有 HTTP(S) 请求后，`FOIL_CHECK_BROWSER=webkit node /tmp/foil-standalone-file-check.mjs` 的 d/e/td 全部通过。两引擎普通/密码都是全新 context、零网络请求，含密码重试、Unicode 目录、普通刷新与设置；未把字符串检查当作离线验证。
- 时间测试使用既有 quicknet round 992 的真实 info/beacon，固定时钟、不等待真实时间。浏览器 file 的跨源 fixture 响应带 `Access-Control-Allow-Origin: *`；真实 BLS 验签与 tlock 解密均执行，每次只有 info + beacon 两个请求，无公网 drand 请求。未提前实现 WebKit te 或从 Share 点击下载的完整 05 矩阵。
- `bun /tmp/foil-standalone-probe.ts /foil/` + `node /tmp/foil-standalone-resource-check.mjs /foil/`：隔离端口 4373（dev）/4473（preview），验证网站专用加载器、原 CSP、保持首屏延迟加载、dev 当前资源与重复请求。开发构建曾检出生产 React 配合 development JSX 的错误配置，已用 `esbuild.jsxDev: false` 修正并增加构建依赖防线；最终 dev 与生产资源字节完全相同。
- `bun /tmp/foil-standalone-probe.ts /` + `FOIL_PRODUCTION_PORT=4573 node /tmp/foil-standalone-resource-check.mjs / production`：root build 的真实网站加载器同样通过。
- `bun /tmp/foil-standalone-reassemble.ts` + `node /tmp/foil-standalone-extra-file-check.mjs`：自身资源/dev 资源分别组装出 401,220 bytes 密码文件，真实 Chromium 离线解锁通过；同脚本验证 Web Crypto/gzip 缺失的明确错误和 storage getter 拒绝下的阅读/设置。测试启动的 dev/preview 进程已停止。

最终体积：内嵌脚本 369,355 bytes、CSS 30,639 bytes，合计 gzip 130,466 bytes；网站按需资源 JS 模块 406.90 kB。示例普通 HTML 401,504 bytes，e/td/te 分别 401,494 / 402,123 / 402,182 bytes。普通网站主 JS 229.16 kB（默认 gzip 73.84 kB）、CSS 30.64 kB；原 Buffer 27.96 kB、timecapsule-crypto 148.74 kB 延迟 chunk 保留。

风险 / blocker：无本项 blocker。时间胶囊仍依赖 drand 网络，本项通过固定公开 beacon 验证真实密码学，未访问公网验证服务实时可用性。WebKit 的 Playwright offline 切换限制及替代网络隔离方法已记录，供 05 复用。Share 按钮、导出生成状态机及完整下载矩阵由 04/05 按队列接入；API 已齐备。未部署。
