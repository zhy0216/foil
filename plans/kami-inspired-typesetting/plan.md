# 借鉴 Kami，提升 Foil 的文档排版与阅读交付

日期：2026-09-10

分析基线：Foil 本地提交 d5f4ca8；参考仓库 /home/ubuntu/libs/Kami，本地提交 4dab24c。结论来自这两个工作区的实际代码、Kami 现有示例图片，以及一次使用 Foil 当前源码和 CSS 的 Chromium 排版探测。未查询上游最新版本。

## 意图

用户希望研究 Kami 中值得学习的设计，并规划如何应用到 Foil。Kami 的 README、模板和设计规范表明它是文档排版系统，因此本方案将请求中的“排班”理解为“排版”。任务类型是文档体验改进，包含现有排版问题修复，以及分阶段增加阅读和打印能力。

**最值得迁入的是一套可复用、可验证的文档排版规则：字体与语言匹配、稳定的字号和间距层次、内容优先的组件、针对输出介质的布局、真实产物检查。** Foil 已有本地编辑、四种分享保护和独立 HTML 阅读基础，适合让一份 Markdown 在写作、阅读和交付时都保持清晰。

推荐先完成 01、02，并完成 07 对应验收。这一阶段即可解决真实显示问题、改善中文阅读，并提供可选纸张风格。03–05 是后续正式阅读和打印阶段，06 是优先级更低的模板扩展。每阶段单独验收，基础排版改进不等待阅读器重构。

本次只产出此 plan.md；未改业务代码、未生成 todos、未启动执行。

## 目标 / 非目标

### 目标

- 让字号、字体、密度设置正确影响正文，修正有序列表视觉语义。
- 为正文、标题、引用、列表和代码建立共享排版规则，改善中英文混排。
- 提供可选 Paper 文档外观，保留 Foil 品牌和现有个人设置。
- 分阶段提供正式阅读视图、章节导航及浏览器打印，覆盖网站、扩展和独立 HTML。
- 将 Kami 的“检查真实产物”方法接入现有浏览器验证流程。
- 以少量 Markdown 起始模板帮助用户组织内容。

### 非目标

- 排班、日历、人员管理等业务功能。
- 本轮重做 Logo、营销官网、产品路由；这些属于已有品牌方案。
- 接入 AI 写作服务、Python / WeasyPrint / PPTX 服务端或 Kami MCP。
- 改写 Markdown 内容作为排版手段，或在编辑器中隐藏语法、插入排版空格和零宽字符。
- 第一阶段增加表格、公式、图表、图片上传或更换编辑器内核。
- 修改 DocState、分享协议、加密层次、存储格式或 URL 载荷上限。
- 向接收方强制传递作者的主题、字号和排版偏好。

## 对照结论与代码证据

Kami 参考主目录为 skills/kami，plugins/kami/skills/kami 是生成镜像，分析以主目录为准。

