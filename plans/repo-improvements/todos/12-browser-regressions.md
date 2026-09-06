difficulty: hard
agent: inherit

# Chromium / WebKit 集成回归

对应发现：F31，以及前述修复的跨模块验收。依赖 `01-share-boundaries.md`、`02-markdown-fidelity.md`、`03-editor-input.md`、`04-local-persistence.md`、`05-import-lifecycle.md`、`06-comment-layout.md`、`07-timecapsule-network.md`、`08-share-generation.md`、`09-toolchain-ci.md`、`10-accessible-dialogs.md`。可与 11 并行；基于 09 已有 harness，不重复改 package/lock。

## T1 · 正文、保存、评论与只读行为

- 要做什么：扩展 `tests/e2e/`，在 Chromium/WebKit 用隔离 context、真实 DOM/键盘验证本地创建→输入→隐藏/切换→重开；包含 plan 的空白保真样本、普通/列表 Enter、跨行和反向选区、Shift+Enter、纯文本 paste/drop、可复现的 undo/redo。评论经历正文编辑仍定位，长回复/resize 后不重叠，未定位评论仍可访问；共享预览不可修改，fork 后独立保存。
- 预计修改文件：新增 `tests/e2e/editor.spec.ts`、`tests/e2e/documents.spec.ts`、`tests/e2e/comments.spec.ts` 及测试 fixture/helper（名称可按 09 结构调整）。
- 验收：两浏览器项目全部通过，无任意长 sleep，使用可观察状态等待；选择区和正文用实际 DOM/保存结果断言。模拟 storage 失败时不会出现 saved 假状态或正文丢失。记录真实 OS IME/剪贴板 API 未能自动化的范围与人工步骤，不用合成事件宣称覆盖真实输入法。
- 前置依赖：01–10。

## T2 · 分享保护、异步取消与可访问性

- 要做什么：覆盖四种 scheme、合法 legacy fixture、错密码/坏数据/超限、坏 hash 恢复、StrictMode 初始化回归。注入可控延迟/网络失败验证取消后旧解锁不覆盖本地；旧普通 URL 在新受保护生成失败后不可复制；timecapsule 的超时/回退与显示状态一致。弹层 Tab/Escape/焦点恢复、嵌套 Help、菜单/toolbar 键盘和移动抽屉验证。
- 预计修改文件：新增 `tests/e2e/sharing.spec.ts`、`tests/e2e/dialogs.spec.ts` 与隔离 fixture/helper；必要时扩展已有 App/codec 测试，不改生产代码加入仅供测试的后门。
- 验收：测试不依赖真实 drand，不发送真实文档/密码到网络；Chromium/WebKit 行为符合当前选项和只读边界，CSP 不被测试配置禁用。网络/crypto 无法在浏览器可靠注入的边界用组件 deferred/mock 回归补足，并明确层级。
- 前置依赖：本文件 T1、01–10。

## T3 · 最终验证与证据

- 要做什么：运行仓库完整检查和浏览器矩阵，逐项对照非 roadmap 发现。发现真实实现回归时交回对应任务修复再集成，不把失败改成 skip 或降低断言。生成一份简洁最终验证记录，列命令、浏览器版本、通过/失败、未自动化限制及仍在 roadmap 的项目。
- 预计修改文件：`plans/repo-improvements/verification.md`（新增），本任务测试文件；不修改 11 的 README/Help/历史审计。
- 验收：`bun run typecheck`、`bun run test`、`bun run build`、`bun run test:e2e`、官方源 audit 与 prod audit 均有最终结果；报告不把测试数量当覆盖率、不把 mocked tlock 当真实线上可用性验证。无其他非 roadmap 必需工作遗留才可结束队列。
- 前置依赖：本文件 T1、T2。

本任务一个最终 commit；如果所需业务修复超出测试范围，由协调器重开对应任务处理，保持每个实现任务的职责与证据清晰。
