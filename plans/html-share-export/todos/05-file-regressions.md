difficulty: medium
agent: inherit

# 实际文件浏览器验收与使用文档

阅读 `../plan.md`，在 04 合入后验证完整用户路径。一个独立 worktree、一个最终 commit；发现实现问题先交由协调器修复依赖实现，再完成验收，不跳过失败场景。

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
