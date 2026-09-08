import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, type BrowserContext, type Page, type Route, type TestInfo } from '@playwright/test';
import type { DocState } from '../../../src/types';
import { DRAND_BEACON, DRAND_INFO, DRAND_ORIGINS, UNLOCK_MS } from './drand';

export type Mode = 'd' | 'e' | 'td' | 'te';
export const PASSWORD = 'FILE_PASSWORD_SENTINEL_中文🔑';
export const DOC: DocState = {
  title: 'FILE_TITLE_SENTINEL 中文 🌱 </title><script>globalThis.fileInjected=1</script>',
  md: '# FILE_BODY_SENTINEL 中文 🌱\n\nRead this text across\nlines.\n\n```html\n\n</script><img src="https://evil.invalid/pixel" onerror="globalThis.fileInjected=1">\n```\n<&> "quotes" \'apostrophe\' \u2028 \u2029\nLast line.',
  comments: [
    { id: 'cross-line', quote: 'text across\nlines.', before: 'Read this ', after: '\n\n```', replies: [
      { id: 'r1', author: '作者 <&> 🌱', ts: 1, body: 'FILE_COMMENT_SENTINEL </script><svg onload="globalThis.fileInjected=1"> & 中文' },
      { id: 'r2', author: 'Reader 二', ts: 2, body: 'Reply with emoji 🧭 and "quotes".' },
    ] },
    { id: 'unlocated', quote: 'This quote was removed', before: '', after: '', replies: [
      { id: 'r3', author: 'Unlocated reader', ts: 3, body: 'UNLOCATED_COMMENT_SENTINEL still readable' },
    ] },
  ],
};

export function hasPassword(mode: Mode) { return mode === 'e' || mode === 'te'; }
export function hasTime(mode: Mode) { return mode === 'td' || mode === 'te'; }

export async function seedAuthor(context: BrowserContext, doc = DOC) {
  await context.addInitScript(doc => {
    localStorage.setItem('foil_doc_file-author', JSON.stringify({ ...doc, id: 'file-author', createdAt: 1, updatedAt: 1 }));
    sessionStorage.setItem('foil_current_id', 'file-author');
    localStorage.setItem('foil_name', 'AUTHOR_PRIVATE_NAME_SENTINEL');
    localStorage.setItem('foil_settings', JSON.stringify({ theme: 'dark', proseSize: 'small' }));
  }, doc);
}

export async function snapshot(page: Page) {
  return page.locator('.editor').evaluate(el => Array.from(el.querySelectorAll('.ln'))
    .map(line => (line.textContent ?? '').replace(/\u200b/g, '')).join('\n'));
}

export async function options(page: Page, mode: Mode, password = PASSWORD) {
  if (hasPassword(mode)) {
    await page.getByRole('switch', { name: 'Require a password', exact: true }).click();
    await page.getByPlaceholder('Choose a password').fill(password);
  }
  if (hasTime(mode)) {
    await page.getByRole('switch', { name: 'Time-lock until a future date', exact: true }).click();
    await page.getByRole('button', { name: 'Custom', exact: true }).click();
    await page.locator('input[type="datetime-local"]').fill(new Date(UNLOCK_MS).toISOString().slice(0, 16));
    await expect(page.locator('.tc-readout-sub')).toContainText(`drand round #${DRAND_BEACON.round}`);
  }
}

export async function download(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath('moved 文档', name + '.html');
  await mkdir(dirname(path), { recursive: true });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export HTML', exact: true }).click();
  const result = await pending;
  await result.saveAs(path);
  expect(await result.failure()).toBeNull();
  await expect(page.getByText('HTML download started.', { exact: true })).toBeVisible();
  const html = await readFile(path, 'utf8');
  const bytes = Buffer.byteLength(html);
  info.annotations.push({ type: 'HTML bytes', description: `${name}: ${bytes}` });
  return { path, html, bytes, filename: result.suggestedFilename() };
}

