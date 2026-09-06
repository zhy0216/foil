# Foil 仓库改进方案

## 意图

用户仅调用 `$auto-dev`，没有附加开发需求，因此进入仓库探索模式：基于现有代码、校验结果和可重复的探针，整理当前可以落地的修复与后续路线图，再交给新的 Herdr session 执行。Foil 是 React 18 / TypeScript / Vite 实现的纯静态 Markdown 编辑器；文档保存在本地，分享使用 URL fragment，时间胶囊使用 drand / tlock。此次优先保护正文保真、保存可靠性、分享选项兑现和异步状态边界，其次完善工具链、评论、无障碍和文档。

探索时间：2026-09-06，基线提交 `9057cc4`，分支 `main`。开始及探查结束时工作区均干净。zvec-grep 返回 `INDEX_MISSING`，没有创建索引；以下证据来自精确 `rg` 检索、定点源码读取、已安装依赖和本地运行结果。

## 目标 / 非目标

- 保持原始 Markdown 字符、选区、输入法和评论锚点的一致性。
- 对分享数据与浏览器存储建立显式边界，错误和取消不会变成未保存编辑或覆盖其他文档。
- 分享链接必须对应当前文档与当前保护选项，过期时间或生成错误不能静默降低保护。
- 保留 `#d=` / `#e=` / `#td=` / `#te=` 四种协议及现有合法链接、文档的兼容性；密码仍在 tlock 外层，保持既有密码派生和密码学参数。
- 建立可重复的单元、组件、浏览器及 CI 验证，并修复已报告的工具链漏洞与版本不协调。
- 保持纯静态、无账户、无后端、无遥测的产品形态。以下 roadmap 不进入此次队列；不包含远端推送、发布、部署或更换托管平台。

## 基线校验与探针

| 命令 / 检查 | 实际结果 |
| --- | --- |
| `bun --version` | `1.4.2` |
| `bun run typecheck` | 通过，`tsc --noEmit` |
| `bun run build` | 通过，生产 Vite `5.4.21`，194 modules，构建约 644ms；主要 JS 229.67 kB / gzip 73.86 kB，另有异步 JS chunks |
| `bun run test` | 2 个文件、18 个测试通过；仅覆盖 `markdown` 与 `url-codec` 的部分路径 |
| `bun audit` | 失败：`POST https://registry.npmmirror.com/-/npm/v1/security/advisories/bulk - 404` |
| `npm_config_registry=https://registry.npmjs.org bun audit` | 完成，报告 25 条漏洞记录：11 high、11 moderate、3 low；不是 25 个包，也不是生产站点已被利用的证据 |
| `npm_config_registry=https://registry.npmjs.org bun audit --prod` | 通过：`No vulnerabilities found (checked 37 packages)`；仅代表此次已知漏洞库的结果 |
| `bun outdated` | 存在 React 19、TypeScript 7、Vite 8、Vitest 5 等新主版本；不以“最新”为理由全部升级 |
| 精确标记检索 | `src/`、README、CLAUDE、docs、工作流未发现 TODO/FIXME/XXX/HACK 标记；既有问题集中记录在 `docs/security-audit.md` |
| 常见密钥格式检索 | 已跟踪源码/配置未匹配私钥头、AWS access key、GitHub token、常见长 API key 模式；不等于完整密钥审计 |
| lint / format | `package.json` 没有对应脚本，仓库也没有独立配置；记录为 roadmap，不凭空把未运行命令记为通过 |

测试阶段原始警告：

```text
[vite] warning: `esbuild` option was specified by "vite:react-babel" plugin. This option is deprecated, please use `oxc` instead.
[vite] warning: `optimizeDeps.esbuildOptions` option was specified by "vite:react-babel" plugin. This option is deprecated, please use `optimizeDeps.rolldownOptions` instead.
Both esbuild and oxc options were set. oxc options will be used and esbuild options will be ignored. The following esbuild options were set: `{ jsx: 'automatic', jsxImportSource: undefined }`
```

