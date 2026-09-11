# kami-inspired-typesetting 执行队列

方案：[../plan.md](../plan.md)。基线：`bc7660a`。每个 todo 对应一个独立 worktree 和一个最终 commit；任务内包含实现、针对性测试与自验。

范围：按用户本次指令，先执行 **01、02、03、04、07**；**05（打印/PDF）与 06（起始模板）本轮不做**，留待后续追加。07 本轮只覆盖 01–04 的阶段验收与完整回归，不包含 05/06 的打印与模板验收。

## 执行偏好

default_agent: opencode
default_model: opencode-go/deepseek-flash

来源：用户本次在 OpenCode 协调会话中的明确全局指定 —— 所有任务使用 OpenCode，模型 `opencode-go/deepseek-flash`（界面名 DeepSeek V4.1 Flash）。该指定覆盖 plan.md 保存的 `default_agent: codex`；本轮所有 todo 均为 `agent: inherit`，按全局默认解析。OpenCode 不使用 Codex reasoning 参数；用户未指定推理强度。

难度与模型映射：用户已全局指定模型，所有任务都使用 `opencode-go/deepseek-flash`，不按难度切换到其他 OpenCode 模型。启动参数固定为 `opencode --auto --model opencode-go/deepseek-flash`（auto/YOLO 模式必须显式传入）。

环境：使用仓库声明的 Node 22.22.3（`$HOME/.nvm/versions/node/v22.22.3/bin`）与 Bun 1.4.2。仓库级校验遵循 CLAUDE.md，顺序执行，避免并发跑真实 600k 轮 KDF 单测与构建。

## 优先级

| 文件 | 优先级 | 难度 | agent | 模型 | 说明 |
| --- | --- | --- | --- | --- | --- |
| [01-typography-scope-lists.md](done/01-typography-scope-lists.md) | P0 | medium | opencode，继承默认 | opencode-go/deepseek-flash | ✅ 已归档：修正正文设置、行盒和列表显示，建立文档样式作用域 |
| [02-cjk-fonts-paper.md](done/02-cjk-fonts-paper.md) | P1 | medium | opencode，继承默认 | opencode-go/deepseek-flash | ✅ 已归档：中文字体回退、统一标题字体与 Paper 外观 |
| [03-semantic-reader-mapping.md](done/03-semantic-reader-mapping.md) | P1 | hard | opencode，继承默认 | opencode-go/deepseek-flash | ✅ 已归档：语义 Markdown 阅读结构与评论源映射 |
| [04-reading-mode-toc.md](04-reading-mode-toc.md) | P1 | hard | opencode，继承默认 | opencode-go/deepseek-flash | 阅读模式、标题与目录接入各宿主 |
| [07-visual-regressions.md](07-visual-regressions.md) | P1 | medium | opencode，继承默认 | opencode-go/deepseek-flash | 01–04 阶段视觉检查与完整回归 |

## 文件

1. [01-typography-scope-lists.md](done/01-typography-scope-lists.md) — ✅ 已归档。依赖：无。
2. [02-cjk-fonts-paper.md](done/02-cjk-fonts-paper.md) — ✅ 已归档。依赖 `01-typography-scope-lists.md`。
3. [03-semantic-reader-mapping.md](done/03-semantic-reader-mapping.md) — ✅ 已归档。依赖 `01-typography-scope-lists.md`；与 02 无硬依赖，但都修改共享样式，可并行、由集成阶段串行 rebase。
4. [04-reading-mode-toc.md](04-reading-mode-toc.md) — 依赖 `02-cjk-fonts-paper.md`、`03-semantic-reader-mapping.md`。
5. [07-visual-regressions.md](07-visual-regressions.md) — 依赖 01–04 全部合入。

## 调度

- 初始仅 01 可运行。
- 01 合入后并行启动 02、03（本队列最多 2 个并行任务）。
- 02、03 合入后启动 04；04 合入后启动 07。
- 05、06 本轮跳过：后续追加时 05 依赖 04、06 依赖 04，07 再扩展到 05/06 的打印与模板验收。
- 依赖链上后续任务必须等待其依赖合入原分支后再从最新原分支创建 worktree。

## 验证

每个任务在自身 worktree 中顺序运行：`bun install --frozen-lockfile` → `bun run typecheck` → `bun run test` → `bun run build`，再运行任务文件里列出的针对性浏览器/单测命令。涉及网站浏览器测试时，先构建对应 base（默认 `/foil/`），例如：

~~~bash
bunx --no-install turbo run build --filter=@foil/web
bun run --cwd apps/web test:e2e tests/e2e/<spec> --workers=2
~~~

根 e2e 与替代 base 变体按 CLAUDE.md 在最后执行并恢复默认产物。协调器在合并前独立复跑仓库级校验。

## 完成记录

（协调器在合并并清理每个任务后更新：todo 文件、最终 commit、使用的 agent/模型与校验证据。）
