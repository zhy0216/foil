difficulty: hard
agent: inherit

# 文件分享 payload 与传输边界

阅读 `../../plan.md`，优先复用现有密码学与解码预算。一个独立 worktree、一个最终 commit。

## T1 · 为文件增加有界编解码入口

- 要做什么：在 `src/lib/url-codec.ts` 提取 URL/file 共用流程，增加 `encodeHtmlPayload(state, options)` 与 `decodeHtmlPayload(payload, password?)`。继续使用现有四个 scheme 前缀和 gzip/AES/tlock 次序，解码返回现有 `DecodeResult`。`encodeUrl`、`decodeUrl`、`openTimeCapsule` 公开接口和旧 wire 兼容性不变。
- 要做什么：文件 transport 有固定最大编码字符数，按现有层字节限制和 AES 开销推导，在 base64 分配/KDF/解压前验证；继续执行 4 MiB 单层、8 MiB 累计和文档 schema/评论数量边界。URL 路径保留 256 KiB，不允许用全局放宽或无限制可配置入口绕过。
- 预计修改文件：`src/lib/url-codec.ts`、`src/lib/url-codec.test.ts`；如抽取共用核心，可新增 `src/lib/share-codec.ts`，并保持已有导出兼容。
- 验收条件：普通、密码、td、te 四种文件 payload 都能正确解码/解锁；密码错误后可重试、密码始终外层、过去日期拒绝；超出 URL 上限但在文件预算内的文档可用文件入口往返，URL 入口仍报原长度错误。
- 验收条件：损坏编码、gzip、envelope、超限字符串/解压/累计预算仍失败，拒绝发生在昂贵工作之前；不新增任何明文 fallback，不改写 PBKDF2 参数或 quicknet 信息。
- 测试要求：扩展现有 codec 测试，时间行为用现有 fixture 与 mocks，不依赖公网。保留原有 URL 边界及四模式回归。
- 前置依赖：无。

## T2 · 文件内嵌数据格式

- 要做什么：新增 `src/lib/html-share-format.ts` 定义并校验 `{ format: 'foil-share', version: 1, payload, shareBaseUrl? }`，验证未知输入、支持的版本和 bounded payload。`shareBaseUrl` 仅接受无凭据的 HTTP(S) 来源路径，剥除/拒绝 query 与 fragment；不能容忍 javascript/file/null base。
- 要做什么：格式之外不放 DocState/title/password/作者偏好；title 留在保护层内。该模块只处理格式与边界，不负责 DOM、HTML 序列化、下载或 UI，便于 03 消费。
- 预计修改文件：新增 `src/lib/html-share-format.ts`、`src/lib/html-share-format.test.ts`。
- 验收条件：合法版本/格式可读，未知版本、空/错误 payload、不合法 scheme、超长数据、危险分享 base 有稳定错误；没有从任意全局或本地库补正文的 fallback。
- 前置依赖：本文件 T1。

## 本任务验证与交接

- 运行 `bun run typecheck`、`bun run test`、`bun run build`，记录结果和新增 API；本任务不要求提前编写 05 的完整浏览器下载用例。
- 所有权仅限 codec、html-share-format 及对应测试。可与 02 并行；不修改 App、组件、样式、Vite 或 ShareModal。
- 交接给 03：实际文件数据类型、入口名称、字符/字节限制、错误语义与受保护模式的处理方式。

## 完成记录 · 2026-09-08

状态：全部验收完成，等待协调器集成。仅修改本任务的 codec、文件格式及测试，以及本 todo 和队列 README 的本项记录；未部署、未修改依赖。

### 03 / 04 可直接使用的 API

从 `src/lib/url-codec.ts` 导入：

```ts
interface ShareOptions {
  password?: string | null;
  unlockMs?: number | null;
}

encodeHtmlPayload(state: DocState, opts?: ShareOptions): Promise<string>;
decodeHtmlPayload(payload: string, password?: string): Promise<DecodeResult>;
validateHtmlPayload(payload: unknown): asserts payload is string;
HTML_PAYLOAD_MAX_CHARS; // 5_592_468，包含 # 和 scheme
```

