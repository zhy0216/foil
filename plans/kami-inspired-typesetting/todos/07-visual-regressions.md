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
