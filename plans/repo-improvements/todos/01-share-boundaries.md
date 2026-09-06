difficulty: hard
agent: inherit

# 分享协议与数据边界

对应发现：F01–F05、F31。依赖：无。范围：codec、共享校验模块及其测试；不修改 App、timecapsule 网络实现或 package/lock。

## T1 · 文档与 envelope 字段校验

- 要做什么：替换 `decodeUrl` / `openTimeCapsule` 的 JSON 强转，新增无重依赖的共享校验模块供本地存储复用。逐层检查 DocState、thread、reply、ID 唯一性、字符串及有限时间戳；合法数据保留正文与 ID，坏数据明确失败，不静默截断。envelope 检查版本、age、正安全整数 round、有效日期及 round 对应时间；展示元数据不替代 tlock 验证。
- 预计修改文件：`src/lib/url-codec.ts`、`src/lib/url-codec.test.ts`；新增 `src/lib/doc-schema.ts`、`src/lib/doc-schema.test.ts`（名称可在同范围调整）。保持 `src/types.ts` 的公共文档类型兼容。
- 验收：合法中文/emoji、多评论/回复不变；null、数组、对象型 title/body、非法/重复 ID、非有限时间、负数/小数 round、不一致 unlockMs 被稳定拒绝。共享模块可单独验证本地数据形状，不强加分享体积上限。
- 前置依赖：无。

## T2 · 全层有界解码与兼容策略

- 要做什么：fragment 上限 256 KiB 字符，任一解压结果上限 4 MiB，线程 1000、每线程回复 200，另有总字节预算。base64/密文长度在派生密钥之前检查；流式解压超限取消 reader 并释放资源。覆盖普通正文、密码明文、胶囊 envelope 和 tlock 解封结果。识别 gzip/raw JSON，不能把超限或任意损坏 gzip 吞掉后回退；缺 API 返回能力错误并保留可判定的合法 legacy raw 支持。
- 预计修改文件：`src/lib/url-codec.ts`、`src/lib/url-codec.test.ts`，T1 的共享模块。
- 验收：正常边界通过，边界外明确失败；小 gzip 膨胀到超限时尽早停止；乱码 base64、截断 AES、损坏 gzip、未知版本/方案都可控失败；四种方案均走相同边界。测试使用有限大小合成数据，不能真的制造 GB 级 OOM。错误不包含密码/正文/完整载荷。
- 前置依赖：本文件 T1。

## T3 · 生成端兑现协议约束

- 要做什么：生成端使用相同大小/字段上限；显式提供的无效、非有限或过期 unlockMs 应报错，不能生成 `#d=` / `#e=`。保持 AES-GCM/PBKDF2 600k、salt/IV 长度和现有外层 AES 的格式。
- 预计修改文件：`src/lib/url-codec.ts`、`src/lib/url-codec.test.ts`。
- 验收：四种方案 round-trip、错密码、篡改/截断、时间元数据和超限矩阵通过；tlock 用 mock 验证编解码边界，网络可靠性由 07 负责。合法现有 fixtures 仍能打开；不能生成当前接收端必定拒绝的链接。
- 前置依赖：本文件 T1、T2。

验证：`bun run typecheck`、`bun run test`、`bun run build`。新增测试仅使用现有 Vitest 能力；package/lock 由 09 管理。
