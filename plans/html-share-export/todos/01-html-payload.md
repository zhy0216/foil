difficulty: hard
agent: inherit

# 文件分享 payload 与传输边界

阅读 `../plan.md`，优先复用现有密码学与解码预算。一个独立 worktree、一个最终 commit。

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
