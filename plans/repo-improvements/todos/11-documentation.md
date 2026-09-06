difficulty: easy
agent: inherit

# 实现、隐私和开发文档一致

对应发现：F28–F30。依赖 `01-share-boundaries.md`、`02-markdown-fidelity.md`、`03-editor-input.md`、`04-local-persistence.md`、`05-import-lifecycle.md`、`06-comment-layout.md`、`07-timecapsule-network.md`、`08-share-generation.md`、`09-toolchain-ci.md`、`10-accessible-dialogs.md`。以合并后的实现为准，不按本次对话推测最终行为。

## T1 · 校准分享与安全声明

- 要做什么：README、CLAUDE、Help 统一四种 scheme、单层外部 AES、PBKDF2 参数与最终网络行为。明确 `#te=` 前缀能透露胶囊类型，密码隐藏的是内容/round 等受保护 envelope；区分正文不上传和 drand 能看到请求元数据。说明 meta frame-ancestors 无效，需响应头才能提供防嵌入保证；不声称当前静态托管已配置该头。
- 预计修改文件：`README.md`、`CLAUDE.md`、`src/components/HelpModal.tsx`。
- 验收：方案表、解释、代码注释/最终实现无矛盾；没有旧 `plaintext → AES → tlock → AES` 说法，没有不符合实现的完全离线或隐藏前缀承诺。保留 URL 历史/剪贴板、丢失 drand/本地存储等实际边界；不把实现细节堆进产品操作流程。
- 前置依赖：01–10。

## T2 · 开发部署条件与历史审计复核

- 要做什么：更新测试命令、冻结安装/审计源、运行时版本、浏览器回归入口与分享上限。说明固定 `/foil/` base、自托管修改 base 的命令，以及 HTTP(S)、Web Crypto/压缩能力和胶囊网络要求。对 `docs/security-audit.md` 加有日期的复核区，把旧 F 项标明已修/未修/原结论需纠正，保留原审计历史，不伪造已做线上渗透或响应头检查。
- 预计修改文件：`README.md`、`CLAUDE.md`、`docs/security-audit.md`；必要时新增本计划内文档复核记录。
- 验收：命令与 package scripts 实际一致，旧 F03/部分 F07 等已过期项不会继续被当成当前未修漏洞；frame-ancestors、样式/转义上下文说明准确。R01–R06 明确仍是 roadmap，不宣传为此次完成。
- 前置依赖：本文件 T1、01–10。

验证：定点文本检索检查旧错误声明，`bun run typecheck`、`bun run test`、`bun run build`；本任务不为纯文案新增镜像实现的测试。引用技术标准时链接官方来源。
