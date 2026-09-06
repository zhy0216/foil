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


## 完成记录（2026-09-06）

T1、T2、T3 全部完成。仅修改 09 的 package/lock、配置、CI、最小 smoke 和本任务归档状态；业务源码、密码学参数、四种 fragment 协议与其他队列项保持原样。

### T1 · 依赖组合与官方审计

- 固定 Vite `7.3.6`、`@vitejs/plugin-react` `5.2.0`、Vitest / UI `4.1.11`。插件 peer 包含 Vite 7，Vitest peer 为 `^6 || ^7 || ^8`；锁文件只有一套 Vite。选择仍接收重要修复和安全补丁的 Vite 7.3，保留 Rollup 构建路径；显式保留原 Vite 5 的 JS 输出 targets。
- React / React DOM 仍为 `18.3.1`、TypeScript 仍为 `5.9.3`、jsdom 仍为 `29.1.1`、tlock-js 仍为 `0.9.0`。直接声明 Buffer `6.0.3` 和 drand-client `1.2.5`，后者与 tlock-js 的精确依赖一致。
- 新增 Playwright `1.63.0` 和匹配 Node 22 的 `@types/node` `22.20.1`。没有全量 `--latest`、advisory ignore 或强制覆盖 peer。
- `.npmrc` 只为本项目选择 `https://registry.npmjs.org/`；锁文件已去掉 mirror tarball URL。使用 `bun audit fix --dry-run` 核对后，仅按依赖允许范围修复下表中的开发依赖，再用 `bun dedupe` 消除重复解析。没有修改用户全局 registry。
- 官方 registry 在执行时复现基线 25 条记录（11 high、11 moderate、3 low）。下面按包归组；相同 GHSA 对不同 Vite 范围产生的记录分别计数，链接去重展示。修复后全依赖 audit 为 **0 / 210 packages**，prod audit 为 **0 / 37 packages**，没有尚无修复的残留条目。

