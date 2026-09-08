difficulty: medium
agent: inherit

# 实际文件浏览器验收与使用文档

阅读 `../../plan.md`，在 04 合入后验证完整用户路径。一个独立 worktree、一个最终 commit；发现实现问题先交由协调器修复依赖实现，再完成验收，不跳过失败场景。

## T1 · 从 Share 下载到离线 file 阅读

- 要做什么：新增 `tests/e2e/html-export.spec.ts`，通过网站 Share 触发真实下载、保存到 Playwright 临时输出目录，在全新且无作者 storage 的 recipient context 中用 `file://` 打开并刷新；不能用 page.setContent 或仅 HTTP 预览代替本地文件。
- 要做什么：普通/密码文件封锁所有网络，验证中文/emoji、空行、代码块、特殊字符、标题、评论与源快照相同；密码失败后重试、取消/重新打开行为正确。测试只读正文/标题/评论，无 Edit anyway、文档库、格式工具或评论写入；阅读设置、桌面锚点与移动抽屉可用，存储拒绝不阻止阅读。
- 要做什么：覆盖文件中再次导出后仍能离线重开、复制分享链接指向有效网站路径、长度超出 URL 上限而文件仍可导出。选择有意义代表场景控制矩阵，不按所有设置排列组合。
- 预计修改文件：新增 `tests/e2e/html-export.spec.ts` 及必要 helper；必要时小幅调整 `playwright.config.ts` 支持独立文件测试，不降低现有项目覆盖。
- 验收条件：Chromium 和 WebKit 都跑真实 file 打开与离线普通/密码路径；不需要服务器/作者缓存来加载文件程序。下载之后的所有脚本/CSS都来自文件，错误日志与 CSP 违规为空。
- 前置依赖：`04-share-export.md`。

## T2 · 保护模式、包装和网站回归

- 要做什么：参考 `tests/e2e/sharing.spec.ts` 的固定 quicknet/真实 beacon，覆盖 td 和 te 到期前、到期后解密、错误密码、网络失败重试、取消后迟到回调；拦截 drand 返回允许 file/null origin 的 CORS 响应，其余外网均拒绝，不用真实公网或真实时间长等待。
- 要做什么：检查下载文件原始字节中受保护 title/md/comment/password 的测试 sentinel 不存在；使用含关闭 script 标签、事件属性、HTML 字符和 Unicode 的内容验收无注入。检查内联脚本 hash 生效、无外链 chunk，无嵌入完整编辑器模块的构建依赖。
- 要做什么：复用既有网站四类链接和编辑/持久化回归；默认 `/foil/` 与 `--base /` 的导出都验证，根路径构建与默认构建顺序执行。记录代表性文件体积和常规入口体积，排除重复模板/错误提前加载。
- 预计修改文件：`tests/e2e/html-export.spec.ts`、`tests/e2e/sharing.spec.ts`（仅必要 fixture 提取）、新增 `tests/e2e/helpers/*`；必要的构建产物断言放在现有测试工具中。
- 验收条件：四种保护方式以真实浏览器密码学通过；未解锁前看不到正文；网络只发往允许的 drand，原网站 CSP 未放宽且所有现有 e2e 仍通过。不能为了通过 file/CSP 测试启动浏览器禁用安全策略。
- 前置依赖：本文件 T1。

## T3 · 使用与开发说明

- 要做什么：README 增加 Share → Export HTML、直接发送并浏览器打开、预览范围、文件密码/时间胶囊语义、普通/密码离线和 drand 网络例外；说明文件快照不会随作者文档更新，阅读设置不代表保存文档修改。
- 要做什么：更新 HelpModal 的必要说明，使网站链接与文件载荷描述都准确，不暗示文件必须从服务器下载程序或可进入 editor。CLAUDE 开发架构/构建说明若因新增独立入口改变则同步必要事实。
- 预计修改文件：`README.md`、`src/components/HelpModal.tsx`、必要时 `CLAUDE.md`。
- 验收条件：用户可以仅根据 UI/README 完成导出和打开；实际实现支持范围与文字一致。没有把 file 支持泛化成所有浏览器/邮件内置预览器保证。
- 前置依赖：本文件 T2，以最终验证结果为准。

## 最终验证