已安装依赖元数据确认：根 Vite `5.4.21`，Vitest `4.1.7` 需要 Vite `^6 || ^7 || ^8`，其锁文件中另有 Vite `8.0.14`；React 插件 `4.7.0` 的 peer 范围只到 Vite 7。审计涉及 `@babel/core`、`browserslist`、`esbuild`、`nanoid`、`postcss`、`undici`、两套 `vite`，均由开发依赖路径引入。执行时重查 advisory 与版本范围，不用忽略规则掩盖可修复条目。

通过 Bun + JSDOM 直接调用现有 `renderDecorated` / `getMarkdown` / `getCharOffset`，未修改源码，复现：

| 输入 / DOM 情形 | 当前输出 | 应保持的结果 |
| --- | --- | --- |
| `#  heading` | `# heading` | 原始双空格 |
| `-   item` | `- item` | 原始三个空格 |
| `1.  item` | `1. item` | 原始双空格 |
| `>quote` | `> quote` | 不凭空添加空格 |
| `\t  ` | 空串 | 原始 tab 和空格 |
| `-\t[x]\titem` | `- [x] item` | 原始 tab |
| `**abc**` 的 `.ln` 元素自身 offset 0 | 字符 offset 7 | 0 |
| `<div class="ln">first<br>second</div>` | `firstsecond` | `first\nsecond` |
| `<div>new text</div>` | 空串 | `new text` |

最后两项证明 DOM 读取器不接纳这些合法浏览器编辑形态，不能据此断言每个浏览器的 Enter 都产生相同 DOM；真实输入、粘贴、撤销和输入法还需要浏览器回归。

## 方案

### 分享协议与数据边界

在 `url-codec.ts` 的所有入口做有界解码，新增小型共享文档校验模块（建议 `src/lib/doc-schema.ts`，新文件）。先检查 fragment 长度、scheme、base64url 和密文最小结构，再做密码派生、解密或解压。解压按块统计字节并取消超限流；解密后的 envelope、最终正文都执行同一策略，禁止“解压失败即任意回退”吞掉超限错误。

初始产品上限采用 fragment 256 KiB 字符、任一解压结果 4 MiB、1000 个评论线程、每线程 200 条回复，并以总字节预算兜底。明确区分 8 KB 的分享兼容性提示与接收端安全上限。生成端也遵守相同边界，避免生成自身打不开的链接；不截断正文、不静默丢评论，超过上限应明确拒绝。存储读取复用字段校验，但不因分享大小上限删除用户已有的本地大文档。

校验 `DocState`、嵌套 thread/reply、字符串类型、有限时间戳、ID 唯一性；遇到无效数据返回稳定错误。选择器查询不能直接插入外部 ID，应使用安全查找或正确转义，同时保留合法 ID 的评论关联。时间胶囊 round 必须是正安全整数，时间须有效并与本地 round 数学一致；外层时间是展示元数据，不能替代实际密码学验证。无压缩 API 的旧明文编码兼容策略须明确：识别 gzip 头与已知原始 JSON 形式，不将任意损坏 gzip 当成合法兼容格式。时间胶囊选项一旦明确传入却无效或过期，拒绝生成，而不是退化为普通分享。

### 编辑器与评论

保留“Markdown 为真值、语法标记可见”的架构。renderer 使用捕获到的原始空白；纯空白行只增加必要占位，不丢弃用户字符。DOM 工具统一处理 text / element / root 选区边界、换行与占位字符，所有输入修改使用一致的 Markdown 选区替换操作。

拦截 paste/drop，只取纯文本；覆盖普通 Enter、Shift+Enter、列表继续、跨行选区替换、IME composition 期间不拦截提交键。原生输入的 DOM 归一化必须与这些操作兼容。编辑器每次重建内容后重新定位高亮，并保存/恢复选区，不能只依赖 comments 数组是否变化。imperative handle 提供 toolbar 所需的选区操作，消除 App 中另走一套 `execCommand` 的路径。为 read-only 的所有修改入口加守卫。