| 包 | 基线版本 | 记录数 | 修复后版本 | 官方 registry 返回的 advisory |
| --- | --- | ---: | --- | --- |
| `@babel/core` | 7.29.0 | 1 | 7.29.6 | [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) |
| `browserslist` | 4.28.2 | 2 | 4.28.7 | [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx)、[GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) |
| `esbuild` | 0.21.5 | 1 | 0.28.2 | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| `nanoid` | 3.3.12 | 2 | 3.3.18 | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv)、[GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) |
| `postcss` | 8.5.14, 8.5.15 | 2 | 8.5.23 | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp)、[GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) |
| `undici` | 7.25.0 | 12 | 7.29.0 | [GHSA-8xcm-r25x-g524](https://github.com/advisories/GHSA-8xcm-r25x-g524)、[GHSA-4cwx-7wf7-3272](https://github.com/advisories/GHSA-4cwx-7wf7-3272)、[GHSA-m8rv-5g2x-5cg5](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5)、[GHSA-jr45-8vmc-qm54](https://github.com/advisories/GHSA-jr45-8vmc-qm54)、[GHSA-v3r7-h72x-cjcm](https://github.com/advisories/GHSA-v3r7-h72x-cjcm)、[GHSA-vmh5-mc38-953g](https://github.com/advisories/GHSA-vmh5-mc38-953g)、[GHSA-p88m-4jfj-68fv](https://github.com/advisories/GHSA-p88m-4jfj-68fv)、[GHSA-vxpw-j846-p89q](https://github.com/advisories/GHSA-vxpw-j846-p89q)、[GHSA-hm92-r4w5-c3mj](https://github.com/advisories/GHSA-hm92-r4w5-c3mj)、[GHSA-g8m3-5g58-fq7m](https://github.com/advisories/GHSA-g8m3-5g58-fq7m)、[GHSA-pr7r-676h-xcf6](https://github.com/advisories/GHSA-pr7r-676h-xcf6)、[GHSA-35p6-xmwp-9g52](https://github.com/advisories/GHSA-35p6-xmwp-9g52) |
| `vite` | 5.4.21, 8.0.14 | 5 | 7.3.6 | [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3)、[GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)、[GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) |

相容性来源：[Vite 支持政策](https://vite.dev/releases)、[Vite 7 迁移说明](https://v7.vite.dev/guide/migration)、[Vite 7.3.6 元数据](https://registry.npmjs.org/vite/7.3.6)、[React 插件 5.2.0 元数据](https://registry.npmjs.org/@vitejs/plugin-react/5.2.0)、[Vitest 4.1.11 元数据](https://registry.npmjs.org/vitest/4.1.11)、[tlock-js 0.9.0 元数据](https://registry.npmjs.org/tlock-js/0.9.0)、[Bun audit](https://bun.com/docs/pm/cli/audit)。

### T2 · 固定运行时与构建门禁

- 实测并固定 Node `22.22.3` / Bun `1.4.2`：`.node-version`、`packageManager` 和 `engines`，共享 action 从版本文件 / package.json 读取。Node 满足 Vite / 插件的 `^20.19.0 || >=22.12.0`、jsdom 的 `^20.19.0 || ^22.13.0 || >=24.0.0` 及 Playwright 的 `>=20`。
- `ci.yml` 在 push / pull_request 触发，仅需 `contents: read`，没有 secrets、Pages 或 OIDC 写权限。CI 与 Pages build 复用 `.github/actions/verify`，依次冻结安装、类型检查、单元测试、两类官方源 audit、安装浏览器、构建并执行 smoke；所有校验成功后 Pages build 才上传 `dist`。Pages / OIDC 写权限只属于实际 deploy job。
- `test:e2e` 自动运行 `bun run build`，不会使用旧产物。Vite 与 Vitest 分开配置，并复用 alias / React 插件；TypeScript 检查包括新配置和 e2e specs。
- meta CSP 仅移除 `frame-ancestors`；实际构建 HTML 的 default/script/style/connect/img/font/object/base/form 九项策略在两个浏览器中逐项断言通过。该指令在 meta 中被忽略的依据为 [CSP Level 3](https://w3c.github.io/webappsec-csp/#directive-frame-ancestors)。响应头能力说明仍由 11 负责，未修改托管资源。

### T3 · 最小浏览器入口

- Chromium `153.0.8010.12` 和 WebKit `26.6` 均通过同一 smoke：打开实际构建的 `/foil/` 页面、校验 CSP、键盘输入生成的普通文本、等待 localStorage 保存、刷新后恢复。每个测试使用全新上下文，阻止 service worker，拦截并拒绝所有非本地请求；两浏览器的外部请求、页面错误和控制台警告均为空。
- 固定预览地址 `http://127.0.0.1:4173/foil/`、`--strictPort`、`reuseExistingServer: false`，使用 Playwright 进程组关闭机制。成功后实测 4173 无监听；定点探针的 4174 / 4175 也已退出。
- 失败时保留 trace / screenshot，CI 上传诊断产物并保留 7 天；`test-results/`、`playwright-report/`、`blob-report/` 都被 Git 忽略。安装命令遵循 [Playwright CI](https://playwright.dev/docs/ci)，生命周期配置遵循 [Playwright webServer](https://playwright.dev/docs/test-webserver)。
- 额外用 Vite `write: false` 检查产物图，并与实际 `dist` JS 逐字比较：入口没有 tlock / drand 模块或静态 chunk 依赖，两者保留动态入口。随后在两个浏览器的实际 CSP 页面导入这些 chunk，确认 `HttpChainClient` / `HttpCachingChain` / `timelockEncrypt` / `timelockDecrypt` 可用及 `Buffer.from('Foil').toString('hex') === '466f696c'`；启动时没有预先请求这两个动态入口，检查全程没有外部请求。该探针验证装载边界，不宣称覆盖四种分享的完整行为矩阵。

### 最终校验

以下校验在删除本 worktree 的 `node_modules` 后冻结重装，Node `22.22.3` / Bun `1.4.2` 的 macOS arm64 环境完成。单元测试没有访问真实 drand。

| 命令 / 检查 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | 通过；安装 162 个本机包，无 peer / 弃用警告；锁文件 SHA-256 前后均为 `872117daaca268b15a9a3d1e7d519a740190bf083b8a5e9ccb15c41dc591f502` |
| `bun run typecheck` | 通过 |
| `bun run test` | 2 个文件、18 个测试通过；无原 esbuild / oxc 三条警告 |
| `bun run build` | 通过；Vite 7.3.6，149 modules，静态 `dist`，入口 JS 230.61 kB / gzip 74.30 kB |
| `env -u NO_COLOR bun run test:e2e` | 通过；Chromium / WebKit 各 1 项，共 2 项；构建和预览没有相关警告 |
| `npm_config_registry=https://registry.npmjs.org bun audit` | 通过；0 条，检查 210 packages |
| `npm_config_registry=https://registry.npmjs.org bun audit --prod` | 通过；0 条，检查 37 packages |
| `bun audit` | 本项目不加 registry 环境变量也通过，确认 `.npmrc` 生效 |
| `npm ls --all --json` | 退出 0，无依赖 / peer problems |
| `bun dedupe --check` | 退出 0，无可去重版本 |
| `actionlint .github/workflows/ci.yml .github/workflows/deploy.yml` | 通过；共享 action 和两个 workflow 另经 YAML 解析通过 |
| `node /tmp/foil-09-toolchain-ci/verify-crypto-chunks.mjs` | 两浏览器的异步 chunk / Buffer / CSP / 零外部请求定点检查通过；脚本和 JSON 结果为本机临时验收证据 |
| 端口 / Git 忽略检查 | 4173 / 4174 / 4175 均无残留监听，三个测试产物目录均被忽略 |
| `git diff --check` | 通过 |

`env -u NO_COLOR` 只在该命令的进程环境中解除执行宿主的 `NO_COLOR` 与 Playwright 强制颜色变量冲突，不修改用户环境或测试行为。GitHub workflow 的 Linux 执行尚未远端触发，本阶段按任务约束没有 push、PR 或部署；已经完成本机全部命令和工作流静态校验。

### 交给协调器的既有行为发现

最初的 WebKit smoke 输入字符串带行末空格时，保存内容以 U+00A0 结尾，而不是输入的 U+0020。使用当前任务起点的原 package / lock / config、相同业务源码，在临时目录冻结安装 Vite `5.4.21` / 插件 `4.7.0` 后独立构建，WebKit `26.6` 同样复现；不是本次工具链升级新增的回归。最小 smoke 使用普通文本（末尾句点）并继续精确断言持久化内容；空白 / DOM 保真交由 03 实现、12 扩展矩阵，09 没有越界修复业务源码。

可重复操作：在新浏览器上下文打开构建页，点击 `.editor .ln` 的首行，逐键输入 ` toolchain smoke 09 `，等待保存，再读取当前 `foil_doc_<id>` 的 `md` 首行并检查最后一个字符。基线结果为 `# Welcome to Foil toolchain smoke 09\u00a0`，没有外部请求。失败截图 / trace 与基线 JSON 保留在本机 `/tmp/foil-09-toolchain-ci/`；其余 09 验收没有 blocker。
