# Share 导出独立 HTML

## 意图

用户希望在 Share 中导出一个可以直接发给别人的 HTML 文件。接收方用浏览器打开文件后，获得与打开分享链接一致的阅读体验，文件包含完整的运行程序，但只有 preview，没有 editor。实现范围包括正文、标题、已有评论及锚点、阅读设置、帮助、继续分享，以及现有普通、密码、时间胶囊、密码加时间胶囊四种保护方式。

这是新增文件分享能力。已询问离线要求；在没有进一步答复时采用推荐方案：程序和样式全部内嵌，普通和密码文件离线可读；时间胶囊保留 drand 的网络依赖。用户后续答复优先于本文默认假设。

## 仓库依据

- 当前基线为 `9769a74`；规划开始时工作区干净。栈为 React 18、TypeScript、Vite 7.3.6、Bun，纯静态应用。
- `src/components/ShareModal.tsx` 生成四类链接，已经用文档/选项快照、请求代次和 250ms debounce 防止复制过期结果；出口目前只有复制链接。
- `src/lib/url-codec.ts` 实现 gzip、AES-GCM/PBKDF2、tlock、schema 与分层预算。链接上限为 256 KiB 字符，每层为 4 MiB，累计解码预算 8 MiB，最多 1000 个评论线程、每线程 200 条回复。
- `src/App.tsx` 同时负责编辑、分享接收、阅读设置、评论布局和本地文档持久化。目前 readOnly 分支仍挂载 `Editor`，并有 `Edit anyway`；评论写入 handler 会在 readOnly 时直接返回。
- `src/components/Editor.tsx`、`src/lib/markdown.ts`、`src/lib/editor-dom.ts` 共用逐行 Markdown 装饰与文本上下文锚点。当前 preview 也显示装饰后的 Markdown 语法，不引入新 Markdown 解析器或改变这套表示。
- `src/components/Thread.tsx` 总会显示 Reply/Delete，需要有真正只读的展示方式。`SettingsModal.tsx`、`HelpModal.tsx`、`PasswordPromptModal.tsx`、`TimeCapsuleUnlock.tsx` 是可复用的现有交互。
- `src/lib/timecapsule.ts` 先动态加载并安装全局 Buffer，再加载密码学依赖。合并成一个脚本时必须验证这个初始化顺序。`timecapsule-drand.ts` 提供固定 quicknet 与四个 drand 来源。
- `vite.config.ts` 的生产 CSP 当前只允许同源外部脚本，base 为 `/foil/`；部署脚本覆盖为 `/`。导出文件需要自己的内联脚本 CSP，不能放宽网站的策略。
- 现有 Vitest 覆盖 codec、分享竞态、本地存储和编辑器。`tests/e2e/sharing.spec.ts` 有真实密码学、固定 quicknet beacon 与模拟网络，Playwright 已覆盖 Chromium 和 WebKit。
- `plans/repo-improvements/` 和 `plans/foil-brand-and-site/` 属于其他工作，本队列不执行它们，也不迁移官网入口。

## 目标与非目标

### 目标

1. Share 新增清晰的 `Export HTML` 操作，下载一个 `.html`，不需要附件目录、服务器、CDN、作者浏览器缓存或本地文档库。
2. 文件携带点击导出时的完整 `DocState` 快照，选中的密码/解锁日期与复制链接具有相同语义。保护文件在解锁前不包含明文正文、评论或文档标题。
3. 网站分享预览和文件预览复用同一阅读组件。文件中没有编辑文档、修改标题、管理文档库、格式工具、添加/回复/删除评论、fork/Edit anyway 的入口或可用写入路径。
4. 保留评论阅读与定位、移动端评论抽屉、文字选择与复制、阅读统计、主题/字体/字号/宽度/密度/强调色和帮助。文件内继续分享可生成有效网站链接或再次导出文件。
5. 文件格式使用明确版本并有输入边界；不受 URL 专属 256 KiB 上限约束，但保留有界解码和文档结构限制。
6. 真正下载并通过 `file://` 打开验证四种模式，覆盖离线、密码重试、时间门控和损坏文件。网站现有分享及编辑流程继续通过回归。

### 非目标