评论位置基于实际卡片高度和容器变化计算；尺寸、字体、宽度、正文变化后重新布局。上下文不再唯一匹配时，不能自动挂到另一个同名短语；把无法定位的评论展示为“未定位”，仍能查看和删除，避免悄悄隐藏。切换文档清掉旧选区/草稿/active thread；共享预览只能在明确 fork 后修改评论。

### 本地文档与异步流程

封装可失败的 localStorage/sessionStorage 操作；字段异常与 API 不可用要区分，不覆盖损坏原记录。保存失败保留内存中的正文并显示真实状态，后续可重试；切换、新建、fork 的失败不得伪装成成功。保存逻辑保持一个实现，400ms debounce 在页面隐藏/pagehide、文档切换时尝试刷新，既不保存共享预览，也不因单纯打开文档不断改变排序。浏览器强杀进程无法保证刷盘，应在文档说明。

引入明确的加载/本地编辑/共享预览/密码解锁/胶囊解锁状态与操作世代标识，可按需抽取少量 hook。初始化在 StrictMode effect 重放时仍使用同一个捕获到的 fragment；失败链接回到有效本地文档或可恢复的错误界面，不出现没有 currentId 却标记 saved 的编辑器。任何解锁返回只有仍属当前请求才能应用；取消、切换、卸载使旧结果失效，重试计时器也清理。密码提交进行中避免重复请求。每次成功导入都明确进入共享只读模式，不继承取消后本地文档的写入绑定。

### 时间胶囊与分享生成

保持固定 quicknet 链哈希/公钥和签名验证。为链信息及具体 round 请求设置有限的超时与 endpoint 回退；获取 `/info` 成功不表示该节点后续永远健康。不得通过全局覆盖 fetch 或关闭验证解决问题。客户端缓存失败可恢复，404/未来轮次与离线、损坏密文、验证失败使用明确分类。仅剩本地倒计时不能宣称签名已公开，解密成功后才报告已解封。尽可能把 Buffer polyfill 与加密重依赖一起延迟加载，并用依赖类型替代 `unknown` / `as any`。

ShareModal 的链接结果绑定文档快照、密码、时间选项及请求代次。修改选项、开始生成、失败、关闭时立即废弃旧结果；只有当前请求成功的链接可复制或手动选择。使用短 debounce 减少每个密码字符触发昂贵 PBKDF2；不能把取消标记误称为底层密码学可中断。无效输入必须清掉 busy，打开很久的时间选项在实际生成/复制前复核；错误信息明确且不泄露密码或载荷。

### 工具链、可访问性、文档

修复 Vite / React 插件 / Vitest 的 peer 不匹配，选择经过 advisory 验证的相容版本组合，保留 React 18 与 TypeScript 5，Vitest 优先保持 4.x 的可用修复版本。升级范围以解决漏洞和警告为准，不全量追新。直接声明源码导入的 `buffer`、`drand-client`，让干净安装不依赖传递依赖提升；drand 版本要与 tlock 的实际协议和类型相容。锁文件使用可在 CI 审计的源，不改用户全局 registry；锁定验证过的 Bun/Node 版本。PR 工作流执行类型、测试、构建；既有 Pages 构建也经过同样检查。

补一个最小 Playwright 测试入口和 Chromium/WebKit 项目，关键浏览器回归写在后续独立任务。组件测试尽量使用已有 React/Vitest 能力，测试支持依赖由工具链任务统一管理。测试不访问真实 drand，不把密码学和网络请求发送到外部服务。

主要 dialog 统一命名、focus trap、Escape、焦点恢复和背景交互隔离；输入控件有标签、菜单/单选/开关符合键盘操作。Share 上的 Help 为嵌套弹层，关闭顶层后返回原弹层。移动评论抽屉同样可用键盘关闭；toolbar 的键盘操作不能丢选区。

修正 README、CLAUDE、Help 与旧安全审计中的已过期结论：当前 `#te=` 是单层外部 AES，fragment 前缀本身可透露胶囊类型；`getClient()` 当前在加密时也取 `/info`，不能声称实际实现完全不联网。meta CSP 中的 `frame-ancestors` 不生效，应去掉虚假保护声明，并说明 HTTP 响应头才能提供该保证；不为此改托管平台。文档说明 `/foil/` base、自托管时的配置、HTTP(S) / Web Crypto / 压缩能力要求以及 drand 网络依赖。

