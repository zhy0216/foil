# Foil 品牌统一与产品官网方案

## 意图

本方案落实两项工作：清除设计令牌中的 Alumnium 品牌残留，并为 Foil 增加一个以产品介绍和隐私解释为核心的静态官网。方案基于当前仓库的实际结构：`src/main.tsx` 是唯一编辑器入口，`App.tsx` 在顶部栏显示 Foil 品牌，`HelpModal.tsx`、`README.md` 和示例文档重复维护产品文案，`index.html` 目前直接加载编辑器，`vite.config.ts` 将部署 base 固定为 `/foil/`。官网改造不能让已有 `/foil/#d=...`、`/foil/#e=...`、`/foil/#td=...`、`/foil/#te=...` 分享链接失效，因此采用静态多页面入口，并由新首页把旧分享链接无损转交给编辑器入口。

## 目标 / 非目标

### 目标

- 将颜色、字体、Logo、产品术语和隐私文案统一为 Foil 品牌，不再出现 Alumnium 或 `alumnium.ai`。
- 保留当前极简编辑器的交互和可配置主题；只强化“折叠纸张 / 金属箔片 / F”标志、纸张感正文和单一蓝色品牌强调色。
- 增加可被搜索引擎和社交平台读取的静态产品首页，明确说明“写在本地、按链接分享、可选密码或时间锁”。
- 首页提供立即打开编辑器、查看隐私边界、查看源码、自托管和下载等入口。
- 保持 GitHub Pages `/foil/` 部署可用，并允许将来通过环境变量切换到自定义域名根路径。
- 保证现有分享 URL、密码解锁、时间胶囊解锁和编辑器本地保存行为不因入口变化而改变。
- 官网不引入第三方字体、广告、追踪脚本或外部图片请求，继续符合当前无后台、无遥测的产品承诺。

### 非目标

- 不在本方案中增加账户、云同步、支付、团队协作、远程撤销或其他后端能力。
- 不修改 URL 加密、tlock、Markdown 编辑器或本地存储协议。
- 不把只读分享/fork 描述为实时协作，也不宣称链接可远程撤销或文档永不丢失。
- 不进行大范围编辑器视觉重做，不引入设计系统框架或 CMS。
- 不在没有域名和商标核验结果的情况下承诺最终域名、注册商标或固定 canonical URL。

## 现状证据与约束

- `src/main.tsx` 同时加载 `design-tokens.css`、`styles.css` 并渲染 `App`，所以设计令牌改动会影响编辑器、设置面板和所有弹层。
- `src/styles/design-tokens.css:2-3` 仍写着 “Alumnium Design System” 和 `alumnium.ai`；`src/styles/design-tokens.css:84` 还把暗色主题注释为 `alumnium.ai`。当前默认 Cerulean 色值已被 `settings-config.ts` 和 Logo 使用，不能通过删除变量破坏现有主题设置。
- `src/App.tsx:776-779` 直接渲染 `F` 品牌标志；`src/components/HelpModal.tsx`、`README.md` 和 `SAMPLE_MD` 中有产品定义、加密和时间胶囊说明，需要共享术语但必须以当前实现为准。
- `index.html:6` 的标题仍是 `Foil — markdown editor`，页面没有 description、Open Graph、Twitter Card、主题色或可索引的营销内容。
- `vite.config.ts:20` 固定 `base: '/foil/'`；GitHub Pages workflow 将 `dist/` 作为静态产物发布。官网和编辑器必须同时适配子路径和自定义域名。
- `ShareModal.tsx` 以当前 `window.location.pathname` 生成分享链接，因此编辑器迁移到新路径后，分享链接会自然使用新路径；旧根路径链接需要由官网入口转发。

## 方案

### 1. 建立 Foil 品牌内容和术语源

新增一个轻量的静态内容模块，例如 `src/content/brand.ts`，集中维护：