export function block(html: string, tag: 'script' | 'style', id: string) {
  const blocks = [...html.matchAll(new RegExp(`<${tag} id="${id}"[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))];
  expect(blocks).toHaveLength(1);
  return blocks[0][1];
}

export function inspectFile(html: string, mode: Mode, baseURL: string, password = PASSWORD) {
  const data = JSON.parse(block(html, 'script', 'foil-share-data'));
  expect(data).toMatchObject({ format: 'foil-share', version: 1, shareBaseUrl: baseURL });
  expect(data.payload).toMatch(new RegExp(`^#${mode}=[A-Za-z0-9_-]+$`));
  const script = block(html, 'script', 'foil-share-runtime');
  const styles = block(html, 'style', 'foil-share-styles');
  const digest = createHash('sha256').update(script, 'utf8').digest('base64');
  expect(html).toContain(`script-src &#39;sha256-${digest}&#39;;`);
  expect(html).not.toMatch(/<script\b[^>]*\bsrc=|<link\b|\bunsafe-eval\b/i);
  expect(styles).not.toMatch(/@import\b|url\s*\(/i);
  // The runtime includes the re-export assembler's literal opening tags. Count
  // shell elements without treating JavaScript strings as additional HTML.
  expect([...html.replace(script, '').matchAll(/<script\b/g)]).toHaveLength(2);
  for (const privateValue of ['AUTHOR_PRIVATE_NAME_SENTINEL', password]) expect(html).not.toContain(privateValue);
  if (mode !== 'd') {
    expect(html).toContain('<title>Foil shared document</title>');
    for (const sentinel of ['FILE_TITLE_SENTINEL', 'FILE_BODY_SENTINEL', 'FILE_COMMENT_SENTINEL', 'UNLOCATED_COMMENT_SENTINEL']) {
      expect(html).not.toContain(sentinel);
    }
  }
  return { data, script, styles };
}

export async function expectHidden(page: Page) {
  await expect(page.locator('.preview, [contenteditable="true"]')).toHaveCount(0);
  const visibleText = await page.locator('#root').innerText();
  for (const sentinel of ['FILE_TITLE_SENTINEL', 'FILE_BODY_SENTINEL', 'FILE_COMMENT_SENTINEL']) {
    expect(visibleText).not.toContain(sentinel);
  }
}

export async function passwordGate(page: Page, password = PASSWORD) {
  await expect(page.getByRole('heading', { name: 'This document is encrypted' })).toBeVisible();
  await expectHidden(page);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
}

export async function expectDocument(page: Page, doc = DOC, website = false, storageAccessible = true) {
  await expect(page.locator('.preview')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.readonly-title')).toHaveText(doc.title);
  expect(await snapshot(page)).toBe(doc.md);
  await expect(page.locator('.preview')).toHaveAttribute('contenteditable', 'false');
  await expect(page.locator('[contenteditable="true"], input:not([readonly]), textarea, .composer, .doc-switcher, .toolbar')).toHaveCount(0);
  if (!website) await expect(page.getByRole('button', { name: /Edit anyway|New document|Reply|Delete/ })).toHaveCount(0);
  if (!website) await expect(page.locator('script')).toHaveCount(2);
  await expect(page.locator('.readonly-document img, .readonly-document script, .readonly-document [onerror], .readonly-document [onload]')).toHaveCount(0);
  expect(await page.evaluate(() => 'fileInjected' in globalThis)).toBe(false);
  await expect(page.locator('.statusbar')).toContainText(`${doc.md.length.toLocaleString('en-US')} chars`);
  const comments = page.locator('.gutter-comments');
  await expect(comments.locator('.comment-thread')).toHaveCount(doc.comments.length);
  for (const thread of doc.comments) {
    const card = comments.locator('[data-thread-id]').filter({ has: page.locator('.anchor', { hasText: thread.quote }) });
    await expect(card.locator('.anchor')).toHaveText(`"${thread.quote}"`);
    await expect(card.locator('.author')).toHaveText(thread.replies.map(reply => reply.author));
    await expect(card.locator('.body')).toHaveText(thread.replies.map(reply => reply.body));
  }
  if (storageAccessible) expect(await page.evaluate(() => ({
    docs: Object.keys(localStorage).filter(key => key.startsWith('foil_doc_')),
    current: sessionStorage.getItem('foil_current_id'),
  }))).toEqual({ docs: [], current: null });
}

/** Abort HTTP(S), not Playwright offline: WebKit rejects even static file navigation in offline mode. */
export async function isolateNetwork(context: BrowserContext, website?: string, drand = false) {
  const network = {
    requests: [] as string[], unexpected: [] as string[], failed: [] as string[],
    drand: [] as string[], fail: false, holdBeacon: false, held: [] as Route[],
  };
  await context.route(/^https?:/, async route => {
    const url = new URL(route.request().url());
    network.requests.push(url.href);
    if (website && url.origin === new URL(website).origin) return route.continue();
    const info = url.pathname === `/${DRAND_INFO.hash}/info`;
    const beacon = url.pathname === `/${DRAND_INFO.hash}/public/${DRAND_BEACON.round}`;
    if (drand && DRAND_ORIGINS.has(url.origin) && (info || beacon)) {
      network.drand.push(url.href);
      if (network.fail) {
        network.failed.push(url.href);
        return route.abort('internetdisconnected');
      }
      if (beacon && network.holdBeacon) { network.held.push(route); return; }
      return fulfillDrand(route, info ? DRAND_INFO : DRAND_BEACON);
    }
    network.unexpected.push(url.href);
    return route.abort('internetdisconnected');
  });
  return network;
}

export function fulfillDrand(route: Route, data: unknown = DRAND_BEACON) {
  return route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) });
}

declare global {
  interface Window {
    fileProbe: {
      csp: string[]; parsed: number; releasePassword?: () => void; passwordReady: boolean;
    };
  }
}

export async function observe(page: Page) {
  const errors: { message: string; url: string }[] = [];
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push({ message: message.text(), url: message.location().url });
  });
  await page.addInitScript(() => {
    window.fileProbe = { csp: [], parsed: 0, passwordReady: false };
    document.addEventListener('securitypolicyviolation', event => window.fileProbe.csp.push(event.violatedDirective));
    // Observe completion without replacing codec/crypto results. Cancellation
    // tests can wait for the actual decoded document, not an arbitrary sleep.
    const parse = JSON.parse;
    JSON.parse = (...args: Parameters<typeof JSON.parse>) => {
      const value = parse(...args);
      if (value?.md?.includes?.('FILE_BODY_SENTINEL')) window.fileProbe.parsed++;
      return value;
    };
  });
  return {
    errors, runtimeErrors,
    async clean(failedRequests: string[] = []) {
      expect(runtimeErrors).toEqual([]);
      // Only a deliberately aborted drand request may produce a browser network
      // console error. CSP, crypto and application errors are never ignored.
      expect(errors.filter(error => !(failedRequests.includes(error.url) &&
        /Failed to load resource|Load failed|network connection was lost/i.test(error.message)))).toEqual([]);
      expect(await page.evaluate(() => window.fileProbe.csp)).toEqual([]);
    },
  };
}

export async function settleDecodedDocument(page: Page) {
  await expect.poll(() => page.evaluate(() => window.fileProbe.parsed)).toBeGreaterThan(0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
