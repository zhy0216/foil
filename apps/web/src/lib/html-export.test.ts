import { Blob as NodeBlob } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assembleHtmlShare, createHtmlDownload, htmlFileName } from './html-export';
import { decodeHtmlPayload, encodeHtmlPayload } from './url-codec';
import { parseStandaloneRuntime, STANDALONE_IDS } from './standalone-runtime';
import { HTML_SHARE_DATA_MAX_CHARS, readEmbeddedShareData, readStandaloneRuntime } from '../standalone/resources';
import type { DocState } from '../types';

const runtime = { script: 'globalThis.foilRuntime = "中文🌱";\r\n/* final line */\r', styles: 'body { color: blue; }\r\n' };
const sentinel = {
  title: 'PRIVATE_TITLE_小猫 </title><script>globalThis.pwned=1</script>',
  md: 'PRIVATE_MD_🌱 </script><img src=x onerror="globalThis.pwned=2"> & \u2028\u2029',
  comment: 'PRIVATE_COMMENT_评论 </script><script>globalThis.pwned=3</script>',
  password: 'PRIVATE_PASSWORD_🔑',
};
const doc: DocState = {
  title: sentinel.title, md: sentinel.md,
  comments: [{ id: 'comment', quote: 'PRIVATE_MD', before: '', after: '', replies: [
    { id: 'reply', author: 'Author', ts: 1, body: sentinel.comment },
  ] }],
};
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('Blob', NodeBlob);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('HTML assembly and file resources', () => {
  it('round-trips hostile Unicode content without escaping the data block or title', async () => {
    const payload = await encodeHtmlPayload(doc);
    const file = await assembleHtmlShare({ payload, runtime, title: doc.title,
      shareBaseUrl: 'https://example.test/foil/?private=query#private' });
    const dom = parse(file.html);
    expect(dom.title).toBe(doc.title);
    expect(dom.querySelectorAll('script')).toHaveLength(2);
    expect(dom.querySelector('img, script[src], link, iframe, base, form')).toBeNull();
    const data = readEmbeddedShareData(dom);
    expect(data.shareBaseUrl).toBe('https://example.test/foil/');
    expect(await decodeHtmlPayload(data.payload)).toEqual({ state: doc });
    expect(dom.getElementById(STANDALONE_IDS.data)?.textContent).not.toMatch(/[<>&\u2028\u2029]/);
    expect(file.filename).toMatch(/\.html$/);
    expect(file.filename).not.toMatch(/[<>:"/\\|?*]/);
  });

  it('hashes the exact UTF-8 bytes parsed from the final inline script', async () => {
    const file = await assembleHtmlShare({ payload: '#d=e30', runtime: {
      ...runtime, script: runtime.script + '/* lone surrogate: \ud800 */',
    } });
    const dom = parse(file.html);
    const script = dom.getElementById(STANDALONE_IDS.script)!.textContent!;
    expect(script).not.toContain('\r');
    expect(script).not.toContain('\ud800');
    const expected = createHash('sha256').update(script, 'utf8').digest('base64');
    const csp = dom.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')!;
    expect(csp).toContain(`script-src 'sha256-${expected}';`);
    expect(csp.split('script-src ')[1].split(';')[0]).not.toMatch(/unsafe-inline|unsafe-eval|self|https/);
    expect(csp).toContain("object-src 'none'; base-uri 'none'; form-action 'none'");
    expect(csp).toContain('connect-src https://api.drand.sh https://drand.cloudflare.com https://api2.drand.sh https://api3.drand.sh;');
  });

  it('keeps the title, text, comments and password out of a real password file', async () => {
    const payload = await encodeHtmlPayload(doc, { password: sentinel.password });
    const file = await assembleHtmlShare({ payload, runtime, title: doc.title });
    for (const text of ['PRIVATE_TITLE', 'PRIVATE_MD', 'PRIVATE_COMMENT', 'PRIVATE_PASSWORD']) {
      expect(file.html).not.toContain(text);
      expect(file.filename).not.toContain(text);
    }
    expect(parse(file.html).title).toBe('Foil shared document');
    expect(file.filename).toBe('foil-shared-document.html');
    expect(await decodeHtmlPayload(readEmbeddedShareData(parse(file.html)).payload, sentinel.password)).toEqual({ state: doc });
  });

  it.each(['e', 'td', 'te'])('uses a generic shell for #%s even if the caller passes a sensitive title', async scheme => {
    const payload = '#' + scheme + '=' + 'A'.repeat(60);
    const file = await assembleHtmlShare({ payload, runtime, title: sentinel.title });
    expect(file.html).not.toContain('PRIVATE_TITLE');
    expect(file.filename).toBe('foil-shared-document.html');
  });

  it('reuses only the fixed program/styles without capturing unlocked DOM or growing', async () => {
    let file = await assembleHtmlShare({ payload: '#d=e30', runtime });
    const original = file.html;
    for (let i = 0; i < 3; i++) {
      const dom = parse(file.html);
      dom.getElementById('root')!.textContent = 'OLD_UNLOCKED_PLAINTEXT';
      dom.title = 'OLD_UNLOCKED_TITLE';
      const own = readStandaloneRuntime(dom);
      expect(own).toEqual(parseStandaloneRuntime(runtime));
      file = await assembleHtmlShare({ payload: '#d=e30', runtime: own });
      expect(file.html).toBe(original);
      expect(file.html).not.toContain('OLD_UNLOCKED');
    }
  });

  it.each([
    { script: '</script><script>alert(1)</script>', styles: 'body{}' },
    { script: '<!--<script>', styles: 'body{}' },
    { script: 'void 0;', styles: '</style><img src=x>' },
    { script: 'void 0;\0', styles: 'body{}' },
    { script: '', styles: 'body{}' },
  ])('rejects resources that can change HTML parsing', async bad => {
    await expect(assembleHtmlShare({ payload: '#d=e30', runtime: bad })).rejects.toThrow('reading program');
  });

  it('fails closed for invalid payload/base and absent Web Crypto', async () => {
    await expect(assembleHtmlShare({ payload: '#unknown=e30', runtime })).rejects.toThrow('Unsupported share scheme');
    await expect(assembleHtmlShare({ payload: '#d=e30', runtime, shareBaseUrl: 'file:///private.html' })).rejects.toThrow('base URL');
    vi.stubGlobal('crypto', undefined);
    await expect(assembleHtmlShare({ payload: '#d=e30', runtime })).rejects.toThrow('Web Crypto');
  });

  it.each([
    ['../../bad\\file:*?"<>|', 'bad-file------.html'],
    ['CON.txt', '_CON.txt.html'], ['NUL', '_NUL.html'], [' . ', 'foil-shared-document.html'],
    ['你好 🌱.html', '你好 🌱.html'],
  ])('makes a safe filename for %s', (title, expected) => {
    const filename = htmlFileName(title, '#d=e30');
    if (title.startsWith('../')) {
      expect(filename).not.toMatch(/[/\\:*?"<>|]|^\./);
    } else expect(filename).toBe(expected);
    expect(new TextEncoder().encode(htmlFileName('🌱'.repeat(300), '#d=e30')).length).toBeLessThan(255);
  });
});

describe('embedded data boundary', () => {
  it.each([
    '', '<script id="foil-share-data">{}</script>',
    '<script id="foil-share-data" type="application/json" src="elsewhere">{}</script>',
    '<script id="foil-share-data" type="application/json">{"PRIVATE_INPUT":</script>',
    '<script id="foil-share-data" type="application/json">{}</script><div id="foil-share-data"></div>',
  ])('rejects missing, executable, external, corrupt and duplicate data', html => {
    expect(() => readEmbeddedShareData(parse(html))).toThrow();
    try { readEmbeddedShareData(parse(html)); }
    catch (error) { expect(String(error)).not.toContain('PRIVATE_INPUT'); }
  });
  it('rejects oversized JSON text before parsing and rejects unknown versions', () => {
    const dom = parse('<script id="foil-share-data" type="application/json"></script>');
    const block = dom.getElementById('foil-share-data')!;
    block.textContent = ' '.repeat(HTML_SHARE_DATA_MAX_CHARS + 1);
    const parseSpy = vi.spyOn(JSON, 'parse');
    expect(() => readEmbeddedShareData(dom)).toThrow('Invalid HTML share data');
    expect(parseSpy).not.toHaveBeenCalled();
    block.textContent = JSON.stringify({ format: 'foil-share', version: 2, payload: '#d=e30' });
    expect(() => readEmbeddedShareData(dom)).toThrow('Unsupported HTML share version');
  });
});

describe('download lifecycle', () => {
  it('separates preparation from a single click and revokes the UTF-8 Blob URL', () => {
    vi.useFakeTimers();
    const create = vi.fn((_blob: Blob) => 'blob:foil');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true);
      expect(this.download).toBe('file.html');
    });
    const handle = createHtmlDownload({ html: '中文🌱', filename: 'file.html' });
    expect(create.mock.calls[0][0]).toBeInstanceOf(NodeBlob);
    expect((create.mock.calls[0] as unknown as [Blob])[0].type).toBe('text/html;charset=utf-8');
    expect(click).not.toHaveBeenCalled();
    handle.download();
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    expect(() => handle.download()).toThrow('no longer available');
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    handle.dispose();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:foil');
  });
  it('disposes cancelled preparations and failed downloads without leaving an anchor', () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:foil'), revokeObjectURL: revoke }));
    const handle = createHtmlDownload({ html: '', filename: 'file.html' });
    handle.dispose();
    expect(() => handle.download()).toThrow('no longer available');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('PRIVATE_ERROR'); });
    const second = createHtmlDownload({ html: '', filename: 'file.html' });
    expect(() => second.download()).toThrow('Could not start the HTML download');
    second.dispose();
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