- 运行 `bun run typecheck`、`bun run test`、`bun run test:e2e`。后者包含完整默认生产构建与 Chromium/WebKit；再按任务 T2 完成根路径验证。构建不能并发覆盖同一 dist。
- 依赖发生变更时执行 `bun audit`、`bun audit --prod`。测试全部通过后不无理由重复，记录命令、浏览器、文件模式、体积、任何实际剩余限制。
- 不提交生成 HTML、dist、Playwright artifacts 或临时 fixture 下载，不部署网站。协调器在最终集成验证完成后报告真实完成状态。

## 完成记录 · 2026-09-08

状态：05 全部验收完成，待协调器集成。基线 `f7f1f8f`，01–04 均已合入。完整阅读方案、本项原文、03/04 归档、README、CLAUDE 与相关源码；03/04 的历史待集成文字保留给协调器收尾。没有发现依赖实现 bug，没有修改 codec、ShareModal、StandaloneApp 或阅读组件。只更新本项状态，不改其他队列历史；未启动额外 agent、改依赖、rebase/merge/push、操作 main、创建 PR、清理 worktree 或部署。

### 文件与测试接口

- 新增 `tests/e2e/html-export.spec.ts`：8 个代表场景 × Chromium/WebKit = 16 项新增测试。保留原网站 12 项，完整每种 base 共 28 项。无 skip、fixme、only、放宽 timeout 或浏览器安全参数。
- 新增 `tests/e2e/helpers/html-export.ts`：作者 fixture、UI 保护选项、真实 Download.saveAs、文件原字节检查、完整阅读快照、隔离网络、CSP/运行日志及真实异步完成观察。文件保存到 `testInfo.outputPath('moved 文档', name + '.html')`，用 `pathToFileURL` 导航。每个 recipient 都是没有作者 storageState/cache 的新 context；全部程序和样式必须来自文件，没有 `page.setContent` 或 HTTP 预览替代。
- 新增 `tests/e2e/helpers/drand.ts`：从既有 `sharing.spec.ts` 原样提取固定 quicknet info、round 992 真实 beacon、四个来源和 UNLOCK_MS。`sharing.spec.ts` 仅变更 fixture 导入，原测试和断言全部保留。
- `playwright.config.ts` 增加 `FOIL_E2E_BASE=/` 与可选 `FOIL_E2E_PORT`（默认 4173）；baseURL、webServer.url 和 **vite preview --base** 一致。Chromium/WebKit 项目、CSP、retry、timeout、service-worker 设置均未降低。
- README、HelpModal 和 CLAUDE 同步真实文件使用、只读范围、快照语义、重新选择保护、离线/drand 边界、设置存储拒绝、独立入口、按需资源与顺序构建说明。纠正旧文档的多余 AES 层和“封存不联网”表述；没有宣称支持所有浏览器或邮件内嵌预览器。

真实 UI/API 沿用 04：Share → `Export HTML`，成功提示 `HTML download started.`；密码 switch 为 `Require a password`，时间 switch 为 `Time-lock until a future date`，Custom 日期使用 UTC 固定 round。文件错误密码为 `Incorrect password or damaged share link`；取消为 `Reading cancelled` + Retry。Settings 的 Large/Light/Dark/Compact/Wide 为 radio。文件数据、程序、样式 ID 分别为 `foil-share-data`、`foil-share-runtime`、`foil-share-styles`。测试不导入应用 codec 来伪造正常下载。

### 逐条验收证据

以下场景在默认 `/foil/` 与根路径 `/` 的 Chromium 和 WebKit 均通过：

