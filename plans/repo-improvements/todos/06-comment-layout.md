difficulty: hard
agent: inherit

# 评论定位与自适应布局

对应发现：F01 的 selector 边界、F18、F19、F31。依赖 `05-import-lifecycle.md`（传递包含 03/04）。范围是评论定位、App/Editor/Thread 和相关样式。

## T1 · 安全且确定的锚点定位

- 要做什么：从现有 before+quote+after 规则提取可测试定位逻辑；有唯一可靠匹配时才定位，多个候选无法消歧时不回退到第一个错误位置。保留有唯一 quote 且旧链接没有上下文的兼容。App 查询 anchor ID 使用安全 DOM 查找或 CSS.escape，不把外部字符串直接拼 selector。位置 map 使用无原型对象或 Map，避免特殊键干扰。
- 预计修改文件：`src/components/Editor.tsx`、`src/App.tsx`、`src/lib/editor-dom.ts`；可新增 `src/lib/comment-anchors.ts` 及测试。
- 验收：重复短语、上下文编辑/删除、跨行、重叠评论、特殊字符 ID 和 `__proto__` 一类键都不会抛错或挂错；定位不改变正文。03 的输入后高亮/选区回归仍通过。
- 前置依赖：05。

## T2 · 无法定位的评论仍可访问

- 要做什么：为无法定位的 thread 显示清晰的未定位区域或列表入口，不再被 stackedThreads 过滤后完全消失；支持查看、允许编辑时回复/删除，遵守 05 的只读边界。桌面与移动端都能打开这些评论。
- 预计修改文件：`src/App.tsx`、`src/components/Thread.tsx`、`src/styles/styles.css` 及相关测试。
- 验收：删掉引用文本后评论仍可找到，恢复唯一匹配后能回到锚点；共享只读中不能通过未定位列表改评论；移动端可达且没有只在宽屏显示的唯一入口。
- 前置依赖：本文件 T1。

## T3 · 根据实际高度排列卡片

- 要做什么：替换固定 96px 的堆叠假设，根据实际 thread 高度与 anchor 位置排列，字体/宽度/窗口/回复内容变化时重算。用 ResizeObserver 或同等机制合并更新并清理，避免测量/写入死循环。保留移动 sheet 的布局。
- 预计修改文件：`src/App.tsx`、`src/components/Thread.tsx`、`src/styles/styles.css`；布局纯函数/组件测试。
- 验收：长评论、多回复、字体/字号/密度/宽度切换和窗口 resize 后不重叠；稳定输入不会产生无限 render/observer；卸载清监听。JSDOM 测量使用有意义 mock，真实布局由 12 验证。
- 前置依赖：本文件 T1、T2。

验证：`bun run typecheck`、`bun run test`、`bun run build`。大规模编辑器性能改造属于 R01，不加新评论持久化格式或自动重写历史 ID。
