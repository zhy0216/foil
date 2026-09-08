import { parseHtmlShareData, type HtmlShareData } from './html-share-format';
import { parseStandaloneRuntime, STANDALONE_IDS, type StandaloneRuntime } from './standalone-runtime';

export interface HtmlExportInput {
  payload: string;
  runtime: StandaloneRuntime;
  shareBaseUrl?: string;
  /** Used only for plain #d= files. Protected shells always use a generic name. */
  title?: string;
}

export interface HtmlExport {
  html: string;
  filename: string;
}

const GENERIC_TITLE = 'Foil shared document';
const DRAND_ORIGINS = 'https://api.drand.sh https://drand.cloudflare.com https://api2.drand.sh https://api3.drand.sh';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}

/** User data never enters executable code or an HTML attribute. */
function dataJson(data: HtmlShareData): string {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}

export function htmlFileName(title: string, payload: string): string {
  if (!payload.startsWith('#d=')) return 'foil-shared-document.html';
  const clean = title.slice(0, 200).normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '-')
    .replace(/[\ud800-\udfff]/gu, '').replace(/^[.\s]+|[.\s]+$/g, '');
  // Leave room for the extension even on filesystems with a 255-byte limit.
  let name = '', bytes = 0;
  for (const char of clean) {
    bytes += new TextEncoder().encode(char).length;
    if (bytes > 180) break;
    name += char;
  }
  name = name.replace(/[.\s]+$/g, '') || 'foil-shared-document';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name.replace(/\.html$/i, '') + '.html';
}

/** Pure assembly apart from SHA-256; no download, DOM snapshot, or storage. */
export async function assembleHtmlShare(input: HtmlExportInput): Promise<HtmlExport> {
  const data = parseHtmlShareData({
    format: 'foil-share', version: 1, payload: input.payload,
    ...(input.shareBaseUrl === undefined ? {} : { shareBaseUrl: input.shareBaseUrl }),
  });
  const { script, styles } = parseStandaloneRuntime(input.runtime);
  if (!globalThis.crypto?.subtle) throw new Error('HTML export requires Web Crypto in this browser.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script));
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; connect-src ${DRAND_ORIGINS}; img-src data:; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';`;
  const title = data.payload.startsWith('#d=') ? input.title?.trim() || GENERIC_TITLE : GENERIC_TITLE;
  return {
    filename: htmlFileName(title, data.payload),
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style id="${STANDALONE_IDS.styles}">${styles}</style>
</head>
<body>
<div id="${STANDALONE_IDS.root}"><p role="status">Opening shared document…</p></div>
<noscript>Enable JavaScript to read this shared document.</noscript>
<script id="${STANDALONE_IDS.data}" type="application/json">${dataJson(data)}</script>
<script id="${STANDALONE_IDS.script}">${script}</script>
</body>
</html>`,
  };
}

export interface HtmlDownload {
  /** Synchronous final step, after the host has checked its export snapshot. */
  download: () => void;
  /** Idempotent; also called automatically after download or on click failure. */
  dispose: () => void;
}

export function createHtmlDownload(file: HtmlExport): HtmlDownload {
  const url = URL.createObjectURL(new Blob([file.html], { type: 'text/html;charset=utf-8' }));
  let disposed = false, started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    URL.revokeObjectURL(url);
  };
  return {
    dispose,
    download() {
      if (disposed || started) throw new Error('This HTML download is no longer available.');
      started = true;
      const link = document.createElement('a');
      try {
        link.href = url;
        link.download = file.filename;
        document.body.append(link);
        link.click();
        // Give file navigation time to consume the URL (including WebKit).
        timer = setTimeout(dispose, 1000);
      } catch {
        dispose();
        throw new Error('Could not start the HTML download. Please retry.');
      } finally {
        link.remove();
      }
    },
  };
}