| 值得学习的能力 | Kami 的实际依据 | Foil 当前情况 | 应用方式 |
| --- | --- | --- | --- |
| 字体与字号形成统一层次 | [design.md](/home/ubuntu/libs/Kami/skills/kami/references/design.md) 的 Typography、Spacing；[long-doc.html](/home/ubuntu/libs/Kami/skills/kami/assets/templates/long-doc.html) | 正文有五种字体和三档字号，标题固定使用 sans；全局 .p 样式覆盖编辑正文设置 | 正文样式限定作用域，标题使用文档字体变量，建立有限的字号和间距阶梯 |
| 按语言配置字体 | design.md 的英文、中文、日文与代码字体链；中英文 long-doc 模板 | [settings-config.ts](../../packages/editor/src/lib/settings-config.ts) 的字体链主要面向拉丁字形，没有显式中文 serif 回退；设置卡片只展示 Aa | 加入本地 CJK 字体回退和中文字体选项，用中英文预览选字体 |
| 克制的纸面层次 | [tokens.json](/home/ubuntu/libs/Kami/skills/kami/references/tokens.json)、design.md 的四档文字色和单一强调色 | [design-tokens.css](../../packages/editor/src/styles/design-tokens.css) 已有 token，但混合了全局文章样式，且还保留 Alumnium 注释 | 复用现有 token 基础，增加文档语义变量和可选 Paper 外观 |
| 用结构表达列表、表格、引用 | long-doc 使用原生 ul、ol、table、blockquote、pre；不同内容有不同节奏 | [markdown.ts](../../packages/editor/src/lib/markdown.ts) 逐行生成 div/span；有序和无序列表共用 .list；表格未形成结构 | 第一阶段修正列表显示，后续用独立语义阅读器承载正式排版 |
| 长文目录与章节组织 | long-doc 的封面、目录、章节、摘要；PDF 目录使用 target-counter() | [ReadOnlyDocument.tsx](../../packages/editor/src/components/ReadOnlyDocument.tsx) 已有评论导航，没有文章目录，文档标题主要在顶栏 | 后续从解析结构生成章节导航，采用浏览器滚动，不依赖 PDF 专用 CSS |
| 按介质设计打印 | long-doc 的 @page、break-after、widows/orphans；[production.md](/home/ubuntu/libs/Kami/skills/kami/references/production.md) 的白纸变体 | 当前共享 CSS 没有 @media print 或打印入口 | 浏览器原生打印，单独处理纸张、分页、长表格和长代码 |
| 结构模板 | [long-doc.json](/home/ubuntu/libs/Kami/skills/kami/references/schemas/long-doc.json) 与 one-pager、letter 模板 | [App.tsx](../../packages/editor/src/App.tsx) 内置一篇 Welcome，New document 创建空文档 | 增加简报、长文和信件 Markdown 起始模板，创建到新文档 |
| 自动检查加视觉审阅 | [tokens.py](/home/ubuntu/libs/Kami/skills/kami/scripts/tokens.py)、[checks.py](/home/ubuntu/libs/Kami/skills/kami/scripts/checks.py)、[visual.py](/home/ubuntu/libs/Kami/skills/kami/scripts/visual.py) | 已有单测、Chromium/WebKit、扩展与真实 file:// 分享测试；截图主要用于失败诊断 | 延用现有工具，增加排版样本、尺寸断言和人工视觉验收 |

已查看 Kami 的 [英文 Waza 示例](/home/ubuntu/libs/Kami/site/assets/demos/demo-waza.png) 和 [中文白纸示例](/home/ubuntu/libs/Kami/site/assets/demos/demo-kami-print.png)。两者可借鉴的共同点是标题层次、留白、对齐、有限强调和代码区域的层次。白纸示例也说明其设计价值可以在不同纸面颜色下保持。

### 已复现的 Foil 排版问题

探测使用当前 renderDecorated、两份共享 CSS、实际 PROSE_FONT_MAP，在 Chromium 中渲染编辑和预览两个最小容器；设置为 21px、compact（1.55）。这是源码级浏览器样式探测，不是完整应用端到端测试。

| 项目 | 实际结果 | 根因与影响 |
| --- | --- | --- |
| 编辑正文与预览字号不同 | 编辑 .ln.p 为 16px / 26.4px 行高；预览为 21px / 32.55px | design-tokens.css 中 p, .p 固定字号和行高；styles.css 仅为 .preview .ln.p 恢复继承 |
| compact 的行盒仍偏高 | 编辑器普通列表字号 21px、行高 32.55px，但 min-height 为 35.7px | .editor .ln 固定 min-height: 1.7em，密度变化没有完整作用于行盒 |
| 标题额外撑高 | H1 字号 36px、行高 41.4px，编辑 min-height 为 61.2px，预览为 55.8px | 通用逐行 min-height 也作用于标题；应按块类型处理 |
| 有序列表显示成圆点 | 1. First 和 2. Second 的伪元素都是圆点 | classifyLine 区分 olist，但输出 class 都是 list；.syn-bullet 隐藏原标记并统一生成圆点 |

相关文件：[styles.css](../../packages/editor/src/styles/styles.css)、[design-tokens.css](../../packages/editor/src/styles/design-tokens.css)、[markdown.ts](../../packages/editor/src/lib/markdown.ts)、[useReadingSettings.ts](../../packages/editor/src/hooks/useReadingSettings.ts)。

### 必须保留的已有能力

- 编辑器的逐行 textContent 对应原文；选区、光标和评论偏移依赖这一约定。详见 [CLAUDE.md](../../CLAUDE.md)、[editor-dom.ts](../../packages/editor/src/lib/editor-dom.ts)。
- [Preview.tsx](../../packages/editor/src/components/Preview.tsx) 复用 renderDecorated，当前复制行为是原始 Markdown；[Preview.test.tsx](../../packages/editor/src/components/Preview.test.tsx) 明确验证这个契约。
- 网站和扩展共享编辑包，独立 HTML 也共享阅读组件。现有阅读器已经支持评论定位、重叠和跨行锚点、移动抽屉及未定位评论。
- [standalone.ts](../../packages/editor/build/standalone.ts) 构建会拒绝编辑器、文档库依赖，以及含 @import 或 url() 的 CSS；[html-export.ts](../../packages/editor/src/lib/html-export.ts) 的文件 CSP 禁止加载字体。
- Settings 是个人偏好，独立文件的偏好存储可以失败；正文不因此写入本地文档库。