- 不增加后端、上传存储、账号、多人同步、HTML 导入编辑、PDF/ZIP 导出。
- 不让时间胶囊绕过 drand，不以本地倒计时或隐藏明文代替 tlock。
- 不扩展 Markdown 语法或下载链接/图片所指向的外部网页资源；当前 renderer 对这些语法进行文本装饰，保持一致。
- 不把未解锁的文件转成明文，不在文件中塞入作者的其他文档、个人设置、密码或解密密钥。

## 方案

### 1. 共用密码学，分开传输限制

在 `url-codec.ts` 内提取最小的共同编解码流程，保留 `encodeUrl`、`decodeUrl`、`openTimeCapsule` 既有 API、wire 格式和默认限制。新增 `encodeHtmlPayload(state, options)` 与 `decodeHtmlPayload(payload, password?)`：payload 仍是带 `#d=`/`#e=`/`#td=`/`#te=` 前缀的编码字符串，避免再造密码学协议；解码仍返回 `DecodeResult`。

新增文件入口使用固定、有上限的传输预算：由现有每层字节限制和 AES 开销推导最大的 base64 字符数，在分配、解压和 KDF 之前校验。保留 4 MiB/8 MiB/schema/线程限制，URL 入口继续严格拒绝超过 256 KiB 的链接。不要通过全局调大 `SHARE_LIMITS.fragmentChars` 或增加任意无限制开关实现。

HTML 的非可执行数据块包含 `{ format: 'foil-share', version: 1, payload, shareBaseUrl? }`。解密后的文档 title 属于 payload；数据块之外的受保护文件标题和下载名用通用名称。`shareBaseUrl` 仅是导出来源的 HTTP(S) origin + pathname，不包含 query、fragment、凭据或文档数据。

### 2. 独立的共用预览组件

增加 `Preview.tsx`，使用现有 `renderDecorated`、`findAnchorRange`、`wrapRangeInEditor` 等纯函数渲染和标记锚点，不引用 `Editor.tsx` 的输入、撤销、粘贴、格式化代码。复用 `.editor.readonly` 等样式/测试定位可以保留，但 DOM 必须不可编辑。

增加 `ReadOnlyDocument.tsx` 组合标题、preview、只读评论、移动抽屉、统计与可选动作。以 `DocState`、阅读 `Settings` 及动作回调/插槽作为边界，不负责文档库和分享编解码。需要时抽取阅读设置应用的 hook；使网站和文件显示一致。所有评论都可访问，找不到锚点的评论提供未定位列表。设置改变或视口变化后重算评论布局。

`App.tsx` 的网站分享阅读分支改用该组件，网站已有进入本地编辑器的动作由 App 显式提供。文件侧不传编辑动作。`Thread` 增加只读能力并隐藏写入控件。正常编辑器和其文档库继续使用原有逻辑。

### 3. 独立运行入口及单文件构建

增加 `src/standalone/main.tsx` 和 `StandaloneApp.tsx`，启动时只读取上述内嵌数据块，验证格式/版本后进入 loading、password、time capsule、preview、error/cancelled 状态。取消或损坏文件停留在可重试的阅读状态，绝不创建示例文档或进入本地库。异步旧结果不能在取消、换状态或卸载后重新显示内容。

复用现有解密、时间胶囊、设置和帮助组件。文档不写入 localStorage/sessionStorage；设置存储失败时仍可在内存中调整阅读偏好。支持 Web Crypto 和 gzip 的能力检测与明确失败提示，不能返回成功却下载不可用或未保护的内容。

构建侧为这个入口生成完整自包含的生产脚本和 CSS，包括 React、Buffer、tlock、drand 客户端。不使用外部 module script、动态网络 chunk 或运行时 CDN。推荐使用现有 Vite/Rollup 的程序化构建（单入口 IIFE，收集 CSS，禁用外部依赖），输出供网站导出功能按需加载的静态资源描述；dev 与 build 均可用，支持 `/foil/` 和 `/`。

单文件合并可能提前执行动态导入。必须保证 Buffer 在任何依赖初始化前可用，例如在独立构建中使用专用 polyfill 前置模块/独立 bootstrap；不能仅打开 `inlineDynamicImports` 就假定现有顺序仍成立。网站原有延迟加载应保留。