- 产品名：`Foil`；
- 主标题：`写在本地，分享有界。`；
- 英文副标题：`Write privately. Share deliberately.`；
- 产品描述：浏览器内的私密写作空间，文档默认留在设备上，分享时复制链接，可选密码或未来解锁时间；
- 功能名称：`Foil Link`、`Password link`、`Time capsule`；
- CTA：`Open the editor`、`How privacy works`、`View source`、`Self-host Foil`。

`HelpModal`、官网和编辑器内需要重复出现的短文案从该模块读取，长篇威胁模型仍保留在 README/帮助页，但必须逐句核对当前代码。品牌文案使用“host cannot read the fragment”这类准确表述，不使用没有证据支持的“绝对安全”“完全匿名”“实时协作”。

### 2. 清除 Alumnium 残留并强化 Foil 视觉

涉及 `src/styles/design-tokens.css`、`src/styles/styles.css`、`src/App.tsx` 和必要的图标资源：

- 将文件头、主题注释、色板说明改写为 Foil Design System；
- 保留 `--cerulean-*`、`--zinc-*`、`--accent*` 等现有变量，保证 `settings-config.ts` 的 Cerulean、Emerald、Ember、Violet、Graphite 选项仍然工作；
- 增加语义化品牌变量，例如品牌蓝、Logo 背景、纸张正文色和金属折痕色，并让默认主题使用它们；
- 保持深色背景、纸张色正文、系统字体和单一蓝色 CTA，避免渐变、霓虹、终端或“黑客工具”视觉；
- 将现有方形 `F` 标记细化为可识别的折叠纸张/箔片标志。优先使用 CSS/SVG，确保 favicon、顶部栏、官网 Logo 和社交图片使用同一几何形状；
- 为 Logo、按钮、链接和警告状态建立足够的浅色/深色对比度；不把蓝色作为唯一的状态表达方式；
- 不改变编辑器正文的字号、主题切换、密度和用户自定义 accent 的行为，除非视觉审查发现品牌色覆盖了设置项。

同时更新 `App.tsx` 的顶部品牌、`HelpModal` 的标题和说明、示例文档首段以及 README 的产品开场，使它们都使用同一主张。文案更新不能顺手修改密码学协议；如果发现 README/Help 中的旧加密链路或“完全离线”表述与实现不一致，只按现状校准描述。

### 3. 将静态首页与编辑器拆成多页面入口

采用 Vite 多页面构建，避免营销首页加载完整编辑器，也避免依赖客户端路由或服务器 rewrite：

- `index.html` 改为产品官网入口，加载新的 `src/landing.tsx`；
- 新增 `app/index.html`，继续加载现有 `src/main.tsx`，编辑器地址为 `/foil/app/`；
- 在 `vite.config.ts` 配置两个 HTML 输入，抽取官网与编辑器共享的 token/品牌资源；
- 将 `base` 改为可配置值，例如默认 `VITE_BASE_PATH=/foil/`，部署自定义域名时可用 `/`，代码中使用 `import.meta.env.BASE_URL` 生成 CTA、资源和分享链接；
- 官网在 React 挂载前检查 `location.hash`。旧的 `/foil/#...` 链接保留原 fragment，不解码、不记录内容，直接跳转到 `/foil/app/#...`；未知非空 fragment 也交给编辑器，让现有错误恢复流程继续生效；
- 新编辑器入口生成的链接使用 `/foil/app/` 路径，旧链接继续通过首页跳转；
- 对 `/foil/app/`、`/foil/app/index.html` 和本地预览路径分别做静态服务器验证，避免 GitHub Pages 子目录下的绝对 `/src`、`/assets` 或 `/app` 链接。

如果实际部署环境无法稳定提供目录 index，则使用同等功能的 `/app.html` 入口，并在方案实现时统一旧链接跳转规则；选择以 GitHub Pages 和当前 preview 的实际结果为准，不同时维护两套路由。

### 4. 官网页面结构与内容

官网保持单页、静态、可阅读优先，建议结构如下：

1. **Hero**：Foil Logo、主标题“写在本地，分享有界。”、一句产品解释、`打开编辑器` 主按钮和 `查看隐私原理` 次按钮；
2. **产品示例**：用静态 HTML/CSS 模拟当前编辑器，展示一段 Markdown、评论锚点和 Share 状态，不在首页启动真实编辑器状态；
3. **三步分享流程**：
   - 在浏览器中写作；
   - 复制一个包含文档的链接；
   - 根据需要添加密码或未来解锁时间；
