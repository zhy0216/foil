difficulty: medium
agent: inherit

# Share 导出与文件再次分享

阅读 `../../plan.md`，基于已合入的 03 API 实现用户可点击的出口。一个独立 worktree、一个最终 commit。

## T1 · ShareModal 导出 HTML

- 要做什么：ShareModal 保留复制链接并增加 `Export HTML`。用清晰的生成中/错误/完成反馈，禁止重复点击产生重复或过期文件。共用当前文档和 password/timelock 选项，点击时捕获完整快照；组装成功后再次校验请求代次/当前快照/解锁时间才触发下载。
- 要做什么：文档/选项变化、关闭/重开、日期过期都使旧导出失效，错误不能下载之前的普通文件，密码保护失败不能回退为明文。保留现有链接 debounce、快照和 generation 防护，不扩大密码计算次数。
- 要做什么：HTML 导出使用文件 codec/API，独立于 URL 的 ready result/256 KiB 上限。链接因超长而失败时，仍允许有效文档导出为文件。选项本身无效则两种出口都拒绝。下载与组装分开，以便在最后同步触发前检查有效性。
- 预计修改文件：`src/components/ShareModal.tsx`、`src/components/ShareModal.test.tsx`、`src/components/Icons.tsx`（如需下载图标）、`src/styles/styles.css`；必要时微调 03 的导出接口。
- 验收条件：普通、密码、td、te 选择都传入正确保护选项；导出当前文档标题/正文/评论；无效选项、资源加载/加密/下载失败有可理解提示且没有成功下载；超 URL 长度文档仍能导出。
- 测试要求：用受控异步 promise 测文档/选项改变、关闭/重开、过期和迟到结果；验证生成后选项变化不会触发 Blob 下载，下载成功有正确文件名及资源释放。保持原分享竞态测试。
- 前置依赖：`03-standalone-html.md`。

## T2 · 网站与文件传入各自的分享能力

- 要做什么：让 ShareModal 接收导出回调和显式分享网站 base。`App.tsx` 注入 03 的网站按需资源加载/组装能力和当前 origin+pathname；文件的 StandaloneApp 注入自身程序/样式复用与嵌入的 shareBaseUrl。
- 要做什么：文件保留 Share、Settings、Help 等阅读动作，能生成网站链接或再次导出，普通/密码再次导出不需要联网。不能从 file URL 拼分享链接，无法取得合法来源时不给出错误链接。保留 URL 专有长度报错与手动复制 fallback。
- 要做什么：简短英文说明 HTML 直接用浏览器打开、只读预览、普通/密码离线及时间胶囊需网络；不向读者暴露 bundler/codec/CSP 细节。帮助的完整使用说明由 05 更新。
- 预计修改文件：`src/App.tsx`、`src/standalone/StandaloneApp.tsx`、`src/standalone/StandaloneApp.test.tsx`、ShareModal 对应 props/callers。
- 验收条件：网站和文件的 Share 均可触达导出，文件再次下载可重开且维持所选保护；原网站库/编辑仍正常；standalone 不因加入 Share 递归导入自身构建模板或包含 Editor/App。
- 前置依赖：本文件 T1。

## 本任务验证与交接

- 运行 `bun run typecheck`、`bun run test`、`bun run test:e2e`，实际用 Share 下载一个 HTML 并离线打开确认入口完整；完整新增浏览器矩阵由 05 提交。
- 确认正常网站初始加载没有请求/执行整个导出模板；记录按钮文案与定位、下载名规则、导出错误/disabled 条件供 05 编写稳定测试。


## 完成记录 · 2026-09-08

状态：04 验收完成，待协调器集成。基线 `65c044c`，完整阅读方案、03 归档、CLAUDE.md、README 与相关实现。仅修改本项所有权内文件；未改其他 todo 状态或历史方案。未改依赖，未启动额外 agent，未 rebase/merge/push、操作 main、创建 PR 或部署。01/03 的历史“待集成”文案未视作阻塞，留给队列统一收尾。

### 最终接口与宿主职责

`ShareModal` 保留原 props，并新增两个必传 props（base 的值允许 undefined）：

```ts
shareBaseUrl: string | undefined;
exportHtml: (
  state: DocState,
  options: ShareOptions, // { password?: string | null; unlockMs?: number | null }
  shareBaseUrl?: string,
) => Promise<HtmlExport>; // { html: string; filename: string }
```