## 方案

### 1. 先统一正文样式并修复实际问题

涉及 styles/design-tokens.css、styles/styles.css、lib/markdown.ts、hooks/useReadingSettings.ts。

1. 将 UI token 与文档块排版区分。保留现有变量名称与主题控制，文档规则限定在正文容器内，避免 .p、.h1 等全局类覆盖正文设置或反向影响弹层。
2. 编辑正文、预览正文都继承 --prose-size 和 --prose-leading。空行维持可放置光标的行盒，标题按自身行高计算，不套正文的统一最小高度。
3. 增加 --prose-heading-font、标题大小、章节间距等少量语义变量。继续以当前 17/19/21px、1.55/1.7 为初始参数，不直接将 Kami 的打印字号和行高应用到屏幕。
4. 标题上方间距大于其下方间距；标题、正文、列表、代码各用有限层次。编辑模式保留每个原始空行，不能通过合并源行达到排版效果。
5. 为有序、无序、任务列表输出可区分的类型 class；编辑模式直接展示原始标记，保留 42)、缩进、Tab、任务状态等内容，取消统一伪造圆点的规则。
6. 正文引用默认使用正常字形和较弱文字色，降低整块斜体与高饱和边框的干扰；用户显式输入的强调仍保留可辨识语义。
7. 更新共享 token 的 Foil 归属说明，继续保留现有品牌资源与 accent 变量。

这些改动只能调整样式和必要的块类型标识，不改变 Markdown 字符、行序、DOM 偏移含义或输入流程。

### 2. 增加中文排版支持与可选 Paper 外观

涉及 types.ts、settings-config.ts、SettingsModal.tsx、useReadingSettings.ts 和共享样式。

**字体：**

- 为现有 serif、modern-serif 和 mono 字体链补齐本地中文回退，代码也能覆盖中文注释；沿用 Latin 字体作为已有选项的优先选择。
- 增加一个 cjk-serif 选项，中文 serif 字体优先，候选为 Source Han Serif SC/CN、Noto Serif CJK SC/SC、Songti SC、STSong、SimSun，后接现有 Latin serif 回退。
- 所有名字都是系统字体候选，不打包或下载字体，不承诺不同操作系统像素一致。没有相应字体时仍有系统回退。
- 字体选择卡片改为“中文 Aa 123”样例。正文标题跟随所选文档字体，按钮、设置、状态栏继续使用 UI 字体。
- 默认正文 tracking 保持 0；CJK 选项的微调从 0–0.02em 的视觉样本验证开始，不向代码、URL 和所有拉丁文本套用 Kami 针对特定字体的 0.3pt。
- 优先通过字体、行宽和自然换行解决混排，不向 md 注入空格或修改标点。

**文档外观：**

- 增加 readingStyle: standard | paper。旧设置缺少该字段时回退 standard，现有 theme、accent、字号、宽度、密度、字体继续独立生效。
- standard 使用现有界面语义色；paper 只调整文档区域的纸面、文字与分隔层次。浅色可从暖纸色与深墨色开始，深色使用暖暗面及足够清晰的文字。
- 文档语义变量集中定义，例如 --doc-bg、--doc-fg、--doc-muted、--doc-rule、--doc-code-bg。正文、阅读标题、代码与评论区域按同一组颜色规则适配。
- Paper 保留用户选择的 accent；链接和评论定位有清晰的状态表达。验证两种主题下全部现有 accent，避免把暗色链接值直接用于浅色纸面。
- 页面宽度仍是响应式阅读列；不在手机上模拟固定 A4 纸张，不增加纸纹图片或装饰阴影。
- 设置默认值、解析、迁移、重置及独立文件的内存回退一次处理；网页、扩展与 HTML 使用同一套配置。

此阶段的源文预览仍显示 Markdown 标记。它改善当前阅读质量，不承担下一阶段的语义阅读功能。

### 3. 独立建立语义阅读渲染和原文映射

这一阶段是完整阅读排版的主要技术成本，不能通过对现有 Preview 隐藏 .syn 来替代。

建议新增 lib/reading-document.ts、lib/reading-source-map.ts 和 components/ReadingPreview.tsx，文件名可在实现时小幅调整：

