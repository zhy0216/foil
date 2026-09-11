difficulty: medium
agent: inherit

# 01–04 阶段视觉检查与完整回归

对应 plan.md「方案 7」，本轮只覆盖 01–04（05 打印、06 模板不在本轮）。依赖 01–04 全部合入。在现有测试结构中增加固定样本与断言，不另建 Python 检查链或公开组件展示站。

## T1 · 固定排版样本

- 要做什么：在现有测试结构中建立固定样本，至少包含：中文长文、英文简报、中英混排、连续/重复标题、多层列表、长 URL、长代码、表格、空行、emoji/组合字符，以及跨块/重叠/未定位评论。稳定 fixture 跟随测试源码；截图与生成的 PDF 等产物放现有已忽略的测试产物目录，不提交大文件，不使用生产环境上传。
- 预计修改文件：`apps/web/tests/e2e/` 与 `apps/extension/tests/e2e/` 下的 fixture/helpers/spec，以及 `packages/editor/src/**` 中新增的样本单测。
- 验收：样本可被网站、扩展与独立 HTML 三个宿主复用或等价覆盖；01 建立的浏览器样本扩展到完整矩阵，不等到最后才检查视觉效果。
- 前置依赖：01–04 已合入。

## T2 · 行为断言与截图

- 要做什么：自动断言聚焦行为而不对照 CSS 常量：设置实际生效（字号/行高/字体/密度/宽度/外观）、有序编号可见、原文与阅读内容未缺失、无页面级横向溢出、评论仍可达、Reading/Source 切换与目录跳转不改分享 fragment。用现有 Playwright 在固定环境获取截图；初期人工对照审批视觉基线并记录结论，只有稳定后再考虑截图差异门槛。
- 预计修改文件：`apps/web/tests/e2e/`、`apps/extension/tests/e2e/` 中相关 spec 与 helpers；必要时小幅修正暴露的产品缺陷（范围限于 01–04 验收，超出则记录 blocker）。
- 验收：矩阵至少覆盖——视口 375/768/1280px 与 200% 缩放；standard/paper × light/dark；各字体、字号、密度、宽度与 5 个 accent 的代表性组合；宿主（网站编辑/预览、扩展、新导出 HTML、`file://`）；数据（文本与选区偏移、中文 IME、撤销、评论锚点）；分享（四类分享与导出继续通过已有回归）；离线与构建（普通/密码场景无额外网络或字体请求，HTML 自包含断言与 CSP 仍通过）。
- 前置依赖：本文件 T1。

## T3 · 完整仓库回归与记录

- 要做什么：从仓库根按 CLAUDE.md 顺序运行完整校验，包含替代 base 变体；记录每项命令与结果、截图路径、人工视觉审查结论与任何已知限制。视觉审查关注标题与后文的归属、真实字体回退、中文标点换行、代码可读性、表格宽度与评论遮挡；不把 Kami 的纸面填充比例或英文孤词阈值当成本轮硬门槛。
- 预计修改文件：测试与验证记录（可写入 `plans/kami-inspired-typesetting/todos/07-visual-regressions.md` 的完成记录或现有测试文档），不改业务代码除非修复暴露缺陷。
- 验收：`bun install --frozen-lockfile`、`bun run typecheck`、`bun run test`、`bun run build`、`bun run test:e2e` 依次通过；再执行 `bunx --no-install turbo run build --filter=@foil/web -- --base /` + `FOIL_E2E_BASE=/ bun run --cwd apps/web test:e2e --workers=2`，最后 `bun run build` 恢复默认产物。报告逐条列出命令与结果。

## 验证

~~~bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run test:e2e
bunx --no-install turbo run build --filter=@foil/web -- --base /
FOIL_E2E_BASE=/ bun run --cwd apps/web test:e2e --workers=2
bun run build
~~~

任何断言失败都要诊断到根因；属于 01–04 范围内的小缺陷在本任务内修复并复验，超出范围的记录 blocker。`git diff --check` 通过。

