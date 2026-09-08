import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { expect, test as base, type Page } from '@playwright/test';
import {
  DOC, PASSWORD, block, download, expectDocument, expectHidden, fulfillDrand,
  inspectFile, isolateNetwork, observe, options, passwordGate,
  seedAuthor, settleDecodedDocument, snapshot,
} from './helpers/html-export';
import { DRAND_ORIGINS, UNLOCK_MS } from './helpers/drand';

type Reader = { page: Page; network: Awaited<ReturnType<typeof isolateNetwork>> };
const test = base.extend<{
  newReader: (options?: { drand?: boolean; website?: string; denyStorage?: boolean }) => Promise<Reader>;
}>({
  newReader: async ({ browser }, use) => {
    const readers: { reader: Reader; log: Awaited<ReturnType<typeof observe>> }[] = [];
    try {
      await use(async (options = {}) => {
        // No storageState, author cache, permissions or insecure browser flags.
        const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'UTC' });
        const network = await isolateNetwork(context, options.website, options.drand);
        if (options.denyStorage) await context.addInitScript(() => {
          for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, {
            get() { throw new DOMException('Storage refused by recipient', 'SecurityError'); },
          });
        });
        const page = await context.newPage();
        const log = await observe(page);
        const reader = { page, network };
        readers.push({ reader, log });
        return reader;
      });
      for (const { reader, log } of readers) {
        expect(reader.network.unexpected).toEqual([]);
        await log.clean(reader.network.failed);
      }
    } finally {
      for (const { reader } of readers) await reader.page.context().close();
    }
  },
});

test.use({ timezoneId: 'UTC' });

async function openShare(page: Page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Share this document' })).toBeVisible();
}

