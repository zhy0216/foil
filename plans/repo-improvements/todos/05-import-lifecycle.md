difficulty: hard
agent: inherit

# 导入、取消和共享只读边界

对应发现：F11–F13、F17、F21、F31。依赖 `03-editor-input.md`、`04-local-persistence.md`。这些任务合并后再改 App；不改 codec、drand 网络、ShareModal 或工具链配置。

## T1 · 幂等初始化与损坏链接恢复

- 要做什么：明确本地/共享/待密码/待胶囊/加载失败状态；一次捕获 fragment 后再清地址栏，StrictMode 重放使用相同加载意图，并使过期异步结果失效。去除 fragment 时保留无关 pathname/query。错误或未知分享进入有效本地文档或有恢复操作的错误状态，不能留下无 currentId 的可编辑 saved 空页。合理复用已有本地库，避免无意创建重复 sample。
- 预计修改文件：`src/App.tsx`；新增 App 导入回归或小型导入状态 helper/hook 及其测试。
- 验收：普通加载、合法/错误/未知 hash、四种 scheme、StrictMode setup/cleanup 重放都得到一致结果；共享加载不创建并绑定可写文档。一次加载失败不会删除本地数据，取消可回到有效本地文档。
- 前置依赖：03、04。

## T2 · 解锁请求的世代与取消

- 要做什么：密码请求忙碌期间防重复提交；取消/切换/卸载时使所有旧密码和 tlock 结果失效。TimeCapsuleUnlock 的重试计时器可清理，取消后不再调度下一次请求，已在途请求的结果也不能回调覆盖 App。成功解密显式进入只读共享状态并清除本地写入绑定。本地时钟到点只表示可以尝试解密，不能宣称签名已验证发布。
- 预计修改文件：`src/App.tsx`、`src/components/PasswordPromptModal.tsx`、`src/components/TimeCapsuleUnlock.tsx`；新增对应组件测试。
- 验收：用 deferred promises/fake timers 复现“解锁 → 取消 → 回本地 → 旧请求成功”，本地内容和 currentId 不变；重复提交不会并发应用结果。取消后重试次数不增加；已解封文案只在成功后出现。错误保留可重试/返回路径，不暴露载荷。
- 前置依赖：本文件 T1。

## T3 · 只读修改门禁与文档切换清理

- 要做什么：所有新评论/回复/删除、标题/正文快捷键和 toolbar 修改都验证 readOnly。共享预览提供明确 fork 操作，fork 成功后再编辑；Thread 接受只读能力信息并隐藏/禁用修改操作。App toolbar 调用 03 提供的 Markdown 操作，取代另走 execCommand。切换/导入/fork 后清 composer、旧 selection、active thread 和不属于新文档的瞬时状态。
- 预计修改文件：`src/App.tsx`、`src/components/Thread.tsx` 及 App/Thread 测试；03 的 Editor handle 只消费，不重写其实现。
- 验收：共享页面的鼠标、快捷键、评论按钮均不会改文档或写本地；明确 fork 后可写且分配新 ID。旧文档的 composer 不会在新文档提交；取消解锁后的正常本地编辑仍保存。toolbar 与键盘得到同一 Markdown/选区结果。
- 前置依赖：本文件 T1、T2。

验证：`bun run typecheck`、`bun run test`、`bun run build`。布局和可访问性由 06/10 接续处理，不扩大为路由框架或全局状态库迁移。