新增 `src/lib/html-export.ts` 等小模块，把已编码 payload 与运行资源组装成完整 UTF-8 HTML，并提供文件名/Blob 下载帮助函数。用户数据只放安全转义后的非可执行 JSON 中，处理 `</script>`、HTML 特殊字符、Unicode、恶意标题/评论等边界；脚本 hash 按最终实际嵌入字节计算。导出 CSP 使用内联脚本 hash，脚本不使用 unsafe-inline/unsafe-eval，连接只允许现有 drand 来源，拒绝 object、base 和表单导航。网站 CSP 不为导出降级。

避免循环打包：共用 ShareModal 和 HTML 组装器不得静态依赖“包含自身的生成模板”。网站通过按需资源加载器提供导出回调；文件再次导出时从它自己的固定脚本/样式数据获取运行资源并调用相同组装器，无需回源，不能把解锁后的整个 DOM 当模板保存。

### 4. Share UI 与再次分享

ShareModal 保留复制链接，新增 HTML 出口，共用文档快照、保护选项和有效日期判断。导出在用户点击时使用捕获的快照，异步过程中修改文档/选项、关闭弹窗或过期时废弃旧结果；禁止失败后回落为普通明文文件或下载旧文件。展示生成中、错误、成功状态，安全文件名以 `.html` 结尾，下载后释放 Blob URL，并防止重复点击产生多份过期下载。

文件导出不能以“URL 已生成成功”为前提：文档超过 URL 长度上限但仍在文件数据预算内时，复制链接可以报错，HTML 仍然可导出。不要为了增加按钮破坏现有分享结果的快照与竞态测试。

以导出回调和显式 `shareBaseUrl` 为 ShareModal 的环境边界。网站传入当前部署路径，文件传入其来源元数据；不得从 `file://` 的 origin/path 生成链接。文件可继续选择保护选项、复制来源网站分享链接和再次导出；新链接受原 URL 长度限制。断网情况下普通/密码的再次导出继续可用，时间胶囊的创建/打开保持现有网络契约。

帮助及 Share 简短说明解释文件直接用浏览器打开、预览限定、普通/密码离线与定时解锁联网；保持现有英文 UI 用语。读者不需要看到打包、CSP 或 codec 等实现细节。

## 拆解

| 顺序 | 任务 | 难度 | 前置依赖 | 范围 |
| --- | --- | --- | --- | --- |
| 01 | 文件分享 payload 与传输边界 | hard | 无 | codec、版本数据 schema、密码学/限制回归 |
| 02 | 网站与文件共用只读预览 | hard | 无 | Preview、ReadOnlyDocument、App 阅读分支、Thread、阅读样式 |
| 03 | 独立入口与自包含 HTML 构建 | hard | 01、02 | standalone、Vite 构建集成、组装器、资源内嵌、CSP |
| 04 | Share 导出与文件再次分享 | medium | 03 | ShareModal、App/standalone 回调、下载交互和竞态测试 |
| 05 | 实际文件浏览器验收与文档 | medium | 04 | Chromium/WebKit file 打开、离线/四种保护/回归、README/帮助 |

01 与 02 的业务文件不相交，可用独立 worktree 并行。03 等它们均验证合入后开始；04 与 05 依次进行。每项一个最终 commit。新增文件名是建议落点，可在保持接口职责及任务所有权的前提下小幅调整；实际接口需记录到 todo 完成说明中供下游使用。

## 执行偏好

- `default_agent: codex`，来自发起流程的 Codex 宿主；用户没有全局或单任务覆盖。
- 每个 todo 使用 `agent: inherit`；未指定模型或推理强度覆盖。
- 根据共享分发规则：hard → `gpt-6-astra` + `max`；medium → `gpt-6-astra` + `xhigh`。协调器使用 `gpt-6-astra` + `high`，不作为任务默认难度。
- 本机 `codex --help` 支持要求的启动参数；本机模型元数据确认 `gpt-6-astra` 支持 high/xhigh/max。Herdr 环境已确认。
- 通过 auto-dev 提交本计划与队列后，在同级后台 pane 启动 herdr-finish-plan。使用独立 worktree、按依赖执行并集成，不执行其他 plan，不部署网站。

