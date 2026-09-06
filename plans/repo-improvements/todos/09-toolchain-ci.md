difficulty: hard
agent: inherit

# 相容工具链、依赖修复与 CI

对应发现：F22、F24–F26、F29、F31。依赖：无。独占 package/lock、Vite/Vitest/Playwright 配置、工作流和最小 e2e smoke；不改业务源码来掩盖升级回归。

## T1 · 可审计的依赖组合

- 要做什么：复核基线 25 条开发依赖 advisory，选择已修复且 peer 相容的 Vite / React 插件 / Vitest 组合，消除 Vite 5+8 混用与 esbuild/oxc 三条警告。保留 React 18、TypeScript 5，Vitest 优先保持 4.x 的修复版本；若必要升级会扩大任务范围，报告具体兼容性证据再调整，不全量 `--latest`。直接声明 `buffer` 与与 tlock 相容的 `drand-client`。锁文件与审计使用可用源，不改用户全局 registry。
- 预计修改文件：`package.json`、`bun.lock`、`vite.config.ts`；必要时新增 `vitest.config.ts` 和项目级包管理配置。
- 验收：干净 worktree `bun install --frozen-lockfile` 后 typecheck/test/build 全通过，无相关 peer/弃用警告。官方 registry 的全依赖 audit 和 prod audit 通过；如存在执行时新出现且无可用修复的条目，逐条报告范围/原因，不添加 blanket ignore。crypto 动态导入、buffer alias 和 `/foil/` 仍正确。
- 前置依赖：无。

## T2 · 运行时固定、PR 与部署前校验

- 要做什么：按依赖 engines 选择并固定已验证的 Node/Bun 版本（基线 Bun 为 1.4.2），新增 pull_request/push 的类型、单元测试、构建验证；现有 Pages build 在上传产物前也必须通过测试。复用合理配置，避免 fork PR 要求 secrets/写权限。meta CSP 去掉不生效的 frame-ancestors，保留其他已有效的安全策略。
- 预计修改文件：`.github/workflows/deploy.yml`、新增 `.github/workflows/ci.yml`；`package.json`、必要运行时版本文件、`vite.config.ts`。
- 验收：PR 工作流不用部署权限就能验证，main 部署构建不能绕过测试；冻结锁安装可重复。构建 meta CSP 没有无效 frame-ancestors，script/object/base/form/connect 等现有边界不被意外放宽。实际响应头保护能力由 11 文档说明，不改托管资源。
- 前置依赖：本文件 T1。

## T3 · 最小真实浏览器测试入口

- 要做什么：增加维护中且相容的 Playwright 测试依赖、`test:e2e` 脚本及 Chromium/WebKit 项目，启动本地构建预览并使用正确 `/foil/` base；新增最小打开页面/本地编辑 smoke。CI 安装所需浏览器并执行，失败保留必要 trace，测试仅用生成的测试数据。最终行为矩阵由 12 扩展。
- 预计修改文件：`package.json`、`bun.lock`；新增 `playwright.config.ts`、`tests/e2e/smoke.spec.ts`；CI 工作流与必要 `.gitignore` 条目。
- 验收：`bun run test:e2e` 在 Chromium/WebKit 上运行 smoke；CI 测试不依赖公共 drand 或用户浏览器数据。测试产物目录被忽略，固定端口/本地进程有清理，静态预览有 CSP 的情况下应用仍能工作。
- 前置依赖：本文件 T1、T2。

验证：冻结安装、`bun run typecheck`、`bun run test`、`bun run build`、`bun run test:e2e`、`npm_config_registry=https://registry.npmjs.org bun audit` 与对应 `--prod`。遵循工具的当前官方文档与已安装 CLI，不把缺少 lint 的 R04 扩展成全仓格式迁移。
