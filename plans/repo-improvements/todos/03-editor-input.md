difficulty: hard
agent: inherit

# 编辑器输入、选区与高亮生命周期

对应发现：F08–F10、F31。依赖 `02-markdown-fidelity.md`。范围为 Editor 与 DOM helper；新增 handle 方法供 05 使用，原方法保持兼容，不改 App。

## T1 · 稳定 DOM 与 Markdown 坐标映射

- 要做什么：支持 text、元素子节点边界和 root 边界的选区读写，处理 `.ln`、原生 div/br、空行及 ZWSP。读取选区两端时尽量直接遍历 Range，不在 selectionchange 中反复改变全局选区；同时校验两端都在 editor 内。
- 预计修改文件：`src/lib/editor-dom.ts`；新增 `src/lib/editor-dom.test.ts`。
- 验收：`**abc**` 的 block offset 0 得到 0；`first<br>second` 保留换行，无 `.ln` 的原生 block 不丢文字。所有合法字符 offset round-trip，覆盖嵌套 syn、高亮 span、多行、空行、emoji UTF-16、正向/反向和跨边界选区。明确 CRLF/ZWSP 的归一化契约。
- 前置依赖：02。

## T2 · 统一输入与选区替换

- 要做什么：统一 Markdown 选区替换操作，覆盖普通 Enter、Shift+Enter、列表/quote/task 继续、选区替换与快捷键。paste/drop 阻止浏览器插入任意 HTML，仅使用纯文本并在正确的选区/落点插入；不处理文件为 HTML。IME composition 期间不抢 Enter 或重建 DOM，结束后一次同步。readOnly 的所有编辑入口直接停止。为 App toolbar 增加可调用的相同操作，不移除现有 handle。
- 预计修改文件：`src/components/Editor.tsx`、`src/lib/editor-dom.ts`；新增 `src/components/Editor.test.tsx` 及 helper 测试。
- 验收：带恶意 HTML 的粘贴/drop 只保留 plain text；多行、空行、列表继续/退出、反向选区替换正确，光标不跳末尾。composition 的 Enter 不被劫持，结束后内容只更新一次；只读时快捷键不触发 onChange。常见输入/撤销/重做没有因新事务路径进一步退化，真实浏览器验证由 12 完成。
- 前置依赖：本文件 T1。

## T3 · 每次内容重建后恢复评论高亮

- 要做什么：把高亮刷新绑定到真正的 DOM 重建生命周期，包括输入、prop 替换及 handle 更新，而不只依赖 anchors 数组变化；保存并恢复选区，防止重复包裹与 effect 循环。上下文的歧义策略留给 06，保留可复用的定位入口。
- 预计修改文件：`src/components/Editor.tsx`、Editor/DOM 测试。
- 验收：评论建立后输入一个字符，高亮仍在正确文字，点击仍报告 thread ID；切换内容/active anchor、多行与重叠评论不丢正文/光标，不产生无限 selectionchange 或嵌套高亮增长。
- 前置依赖：本文件 T1、T2。

验证：`bun run typecheck`、`bun run test`、`bun run build`。使用已有 React/Vitest 写组件回归；不要改 package/lock，也不要把 R01 的编辑器整体迁移作为实现前提。