## 拆解：完整发现清单

位置行号是基线定位线索，执行时以符号为准。P1 表示此次优先解决，P2 表示可靠性、易用性及维护改进；没有足够证据认定 P0。roadmap 只记录，不进队列。

| ID | 位置 | 问题与证据 / 改进建议 | 优先级 | 难度 | 落点 |
| --- | --- | --- | --- | --- | --- |
| F01 | `url-codec.ts:170–216`、`App.tsx:174–178,345`、`Thread.tsx:52` | JSON 强转 DocState，嵌套评论无校验，外部 ID 直接插入 selector；畸形值可造成渲染/查询异常。加共享 schema 与安全查询。 | P1 | hard | 01、06 |
| F02 | `url-codec.ts:28–60,98,170` | hash、base64、解压无上限；密文未做便宜的最小长度检查。全层有界，覆盖 gzip 膨胀与截断密文。 | P1 | hard | 01 |
| F03 | `url-codec.ts:42–60` | 无压缩 API 和任意解压异常均原样返回，协议兼容与损坏错误混淆。明确 legacy/raw 分支与能力错误。 | P2 | hard | 01 |
| F04 | `url-codec.ts:120–135` | envelope 仅检查 number/string，允许负数/小数/不合理日期和不一致 round；加结构、数值与时间一致性验证。 | P1 | hard | 01 |
| F05 | `url-codec.ts:145`、`ShareModal.tsx:80–100` | 已选 timelock 过期可能走普通分支，memo 不随时间更新。明确拒绝失效选项，生成和复制前复核。 | P1 | medium | 01、08 |
| F06 | `markdown.ts:67–120` | 标题、列表、引用、task 和空白行改变源字符，已复现。原样保留空白并建立全文回读不变量。 | P1 | medium | 02 |
| F07 | `markdown.ts:4–5` | escapeHtml 仅适用于当前文本位置，不保证属性上下文安全。补全引号转义与契约；不把现有文本调用误报成已证实 XSS。 | P2 | easy | 02 |
| F08 | `Editor.tsx:100–218,311–329`、`editor-dom.ts:116` | 无 paste/drop、普通换行归一化；列表 Enter 不替换完整选区，keydown 不检查 composition/readOnly。统一输入事务并做真实浏览器验证。 | P1 | hard | 03 |
| F09 | `editor-dom.ts:6–31`、`Editor.tsx:221–255` | 元素边界 offset 错误已复现，根边界返回 null；selectionchange 为读取坐标反复改选区。补边界映射、减少事件递归与选区丢失。 | P1 | hard | 03 |
| F10 | `Editor.tsx:64–74,262–295` | 每次输入重建 innerHTML 清掉 anchor，但高亮 effect 只依赖 anchors/activeAnchorId。正文更新后主动重建高亮并恢复选区。 | P1 | hard | 03 |
| F11 | `App.tsx:370–443,459–472,605–724`、`Thread.tsx` | readOnly 创建评论只 toast 不 return，回复/删除仍可用，toolbar 另走 DOM 修改。只读门禁覆盖所有路径，明确 fork 后编辑。 | P1 | hard | 05 |
| F12 | `App.tsx:192–233`、`main.tsx` | 错误/未知 hash 可能留下无 currentId 的可编辑空页；StrictMode 重放会在已清 hash 后另建本地文档。幂等初始化及有效恢复路径。 | P1 | hard | 05 |
| F13 | `App.tsx:235–249,495–533`、`TimeCapsuleUnlock.tsx:59–82` | 取消后异步解密仍回调，可能替换当前本地内容；密码可重复提交，重试计时器不清理。使用请求世代、提交锁和取消清理。 | P1 | hard | 05 |
| F14 | `App.tsx:253–288` | 400ms debounce 仅切换/新建时 flush，无离页/隐藏刷新且保存代码重复。单一 pending-save 实现与生命周期处理。 | P1 | hard | 04 |
| F15 | `doc-store.ts`、`App.tsx:88–103,165` | storage 抛错未统一处理，列表枚举在 catch 外，本地对象/设置缺字段校验。失败保留草稿、显示真实状态，不覆盖坏数据。 | P1 | hard | 04 |
| F16 | `App.tsx:165–170,399–420` | 作者名只在 mount 读取，更新后新评论仍用旧默认名；旧 toast timer 会清掉新 toast。改为可更新状态并清理定时器。 | P2 | medium | 04 |
| F17 | `App.tsx:174–188,370–415` | 切换文档没有清 selection/composer，旧评论草稿可落到新文档。文档身份变更时清理瞬时状态。 | P1 | medium | 05 |
| F18 | `Editor.tsx:273–282`、`App.tsx:356–359,679` | 上下文失配后退到第一个相同 quote，可能挂错；无法定位的评论从列表过滤掉。确定性定位并显示未定位评论。 | P1 | hard | 06 |
| F19 | `App.tsx:337–368`、`styles.css:501` | gutter 用固定 96px 估高，评论变长会重叠；字体/宽度/resize 不触发重算。按实测尺寸布局并控制观察循环。 | P2 | hard | 06 |
| F20 | `timecapsule.ts:68–101,121–134`、已安装 `drand-client/util.js` | fetch 无 timeout；只在 /info 失败时切节点，缓存节点后续故障不回退；任意 404 文本误分类未来轮次。有限请求、轮次回退、结构化错误。 | P1 | hard | 07 |
| F21 | `TimeCapsuleUnlock.tsx:98–109` | 本地时间到就显示 Unsealed / signature is public，未核实网络。区分可尝试、解密中、已验证解封。 | P2 | medium | 05 |
| F22 | `timecapsule.ts:14–20,63,115,125` | Buffer 静态进入启动路径且写 global，客户端用 unknown/any；在需要时装载并补具体类型，不变更密码学协议。 | P2 | medium | 07、09 |
| F23 | `ShareModal.tsx:71–78,103–149,284–295` | 新生成/失败未清旧 URL，可能把旧普通链接按当前保护选项复制；无效输入时 busy 可能残留，逐键重复派生。绑定快照/请求并清状态、debounce。 | P1 | medium | 08 |
| F24 | `package.json`、`bun.lock`、`vite.config.ts` | 开发依赖 25 条 advisory，Vite/插件/Vitest peer 不匹配及三条警告。升级兼容组合、重审计并保留通过证据。 | P1 | hard | 09 |
| F25 | `package.json`、`timecapsule.ts:14,69`、`bun.lock` | 直接使用的 buffer/drand-client 未直接声明；mirror audit 404。明确直接依赖、可重复安装和项目级审计源。 | P2 | medium | 09 |
| F26 | `.github/workflows/deploy.yml` | 仅 main push / 手动部署构建，没有 PR 校验且不跑测试；Bun latest 漂移。独立 PR 检查、部署前 gate、锁定验证运行时。 | P1 | medium | 09 |
| F27 | 各 Modal、`DocSwitcher.tsx`、`Composer.tsx`、`Thread.tsx`、`App.tsx:605–724` | 多数弹层缺 dialog 命名/焦点圈/Escape/返回焦点；控件仅 placeholder，menu/radio/switch 与 toolbar 键盘行为不完整。统一可访问交互。 | P2 | medium | 10 |
| F28 | `README.md`、`CLAUDE.md`、`HelpModal.tsx`、`docs/security-audit.md` | README 仍写内外两层 AES，而代码已删除内层；“隐藏胶囊类型”“加密完全离线”、旧审计参数/CSP 项已漂移。逐项按实现校准，不擦除历史。 | P2 | easy | 11 |
| F29 | `vite.config.ts:7`、安全审计 | meta 里的 frame-ancestors 不生效。移除无效指令并准确说明响应头限制，保留其余有效 CSP。 | P2 | medium | 09、11 |
| F30 | `README.md` Deploy、`vite.config.ts:20` | 声称任意静态宿主/USB 都可运行，实际 base 固定 /foil/，浏览器 API 有能力要求，胶囊依赖网络。文档给出 base 配置和运行条件。 | P2 | easy | 11 |
| F31 | 两个现有 `*.test.ts` | 缺 DOM/组件/storage/四种分享完整矩阵/时间胶囊故障和浏览器回归。每个修复配针对性测试，最终补 Chromium/WebKit 集成。 | P1 | hard | 01–10 各自测试、12 |
| R01 | `Editor.tsx:64`、锚点扫描 | 全文 innerHTML 重建、逐评论扫全文/DOM，规模增长成本明显；没有性能实测阈值。先测长文/大量评论，再决定增量渲染或成熟编辑器迁移，包含完整 undo/redo 架构。 | P2 | hard | roadmap |
| R02 | `doc-store.ts:29–44`、`App.tsx:271` | 每次保存刷新列表会解析全部文档；大量库容量受 localStorage 限制。测量后考虑元数据索引、IndexedDB 和备份/导出，不在此次改存储格式。 | P2 | hard | roadmap |
| R03 | `doc-store.ts:57`、`App.tsx:259` | 多标签编辑同一文档可最后写覆盖，删除后另一标签可重建；sessionStorage 只隔离选择，未提供冲突协议。另设 revision/锁/冲突副本设计，避免把简单事件监听宣传成原子协作。 | P2 | hard | roadmap |
| R04 | `App.tsx` 785 行、`styles.css` 1221 行、`package.json` | 状态职责集中、样式文件大、无 lint/format、残留 eslint-disable；此次只抽修复所需逻辑。后续制定 lint 与格式基线，再分模块，避免无关大范围格式变化。 | P2 | hard | roadmap |
| R05 | `package.json`、outdated 输出 | React 19 / TypeScript 7 / Vitest 5 等主版本更新。独立评估收益、迁移指南和兼容性，不与此次缺陷修复绑定。 | P2 | hard | roadmap |
| R06 | `vite.config.ts`、`Editor.tsx`、`doc-store.ts` | Trusted Types、收紧 inline-style、本地加密与备份是后续纵深防御/产品设计。现有明文 localStorage、URL 历史与 drand 元数据可见性属于既有边界，不虚构成此次漏洞。 | P2 | hard | roadmap |

