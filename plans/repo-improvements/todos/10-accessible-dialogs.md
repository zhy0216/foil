difficulty: medium
agent: inherit

# 弹层、控件与键盘可访问性

对应发现：F27、F31。依赖 `06-comment-layout.md`、`08-share-generation.md`。所有相关 App/评论/Share 状态逻辑合并后再统一交互；不改 package/lock 或密码学。

## T1 · 一致的弹层生命周期

- 要做什么：为 Settings、Help、Share、Password、TimeCapsule 与移动评论层统一 dialog 语义、可访问名称、初始焦点、Tab/Shift+Tab 圈定、Escape 和关闭后焦点恢复。背景交互隔离正确处理嵌套弹层，Share 打开 Help 再关闭后应返回 Share，不能关闭底层或把焦点送回页面。密码/胶囊 Escape 复用 05 的安全取消。
- 预计修改文件：`src/components/SettingsModal.tsx`、`HelpModal.tsx`、`ShareModal.tsx`、`PasswordPromptModal.tsx`、`TimeCapsuleUnlock.tsx`、`src/App.tsx`、`src/styles/styles.css`；可新增轻量共用 Dialog/hook 及组件测试。
- 验收：键盘可遍历并关闭所有弹层，关闭后返回触发器或合理回退；嵌套只关闭顶层；无焦点逃逸/陷死，事件与 inert/滚动锁在卸载后恢复。安全取消与分享快照回归仍通过。
- 前置依赖：06、08。

## T2 · 输入名称、菜单和编辑 toolbar

- 要做什么：输入和 textarea 用 label/htmlFor/aria-label 关联，反馈用适当 live region；DocSwitcher 的触发器与菜单项具有一致键盘/ARIA 语义，settings radiogroup、share switch 支持预期键盘操作。toolbar 支持键盘激活，并通过 03/05 的已保存选区执行，不丢失待格式化范围；Editor 具备适当的可编辑文本语义。
- 预计修改文件：`src/components/DocSwitcher.tsx`、`SettingsModal.tsx`、`ShareModal.tsx`、`Composer.tsx`、`Thread.tsx`、`Editor.tsx`、`src/App.tsx` 与样式；相关组件测试。
- 验收：控件不只依赖 placeholder 命名，菜单状态/expanded 与实际开关一致；键盘可完成选择文档、改设置、切分享选项和格式化选区；焦点样式可见。只读预览仍不可通过键盘改内容，移动抽屉也可关闭。
- 前置依赖：本文件 T1。

验证：`bun run typecheck`、`bun run test`、`bun run build`。组件测试检验焦点/键盘行为，12 在真实浏览器复核；不为了无障碍引入新的重 UI 框架或全站视觉改版。