| 原验收 | 正式浏览器证据 |
| --- | --- |
| T1：实际 Share 下载、全新 file 阅读、刷新与离线 | d/e 各从网站真实下载到含 Unicode 目录，作者 page 关闭，新 recipient 直接 file 导航并刷新；HTTP(S) 全拒绝且请求列表为空，无作者缓存、文档库或文档 storage |
| T1：完整快照与只读 | 中文/emoji、空行、空代码行、代码块、HTML 特殊字符及 Unicode 分隔符逐字比较 Markdown；标题、全部线程和回复的 author/body/quote 比较；跨行锚点与未定位评论保留。无可编辑正文/标题、编辑/库/格式工具/评论写入控件，键盘输入不改正文，选择/copy 得到完整原 Markdown，保留阅读统计 |
| T1：密码失败、取消、重新打开 | e 错误密码→取消→Retry→正确密码；刷新重新要求密码；专门挂起真实 AES decrypt 的已计算结果，取消后释放并观察实际文档解析完成，界面仍为 cancelled，之后可重试。没有替换密码学结果或靠任意 sleep 声称迟到完成 |
| T1：设置与移动抽屉、存储拒绝 | d/e 不继承作者小字号，Large/Light 修改在刷新后保持，正文/评论不变；普通移动文件拒绝 localStorage/sessionStorage getter，仍可读全部评论/回复和未定位提示，抽屉 Escape、焦点归还、Tab 循环、背景 inert、锚点定位通过；theme/font/size/width/density/accent 均可在内存调整，刷新仍可阅读 |
| T1：再导出与网站链接 | d/e 从文件再次真实下载，在第三个全新且断网 context 重开；e 使用新密码，旧密码失败、新密码成功。程序/CSS 与首文件逐字相同，文件字节数相等，没有模板累积。点击 Copy，验证实际成功或明确手动复制 fallback；生成链接保留正确网站 base，实际网站导航得到完整快照并可见 Edit anyway |
| T1/T2：超 URL 仍导出 | 每浏览器 440,000 字符确定性不可压缩正文；Copy 因 256 KiB 错误 disabled，Export HTML 仍 enabled。真实下载 payload 为 Chromium 443,949 / WebKit 446,426 字符，file 离线逐字重开成功 |
| T2：四种真实保护、标题与载荷保护 | 网站 UI 下载 d/e/td/te，检查实际 payload scheme；e/td/te 文件名为 foil-shared-document.html、外壳通用 title，原字节没有 title/body/comment/password sentinel 或作者私有设置值。真正 AES/PBKDF2、tlock、BLS 验签均在浏览器执行 |
| T2：td/te 未到期、到期、网络失败与取消迟到 | 固定时钟在到期前 60 秒/1 秒不显示 Decrypt 或正文且不请求网络；到期仍需点击 Decrypt。te 先验证错误密码不能到时间门。拒绝所有四个 drand endpoint 后显示连接错误，Retry 后挂起真实 beacon 响应，Cancel 再释放响应；观察解密文档实际解析后仍无正文，然后 Retry 成功。刷新后重新解锁；使用 CORS `Access-Control-Allow-Origin: *` 的本地 fixture，无公网或真实长等待 |
| T2：恶意载荷、安全包装与 CSP | 含关闭 title/script、img onerror、svg onload、引号、&、中文/emoji 的快照无注入，原文完整；运行 hash 用保存的实际 UTF-8 字节计算并匹配 CSP，只有两个真实 script 元素、无外链 script/link/CSS import/url。另把真实下载文件的 runtime 字节篡改，浏览器发出 script-src-elem 违规并拒绝整个程序，sentinel 未执行 |
| T2：损坏文件 | 对真实下载仅更改 data block 的未知 version 或损坏 payload，file 导航显示 Could not open this file；Retry 仍封闭失败，无样例文档或 editor |
| T2：网站回归、延迟加载及构建依赖 | 新测试补充普通/td 网站链接与完整评论快照，原 e/te 和编辑保存/刷新回归全部保留；原网站精确 CSP 断言通过。d/e 网站首屏及仅打开 Share 不请求 standalone，Export 才请求一次，导入后 Buffer 仍未初始化、Editor 未被接管。每次生产构建通过已有 Rollup 模块防线：无 App/Editor/DocSwitcher/Composer/doc-store/网站 loader、外部 chunk 或重复 Buffer |
| T3：使用/开发说明与实际范围一致 | README 提供 Share→Export→发送→保存→浏览器打开的完整步骤，Help 在真实 file 中可打开并显示 Export HTML 说明，CLAUDE 给出独立入口与复跑命令；普通/密码离线、时间胶囊需 drand、文件快照不随作者更新且无 editor、偏好不是文档修改、仅验证 Chromium/WebKit 均明确 |

所有正常文件路径的 HTTP(S)（d/e）、pageerror、console error 和 CSP 违规均为空。负面用例的例外严格限定为：测试刻意 abort 的具体 drand URL 对应浏览器网络错误，以及刻意篡改 runtime 的单条 script-src-elem 违规；其他错误照常失败，未过滤应用/crypto/CSP 回归。

### 精确复跑命令与实际结果