- URL 和文件共用内部 `encodeShare` / `decodeShare`，transport 只能在两个固定入口中选择，没有可配置的无限制入口。既有 `encodeUrl`、`decodeUrl`、`openTimeCapsule`、`SHARE_LIMITS`、`DecodeResult` 和旧 wire 兼容性保留。
- 文件必须带 `#d=`、`#e=`、`#td=` 或 `#te=`。`decodeHtmlPayload('')` / `decodeHtmlPayload('#')` 返回错误；URL 入口保留空 fragment 返回 `{}` 和省略 `#` 的历史行为。双方仍接受正确的 legacy base64 padding；原先可识别的 raw JSON 兼容路径未增加 fallback。
- `encodeHtmlPayload` 失败时 reject，不产生部分 payload。`decodeHtmlPayload` 返回既有 `DecodeResult`：普通文档为 `{ state }`；需要密码为 `{ encrypted: 'password' | 'time-password' }`；密码正确后或 td 为 `{ timeCapsule }`；失败只有 `{ error }`。
- 密码始终在最外层。将同一 payload 再传入 `decodeHtmlPayload(payload, correctPassword)` 即可在错误密码后重试。td / te 必须把解出的 envelope 交给原 `openTimeCapsule`；其 `NotYetReadyError`、`NoEndpointError` 类型及重试契约保持。普通/密码不调用 drand，时间胶囊的网络契约保持。
- 不需要时间保护时省略 `unlockMs`；显式 `null` / `undefined`、无效值、过去时间，以及异步封存期间过期的时间都会拒绝。文档 title、正文和评论均留在 payload 内。

从 `src/lib/html-share-format.ts` 导入：

```ts
interface HtmlShareData {
  format: 'foil-share';
  version: 1;
  payload: string;
  shareBaseUrl?: string;
}

parseHtmlShareData(value: unknown): HtmlShareData;
normalizeShareBaseUrl(value: unknown): string;
SHARE_BASE_URL_MAX_CHARS; // 2048
HtmlShareFormatError; // 导出的 Error 子类
```

- `parseHtmlShareData` 消费已解析的未知 JSON 值，返回只包含上述字段的新对象。format / version / payload 必须是自有字段；额外字段（含 state、md、title、password、author、settings）被拒绝。没有浏览器全局、文档库或 storage 的正文 fallback。
- `shareBaseUrl` 可省略；如显式提供，则必须是无凭据的绝对 HTTP(S) URL。返回规范化的 origin + pathname，移除 query / fragment；拒绝 javascript、file、blob、data、ftp、null、相对 URL、凭据、控制字符和反斜杠。输入及规范化输出均最多 2048 字符；显式 null / undefined 也拒绝。
- `validateHtmlPayload` / 格式解析只校验 scheme、canonical base64、传输长度和可提前推导的字节预算，不分配 base64 解码字节，不做解密、解压或网络请求。其成功不表示密码、gzip、文档/envelope schema 已通过；后续仍须调用 decode/open。
- 本模块不解析 HTML 或 JSON 文本，不做 DOM、HTML 转义、下载、UI 或任何持久化；内嵌数据块的文本读取/解析边界和安全序列化由 03 实现。

### 边界与错误语义

- URL 上限仍为 262,144 字符（256 KiB）。文件固定字符上限为 `4 + ceil((4_194_304 + 44) / 3) * 4 = 5_592_468`，44 字节来自 16 字节 salt、12 字节 IV、16 字节 GCM tag。
- 字符检查先于 base64 解码分配；随后按实际 scheme 检查预计解码字节数。单层继续最多 4,194,304 字节（4 MiB），AES wire 允许额外 44 字节；每个 decode/open 操作累计最多 8,388,608 字节（8 MiB），包含已有压缩/解密层计数。密码层仅 wire + 明文就超预算时，在提示密码、分配字节和 KDF 前拒绝。
- 上述字符上限是传输天花板，不承诺所有低于该长度的内容都可解码。例：密码 raw JSON 层在仅计 wire + 明文时最多 4,194,282 字节，进一步 gzip 解压出的 JSON 仍需计入总预算。
- gzip 流逐块检查并沿用取消/release 逻辑；capsule open 独立重验 envelope 并计入其序列化字节。UTF-8、JSON escaping、schema、1000 个线程 / 每线程 200 条回复等限制保持。
- 新增稳定消息：`Invalid HTML share payload`、`HTML share payload exceeds the character limit`、`Could not build HTML share payload`、`Could not read HTML share payload`。
- 格式解析抛 `HtmlShareFormatError`，消息为 `Invalid HTML share data`、`Unsupported HTML share format`、`Unsupported HTML share version`、`Invalid HTML share base URL`，或复用 payload 校验的固定消息。
- 原有 `Unsupported share scheme`、`Invalid share encoding`、`Invalid encrypted share data`、`Incorrect password or damaged share link`、gzip/envelope/schema/4 MiB/total budget 等错误继续复用。错误不包含输入正文或密码；没有明文降级。PBKDF2-SHA256 600,000 轮、AES-GCM-256、quicknet 参数和延迟加载入口未改变。

