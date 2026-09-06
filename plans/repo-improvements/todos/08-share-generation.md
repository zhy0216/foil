difficulty: medium
agent: inherit

# 分享链接与当前选项一致

对应发现：F05、F23、F31。依赖 `01-share-boundaries.md`。仅改 ShareModal 及测试，不改 App/codec/drand/package。

## T1 · 链接结果绑定当前快照

- 要做什么：文档、密码或时间选项改变即清除旧 url/size/复制能力；成功结果绑定请求代次和输入快照。关闭/重新打开、失效输入和失败均清掉陈旧结果与 busy；只有当前输入对应的成功 URL 可以显示为可复制链接。处理一次 encode 失败后已有旧普通 URL 的危险场景，不能仅依赖 effect 稍后设置 busy。
- 预计修改文件：`src/components/ShareModal.tsx`；新增 `src/components/ShareModal.test.tsx`。
- 验收：先生成普通链接，再启用密码/胶囊并模拟失败，旧链接既不可复制也不能从输入框手动选出；旧请求晚返回不会替换新结果。invalid→valid、快速开关 modal、关闭时在途请求均恢复正确状态。
- 前置依赖：01。

## T2 · 时间复核与有界生成频率

- 要做什么：在生成前/复制前核实 timelock 选项仍有效；30 秒 UI 要求与 codec 过期拒绝相容，不能把期满链接提示成未来胶囊。短 debounce（初始 250ms）减少逐字符 PBKDF2，取消 debounce timer 并忽略过期在途结果；成功复制的 toast 根据实际成功结果的方案生成。
- 预计修改文件：`src/components/ShareModal.tsx`、ShareModal 测试。
- 验收：fake timers 覆盖打开很久后时间过期、修改密码/文档、连续键入只触发最终一轮有效生成；clipboard 中的 scheme 与成功快照一致。生成失败/超限给稳定提示，合法四种方案仍可生成与复制，8 KB 提示不冒充硬上限。
- 前置依赖：本文件 T1。

验证：`bun run typecheck`、`bun run test`、`bun run build`。测试 mock encodeUrl 与 clipboard，验证用户操作和结果；保留密码仅在内存、不进入日志/URL 的约束。底层 Web Crypto 不可中断时只能忽略旧结果，不能声称已取消计算。