- ShareModal 将来源规范化为 HTTP(S) origin + pathname，移除 query/hash；没有合法来源时不运行 encodeUrl、Copy disabled，但允许 HTML 导出，回调收到 undefined base。不会从 file/null URL 构造链接。
- 回调只编码和组装，不下载。ShareModal 在点击时深拷贝完整 DocState，按开关组装 ShareOptions；组装返回后检查代次、最新完整快照、open、宿主回调、实时 getState、target 的 30 秒窗口和 unlockMs。createHtmlDownload 准备 Blob 后再同步复查一次，紧接着 download()；废弃准备调用 dispose()。错误不会回落到普通文件或旧结果。
- HTML 与链接独立生成；仅用户点击才调用 exportHtml，URL 的 250ms debounce 和密码输入计算次数不变。busy 和 success 都禁止重复下载同一请求；关闭重开或文档/选项变化恢复按钮。失败允许直接重试。
- `App.tsx` 的模块内 `exportWebsiteHtml` 依次调用网站专用 loadStandaloneRuntime、encodeHtmlPayload、assembleHtmlShare，传入当前 origin + pathname。加载资源失败时不启动文件密码计算；正常网站和仅打开 Share 均不请求模板，导入资源模块后也不执行其中的阅读程序。
- `StandaloneApp.tsx` 现在自行管理 ShareModal/open/toast，并在完整解锁后提供 ReadOnlyDocument.onShare。03 预留的 StandaloneShareContext / StandaloneAppProps.onShare 接缝已由实际 UI 取代，`<StandaloneApp />` 和 main.tsx 无需额外包装。模块内 `exportFileHtml` 用 readStandaloneRuntime → encodeHtmlPayload → assembleHtmlShare；来源来自启动时捕获的嵌入数据，资源只读固定 script/style，不序列化解锁 DOM。
- 文件保留 Settings、Help、Share；Share 的 Learn more 在上层打开现有 Help。两种宿主的导出回调都保持稳定引用；Share 的状态/成功反馈不会再次触发链接密码计算。无网站 loader 进入共享 UI 或文件构建。
- 普通/密码文件再次导出无需联网；再次分享沿用 Share 原行为，每次打开默认无密码/无时间锁，用户显式选择本次保护，不保留之前输入的解锁密码。所选 d/e/td/te 保护完整传入文件 codec。

### 05 可用的 UI 定位、状态与命名

- 网站与文件顶栏：`getByRole('button', { name: 'Share', exact: true })`。
- 弹窗：`getByRole('dialog', { name: 'Share this document' })` / `.share-modal`。
- 导出按钮：`getByRole('button', { name: 'Export HTML', exact: true })`；忙时名称 `Exporting HTML…`，提示 `Preparing your HTML file…`（role=status）。
- 下载启动成功：`HTML download started.`（role=status）。含义是浏览器下载已触发，不声称操作系统已完成保存；按钮恢复 `Export HTML` 文案并保持 disabled，关闭重开/变更快照后可再下载。
- 导出错误：`.share-html [role="alert"]`，前缀 `Couldn't export HTML:`；有效快照可直接点击重试。过期或实时文档变更也不会下载。旧请求的迟到成功/错误都不覆盖新请求。
- 密码 switch 的 accessible name：`Require a password`；时间 switch：`Time-lock until a future date`。顺序仍为密码第一个、时间第二个。密码 input placeholder 仍为 `Choose a password`；日期仍为 `input[type="datetime-local"]`；预设文案未变。
- URL input：`getByLabel('Shareable link')` / `.url-row input`；Copy 文案未变。URL 错误持久显示在 `.share-modal [role="alert"]`，保留 256 KiB 专属错误与 clipboard 失败后的手动选择复制。
- disabled：密码开关开启而密码为空、时间未选/非法/距目标不足 30 秒、读取当前文档失败、正在导出、该快照下载已启动。URL 未 ready/超限、缺少网站来源不会禁用有效 HTML；资源/加密/Blob/点击失败仅显示错误，不降级保护。
- 简短英文说明：HTML 直接用浏览器打开、只读预览、普通和密码文件离线、时间胶囊需要网络。Share 单独增加高度约束和滚动，确保选项展开后底部出口可达；完整 Help/README 文档仍属 05。
- 文件名沿用 03：普通按标题安全清理（路径/控制字符、Windows 保留名、UTF-8 名称预算等）并固定 `.html`；e/td/te 一律 `foil-shared-document.html`，外壳 title 一律 `Foil shared document`。实际普通测试名为 `Share 文档 04.html`。createHtmlDownload 点击后 1 秒 revoke，失败或废弃立即 dispose，临时 anchor 总被移除。
- 文件错误密码文案来自 codec：`Incorrect password or damaged share link`；网站的旧文案 `Wrong password or corrupt link.` 不适用于 standalone。Settings 的 `Large` 为 role=radio，不是 role=button。

### 逐项验收证据

