import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, dist, shareBase } from './fixtures';
import { newDocument, openShare, closeShare, options, UNLOCK_MS } from './helpers';
import { DRAND_ORIGINS } from '../../../web/tests/e2e/helpers/drand';

test('MV3 worker opens two real packaged tabs through its toolbar handler', async ({ extension }, info) => {
  const { context, worker, entry } = extension;
  expect(context.pages().filter(page => page.url().startsWith('chrome-extension:'))).toEqual([]);
  expect(await worker.evaluate(() => chrome.action.onClicked.hasListeners())).toBe(true);
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions ?? []).toEqual([]);
  expect(manifest.host_permissions).toEqual([...DRAND_ORIGINS].map(origin => `${origin}/*`));
  const csp = manifest.content_security_policy;
  expect(typeof csp === 'object' ? csp.extension_pages : undefined).toContain("script-src 'self';");
  expect(manifest.action?.default_popup).toBeUndefined();

  // MV3 workers reject dynamic import. Capture the unmodified built callback
  // with DevTools evaluation; getURL/tabs.create remain the real browser APIs.
  // This complements background.test.ts's listener test, not a native click.
  const bundle = await readFile(join(dist, 'background.js'), 'utf8');
  await worker.evaluate(`(() => {
    const event = chrome.action.onClicked;
    const original = event.addListener;
    let handler;
    event.addListener = fn => { handler = fn; };
    try { ${bundle} } finally { event.addListener = original; }
    globalThis.foilToolbarHandler = handler;
  })()`);
  const opened = [];
  for (let i = 0; i < 2; i++) {
    const pending = context.waitForEvent('page');
    await worker.evaluate(() => (globalThis as unknown as { foilToolbarHandler: () => Promise<void> }).foilToolbarHandler());
    const page = await pending;
    await expect(page).toHaveURL(entry);
    await expect(page.locator('[contenteditable="true"]')).toBeVisible();
    const resources = await page.evaluate(() => [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[href]')]
      .map(el => el instanceof HTMLScriptElement ? el.src : el.href));
    expect(resources.length).toBeGreaterThan(1);
    for (const url of resources) expect(url.startsWith(entry.replace('index.html', ''))).toBe(true);
    opened.push(page);
  }
  expect(opened[0]).not.toBe(opened[1]);
  expect(extension.network.requests).toEqual([]);
  info.annotations.push({ type: 'limitation', description: 'Real compiled toolbar handler via DevTools; native toolbar UI and branded Chrome/Edge installation were not exercised.' });
});

test('user Copy writes the actual clipboard and denial preserves the manual fallback', async ({ extension }) => {
  const page = await extension.page();
  await newDocument(page, 'Clipboard snapshot', 'COPY_BODY');
  await openShare(page);
  const link = await page.getByLabel('Shareable link').inputValue();
  expect(link.split('#')[0]).toBe(shareBase);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('Link copied');
  await page.getByRole('button', { name: 'Open shared link', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Foil share link or fragment', exact: true });
  await field.press('ControlOrMeta+V');
  await expect(field).toHaveValue(link); // Real OS clipboard paste, no clipboard-read grant.
  await page.keyboard.press('Escape');
  await openShare(page);
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {
    configurable: true, value: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
  }));
  try {
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(page.locator('.toast')).toHaveText("Couldn't copy — select the box and copy manually");
    await expect(page.getByLabel('Shareable link')).toHaveValue(link);
    await expect(page.getByRole('dialog', { name: 'Share this document' })).toBeVisible();
  } finally { await page.evaluate(() => Reflect.deleteProperty(navigator.clipboard, 'writeText')); }
  expect(await extension.worker.evaluate(() => chrome.runtime.getManifest().permissions ?? [])).toEqual([]);
});

test('offline first crypto load uses packaged code and reports unavailable drand', async ({ extension }) => {
  const page = await extension.page();
  expect(extension.scripts.filter(url => url.includes('timecapsule-crypto'))).toEqual([]);
  extension.network.allowDrand = true;
  extension.network.failDrand = true;
  await page.clock.setFixedTime(UNLOCK_MS - 3_600_000);
  await openShare(page);
  await options(page, 'td');
  await expect(page.locator('.share-modal [role="alert"]')).toContainText('Could not seal time capsule');
  expect(new Set(extension.network.failed.map(url => new URL(url).origin))).toEqual(DRAND_ORIGINS);
  expect(extension.scripts.some(url => url.startsWith(extension.entry.replace('index.html', 'assets/timecapsule-crypto-')))).toBe(true);
  for (const url of extension.scripts.filter(url => /^(https?:|chrome-extension:)/.test(url))) {
    expect(url.startsWith(extension.entry.replace('index.html', ''))).toBe(true);
  }
  await closeShare(page);
});
