difficulty: medium
agent: inherit

# Share 导出与文件再次分享

阅读 `../plan.md`，基于已合入的 03 API 实现用户可点击的出口。一个独立 worktree、一个最终 commit。

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