### 执行任务与依赖

| 顺序 | 任务文件 | 主要范围 | 依赖 |
| --- | --- | --- | --- |
| 01 | `01-share-boundaries.md` | URL 有界解码、schema、envelope、有效选项 | 无 |
| 02 | `02-markdown-fidelity.md` | Markdown 原始字符与转义 | 无 |
| 03 | `03-editor-input.md` | DOM 映射、输入事务、高亮生命周期 | 02 |
| 04 | `04-local-persistence.md` | storage 失败、保存生命周期、设置/作者/toast | 01 |
| 05 | `05-import-lifecycle.md` | 初始化、取消/解锁、只读边界、toolbar 接入 | 03、04 |
| 06 | `06-comment-layout.md` | 定位歧义、未定位评论、实际高度布局 | 05 |
| 07 | `07-timecapsule-network.md` | 可信 drand 请求、超时回退、延迟加载 | 无 |
| 08 | `08-share-generation.md` | 分享请求与选项一致性 | 01 |
| 09 | `09-toolchain-ci.md` | 依赖修复、配置、PR/部署检查、浏览器测试入口 | 无 |
| 10 | `10-accessible-dialogs.md` | 弹层/菜单/输入/toolbar 键盘和焦点 | 06、08 |
| 11 | `11-documentation.md` | README / CLAUDE / Help / 历史审计校准 | 01–10 |
| 12 | `12-browser-regressions.md` | Chromium/WebKit 集成回归和验证报告 | 01–10 |