从本 checkout 独立执行，命令按顺序运行；无需交接中的 `/tmp` 脚本或被清理 worktree：

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run test:e2e --workers=2
bun run build --base /
FOIL_E2E_BASE=/ bunx playwright test --workers=2
git diff --check
```

| 命令 | 最终结果 |
| --- | --- |
| `bun install --frozen-lockfile` | 退出 0，162 packages；package.json/bun.lock 无变化，无依赖变更所以未运行 audit |
| `bun run typecheck` | 退出 0；Playwright 配置修正后也复验通过 |
| `bun run test` | 16 文件、619/619，通过 23.96s；与所有 build 串行，原 5 秒 KDF timeout 未改 |
| `bun run build` | 由 test:e2e 实际调用，默认生产构建通过；最终 Vite 2.77s，含单文件依赖防线 |
| `bun run test:e2e --workers=2` | 最终默认 `/foil/` Chromium/WebKit 28/28，约 1.2 分钟，含完整生产重建 |
| `bun run build --base /` | 默认 suite 和 preview 退出后串行执行，通过；最终 Vite 2.74s |
| `FOIL_E2E_BASE=/ bunx playwright test --workers=2` | 最终根路径 Chromium/WebKit 28/28，约 1.1 分钟；没有重新调用会覆盖 base 的 test:e2e 脚本 |
| `git diff --check` | 通过 |

只复跑文件矩阵时：先 `bun run build`，再 `bunx playwright test tests/e2e/html-export.spec.ts --workers=2`；根路径则先 `bun run build --base /`，再 `FOIL_E2E_BASE=/ bunx playwright test tests/e2e/html-export.spec.ts --workers=2`。任一 Playwright 命令可额外设置 `FOIL_E2E_PORT=4273` 选择空闲端口；不要同时构建两个 base 到同一 dist。下载体积也记录在各测试的 `HTML bytes` annotation，文件和报告仅留 ignored 的 test-results/playwright-report，不提交。

调试记录：首轮 10 个新增用例因原字节正则把再导出组装器字符串中的 `<script>` 误计成 DOM 元素而失败；修正为剥离运行脚本文本后检查外壳，同时断言实际浏览器 DOM 两个 script，新增矩阵 16/16 通过。根路径首轮因本项配置漏传 `vite preview --base /`，`/assets/...` 返回明确的 `/foil/` base 404：4 个 Chromium 用例失败后主动停止该轮（2 interrupted，22 未运行），补全 preview base 后顺序重跑默认与根路径完整 28+28，最终没有 skipped/interrupted/failed 用例。没有为这些测试配置错误修改依赖实现或降低断言。

### 实测体积与环境

单位为原始 bytes；两种 base 的固定阅读脚本/CSS 相同。脚本 386,377，CSS 30,880，合计 gzip（Node gzipSync 默认参数）134,993；网站按需资源模块 424,854。Help 扩充使常规入口比 04 增加约 1.46 kB，未嵌入整个阅读模板。

| 产物 | 默认 /foil/ | 根路径 / |
| --- | ---: | ---: |
| 常规主 JS | 238,085（gzip 77,022） | 238,075（gzip 77,017） |
| 常规 CSS | 30,880（gzip 6,432） | 相同 |
| Buffer 延迟 JS | 27,957（gzip 8,559） | 相同 |
| timecapsule-crypto 延迟 JS | 148,744（gzip 53,126） | 148,744（gzip 53,127） |
| Chromium d / e HTML | 419,036 / 419,014 | 419,031 / 419,009 |
| WebKit d / e HTML | 419,029 / 419,008 | 419,024 / 419,003 |
| Chromium td / te HTML | 419,658 / 419,717 | 419,649 / 419,709 |
| WebKit td / te HTML | 419,649 / 419,711 | 419,649 / 419,706 |
| Chromium / WebKit 长文档 HTML | 862,244 / 864,721 | 862,239 / 864,716 |

d/e 每份再次导出的 bytes 均与对应原文件相等，固定脚本/CSS 逐字相同；td/te 因随机保护层压缩可能有少量体积差异。环境为 Bun 1.4.2、Playwright 1.63.0；安装的浏览器清单为 Chromium 153.0.8010.12 revision 1243、WebKit 26.6 revision 2359（Linux）。WebKit 的 Playwright offline 开关会拒绝简单静态 file 导航，所以正式测试统一使用 HTTP(S) 全拦截拒绝；浏览器安全策略未禁用。

风险 / blocker：无本项 blocker。时间胶囊仍依赖 drand，测试只固定其公开 info/beacon 验证真实密码学，没有访问公网确认服务实时可用性。未保证所有浏览器、邮件内置预览器或浏览器外系统附件策略；用户文档说明了下载后用浏览器打开。全部原验收保留，队列最终集成状态由协调器报告，未部署。