- renderDecorated、Editor 和现有 Preview 继续负责逐行原文视图。
- 新模块把规范化 Markdown 解析为文档结构，由 React 渲染实际的标题、段落、列表、引用、代码和表格。
- 支持范围明确为常用 Markdown：ATX 标题、段落与软/硬换行、分隔线、有序/无序/任务及嵌套列表、引用、围栏代码、行内强调/删除线/代码/链接，以及 GFM 表格。兼容 Foil 已有 ==高亮== 扩展。
- 首步用包含嵌套结构、转义字符、实体、CRLF、emoji、组合字符和表格的样本，验证一个现成解析器的块级和行内 source position、浏览器构建、扩展 CSP 与独立 IIFE 输出。所选依赖版本和体积变化需记录，不预先承诺未验证的库接口。
- 用 React 白名单节点输出，不执行原始 HTML。原始 HTML 作为文本显示；未知扩展和无法完整处理的内容可读回退，不能丢弃。
- 阅读链接仅允许明确的安全协议，例如 HTTP(S)、mailto，以及已解析的文内目标；不将 file、javascript、data 等任意输入直接转成导航。外部链接由用户主动点击，禁止自动预取。
- Markdown 图片先显示替代文字和可读的目标说明，不自动请求远程资源。公式、Mermaid 围栏继续作为源文本或代码显示，渲染支持列为 roadmap。

**评论与选择映射：**

- 持久化锚点仍使用 quote / before / after。findAnchorRange 先在规范化 Markdown 中定位原始范围，再映射到阅读 DOM。
- 阅读映射按 UTF-16 源偏移记录可见文本片段，处理转义、实体解码、折叠的语法标记、软换行和单元格边界；不能假设可见字数恒等于源字符数。
- 跨块和重叠评论映射到多个可见片段；激活评论只更新状态，不重建选区。仅引用语法标记、目标不可见或无法可靠定位的评论继续在“未定位”列表可访问。
- 阅读 DOM 不调用现有 getMarkdown、setSelectionOffsets 等逐行编辑器函数。需要维护选区时使用阅读器自己的映射。
- 阅读模式复制用户看到的文本；另提供 Copy Markdown。Source 模式保留当前精确复制 Markdown 的行为；测试分别验证两个契约。

03 的完成门槛是内容覆盖、评论映射和渲染边界同时成立。如果技术验证未通过，继续交付第一阶段和已有 Source 视图，不能以删除原有回归断言宣告完成。

### 4. 接入阅读模式、文档标题与章节导航

涉及 App.tsx、ReadOnlyDocument.tsx、StandaloneApp.tsx，以及新阅读组件。

- 本地编辑增加 Read / Write 切换。使用独立的 localView 状态，不复用当前 readOnly：后者关联分享导入、保存抑制和 fork 行为。
- 进入阅读前取得当前完整编辑快照，妥善结束输入法组合；切换本身不标记文档已修改。保留 Markdown、评论、dirty/save-error 状态，回到 Write 恢复光标与编辑上下文。
- 网站分享、扩展分享与独立 HTML 都通过 ReadOnlyDocument 使用同一阅读实现；本地文档显示 Back to editing，导入分享继续通过 Edit anyway 创建本地副本。
- 在 03 的验收完成后，正式阅读默认使用 Reading，并提供 Source 切换。这是后续阶段明确的展示行为变化；新增 readerView 偏好只存在接收方本地，缺失或非法值使用 Reading。
- 正文页首有可阅读的标题。与首个 Markdown 标题重复时去重显示，原文保持不变；标题、目录文本和正文结构来自同一次解析。
- 从正文标题生成目录；建议至少三个标题才显示，短文不占用固定导航列。重复标题生成确定且唯一的内部 ID。
- 桌面复用可收起导航区域，移动端使用紧凑章节菜单。评论区域优先复用现有布局，不建立挤压正文的第三个固定宽栏。
- 章节跳转通过内部元素定位和滚动完成，不覆写承载分享载荷的 URL fragment。支持键盘定位和合适的标题顶部滚动留白。
- 字体、宽度、模式、评论高度和视口变化均触发布局重算；无匹配锚点的评论保留现有可达入口。
- 文档内容、设置面板、打印产物依然只在已有密码和时间解锁流程通过后显示。

分享的仍是相同 DocState。旧链接使用新应用打开可获得新阅读器；已经导出的旧 HTML 内置旧运行时，不会自动升级。源文保真测试继续覆盖原有 Preview，新阅读器单独建立语义契约。