for (const mode of ['d', 'e'] as const) {
  test(`${mode}: Share download, offline file refresh, read-only reading and protected re-export`, async ({ page, context, baseURL, newReader }, info) => {
    await seedAuthor(context);
    const authorNetwork = await isolateNetwork(context, baseURL);
    const authorLog = await observe(page);
    await page.goto('./');
    expect(await snapshot(page)).toBe(DOC.md);
    await openShare(page);
    await expect(page.getByLabel('Shareable link')).toHaveValue(/#d=/);
    expect(authorNetwork.requests.filter(url => url.includes('foil-standalone'))).toEqual([]);
    expect(await page.evaluate(() => typeof (globalThis as { Buffer?: unknown }).Buffer)).toBe('undefined');
    await options(page, mode);
    const first = await download(page, info, mode);
    const original = inspectFile(first.html, mode, baseURL!);
    expect(first.filename).toMatch(/\.html$/);
    expect(first.filename).not.toMatch(/[<>:"/\\|?*]/);
    if (mode === 'e') expect(first.filename).toBe('foil-shared-document.html');
    expect(authorNetwork.requests.filter(url => url.includes('foil-standalone'))).toHaveLength(1);
    expect(await page.evaluate(() => typeof (globalThis as { Buffer?: unknown }).Buffer)).toBe('undefined');
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(1);
    await authorLog.clean();
    expect(authorNetwork.unexpected).toEqual([]);
    await page.close();

    const { page: reader, network } = await newReader();
    await reader.goto(pathToFileURL(first.path).href);
    expect(new URL(reader.url()).protocol).toBe('file:');
    if (mode === 'e') {
      await passwordGate(reader, 'wrong password');
      await expect(reader.getByText('Incorrect password or damaged share link')).toBeVisible();
      await expectHidden(reader);
      await reader.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(reader.getByRole('heading', { name: 'Reading cancelled' })).toBeVisible();
      await expectHidden(reader);
      await reader.getByRole('button', { name: 'Retry', exact: true }).click();
      await passwordGate(reader);
    }
    await expectDocument(reader);
    // Author preferences are not part of the snapshot.
    await expect(reader.locator('.editor-wrap')).toHaveCSS('--prose-size', '19px');
    await reader.reload();
    if (mode === 'e') await passwordGate(reader);
    await expectDocument(reader);

    // Desktop anchors, including a cross-line quote and an unlocated thread.
    const anchor = reader.locator('.preview .anchor-hl[role="button"]').first();
    await anchor.press('Enter');
    await expect(reader.locator('.gutter-comments .anchor').first()).toBeFocused();
    await expect(reader.locator('.gutter-comments .comment-thread').first()).toHaveClass(/active/);
    await reader.locator('.gutter-comments .anchor').first().click();
    await expect(anchor).toBeFocused();
    await expect(reader.getByText('Quoted text not found in this document.')).toBeVisible();
    // Keyboard typing has no editing path; native selection and copy retain Markdown.
    await anchor.press('x');
    expect(await snapshot(reader)).toBe(DOC.md);
    const copied = await reader.locator('.preview').evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      const clipboard = new DataTransfer();
      el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard }));
      selection.removeAllRanges();
      return clipboard.getData('text/plain');
    });
    expect(copied).toBe(DOC.md);

    await reader.getByRole('button', { name: 'Settings', exact: true }).click();
    await reader.getByRole('radio', { name: 'Large', exact: true }).click();
    await reader.getByRole('radio', { name: 'Light', exact: true }).click();
    await reader.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(reader.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(reader.locator('.editor-wrap')).toHaveCSS('--prose-size', '21px');
    await reader.reload();
    if (mode === 'e') await passwordGate(reader);
    await expectDocument(reader);
    await expect(reader.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(reader.locator('.editor-wrap')).toHaveCSS('--prose-size', '21px');
    await reader.getByRole('button', { name: 'About Foil', exact: true }).click();
    await expect(reader.getByRole('heading', { name: 'About Foil' })).toBeVisible();
    await expect(reader.getByText('Export HTML', { exact: false }).first()).toBeVisible();
    await reader.getByRole('button', { name: 'Done', exact: true }).click();
    await openShare(reader);
    await expect(reader.getByLabel('Shareable link')).toHaveValue(/#d=/);
    const link = await reader.getByLabel('Shareable link').inputValue();
    expect(link.split('#')[0]).toBe(baseURL);
    // Clipboard permission differs for file origins. Exercise the actual Copy
    // action and accept only its documented success or manual-copy fallback.
    await reader.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(reader.getByRole('status')).toHaveText(/Link copied|Couldn't copy — select the box and copy manually/);
    if (await reader.getByRole('dialog', { name: 'Share this document' }).count() === 0) await openShare(reader);
    await options(reader, mode, PASSWORD + ' second');
    const second = await download(reader, info, mode + '-again');
    const regenerated = inspectFile(second.html, mode, baseURL!, PASSWORD + ' second');
    expect(regenerated.script).toBe(original.script);
    expect(regenerated.styles).toBe(original.styles);
    expect(second.bytes).toBe(first.bytes);
    expect(network.requests).toEqual([]);

    const { page: reopened, network: reopenedNetwork } = await newReader();
    await reopened.goto(pathToFileURL(second.path).href);
    if (mode === 'e') {
      await passwordGate(reopened, PASSWORD);
      await expect(reopened.getByText('Incorrect password or damaged share link')).toBeVisible();
      await passwordGate(reopened, PASSWORD + ' second');
    }
    await expectDocument(reopened);
    expect(reopenedNetwork.requests).toEqual([]);

    // The file's continued-sharing link opens the real website at either base.
    const { page: website } = await newReader({ website: baseURL });
    await website.goto(link);
    await expectDocument(website, DOC, true);
    await expect(website.getByRole('button', { name: 'Edit anyway' })).toBeVisible();
    expect(new URL(website.url()).hash).toBe('');
  });
}

for (const mode of ['td', 'te'] as const) {
  test(`${mode}: real file time gate, network retry and cancelled late decryption`, async ({ page, context, baseURL, newReader }, info) => {
    await seedAuthor(context);
    const authorNetwork = await isolateNetwork(context, baseURL, true);
    const authorLog = await observe(page);
    await page.clock.setFixedTime(UNLOCK_MS - 3_600_000);
    await page.goto('./');
    await openShare(page);
    await options(page, mode);
    await expect(page.getByLabel('Shareable link')).toHaveValue(new RegExp(`#${mode}=`), { timeout: 30_000 });
    const websiteLink = await page.getByLabel('Shareable link').inputValue();
    const file = await download(page, info, mode);
    inspectFile(file.html, mode, baseURL!);
    expect(file.filename).toBe('foil-shared-document.html');
    expect(authorNetwork.drand.length).toBeGreaterThan(0);
    expect(authorNetwork.unexpected).toEqual([]);
    await authorLog.clean();
    await page.close();

    const { page: reader, network } = await newReader({ drand: true });
    await reader.clock.setFixedTime(UNLOCK_MS - 60_000);
    await reader.goto(pathToFileURL(file.path).href);
    if (mode === 'te') {
      await passwordGate(reader, 'wrong password');
      await expect(reader.getByText('Incorrect password or damaged share link')).toBeVisible();
      await expectHidden(reader);
      expect(network.requests).toEqual([]);
      await passwordGate(reader);
    }
    await expect(reader.getByRole('heading', { name: 'Time capsule' })).toBeVisible();
    await expect(reader.locator('.tc-countdown-time')).toHaveText('00:01:00');
    await expect(reader.getByRole('button', { name: 'Decrypt', exact: true })).toHaveCount(0);
    await expectHidden(reader);
    await reader.clock.setFixedTime(UNLOCK_MS - 1000);
    await expect(reader.locator('.tc-countdown-time')).toHaveText('00:00:01');
    await expectHidden(reader);
    expect(network.requests).toEqual([]);
    await reader.clock.setFixedTime(UNLOCK_MS);
    await expect(reader.getByText('Unsealed', { exact: true })).toBeVisible();
    await expectHidden(reader);
    expect(network.requests).toEqual([]);

    network.fail = true;
    await reader.getByRole('button', { name: 'Decrypt', exact: true }).click();
    await expect(reader.getByText('Could not reach drand. Check your connection and retry.', { exact: false })).toBeVisible();
    await expectHidden(reader);
    expect(new Set(network.failed.map(url => new URL(url).origin))).toEqual(DRAND_ORIGINS);
    network.fail = false;
    network.holdBeacon = true;
    await reader.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => network.held.length).toBe(1);
    await reader.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(reader.getByRole('heading', { name: 'Reading cancelled' })).toBeVisible();
    network.holdBeacon = false;
    await fulfillDrand(network.held.shift()!);
    await settleDecodedDocument(reader);
    await expect(reader.getByRole('heading', { name: 'Reading cancelled' })).toBeVisible();
    await expectHidden(reader);
    await reader.getByRole('button', { name: 'Retry', exact: true }).click();
    if (mode === 'te') await passwordGate(reader);
    await reader.getByRole('button', { name: 'Decrypt', exact: true }).click();
    await expectDocument(reader);
    await reader.reload();
    if (mode === 'te') await passwordGate(reader);
    await reader.getByRole('button', { name: 'Decrypt', exact: true }).click();
    await expectDocument(reader);

    const { page: website } = await newReader({ website: baseURL, drand: true });
    await website.clock.setFixedTime(UNLOCK_MS + 60_000);
    await website.goto(websiteLink);
    if (mode === 'te') await passwordGate(website);
    await website.getByRole('button', { name: 'Decrypt', exact: true }).click();
    await expectDocument(website, DOC, true);
  });
}

test('mobile reader keeps all comments and settings when storage is denied', async ({ page, context, baseURL, newReader }, info) => {
  await seedAuthor(context);
  const network = await isolateNetwork(context, baseURL);
  await page.goto('./');
  await openShare(page);
  const file = await download(page, info, 'mobile');
  expect(network.unexpected).toEqual([]);
  const { page: reader, network: offline } = await newReader({ denyStorage: true });
  await reader.setViewportSize({ width: 390, height: 844 });
  await reader.goto(pathToFileURL(file.path).href);
  await expectDocument(reader, DOC, false, false);
  expect(await reader.evaluate(() => {
    try { return localStorage.length; } catch (error) { return (error as DOMException).name; }
  })).toBe('SecurityError');
  await reader.getByRole('button', { name: 'Read 2 comments' }).click();
  const drawer = reader.getByRole('dialog', { name: 'Comments', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.body')).toHaveText(DOC.comments.flatMap(thread => thread.replies.map(reply => reply.body)));
  await expect(drawer.getByRole('button', { name: /Reply|Delete/ })).toHaveCount(0);
  await expect(drawer.getByText('Quoted text not found in this document.')).toBeVisible();
  await expect(reader.locator('.readonly-content')).toHaveAttribute('inert', '');
  await drawer.getByRole('button', { name: 'Close', exact: true }).press('Shift+Tab');
  await expect(drawer.locator('.anchor').last()).toBeFocused();
  await drawer.locator('.anchor').last().press('Tab');
  await expect(drawer.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await drawer.getByRole('button', { name: 'Close', exact: true }).press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(reader.getByRole('button', { name: 'Read 2 comments' })).toBeFocused();
  await reader.locator('.preview .anchor-hl[role="button"]').first().click();
  await expect(drawer).toBeVisible();
  await drawer.locator('.anchor').first().click();
  await expect(drawer).toHaveCount(0);
  await expect(reader.locator('.preview .anchor-hl[role="button"]').first()).toBeFocused();
  await reader.getByRole('button', { name: 'Settings', exact: true }).click();
  await reader.getByRole('radio', { name: 'Large', exact: true }).click();
  await reader.getByRole('radio', { name: 'Dark', exact: true }).click();
  await reader.getByRole('radio', { name: 'Compact', exact: true }).click();
  await reader.getByRole('radio', { name: 'Wide', exact: true }).click();
  await reader.getByRole('button', { name: 'Aa Mono Plain code', exact: true }).click();
  await reader.getByRole('button', { name: 'Violet', exact: true }).click();
  await reader.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(reader.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(reader.locator('html')).toHaveCSS('--accent', '#6f3ad9');
  await expect(reader.locator('.editor-wrap')).toHaveCSS('--prose-size', '21px');
  await expect(reader.locator('.editor-wrap')).toHaveCSS('--prose-leading', '1.55');
  await expect(reader.locator('.editor-wrap')).toHaveCSS('--prose-font', /ui-monospace/);
  await expect(reader.locator('.canvas')).toHaveCSS('--editor-width', '960px');
  await expectDocument(reader, DOC, false, false);
  await reader.reload();
  await expectDocument(reader, DOC, false, false);
  expect(offline.requests).toEqual([]);
});

test('password cancellation discards an actual late AES result and can retry', async ({ page, context, baseURL, newReader }, info) => {
  await seedAuthor(context);
  await isolateNetwork(context, baseURL);
  await page.goto('./');
  await openShare(page);
  await options(page, 'e');
  const file = await download(page, info, 'password-cancel');
  const { page: reader, network } = await newReader();
  await reader.addInitScript(() => {
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    let hold = true;
    crypto.subtle.decrypt = async (...args) => {
      const actual = await decrypt(...args);
      if (hold) {
        hold = false;
        await new Promise<void>(resolve => {
          window.fileProbe.releasePassword = resolve;
          window.fileProbe.passwordReady = true;
        });
      }
      return actual;
    };
  });
  await reader.goto(pathToFileURL(file.path).href);
  await passwordGate(reader);
  await expect.poll(() => reader.evaluate(() => window.fileProbe.passwordReady)).toBe(true);
  await reader.getByRole('button', { name: 'Cancel', exact: true }).click();
  await reader.evaluate(() => window.fileProbe.releasePassword!());
  await settleDecodedDocument(reader);
  await expect(reader.getByRole('heading', { name: 'Reading cancelled' })).toBeVisible();
  await expectHidden(reader);
  await reader.getByRole('button', { name: 'Retry', exact: true }).click();
  await passwordGate(reader);
  await expectDocument(reader);
  expect(network.requests).toEqual([]);
});

test('a document beyond the URL limit still downloads and reopens offline', async ({ page, context, baseURL, newReader }, info) => {
  // Deterministic incompressible text, independent of external fixture files.
  const md = Array.from({ length: 10_000 }, (_, i) => createHash('sha256').update(`foil-long-${i}`).digest('base64')).join('');
  const doc = { title: 'Long document 中文', md, comments: [] };
  await seedAuthor(context, doc);
  const network = await isolateNetwork(context, baseURL);
  await page.goto('./');
  await openShare(page);
  await expect(page.locator('.share-modal [role="alert"]')).toContainText('Share link exceeds the 256 KiB limit');
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export HTML', exact: true })).toBeEnabled();
  const file = await download(page, info, 'long');
  const { data } = inspectFile(file.html, 'd', baseURL!);
  expect(data.payload.length).toBeGreaterThan(256 * 1024);
  expect(network.unexpected).toEqual([]);
  const { page: reader, network: offline } = await newReader();
  await reader.goto(pathToFileURL(file.path).href);
  await expectDocument(reader, doc);
  expect(offline.requests).toEqual([]);
});

test('damaged payload/version fail closed and a changed runtime is rejected by file CSP', async ({ page, context, browser, baseURL, newReader }, info) => {
  await seedAuthor(context);
  await isolateNetwork(context, baseURL);
  await page.goto('./');
  await openShare(page);
  const file = await download(page, info, 'integrity');
  const source = block(file.html, 'script', 'foil-share-data');
  for (const mutation of [{ version: 999 }, { payload: '#d=not_a_gzip_document' }]) {
    const path = info.outputPath(`damaged-${'version' in mutation ? 'version' : 'payload'}.html`);
    await writeFile(path, file.html.replace(source, JSON.stringify({ ...JSON.parse(source), ...mutation })));
    const { page: reader } = await newReader();
    await reader.goto(pathToFileURL(path).href);
    await expect(reader.getByRole('heading', { name: 'Could not open this file' })).toBeVisible();
    await expectHidden(reader);
    await reader.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(reader.getByRole('heading', { name: 'Could not open this file' })).toBeVisible();
  }

  // Positive CSP rejection control: only this deliberately tampered file is
  // expected to emit a violation. Normal exports require zero violations.
  const tamperedPath = info.outputPath('changed-runtime.html');
  const script = block(file.html, 'script', 'foil-share-runtime');
  await writeFile(tamperedPath, file.html.replace(script, 'globalThis.fileInjected=1;\n' + script));
  const tamperedContext = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const network = await isolateNetwork(tamperedContext);
    const reader = await tamperedContext.newPage();
    const log = await observe(reader);
    await reader.goto(pathToFileURL(tamperedPath).href);
    await expect.poll(() => reader.evaluate(() => window.fileProbe.csp.length)).toBeGreaterThan(0);
    expect(await reader.evaluate(() => window.fileProbe.csp)).toEqual(['script-src-elem']);
    expect(await reader.evaluate(() => 'fileInjected' in globalThis)).toBe(false);
    await expectHidden(reader);
    expect(log.runtimeErrors).toEqual([]);
    expect(log.errors.length).toBeGreaterThan(0);
    expect(log.errors.every(error => /Content Security Policy|script-src/i.test(error.message))).toBe(true);
    expect(network.requests).toEqual([]);
  } finally { await tamperedContext.close(); }
  // Also ensure assertions consumed the actual saved bytes, not a DOM snapshot.
  expect(await readFile(file.path, 'utf8')).toBe(file.html);
});
