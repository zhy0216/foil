difficulty: hard
agent: inherit

# 本地保存、失败状态与偏好

状态：已完成（2026-09-06）。

对应发现：F14–F16、F31。依赖 `01-share-boundaries.md`。主要修改 App/doc-store/settings；不修改分享 UI、Editor、codec 或 package。

## T1 · 可失败且不破坏数据的存储层

- 要做什么：统一捕获 localStorage/sessionStorage 的读取、枚举、写入和删除异常，使用 01 的字段校验处理 StoredDoc 和嵌套评论；校验 key/id、时间等本地元数据。损坏条目不作为合法文档渲染，也不自动覆盖/删除原值。设置只接受已知枚举并兼容 foil_theme；对禁用 storage 给出可恢复的内存草稿状态。
- 预计修改文件：`src/lib/doc-store.ts`、`src/App.tsx`、`src/lib/settings-config.ts`；新增 `src/lib/doc-store.test.ts`、设置校验测试及必要的小型 storage helper。
- 验收：SecurityError、QuotaExceededError、JSON 损坏/形状错误、枚举失败都不会白屏；不能显示 saved 或成功创建/fork；用户正文仍在内存可复制/重试。正常文档 key/时间不变；不把分享体积上限用于删改本地大文档。不存在记录与损坏/不可访问记录应区分。
- 前置依赖：01。

## T2 · 单一待保存快照与生命周期刷新

- 要做什么：合并 debounce/flushSave 的重复代码，按文档身份记录最新 dirty 快照。页面隐藏/pagehide、切换/新建前尝试 flush；失败保留当前草稿及可见错误，避免先丢内容再跳走。只在内容实际变化时更新时间/排序，不将只读分享写回本地。定时器、监听器和组件卸载有清理，删除当前文档不被本任务自己的旧 timer 重建。
- 预计修改文件：`src/App.tsx`、`src/lib/doc-store.ts`；必要时新增保存 hook/helper 及针对性测试。
- 验收：使用 fake timers 覆盖 400ms 内编辑后隐藏/切换、连续编辑、失败后重试、快速切换、删除后旧 timer、只读 skip。成功保存才标 saved；纯打开文档不写入/改变 updatedAt。文档 ID 与快照不会串写。
- 前置依赖：本文件 T1。

## T3 · 作者与提示状态一致

- 要做什么：作者名由可更新状态保存，成功提交后新 composer/reply 能读到新默认值；存储偏好失败不阻断正文编辑。toast 更替清掉旧 timeout，卸载时清理。
- 预计修改文件：`src/App.tsx` 及相关测试；只在确有需要时通过现有 props 更新默认值，不抢占 Thread/Composer 的界面重构。
- 验收：更改作者后下一次评论使用新默认名；连续 toast 以后一个为准；storage 写偏好失败不触发未捕获异常。既有设置迁移正常。
- 前置依赖：本文件 T1。

验证：`bun run typecheck`、`bun run test`、`bun run build`。同一文档多标签冲突协议、IndexedDB/大库索引属于 R02/R03，不宣称本次解决浏览器强杀或跨标签原子性。

## 完成与验收证据

- T1：`doc-store.ts` 统一封装 localStorage/sessionStorage 的读取、枚举、写入和删除；返回 unavailable、quota、corrupt、invalid 稳定错误。读取和保存复用 `parseDocState`，检查文档 ID、key 对应关系、嵌套评论、唯一 ID、非负安全整数时间戳和时间顺序。损坏记录只跳过并保留原始值，保存不会覆盖损坏记录；创建失败返回内存文档供继续编辑和重试。
- T1：设置解析只接受已知 theme/font/size/accent/width/density 枚举，逐字段回退并保留 `foil_theme` 兼容读取；设置与作者偏好写入失败显示真实错误，不阻断正文编辑，也不会在打开页面时重写坏记录。
- T2：App 通过 dirty revision 和文档身份捕获单一 400ms 保存快照；隐藏、pagehide、切换和新建前刷新，写入失败阻止切换/新建并保留草稿。旧 timer 在切换和删除时取消，延迟回调不能串写其他文档；只读分享跳过保存。只有成功写入且 storage 状态可用时显示 saved，失败显示 not saved 并保留可见错误。
- T3：作者名改为可更新状态，评论提交后新 composer/thread 使用新默认名；作者偏好失败不影响评论或正文。toast 更替会清除旧 timer，组件卸载清理 timer。
- 新增 `src/App.persistence.test.tsx`、`src/lib/doc-store.test.ts` 与 `src/lib/settings-config.test.ts`：使用 fake timers 覆盖 StrictMode 打开不重写、pagehide 刷新及 QuotaExceededError 草稿保留；另覆盖正常往返、损坏 JSON/形状/元数据、不可用 storage、损坏记录不覆盖、缺失记录区分、ID 删除、设置枚举回退和 `foil_theme` 迁移；11 项全部通过。
- `bun install --frozen-lockfile`：通过，未修改 package/lock。
- `bun run typecheck`：通过。
- `bunx vitest run src/App.persistence.test.tsx src/lib/doc-store.test.ts src/lib/settings-config.test.ts`：3 个文件、11 项通过。
- `bun run build`：通过，Vite 7.3.6，154 modules。
- `bun run test`：本任务测试及其余测试共 374 项通过；基线 `src/lib/url-codec.test.ts` 的 3 项 envelope 边界测试仍失败（`Number.MAX_SAFE_INTEGER` 触发 generic error，而断言要求 codec 的 `Invalid time-capsule envelope`）。该问题属于 codec 范围，本任务未修改 codec。
- `git diff --check`：通过。未改 package/lock、分享 UI、Editor、codec 或其他任务文件。