| 验收条件 | 实际证据 |
| --- | --- |
| T1：普通、密码、td、te 传正确保护及完整标题/正文/评论 | ShareModal 42 项测试中的四模式用例检查回调参数、与 URL 选项相同、深拷贝嵌套 replies；StandaloneApp 25 项测试中四模式检查实际 encodeHtmlPayload 参数及 assembleHtmlShare 结果的数据块、自身程序、来源 |
| T1：清晰生成/错误/成功、禁止重复及旧结果下载 | 受控 promise 覆盖重复点击、文档 title/md/comments、密码值/开关、时间开关/预设/日期、来源变化、关闭/重开/卸载、新旧完成顺序；已组装结果 resolve 后同一任务内开关往返也被废弃 |
| T1：最后同步检查、过期、资源释放 | 单测覆盖无 render 的实时 getState 变化、无 clock tick 的过期、跨 30 秒边界、有 tick 的过期、Blob 准备时文档/开关/过期变化；无 anchor 点击，已创建 URL 被 revoke。成功文件名/Blob 类型/一次下载/延时释放检查通过 |
| T1：无效选项和失败不下载或降级 | 缺密码/非法日期不调用两个编码出口；资源加载/加密失败不再下载先前普通文件；Blob 构造及 anchor 点击错误明确、可重试且无遗留资源；失败重试继续传 password，不降级 |
| T1：超 URL 上限仍可文件导出 | 单测故障注入通过；真实 Chromium 用 320,000 字符随机正文，URL payload 321,483 字符，Copy 因 256 KiB 错误 disabled，Export HTML 可用；实际下载 738,313 bytes HTML 并在全新、HTTP(S) 全拦截 context 成功 file 打开，正文逐字相同 |
| T2：两宿主真实可达，普通/密码离线再次下载重开 | Chromium/WebKit 均通过网站 Share 实际下载 d/e → 移至含 Unicode 路径 → 全新 HTTP(S) 全拦截 context file 打开 → 文件 Share 再次实际下载 d/e → 另一全新隔离 context 重开；密码文件错误密码后成功，二次密码选择新值并需新密码解锁 |
| T2：完整只读阅读、Settings/Help/来源链接 | 两浏览器 file 显示完整标题、跨行原文与锚点评论；无 editor/composer/library 或文档 storage；普通刷新、字号 Large、About Foil、Share 内 Learn more 均可用。文件链接指回捕获的网站 `/foil/`，没有 file/null 来源 |
| T2：复用自身资源且保护壳无泄露 | 两浏览器再导出程序逐字相同、文件体积不增长；e 原字节无 title/body/comment/password sentinel。单测检查嵌入 root 不含解锁 DOM；无来源不生成链接但允许 HTML，缺自身资源明确失败 |
| T2：网站保持编辑/库/延迟加载，构建无递归依赖 | 原 App 持久化、分享预览/fork 单测与 12 项网站 e2e 通过。真实首屏/仅打开 Share 均零 foil-standalone 请求，点击 Export 才一次加载；加载后 author Buffer 仍 undefined、编辑器仍存在。生产构建的原依赖防线通过，拒绝 Editor/App/DocSwitcher/Composer/doc-store/网站 loader 进入 standalone |

### 校验命令与结果

最终业务校验按 typecheck → 全量 test → build → test:e2e 串行执行，没有与构建并发跑 KDF 测试：

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | 退出 0，162 packages；package.json/bun.lock 无改动 |
| `bun run typecheck` | 退出 0 |
| `bun run test` | 16 文件、619/619 通过，24.58s；包括最终 ShareModal 42 项和 StandaloneApp 25 项 |
| `bun run build` | 默认 `/foil/` 生产构建通过，2.87s（Vite）；standalone 无禁止依赖/外部 chunk |
| `bun run test:e2e --workers=2` | 内含串行重建，Chromium/WebKit 原网站 12/12 通过，26.0s；没有修改测试超时或跳过测试 |
| `node /tmp/foil-share-04-check.mjs` | Chromium/WebKit d/e 共四条实际下载/离线/再导出/重新打开链路通过；零 HTTP(S)、CSP 或 runtime 错误 |
| `node /tmp/foil-share-04-long.mjs` | 真实 URL 超限、HTML 可下载和全新 file 离线打开通过 |
| `git diff --check` | 通过 |

临时浏览器探针使用本分支生产构建、隔离 preview 端口 4474；脚本和下载放 `/tmp`，没有占用 05 的 e2e 文件。最终文件目录 `/tmp/foil-share-04-1p9bYF/`，路径另记在 `/tmp/foil-share-04-current-dir`。检查未关闭浏览器安全策略，WebKit 使用拦截并拒绝所有 HTTP(S)，不使用会拒绝静态 file 导航的 Playwright offline 开关。早期探针使用网站错误密码文案及 button 定位 Large 导致定位失败，已按实际 standalone 文案/role 修正后完整通过；未为探针改动业务行为。

最终资源大小：内嵌脚本 384,918 bytes、CSS 30,880 bytes，两者 gzip 134,410 bytes；网站按需资源模块 423.38 kB。示例 HTML：Chromium d/e 417,125 / 417,189 bytes，WebKit d/e 417,118 / 417,182 bytes；各自再次导出大小相同（压缩实现带来浏览器间微小差异）。网站主 JS 236.63 kB（gzip 76.51 kB），Buffer 27.96 kB、timecapsule-crypto 148.74 kB 的延迟 chunk 保留。

风险 / blocker：无本项 blocker。时间胶囊保持 drand 网络依赖；本项四模式文件保护接入由单测验证，旧真实时间胶囊密码学 e2e 回归通过，新增 td/te 文件完整浏览器矩阵与最终使用文档按队列交给 05。未部署。