### 5. 使用浏览器打印交付文档

涉及共享阅读结构、新增 print 样式、ReadOnlyDocument 和 App 的打印入口。

- 增加 Print / Save as PDF 入口，调用浏览器原生打印；不引入服务端或第三方 PDF 转换服务。
- 阅读模式直接使用共享文章结构；Source / Write 模式使用同一解析结果的 print-only 文档区域，避免打印操作栏或逐行源文。打印视图不能成为另一套 Markdown 解析器。
- @media print 中使用白纸、深色正文、明确页边距，隐藏顶栏、固定状态栏、目录交互、评论浮层与编辑控件，取消屏幕宽度、固定定位、溢出裁剪和最小视口高度。
- 初始印刷参数为正文约 10.5–11pt、正常字形、紧凑但可读的行高；A4 与 Letter 分别验收。默认跟随打印对话框纸张选择，不能靠全局缩小字号挤进一页。
- 标题尽量与后文同页，普通段落采用合理 widows/orphans；支持的浏览器应用 break-after 等规则。
- 表格可跨页并保留表头，长代码可换行或拆分。只对能放入一页的小块避免分页，禁止对所有 table/pre/section 一律 break-inside: avoid。
- 初版打印正文与文档标题，评论打印附录列为后续选项；打印入口文案明确“文档正文”。
- 密码或时间保护只适用于原分享入口。打印得到的是解锁后的可读副本，帮助说明据实描述，不暗示 PDF 自动继承保护。
- 用户直接使用浏览器打印快捷键也走相同排版；密码页、未解锁页不能提前挂载明文打印区。

Kami 的 running header、target-counter() 和 WeasyPrint 特定布局不作为浏览器支持前提。打印分页以真实生成的 PDF 为验收依据，CSS 媒体模拟只能证明部分样式。

### 6. 增加少量结构模板

涉及新 lib/document-templates.ts、DocSwitcher.tsx 和 App.tsx。

- 保留 Blank，在新建文档中加入 Brief、Long note、Letter 三种起始模板。
- 学习 Kami 的摘要、主体、结论和行动项组织方式，提供简洁的中英文 Markdown 样例。UI 文案继续遵循仓库现有英文风格。
- 模板只生成 title + md，comments 为空；使用现有 flushSave / createDocResult / adoptDoc 路径创建新文档。创建失败保持当前文档和可见错误，不覆盖已有正文。
- 模板不携带作者身份、日期猜测或虚构业务结论，不存储额外模板 schema，不锁定页面数量。
- “简报”帮助组织一页量级内容，但用户追加正文后不承诺永远一页；保留用户编辑自由。
- Kami 的内容 schema 适合参考模板结构；Foil 不采用强制字数、最低段落数或“禁止 Markdown 标记”的编辑/导出拦截。

### 7. 建立排版样本和真实产物验收

在现有测试结构中增加固定样本，不另建 Python 检查链或公开组件展示站。

- 样本包含中文长文、英文简报、中英混排、连续/重复标题、多层列表、长 URL、长代码、表格、空行、emoji/组合字符，以及跨块/重叠/未定位评论。
- 01 就建立能复现字号覆盖、有序编号、密度行盒问题的浏览器检查。后续任务在同一批样本上扩展，不等到最后才检查视觉效果。
- 自动断言聚焦行为：设置实际生效、编号可见、原文保持一致、内容未缺失、无页面级横向溢出、评论仍可达。避免只断言 CSS 常量与实现相同。
- 采用现有 Playwright 获取固定环境截图；初期人工对照审批视觉基线，只有稳定后再引入必要的截图差异门槛。
- Kami 的视觉脚本本身也要求人工看图，不能将“截图已生成”或“构建通过”视为排版通过。
- 本地样本和 PDF 放进现有忽略的测试产物目录，必要的稳定 fixture 跟随测试源码。生产环境不上传文档进行检查。

## 拆解

优先级表示本次迁入顺序；roadmap 不进入默认任务队列。