## 完成记录（任务分支 herdr/plan-kami-ts-07-visual-regressions，最终 commit 见分支头）

- 执行：opencode，模型 `alibaba-token-plan-cn/qwen3.8-max`（协调会话实际下发）。
- T1 固定样本：新增 `apps/web/tests/e2e/helpers/samples.ts`。`SAMPLE_MD` 覆盖中文长文、英文简报、中英混排、连续标题（### 连续标题 A/B）与重复标题（### 小节 Subsection ×2）、多层列表（ul 三层 + 任务）、长 URL（裸链 + 查询串）、长代码（含超长行）、GFM 表格、连续空行、emoji/ZWJ/组合字符/代理对；`SAMPLE_COMMENTS` 含单块定位、跨块、重叠一对、未定位共 5 线程。样本被网站 `sample-matrix.spec.ts`、扩展 `typography.spec.ts`（沿用既有窄测试导入路径）与独立 HTML 路径（导出 + `file://` 再打开/再导出）三宿主复用。未新增 packages/editor 单测：03/04 已有 736 项单测对嵌套/转义/实体/CRLF/emoji/表格与偏移、IME、undo 等价覆盖。
- T2 断言与截图：`apps/web/tests/e2e/sample-matrix.spec.ts` 6 项 × chromium/webkit——编辑矩阵（6 字体 × 代表 size/density/width，字号/行高/字体栈/有序编号/原文回环/无横向溢出）、外观矩阵（standard/paper × light/dark × 5 accent）、视口 375/768/1280 与 200% 缩放（640×360 @ deviceScaleFactor 2，设置/Read/TOC 可用）、数据（CJK 输入、undo、锚点存活）、分享阅读（sentinel 全量、TOC 重复标题唯一 ID、跳转与 Reading/Source 切换不改 fragment、5 线程可达含未定位、375 抽屉）、文件导出（自包含断言、离线打开、设置生效、再导出、零网络请求）。扩展 `typography.spec.ts`：打包编辑器与本地 Read 视图离线渲染同一样本 + 375px。全部断言为行为型（计算样式/文本/溢出/URL），不做像素对照。截图基线（固定环境，每次运行重新生成，已忽略目录）：`apps/web/test-results/visual-baseline/`（web-editor/look/vp/zoom200/share-reading/share-source/file-reading 共 37 张/次）、`apps/extension/test-results/visual-baseline/`（ext-editor、ext-reading、ext-editor-375）。人工视觉对照审批为协调器/用户线下步骤，本记录只提供基线路径；自动化不读图。
- 测试辅助根因修正（仅测试代码）：`helpers/html-export.ts` 的 `expectDocument`「无编辑控件」选择器排除 `disabled` 输入（阅读视图任务列表复选框为只读展示）；评论卡片过滤改用精确引文文本，重叠引文不再互配。
- T3 校验（顺序执行）：`bun install --frozen-lockfile` ✓（232 installs，无变更）；`bun run typecheck` ✓（3 任务）；`bun run test` ✓（--force 新跑：editor 26 文件 736 通过、extension 5 文件 241 通过，KDF 未超时）；`bun run build` ✓；`bun run test:e2e` ✓（web 62 通过 = 原 50 + 新 6×2 项目；extension 28 通过 = 原 27 + 新 1）；`bunx --no-install turbo run build --filter=@foil/web -- --base /` ✓ + `FOIL_E2E_BASE=/ bun run --cwd apps/web test:e2e --workers=2` ✓ 62 通过；最终 `bun run build` 恢复 `/foil/`（index.html 引用 `/foil/assets/` 已确认）；`git diff --check` ✓。针对性先行运行：sample-matrix chromium 6/6、webkit 6/6，extension typography 1/1。
- 已知限制：长代码行在阅读视图 `pre` 内横向滚动（页面无溢出，屏幕行为既有设计）；截图同名文件按引擎/运行覆盖，基线以最后一次运行为准；未定位评论在阅读视图可达、编辑 gutter 不列（01–04 既有行为，未改动）；视觉基线人工审批结论由协调器线下补充。