## 校验与验收

现有仓库命令：`bun run typecheck`、`bun run test`、`bun run build`、`bun run test:e2e`（会重新 build 后运行 Chromium/WebKit）。CI 另有 `bun audit` 和 `bun audit --prod`；依赖变更需跑对应审计。尽量使用现有工具链，不为导出引入额外框架。

- codec：四种模式往返、错误密码后重试、未到期不能开、未来日期过期、错误格式/版本、损坏/超限输入；旧 URL wire 格式和所有原有边界保持。
- 文件：捕获真实下载保存到临时目录，在全新 recipient context 中 `file://` 打开并刷新。普通/密码模式完全阻止网络；正文、标题、评论均与源快照一致，设置与移动端评论可操作；正文/标题/评论不支持修改，不创建本地文档。
- 时间胶囊：复用现有固定 quicknet beacon 和真实密码学，拦截 drand 并允许 file 的跨源访问；覆盖 td 和 te、解锁前/后、错误密码、网络失败后重试、取消后旧结果不生效。测试不访问公网 drand、不通过真实等待验收到期。
- 包装：加密文件原始字节不含测试用明文 title/md/comment/password；脚本/样式全在文件中，零脚本/CSS网络请求、零 CSP 违规。覆盖含 `</script>`、事件属性、HTML 字符、emoji/中文的内容和文件名。
- Share：选项/文档快速变化、关闭/重开、导出中失败和过期、下载拒绝或资源不可用、长文档只允许文件导出；文件中再次导出仍可离线打开，来源链接不能是 file/null URL。
- 回归：网站可编辑、保存、打开四类老链接和 fork，正常模式保持延迟密码学加载，默认 `/foil/` 与根路径构建都可用。记录生成文件及常规 bundle 体积，确认无意外重复打包/递归模板。

规划阶段未运行业务校验；以上由执行队列按修改范围和最终集成执行，不把未执行检查写成通过。

## 风险、假设与资料