| 编号 | 任务 | 优先级 | 难度 | 主要模块 / 产出 | 依赖 | 核心验收 |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | 修正正文设置、行盒和列表显示，建立文档样式作用域 | P0 | medium | design-tokens.css、styles.css、markdown.ts、浏览器样本 | 无 | 21px 设置在编辑/预览正文均为 21px；compact 生效；1./2./42) 可见；原文偏移回归通过 |
| 02 | 中文字体回退、统一标题字体与 Paper 外观 | P1 | medium | types.ts、settings-config.ts、SettingsModal、useReadingSettings、样式 | 01 | 中英文预览清晰；旧设置兼容；浅/深色及已有 accent 可读；无需字体网络请求 |
| 03 | 语义 Markdown 阅读结构与评论源映射 | P1 | hard | 新 reading-document、reading-source-map、ReadingPreview；必要解析依赖 | 01 | 内容覆盖、嵌套结构、映射边界、复制行为、危险输入和离线构建均通过 |
| 04 | 阅读模式、标题与目录接入各宿主 | P1 | hard | App、ReadOnlyDocument、StandaloneApp、阅读导航 | 02、03 | 本地切换无内容丢失；源文可查看；目录不改分享 hash；评论与文件再导出正常 |
| 05 | 文档正文打印与 PDF 排版 | P1 | medium | 共享文章结构、print 样式、打印入口 | 04 | 实际 A4/Letter PDF 无正文裁切、空白尾页和 UI 残留；锁定状态不出现正文 |
| 06 | 简报、长文、信件起始模板 | P2 | medium | document-templates、DocSwitcher、App | 04 | 新建与保存失败路径正确；不覆盖当前文档；模板阅读正确，打印在 05 完成后由 07 联合验收 |
| 07 | 各阶段视觉检查与完整回归 | P1 | medium | 现有单测、网站/扩展/文件浏览器套件、截图与 PDF 验收记录 | 第一阶段依赖 01、02；后续随 03–06 扩展 | 对应阶段的质量门槛和宿主矩阵全部通过 |

依赖主线：01 → 02；01 → 03；02 + 03 → 04；04 → 05 / 06。07 随阶段执行，不需要等待所有扩展任务才验收 01、02。

## 执行偏好

- default_agent: codex。
- 来源：当前 Codex 宿主；用户未指定全局 agent、模型、推理强度或单任务 agent。
- 后续拆解保持默认继承，不把所有任务固化为某个 agent 或模型；按已读取的 agent-routing.md 和任务难度解析执行参数。
- 本轮仅记录执行偏好，不启动 agent、Herdr 或自动执行流程。

## 校验

### 本次分析已完成的验证

- 读取双方仓库说明、Foil 构建/测试配置和相关实现，检查现有 plans 的范围。
- 查看两张 Kami 现有渲染示例图。
- 运行一次源码级 Chromium 样式探测，复现上表的字号、最小行高和列表标记问题；没有持久化探测文件。
- 本轮仅编写规划文档，未运行完整 typecheck、单测、build 或 e2e，不将历史 plan 中的测试结果视为当前基线。

### 实现阶段的仓库级命令

从仓库根目录按顺序运行，遵守 CLAUDE.md，避免真实 600k 轮 KDF 单测与构建并发：

~~~bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run test:e2e:install
bun run test:e2e
~~~

根目录 e2e 会检查网站、已安装扩展和真实下载文件；Chrome/Edge 品牌浏览器手工安装不能用 Playwright Chromium 结果替代。Linux CI 按现有工作流安装浏览器系统依赖。

遵循仓库要求，另验根路径并恢复默认产物：

~~~bash
bunx --no-install turbo run build --filter=@foil/web -- --base /
FOIL_E2E_BASE=/ bun run --cwd apps/web test:e2e --workers=2
bun run build
~~~

03 若新增解析依赖，放在实际使用它的 packages/editor，更新唯一 bun.lock，并运行 bun audit 和 bun audit --prod；CI 继续使用现有审计流程。当前仓库无独立 lint 脚本，不虚构 lint 命令。

### 分阶段验收矩阵

| 维度 | 第一阶段 01–02 | 正式阅读/打印阶段 03–05 |
| --- | --- | --- |
| 内容 | 中文、英文、混排、标题、列表、引用、代码、空行 | 增加表格、嵌套块、实体/转义、源文与阅读复制差异 |
| 视口 | 375 / 768 / 1280px；200% 缩放下主要操作可用 | 目录、长表格及评论移动抽屉；A4/Letter 实际 PDF |
| 设置 | standard/paper × light/dark；各字体、字号、密度、宽度和 accent 有代表性覆盖 | 新旧设置与 Source/Reading 切换；独立文件存储失败回退 |
| 宿主 | 网站编辑/预览、扩展、新导出 HTML | 本地 Read/Write、分享阅读、扩展和 file://、文件再次导出 |
| 数据 | 文本与选区偏移不变、中文 IME、撤销、评论锚点 | 跨块和重叠评论、未定位评论、切换不丢 dirty 状态 |
| 分享 | 四类分享与导出继续通过已有回归 | 旧数据兼容；解锁前不显示正文、目录或打印区；接收偏好不回写快照 |
| 离线和构建 | 普通/密码场景无额外网络或字体请求 | 新解析器无远程加载；HTML 自包含断言和 CSP 仍通过 |

