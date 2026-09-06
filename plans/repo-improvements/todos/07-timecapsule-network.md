difficulty: hard
agent: inherit

# drand 请求可靠性与延迟加载

对应发现：F20、F22、F31。依赖：无。独占 `src/lib/timecapsule.ts` 及新增测试/同模块 helper；公开接口保持兼容，不改 codec、UI、package 或 lock。

## T1 · 有限请求和可信 endpoint 回退

- 要做什么：检查已安装 drand/tlock 的真实客户端接口，为 `/info` 与具体 round 请求提供有限超时（初始每请求 5 秒）及全部 endpoint 尝试的总预算。`/info` 成功后 round 请求失败也可切节点；已缓存坏节点能恢复。采用局部类型化客户端/transport，不修改全局 fetch，不关闭链哈希、公钥或签名验证。每个 endpoint 失败不能留下无限等待或悬空 rejection。
- 预计修改文件：`src/lib/timecapsule.ts`；新增 `src/lib/timecapsule.test.ts`，必要时新增局部 drand transport helper。
- 验收：第一节点超时、info 失败、info 成功但 round 失败均会在预算内尝试后续节点；错误 hash/公钥或签名必定拒绝；所有节点失败给可识别错误，下一次请求可重试。fake fetch/timers 断言超时取消和资源清理，不访问真实 drand。
- 前置依赖：无。

## T2 · 轮次与错误分类

- 要做什么：区分未来轮次未发布、网络不可用、验证失败与损坏密文，不再把任意包含 404/not found 的错误误认成未来轮次。使用已验证链时间/真实请求状态和目标 round；保留 NotYetReadyError 与 NoEndpointError 等可消费接口，提供真实 round。pure math 输入也应拒绝非有限/非法值，但保持正确日期的旧输出一致。
- 预计修改文件：`src/lib/timecapsule.ts` 及测试。
- 验收：边界 roundTime/roundAt 保持正确，未来 round 与已过去但不可用的 round 有明确不同处理，坏密文不触发“等待未来”的重试。依赖返回错误结构变化时返回稳定可诊断错误，不泄露密码/正文。
- 前置依赖：本文件 T1。

## T3 · 类型与加载边界

- 要做什么：采用 drand 导出的客户端/chain 类型，移除 unknown/as any 桥接；将 Buffer 的装载与必要 shim 放到使用加密功能时，保证 tlock import 前已就绪。保留纯 round math 无需加载重 crypto 依赖。直接依赖清单由 09 增加，不在此任务改 package。
- 预计修改文件：`src/lib/timecapsule.ts` 及其测试。
- 验收：普通页面/普通分享不会加载 tlock/Buffer 重依赖；seal/unseal 的动态导入顺序在浏览器产物中可用，重复/失败导入不永久污染缓存。类型检查和密码学 round-trip mock 通过，固定 quicknet 参数不变。
- 前置依赖：本文件 T1、T2。

验证：`bun run typecheck`、`bun run test`、`bun run build`，定点检查构建的异步 chunk。不得用 Promise.race 仅掩盖无限 fetch 却声称底层请求已取消；UI 取消结果由 05 管理。