首批可并行 01、02、07、09。02 后可做 03，01 后可并行 04 与 08；05→06→10 因共同修改 App/组件而串行。11 与 12 的文件不相交，可在 01–10 合并后并行。每个任务一个 worktree、一个最终 commit，实际并发上限由执行 skill 管理；声明之外的新文件冲突要先调整调度，不能并行改同一批文件。

## 执行偏好

- `default_agent: codex`，来源：当前 Codex 宿主，上游 auto-dev 已解析。
- 用户未指定全局 model/reasoning，也没有单任务 agent 指定；todos 使用 `agent: inherit`。
- 按共享分发规则：easy → `gpt-6-astra` / `high`；medium → `gpt-6-astra` / `xhigh`；hard → `gpt-6-astra` / `max`。
- 新协调器：Codex，`gpt-6-astra` / `high`，显式 YOLO 参数；协调器启动档不改变逐任务难度映射。
- 计划和队列先提交，再检查 Herdr 环境并启动新的执行 session；当前规划 session 不实现业务代码。

## 校验

每个实现任务完成后运行 `bun run typecheck`、`bun run test`、`bun run build`，并保留各任务的针对性回归。新增测试必须验证用户行为或数据边界，不仅断言实现细节；不要用删测试、降安全参数、跳过 peer 检查来“通过”。