4. **隐私边界**：明确本地存储、URL fragment 不发送给宿主、无账户/后台/遥测，同时说明普通链接、浏览器历史、剪贴板、drand 依赖和本地存储清除风险；
5. **功能卡片**：本地 Markdown、密码链接、时间胶囊、只读预览与 fork、文本锚定评论；
6. **适用场景**：敏感草稿、研究笔记、提案审阅、写给未来的信。避免把它写成企业实时协作套件；
7. **开源与自托管**：GitHub、下载静态文件、自托管说明和 README 链接；
8. **Footer**：隐私/威胁模型、源码、联系入口和版本信息。

页面采用现有系统字体和 CSS token，支持 320px、768px、1440px 宽度，支持键盘导航、`prefers-reduced-motion` 和浅色/深色系统主题。第三方图片、字体、嵌入视频和统计脚本不进入首页。

### 5. 元数据与品牌资源

在 `index.html` 与共享 `public/brand/` 资源中补齐：

- 精确的 `<title>`，例如 `Foil — 私密写作，按链接分享`；
- `meta description`，描述本地写作、链接分享、密码和时间胶囊；
- `theme-color`、语言属性和基础 viewport；
- `og:title`、`og:description`、`og:type`、`og:image` 与 Twitter Card；
- 统一的 SVG favicon、Logo 和 1200×630 社交分享图；
- 资源全部使用相对/`BASE_URL` 路径，不把未知生产域名硬编码进 canonical；域名确定后再补 canonical 和 sitemap。

社交图片只展示 Foil Logo、`Write privately. Share deliberately.` 和简短功能提示，不展示真实用户文档、URL fragment、密码或随机加密载荷。

### 6. 文档和应用内入口同步

- 更新 `HelpModal` 的“About Foil”开场和三种分享方式，使官网、帮助和 README 的术语一致；
- 更新 README 顶部产品介绍、官网入口、自托管入口和截图/预览说明；技术细节继续说明“分享即链接”的实际边界；
- 在编辑器品牌栏或帮助弹层增加“官网 / How Foil works”入口，但不让用户离开未保存编辑；新窗口链接使用现有安全属性；
- 在官网与 README 中明确编辑器入口为 `/app/`（或最终选定的 `/app.html`），并说明旧分享链接兼容策略；
- 任何文案出现“secure”“private”“encrypted”时，回到当前 `url-codec.ts`、`timecapsule.ts` 和 README 威胁模型核对，不把品牌语言变成安全保证。

## 拆解

| 顺序 | 任务 | 主要文件 / 产出 | 依赖 | 难度 |
| --- | --- | --- | --- | --- |
| 01 | 品牌内容盘点与术语源 | `src/content/brand.ts`；现有 App/Help/README 文案清单 | 无 | easy |
| 02 | Foil token 与 Logo 统一 | `src/styles/design-tokens.css`、`src/styles/styles.css`、`src/App.tsx`、`public/brand/` | 01 | medium |
| 03 | 多页面入口和旧链接迁移 | `index.html`、`app/index.html`、`src/landing.tsx`、`vite.config.ts`、必要的分享路径 helper | 01 | hard |
| 04 | 官网组件、响应式布局和 SEO | 官网 JSX/CSS、meta、favicon、OG 图片、开源/自托管入口 | 02、03 | medium |
| 05 | 应用内与文档文案同步 | `HelpModal.tsx`、`README.md`、`App.tsx` 示例文档及入口 | 01、02、03 | medium |
| 06 | 回归、可访问性和部署验收 | Playwright/静态产物检查、视觉检查、旧/新分享链接矩阵 | 02–05 | medium |

依赖关系为 `01 → 02`、`01 → 03`、`02+03 → 04`、`01+02+03 → 05`、`02–05 → 06`。不拆出独立的支付、后端或同步任务；这些属于后续产品化方案。