### 逐条验收证据

| 验收 | 证据 |
| --- | --- |
| 四模式文件解码/解锁且与 URL wire 兼容 | `url-codec.test.ts` 的 `HTML payload transport` 四模式矩阵，双向 URL/file 互解，含 Unicode title、正文、锚点、线程和回复 |
| 密码重试、密码外层、时间保护不降级 | e/te 缺密码、错误密码、篡改、移除 encrypted scheme、正确密码重试；te 的 tlock 输入确认是 gzip 文档；td/te 保留未到期/网络错误并可重试；无效/过去/异步过期时间在相应阶段拒绝 |
| 超出 URL 上限的文件仍可用 | 四模式确定性低压缩率文档生成的 payload 超过 256 KiB，文件往返成功，URL encode/decode 保留原长度错误，后者在 base64 分配/KDF 前拒绝 |
| 文件与原 URL 字节/结构边界 | 四模式最大 raw layer/pair、恰好 4 MiB JSON、边界线程/回复成功；+1 byte、gzip 膨胀、错误 schema、评论超量失败；e/te 累计解压和 td/te open 累计预算失败 |
| 损坏/超限数据及时失败 | base64、encrypted 最小长度、未知 scheme、超长输入由 atob/KDF/解压 spy 证明提前拒绝；损坏 CRC/截断 gzip、错误 envelope、缺失 gzip/Web Crypto 均失败；保留原流取消和旧 URL 边界测试 |
| 版本数据及安全来源路径 | `html-share-format.test.ts` 86 项：版本/格式/未知输入、自有字段、额外敏感字段、payload 编码/大小、HTTP(S) 路径规范化、危险 base 与双向 2048 字符限制；格式校验无解码/KDF/解压/网络；密码数据序列化不含明文标记 |
| 原密码学与浏览器回归 | 全套原 codec / timecapsule 真实固定 quicknet fixture / 延迟加载测试通过；现有 Chromium/WebKit 分享与持久化/CSP 回归通过，无公网 drand 请求 |

### 实际校验

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | 通过，安装 162 packages，lockfile 与依赖声明无改动 |
| `bunx vitest run src/lib/url-codec.test.ts src/lib/html-share-format.test.ts` | 首次定向验证 231 项通过；后续拆分测试，最终 239 项由下面完整 test 覆盖 |
| `bun run typecheck` | 最终通过 |
| `bun run test` | 最终 12 个文件、514 项全部通过（33.59s） |
| `bun run build` | 通过；最终 e2e 命令再次执行同一生产构建并通过（3.04s），154 modules |
| `bunx playwright test --workers=2` | 首次 Chromium/WebKit 共 12 项通过 |
| `bun run test:e2e --workers=2` | 最终源码重建后，Chromium/WebKit 共 12 项通过（31.2s） |
| `git diff --check` | 通过 |

首次完整 test 有一个新增 te 用例因捆绑多次真实 KDF 和大文档检查而超过默认 5 秒，其余 505 项通过。已按验收点拆成独立测试并完整重跑通过；未放宽全局 timeout、未跳过断言。

最终常规构建：主 JS 219.67 kB（gzip 71.04 kB）、Buffer chunk 27.96 kB（gzip 8.56 kB）、延迟 timecapsule-crypto 148.74 kB（gzip 53.13 kB）、CSS 28.97 kB（gzip 6.05 kB）。未生成独立 HTML 运行程序，本项不提前实现 03/05 的下载和 `file://` 完整浏览器验收。

风险 / blocker：本项无 blocker。文件字符上限仍受内部字节/结构预算约束，03/04 必须展示实际 encode/decode 错误；时间胶囊继续需要 drand，普通/密码文件的最终浏览器离线交付由 03/05 验证。构建和 e2e 仅有环境 `NO_COLOR` / `FORCE_COLOR` 提示。