工具链任务增加 `test:e2e` 后，浏览器任务执行 `bun run test:e2e`；至少 Chromium 与 WebKit。覆盖本地新建/输入/隐藏/切换/重开、DOM 保真与选区、IME 的人工可重复步骤、纯文本粘贴/拖放、评论编辑后仍定位、只读/fork、损坏链接恢复、取消异步解锁、分享失败后不可复制旧链接、四种 scheme、时间胶囊失败回退、弹层焦点与 Escape。外部 drand 采用隔离 fixture/mock，不把偶发网络可用性当通过条件。

依赖验证：干净 worktree 中 `bun install --frozen-lockfile`，然后全套检查、`npm_config_registry=https://registry.npmjs.org bun audit` 和 `... bun audit --prod`。需要兼容性升级时重新检查 advisory，记录尚无修复版本的具体原因；不能以此前的 25 条计数代替最终审计。构建检查包含 `/foil/` base、有效 CSP、异步 crypto chunk 可加载。

最终验收：所有非 roadmap 发现均映射到已完成任务，原有合法文档和四类链接仍可读；保存失败不显示 saved；共享预览不会因晚到结果或评论操作写入本地文档；正文回读不变量通过；无工具链 peer/弃用警告；CI 在 PR 和部署构建前执行验证。浏览器无法自动化的 IME/真实剪贴板差异须明确报告手动验证结果或未验证限制。

## 风险与假设

- 链接大小边界是新增产品约束，选择 256 KiB / 4 MiB 是此次明确默认值；须验证现有 fixtures，不对历史文档截断或自动删除。若真实兼容性证据要求调整，记录理由并保证有限上限。
- 原始无压缩编码在旧环境可能存在；不能为了拒绝损坏 gzip 而悄悄删掉所有合法 legacy 链接支持。
- DOM 修改与浏览器 undo/redo、IME 有平台差异。此次验证常见操作不退化，完整编辑器迁移/历史引擎属于 roadmap。
- 存储不可用时可保留内存草稿和显示未保存状态；无法保证浏览器/系统强杀时写入，也不承诺同文档跨标签原子协作。
- tlock round 与 envelope 元数据的校验不能削弱真实签名验证；测试可 mock 网络但不可把关闭验证的配置带入运行时。
- 依赖 advisory 是时间点快照，部分仅在开发服务器或特定平台暴露。漏洞修复与 React/TypeScript 大版本迁移分开评估。
- 不新增索引、后台服务、持久 telemetry 或托管资源；实际执行遵守队列中保存的 agent 选择与任务依赖。

## 外部核验来源

- [Bun audit 官方文档](https://bun.com/docs/pm/cli/audit)：只读审计、生产依赖过滤与 registry 错误的含义；实际结果以上述本地命令为准。
- [Vite 项目安全公告](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)：开发服务器 Windows 路径绕过及修复版本范围；不据此推断静态产物已受影响。
- [CSP Level 3 的 frame-ancestors 规则](https://w3c.github.io/webappsec-csp/#directive-frame-ancestors)：meta 策略中的该指令被忽略，需由响应头交付。