视觉审查关注标题与后文的归属、真实字体回退、中文标点换行、代码可读性、表格宽度及评论遮挡。不要将 Kami 的纸面填充比例、英文字尾孤词阈值照搬成中文网页的硬门槛。

自动 PDF 生成可使用 Chromium；WebKit 检查打印媒体样式并做可行的手工打印验证，不将 Chromium 的 PDF 结果声称为 WebKit 分页证明。

## 风险与假设

1. **用户意图假设。** 按参考仓库明确内容理解为排版；优先提升文档体验。品牌、路由和营销官网不在这次迁入范围。
2. **现有方案重叠。** [foil-brand-and-site](../foil-brand-and-site/plan.md) 已包含 token 归属清理；本方案承接其文档 token 部分，实际路径以当前 monorepo 为准。[html-share-export](../html-share-export/plan.md) 已完成独立阅读基础，不重复建设；其源文预览契约继续在 Source 模式保留。
3. **字体与资源边界。** Kami 本地 README 提醒 TsangerJinKai02 的使用许可有额外限制，模板也含 CDN 回退；Foil 本轮采用系统字体链。若未来打包字体，需要另行核对具体文件许可、文件体积及 HTML/CSP 的资源策略。复制 Kami 模板代码时保留相应 MIT 版权和许可声明。
4. **环境差异。** 系统字体跨平台不同，截图只能在固定环境比较；字体名单存在不代表用户系统已安装。应记录实际可用字体并检查回退效果。
5. **语义渲染风险。** 由原文到可见文字不是一一映射，03 是 hard 任务。复杂 Markdown 不可静默漏字或把评论挂到同名但不同位置的正文；可靠失败回退优先于错误定位。
6. **输入与布局风险。** 01 调整行盒、02 调整字体都会改变选区和评论几何位置；必须保留现有文本不变量，覆盖 IME、空行和字体切换后的重排。
7. **体积与性能。** 解析器只在 Markdown 改变时生成结构，设置切换不重复解析；记录网站主资源、阅读运行时及导出文件大小的增量。用接近当前上限的文档验证交互，避免按评论数重复扫描整篇 DOM。
8. **分享语义。** Paper、字体和 readerView 都是本地偏好，作者与接收方设置不同时外观可以不同。同一设置、同一浏览器下各宿主保持一致；原文件不会因网站升级改变内置样式。
9. **打印差异。** 浏览器分页不等同于 WeasyPrint，不承诺任意长度文档的一页输出或完全相同的页码。文章过长时自然分页，不能牺牲字号或裁切正文。

## 后续可评估方向

以下仅记录借鉴机会，不进入默认拆解：

| 方向 | 标记 | 进入条件 |
| --- | --- | --- |
| 公式、Mermaid 与主题化 SVG 图表 | P2 / roadmap | 正式阅读稳定，明确按需加载、资源与输入处理、离线文件体积及输出契约 |
| 作者可随文档保存排版预设、页眉页脚和署名 | P2 / roadmap | 用户确实需要固定交付外观，再单独设计 schema 和接收方偏好的优先级 |
| 打印评论附录与更多简历/报告模板 | P2 / roadmap | 基础打印实际可用，有具体文档需求 |
| 更准确的中文统计和阅读时间 | P2 / roadmap | 当前按空格计词对中文较粗略，另行统一 App 与 ReadOnlyDocument 的统计函数和估算文案 |
| 本地嵌入开源 CJK 字体 | P2 / roadmap | 对一致外观有明确需求，能接受字体体积，并完成自包含文件与资源限制的专项设计 |

## 执行结果

本轮由 herdr-finish-plan 协调执行，范围为用户指定的 **01、02、03、04、07**；**05（打印/PDF）与 06（起始模板）按用户指令本轮未做**，留待后续追加（05 依赖 04、06 依赖 04，07 再扩展到 05/06 的打印与模板验收）。全部 agent 经 Herdr 启动，auto/YOLO 模式；01 用 `opencode-go/deepseek-flash`（运行中漂移至 qwen3.8-flash），02/03/04/07 用 `alibaba-token-plan-cn/qwen3.8-max`（用户中途改指定）。每个任务独立 worktree、单一最终 commit；协调器在合并前于各 worktree 以 `--force` 绕过 turbo 缓存亲自复跑仓库级校验，再 `git merge --ff-only` 合入 main，随后清理 worktree/workspace/任务分支。