- 离线范围采用上述默认；时间胶囊的封存会获取/校验链信息，打开还需要已发布签名。规划时对当前 `api.drand.sh/<quicknet>/info` 使用 `Origin: null` 的 HEAD 读取返回 200 和 `Access-Control-Allow-Origin: *`，但最终仍需浏览器验收及失败恢复。
- 单文件包含整个阅读及密码学程序，因此体积会大于仅正文的 HTML；这是自包含目标的正常成本，网站首次编辑应避免预加载该模板。
- 文件浏览器能力可能不同。MDN 将 file 来源描述为通常可信，仍应在 Chromium/WebKit 实测 Web Crypto/gzip 与 file 打开，并对不支持者明确提示。[MDN Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)
- Rollup 明确说明内联动态导入会改变模块执行顺序，故 Buffer 与真实 tlock 初始化列为必验项。[Rollup inlineDynamicImports](https://rollupjs.org/configuration-options/#output-inlinedynamicimports)
- 内联脚本通过最终字节对应的 CSP hash 授权；文本的安全嵌入仍独立验证。[MDN script-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src)
- “只有 preview”解释为只读正文与既有评论；对评论的写入本来就要求先进入 editor，不加入文件。作者设置不随分享传输；接收方可自行调整。

## 执行结果

全部 5 项已完成并快进合入本地 `main`。执行起点为干净的 `73ef58d`；仅执行本队列，按 `01 + 02` 并行、`03 → 04 → 05` 串行集成。每项使用独立 worktree，保留一个最终任务 commit；完成记录均归档至 `todos/done/`。

所有任务的 `agent: inherit` 解析为保存的默认 `codex`，模型均为 `gpt-6-astra`。hard 使用 `max`，medium 使用 `xhigh`，没有继承协调器的 `high`。本机 CLI/模型元数据复核后，实际启动显式指定模型、对应推理强度及 `--dangerously-bypass-approvals-and-sandbox`。

| 任务 / 完成记录 | 难度 / 推理强度 | 最终 commit | 协调器独立集成验证 |
| --- | --- | --- | --- |
| [01 文件 payload](todos/done/01-html-payload.md) | hard / max | `c5338d6` | typecheck、514 项单测、生产构建通过 |
| [02 共用只读预览](todos/done/02-readonly-preview.md) | hard / max | `38c1b84` | typecheck、531 项单测、构建及 Chromium/WebKit 12 项 e2e 通过 |
| [03 独立 HTML](todos/done/03-standalone-html.md) | hard / max | `65c044c` | typecheck、578 项单测、默认/root 构建；Chromium 四模式与 WebKit d/e/td 共 7 个实际 file 场景通过 |
| [04 Share 出口](todos/done/04-share-export.md) | medium / xhigh | `f7f1f8f` | typecheck、619 项单测、构建及 Chromium/WebKit 12 项 e2e 通过 |
| [05 文件回归与文档](todos/done/05-file-regressions.md) | medium / xhigh | `8c3d1eb` | typecheck、619 项单测；默认/root 构建及双浏览器矩阵各 28/28 通过 |

### 实际交付

Share 新增 **Export HTML**，下载可直接发送的单个 HTML。文件包含完整阅读程序、样式和文档快照，提供标题、正文、所有评论/回复、评论定位与移动抽屉、选择复制、统计、设置、帮助、继续分享；没有 editor、文档库或评论写入控件。网站与文件共用只读预览，网站保留进入本地编辑的动作。

普通/密码文件可离线打开、刷新及再次导出；时间胶囊与密码加时间胶囊仍需 drand。文件沿用四种真实密码学模式，保留解压/schema 限制，URL 的 256 KiB 限制未放宽。文件采用独立有界传输预算、版本数据验证、安全嵌入与脚本 hash CSP；受保护文件不暴露文档标题或明文。取消、失败、过期和异步旧结果不会回落下载普通明文。

### 最终验证与限制

任务 agent 在 rebase 后、协调器在合入前分别顺序执行并通过以下完整检查，最终 HEAD 均为 `8c3d1eb`，无业务代码再修改：

```sh
bun run typecheck
bun run test
bun run test:e2e --workers=2
bun run build --base /
FOIL_E2E_BASE=/ bunx playwright test --workers=2
```

单测为 16 个文件、619/619；默认 `/foil/` 和根路径 `/` 各为 Chromium/WebKit 28/28，无失败或跳过。正式新增的 16 项浏览器用例通过 Share 真实下载后，在全新接收方 context 中 `file://` 打开，覆盖四种保护、离线刷新/再次导出、移动评论、禁用存储、密码/网络错误重试、取消后迟到解密结果、超 URL 上限、损坏数据和 CSP 拒绝篡改脚本。普通/密码场景阻止全部 HTTP(S)；时间胶囊使用固定 quicknet/beacon 与真实密码学，未访问公网 drand。测试环境为 Linux 上的 Chromium 153.0.8010.12 和 WebKit 26.6；不声称覆盖所有浏览器或邮件附件预览。

最终独立脚本 386,377 bytes，CSS 30,880 bytes；网站按需资源模块 424,854 bytes。代表性导出文件约 419 KB，超 URL 上限的长文档约 862–865 KB。网站主 JS 约 238 KB（gzip 77 KB），Buffer 和时间胶囊仍分块延迟加载；文件再次导出的运行程序及体积检查未发现递归膨胀。精确测量和逐场景证据见 05 完成记录。

执行中已解决的情况保留在各项归档：02 的首次 e2e 端口占用后顺序重跑通过，rebase 仅解决队列 README 的相邻记录冲突；03 修正内嵌资源校验与生产 JSX 构建问题，并将测试/构建顺序执行以避免 KDF 争用；05 修正测试中脚本文本计数和根路径 preview base 配置后，两种路径完整重跑通过。没有跳过测试或降低保护要求。依赖清单和锁文件均未变更，因此未运行本计划仅在依赖变更时要求的 audit。

### 收尾

所有任务均已合入、归档并清理，无阻塞、延期或保留待处理任务；恢复次数均为 0。已核实本轮 5 个任务 agent 正常退出，对应 Herdr workspace、Git worktree 和任务分支全部删除；Foil 仅保留原 `main` checkout，协调器和其他项目资源保持原状。最终仅补充本执行结果和队列状态的协调器文档提交。未执行其他历史 plans，未推送、未部署。