## 执行偏好

- `default_agent: codex`
- 来源：当前 Codex 宿主；用户未指定全局 agent、模型或推理强度，也未指定单任务 agent。
- 任务执行时按仓库既有分发规则根据 `difficulty` 选择模型和推理强度；本方案不把某个具体模型固化到所有任务。
- 本方案只记录执行队列，不启动 agent、不创建 todos、不修改业务代码。

## 校验

### 仓库级命令

每个实现阶段至少运行：

```bash
bun run typecheck
bun run test
bun run build
bun run test:e2e
```

### 品牌与页面验收

- `rg -n -i "alumnium|alumnium\.ai" src index.html README.md public vite.config.ts` 无品牌残留；历史审计记录若保留，必须明确标记为历史，不出现在产品页面或设计 token 中。
- 生产构建同时产出官网入口和编辑器入口，CSS、JS、favicon、OG 图片均能在 `/foil/` 子路径加载；自定义 `VITE_BASE_PATH=/` 构建也不生成 `/foil/` 硬编码资源。
- 根页面可见主标题、产品说明、三步分享流程、隐私边界、GitHub/下载/自托管入口和两个 CTA；页面源 HTML 含 title、description、OG/Twitter 元数据。
- 点击官网 CTA 能打开编辑器；编辑器中的 Logo、主题、设置和本地文档行为与改造前一致。
- 用一份最小 `#d=` fixture 验证 `/foil/#d=...` 会保留 fragment 跳转到编辑器并进入只读预览；对 `#e=`、`#td=`、`#te=` 至少验证入口未剥离 fragment，密码/时间胶囊流程由原有测试覆盖。
- 从新编辑器生成的分享链接使用新编辑器路径；刷新、复制、打开和 fork 均能工作，URL fragment 不被官网脚本读取或记录。
- Playwright 覆盖 Chromium/WebKit 下的 320px 移动布局、键盘 Tab 顺序、可见焦点、浅色/深色主题、CTA、旧链接跳转和页面无控制台错误；官网不产生外部网络请求。
- 用 Lighthouse 或等价人工检查确认无明显缺失的可访问名称、对比度、链接焦点、移动溢出和图片替代文本；社交图片不包含真实文档数据。
- 现有 `bun run test:e2e` 的本地编辑、保存、刷新恢复和分享回归必须继续通过；不以更新截图掩盖交互变化。

## 风险与假设

- **旧分享链接风险**：把 `/foil/` 变成官网后，旧链接会先到首页；fragment 转发必须发生在任何 React 营销内容加载前，且不能把 fragment 发给服务器或日志。该跳转需要实际 GitHub Pages 和 preview 验证。
- **部署 base 风险**：当前 base 固定为 `/foil/`。改成可配置后需要同时验证 GitHub Pages、`bun run preview` 和自定义域名根路径，不能只在根路径开发服务器测试。
- **入口迁移风险**：`ShareModal` 当前从 `window.location.pathname` 生成链接，编辑器入口迁移后必须验证四种 scheme 的新路径；不得生成指向官网的分享 URL。
- **安全文案风险**：官网是公开承诺。普通链接可被持有者读取，浏览器历史/剪贴板可能暴露 URL，时间胶囊依赖 drand，本地数据可能因清除站点数据丢失；这些边界必须在首屏或隐私区可见。
- **视觉 token 风险**：设置允许用户切换 accent。新增 Foil 语义变量只能作为默认品牌层，不能删除现有 accent 覆盖或让用户选择被 Logo 样式强行覆盖。
- **SEO 资产风险**：没有确定生产域名时不生成错误 canonical、sitemap 或绝对 OG URL；先使用相对路径和可替换的环境配置。
- **品牌法律风险**：本方案不包含域名/商标核验。公开发布前应单独检查 Foil 名称在目标市场的可用性，并准备备用命名策略。
- **范围控制假设**：官网保持静态，不添加追踪、表单后端或邮件收集；若后续需要候补名单、支付或云同步，应另立产品和隐私方案，不能把临时脚本塞进本次官网。