### 合入的 commit 与对应 todo

| todo | 最终 commit | 内容 | 协调器独立校验（force） |
| --- | --- | --- | --- |
| 01-typography-scope-lists | `d55d769` | 文档样式作用域、字号/行盒/密度、olist/ulist/task 区分与原始编号、引用样式、typography 浏览器样本 | typecheck 3/3；editor 640 + extension 241；build |
| 02-cjk-fonts-paper | `576e345` | CJK 字体回退与 cjk-serif 选项、中文 Aa 字体卡片、`readingStyle: standard｜paper` 与 `--doc-*` 语义变量、浅色 accent 链接对比度根因修复 | typecheck 3/3；editor 655 + extension 241；build |
| 03-semantic-reader-mapping | `b06fd8f` | 新增 remark/mdast 解析依赖、`reading-document`/`reading-source-map`/`ReadingPreview`、评论源偏移映射、安全链接/图片边界、构建边界断言 | typecheck 3/3；editor 722 + extension 241；build+standalone 断言；bun audit / --prod 无漏洞 |
| 04-reading-mode-toc | `b9ec9d2` | 本地 Read/Write（独立 `localView`）、阅读默认 Reading + Source 切换、`readerView` 接收方本地偏好、文档标题去重、目录导航（不改 `location.hash`）、四宿主接入 | typecheck 3/3；editor 736 + extension 241；build（standalone 550.19 kB）；根 e2e web 50 + extension 27 |
| 07-visual-regressions | `bd9d4d7` | 固定排版样本（中/英/混排/嵌套/表格/emoji/评论场景）、行为断言矩阵（视口/缩放/外观/主题/字体/accent/宿主/离线/CSP）、截图基线、完整回归 | typecheck 3/3；editor 736 + extension 241；build；根 e2e web 62 + extension 28 |

main 最终 HEAD：`bd9d4d7`。归档文件：`todos/done/01`、`02`、`03`、`04`、`07`（各含完成记录）。`todos/README.md` 状态与完成记录已更新。

### 恢复与异常（均在同任务范围内恢复，未越权）

- **01 恢复#1**：首轮 e2e 通过后停在 idle，未提交/未归档；发继续指令后完成校验、归档与单一 commit。
- **04 恢复#1**：`pkill -f "vite preview"` 误杀自身包装 shell，导致 e2e 管道永久阻塞、会话卡死（context 冻结、无子进程）。esc 无效、ctrl+c 终止旧进程后，在同 pane 以同 kind/model/mode 重启 agent，21 个未提交改动完整保留；改用 `[v]ite preview` + `timeout` + 文件重定向（不用 `| tail`）跑完全部 e2e。扩展 e2e 首跑因缺 ZIP 产物使 package.spec 失败（环境步骤遗漏），先 `package` 再跑得 27/27。
- **07 恢复#1**：尝试「查看」PNG 截图做人工视觉对照时，多模态接口报 `Download multimodal file timed out` 中断该轮；发继续指令明确禁止读图（视觉基线人工审批留线下），改为生成基线 + 行为断言，跑完整回归后提交。

### blocked / deferred

- 无 blocked 项。
- deferred：**05 文档正文打印与 PDF 排版**、**06 简报/长文/信件起始模板**（用户本轮明确不做）。
- 线下待办：07 生成的截图基线（`apps/web/test-results/visual-baseline/` 37 张/次、`apps/extension/test-results/visual-baseline/` 3 张/次，均在已忽略目录、每次运行重新生成）需人工对照审批；稳定后再考虑引入截图差异门槛。
- 已知取舍（记录在案，非缺陷）：长代码行在阅读视图 `pre` 内滚动（页面无横向溢出）；未定位评论仅阅读视图可达；图片/脚注标记为原子高亮片段；病态 `==` 连串按 GFM 序列规则与 Foil 行内正则有细微差异（普通 `==x==` 完全一致）。

### 体积影响（解析器接入后）

03 引入 remark/mdast 解析依赖并在 04 接入阅读运行时：网站主 JS 与 standalone 各增约 +100 KB（min），`foil-standalone.js` 由 03 阶段 445.90 kB 增至 04 后 550.19 kB；构建断言（standalone 无编辑器/库/外部 chunk 依赖、扩展 manifest、CSP）全程通过，`bun audit` 与 `bun audit --prod` 无漏洞。
