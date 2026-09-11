import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  download, expectDocument, inspectFile, isolateNetwork, observe, seedAuthor, snapshot,
} from './helpers/html-export';
import {
  SAMPLE_COMMENTS, SAMPLE_DOC, SAMPLE_MD, SAMPLE_REPLY_BODIES, SAMPLE_SENTINELS, visualBaselineDir,
} from './helpers/samples';

/* Task 07 stage gate for 01–04: the fixed sample renders correctly across the
   settings matrix, viewports, hosts and share paths, with screenshots saved
   under the ignored test-results directory for manual visual review. */

const BASELINE = visualBaselineDir(import.meta.url);
const shot = (page: Page, name: string) => page.screenshot({ path: join(BASELINE, name) });

const PROSE_PX = { small: 17, default: 19, large: 21 } as const;
type ProseSize = keyof typeof PROSE_PX;
const LEADING = { compact: 1.55, comfortable: 1.7 } as const;
type Density = keyof typeof LEADING;
type EditorWidth = 'narrow' | 'default' | 'wide';
const SIZES = Object.keys(PROSE_PX) as ProseSize[];
const DENSITIES = Object.keys(LEADING) as Density[];
const WIDTHS: EditorWidth[] = ['narrow', 'default', 'wide'];
/** A distinctive face from each configured system stack (product behavior). */
const FONT_FACES: Record<string, string> = {
  serif: 'Charter',
  'modern-serif': 'New York',
  'cjk-serif': 'Source Han Serif SC',
  sans: 'ui-sans-serif',
  humanist: 'Optima',
  mono: 'SFMono-Regular',
};
const FONTS = Object.keys(FONT_FACES);
const ACCENTS = ['cerulean', 'emerald', 'ember', 'violet', 'graphite'];

function settingsFor(overrides: Record<string, unknown> = {}) {
  return {
    theme: 'light',
    proseFont: 'serif',
    proseSize: 'default',
    accent: 'cerulean',
    editorWidth: 'default',
    density: 'comfortable',
    readingStyle: 'standard',
    ...overrides,
  };
}

async function seed(page: Page, url: string, settings: Record<string, unknown> = {}, comments = SAMPLE_COMMENTS) {
  await page.goto(url);
  await page.evaluate(({ doc, next, id, comments }) => {
    localStorage.setItem('foil_settings', JSON.stringify(next));
    localStorage.setItem(`foil_doc_${id}`, JSON.stringify({ ...doc, comments, id, createdAt: 1, updatedAt: 1 }));
    sessionStorage.setItem('foil_current_id', id);
  }, { doc: SAMPLE_DOC, next: settingsFor(settings), id: 'e2e-sample', comments });
  await page.reload();
}

async function update(page: Page, settings: Record<string, unknown>) {
  await page.evaluate((next) => {
    localStorage.setItem('foil_settings', JSON.stringify(next));
  }, settingsFor(settings));
  await page.reload();
}

/** Every HTTP(S) request is intercepted; only the local build may answer. */
async function blockExternal(context: BrowserContext, baseURL: string, seen: string[]) {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === origin) await route.continue();
    else {
      seen.push(route.request().url());
      await route.abort();
    }
  });
}

const noPageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const lineStyle = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const style = getComputedStyle(el);
    return { fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), height: el.getBoundingClientRect().height };
  });

/** Poll the paragraph line height in hundredths of a pixel (float-safe). */
const pollLineHeight = (page: Page) =>
  expect.poll(async () => Math.round((await lineStyle(page, '.editor .ln.p')).lineHeight * 100) / 100);

async function shareLinkOf(page: Page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const link = page.locator('.url-row input');
  await expect(link).toHaveValue(/#d=[A-Za-z0-9_-]+$/, { timeout: 15_000 });
  const url = await link.inputValue();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  return url;
}

test('editor matrix: every font with representative size, density and width renders the full sample', async ({ page, context, baseURL }, info) => {
  const external: string[] = [];
  await blockExternal(context, baseURL!, external);
  const home = new URL('./', baseURL!).href;
  const editor = page.locator('.editor[contenteditable="true"]');

  for (const [i, font] of FONTS.entries()) {
    const proseSize = SIZES[i % SIZES.length];
    const density = DENSITIES[i % DENSITIES.length];
    const editorWidth = WIDTHS[i % WIDTHS.length];
    await seed(page, home, { proseFont: font, proseSize, density, editorWidth }, []);
    await expect(editor).toBeVisible();
    const p = await lineStyle(page, '.editor .ln.p');
    expect(p.fontSize, font).toBe(PROSE_PX[proseSize]);
    expect(p.lineHeight, font).toBeCloseTo(PROSE_PX[proseSize] * LEADING[density], 1);
    expect(await page.locator('.editor .ln.p').first().evaluate((el) => getComputedStyle(el).fontFamily), font)
      .toContain(FONT_FACES[font]);
    // Raw ordered markers stay visible; the markdown round-trips exactly.
    expect(await page.locator('.editor .ln.olist').first().textContent()).toBe('1. First ordered item');
    expect(await page.locator('.editor .ln.olist').nth(2).textContent()).toBe('42) Answer with a different delimiter');
    expect(await snapshot(page)).toBe(SAMPLE_MD);
    expect(await noPageOverflow(page), font).toBe(true);
    await shot(page, `web-editor-${info.project.name}-${font}-${proseSize}-${density}-${editorWidth}.png`);
  }

  // Width settings measurably change the reading column, still without overflow.
  const widths: number[] = [];
  for (const editorWidth of WIDTHS) {
    await update(page, { proseFont: 'serif', editorWidth });
    await expect(editor).toBeVisible();
    widths.push((await page.locator('.editor-wrap').boundingBox())!.width);
    expect(await noPageOverflow(page)).toBe(true);
  }
  expect(widths[0]).toBeLessThan(widths[1] - 50);
  expect(widths[1]).toBeLessThan(widths[2] - 50);

  // Density changes real line-box height at the largest size.
  await update(page, { proseFont: 'serif', proseSize: 'large', density: 'comfortable' });
  const comfortable = await lineStyle(page, '.editor .ln.p');
  await update(page, { proseFont: 'serif', proseSize: 'large', density: 'compact' });
  const compact = await lineStyle(page, '.editor .ln.p');
  expect(comfortable.lineHeight).toBeCloseTo(21 * 1.7, 1);
  expect(compact.lineHeight).toBeCloseTo(21 * 1.55, 1);
  expect(compact.height).toBeLessThan(comfortable.height);
  expect(external).toEqual([]);
});

test('appearance matrix: standard/paper × light/dark × 5 accents on the full sample', async ({ page, context, baseURL }, info) => {
  const external: string[] = [];
  await blockExternal(context, baseURL!, external);
  const home = new URL('./', baseURL!).href;

  for (const theme of ['light', 'dark'] as const) {
    for (const readingStyle of ['standard', 'paper'] as const) {
      for (const accent of ACCENTS) {
        await seed(page, home, { theme, readingStyle, accent }, []);
        await expect(page.locator('.editor[contenteditable="true"]')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
        expect(await page.evaluate(() => document.documentElement.dataset.readingStyle)).toBe(readingStyle);
        if (accent !== 'cerulean') {
          expect(await page.locator('html').evaluate((el) => getComputedStyle(el).getPropertyValue('--accent').trim()), accent).not.toBe('');
        }
        expect(await noPageOverflow(page), `${theme}/${readingStyle}/${accent}`).toBe(true);
        await shot(page, `web-look-${info.project.name}-${theme}-${readingStyle}-${accent}.png`);
      }
    }
  }
  expect(external).toEqual([]);
});

test('viewports 375/768/1280 and 200% zoom keep the sample readable and operable', async ({ page, context, browser, baseURL }, info) => {
  const external: string[] = [];
  await blockExternal(context, baseURL!, external);
  const home = new URL('./', baseURL!).href;

  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 812 });
    await seed(page, home, { proseSize: 'large' });
    const editor = page.locator('.editor[contenteditable="true"]');
    await expect(editor).toBeVisible();
    expect(await noPageOverflow(page), `editor ${width}px`).toBe(true);

    // Key operations stay available: settings change density for real.
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('radio', { name: 'Compact' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await pollLineHeight(page).toBe(32.55);
    expect(await snapshot(page)).toBe(SAMPLE_MD);
    await shot(page, `web-vp-${info.project.name}-${width}.png`);
  }

  // 200% browser zoom ≙ half the CSS-pixel viewport at deviceScaleFactor 2.
  const zoomed = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  try {
    await blockExternal(zoomed, baseURL!, external);
    const zoomPage = await zoomed.newPage();
    await seed(zoomPage, home, { proseSize: 'large', readingStyle: 'paper' });
    await expect(zoomPage.locator('.editor[contenteditable="true"]')).toBeVisible();
    expect(await noPageOverflow(zoomPage)).toBe(true);
    await zoomPage.getByRole('button', { name: 'Settings' }).click();
    await zoomPage.getByRole('radio', { name: 'Compact' }).click();
    await zoomPage.getByRole('button', { name: 'Done' }).click();
    await pollLineHeight(zoomPage).toBe(32.55);
    expect(await noPageOverflow(zoomPage)).toBe(true);
    await shot(zoomPage, `web-zoom200-${info.project.name}.png`);
  } finally {
    await zoomed.close();
  }
  expect(external).toEqual([]);
});

test('data: editing the sample keeps offsets, undo and comment anchors intact', async ({ page, context, baseURL }) => {
  const external: string[] = [];
  await blockExternal(context, baseURL!, external);
  await seed(page, new URL('./', baseURL!).href);
  const editor = page.locator('.editor[contenteditable="true"]');
  await expect(editor).toBeVisible();

  // Every located thread (single-block, cross-block, overlapping pair) is
  // highlighted; the unlocated thread stays reachable in the read views only.
  await expect(page.locator('.gutter-comments .comment-thread')).toHaveCount(SAMPLE_COMMENTS.length - 1);
  for (const quote of ['排版的核心', 'cross-block', '好的排版是隐形的', '排版是隐形']) {
    await expect(page.locator('.anchor-hl').filter({ hasText: quote }).first(), quote).toBeVisible();
  }

  // Typing CJK at the end keeps the raw-markdown contract; undo restores it.
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('中文X');
  expect(await snapshot(page)).toBe(SAMPLE_MD + '中文X');
  await page.keyboard.press('Control+z');
  expect(await snapshot(page)).toBe(SAMPLE_MD);

  // Anchors survive the edit + undo round-trip.
  for (const quote of ['排版的核心', 'cross-block']) {
    await expect(page.locator('.anchor-hl').filter({ hasText: quote }).first(), quote).toBeVisible();
  }
  expect(await noPageOverflow(page)).toBe(true);
  expect(external).toEqual([]);
});

test('share: the sample link renders fully in Reading, keeps comments and never touches the fragment', async ({ page, context, browser, baseURL }, info) => {
  const external: string[] = [];
  await blockExternal(context, baseURL!, external);
  await seed(page, new URL('./', baseURL!).href);
  const link = await shareLinkOf(page);

  const recipientContext = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'UTC' });
  try {
    await blockExternal(recipientContext, baseURL!, external);
    // Recipient-local preferences: paper, dark, CJK serif, large, compact.
    await recipientContext.addInitScript((next) => localStorage.setItem('foil_settings', JSON.stringify(next)), settingsFor({
      theme: 'dark', readingStyle: 'paper', proseFont: 'cjk-serif', proseSize: 'large', density: 'compact',
    }));
    const reader = await recipientContext.newPage();
    await reader.goto(link);
    await expect(reader.locator('.reading-preview')).toBeVisible({ timeout: 15_000 });

    // Recipient settings drive the reading view; author preferences do not.
    expect(await reader.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    expect(await reader.evaluate(() => document.documentElement.dataset.readingStyle)).toBe('paper');
    const reading = await reader.locator('.reading-preview').evaluate((el) => {
      const style = getComputedStyle(el);
      return { fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), fontFamily: style.fontFamily };
    });
    expect(reading.fontSize).toBe(21);
    expect(reading.lineHeight).toBeCloseTo(21 * 1.55, 1);
    expect(reading.fontFamily).toContain('Source Han Serif SC');

    // Content completeness: every section sentinel is visible; title deduped.
    await expect(reader.locator('.readonly-title')).toHaveText(SAMPLE_DOC.title);
    await expect(reader.locator('.reading-doc-title')).toHaveCount(0);
    const text = await reader.locator('.readonly-document').innerText();
    for (const sentinel of SAMPLE_SENTINELS) expect(text, sentinel).toContain(sentinel);

    // TOC: duplicate headings get unique targets; jumps never rewrite the hash.
    const entries = reader.locator('.reading-toc nav a');
    expect(await entries.count()).toBeGreaterThanOrEqual(3);
    const hrefs = await entries.evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toContain('#小节-subsection');
    expect(hrefs).toContain('#小节-subsection-1');
    await reader.locator('.reading-toc nav a', { hasText: '数据 Data' }).click();
    expect(new URL(reader.url()).hash).toBe('');
    await expect(reader.locator('#数据-data')).toBeInViewport();
    await shot(reader, `web-share-reading-1280-${info.project.name}.png`);

    // Comments: all five threads reachable, anchors clickable, unlocated listed.
    await expect(reader.locator('.gutter-comments .comment-thread')).toHaveCount(SAMPLE_COMMENTS.length);
    await reader.locator('.reading-preview .anchor-hl[role="button"]').first().click();
    await expect(reader.locator('.gutter-comments .comment-thread.active')).toContainText('SAMPLE_LOCATED_BODY 定位评论');
    const gutterText = await reader.locator('.gutter-comments').innerText();
    for (const body of SAMPLE_REPLY_BODIES) expect(gutterText, body).toContain(body);
    await expect(reader.getByText('Quoted text not found in this document.')).toBeVisible();

    // Reading/Source round-trip: exact markdown, stable URL, anchors return.
    const urlBefore = reader.url();
    expect(new URL(urlBefore).hash).toBe('');
    await reader.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(reader.locator('.preview')).toBeVisible();
    expect(await snapshot(reader)).toBe(SAMPLE_MD);
    expect(reader.url()).toBe(urlBefore);
    expect(new URL(reader.url()).hash).toBe('');
    await shot(reader, `web-share-source-${info.project.name}.png`);
    await reader.getByRole('button', { name: 'Reading', exact: true }).click();
    await expect(reader.locator('.reading-preview')).toBeVisible();
    await expect(reader.locator('.reading-preview .anchor-hl[role="button"]').first()).toBeVisible();
    expect(await noPageOverflow(reader)).toBe(true);
    expect(reader.url()).toBe(urlBefore);
  } finally {
    await recipientContext.close();
  }

  // Mobile recipient: the drawer keeps every thread reachable.
  const mobileContext = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'UTC', viewport: { width: 375, height: 812 } });
  try {
    await blockExternal(mobileContext, baseURL!, external);
    const mobile = await mobileContext.newPage();
    await mobile.goto(link);
    await expect(mobile.locator('.reading-preview')).toBeVisible({ timeout: 15_000 });
    await mobile.getByRole('button', { name: `Read ${SAMPLE_COMMENTS.length} comments` }).click();
    const drawer = mobile.getByRole('dialog', { name: 'Comments', exact: true });
    await expect(drawer).toBeVisible();
    const drawerText = await drawer.innerText();
    for (const body of SAMPLE_REPLY_BODIES) expect(drawerText, body).toContain(body);
    await expect(drawer.getByText('Quoted text not found in this document.')).toBeVisible();
    await drawer.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(drawer).toHaveCount(0);
    expect(await noPageOverflow(mobile)).toBe(true);
    await shot(mobile, `web-share-reading-375-${info.project.name}.png`);
  } finally {
    await mobileContext.close();
  }
  expect(external).toEqual([]);
});

test('file: the exported sample is self-contained, opens offline and re-exports', async ({ page, context, browser, baseURL }, info) => {
  await seedAuthor(context, SAMPLE_DOC);
  const authorNetwork = await isolateNetwork(context, baseURL);
  await page.goto('./');
  expect(await snapshot(page)).toBe(SAMPLE_MD);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Share this document' })).toBeVisible();
  await expect(page.getByLabel('Shareable link')).toHaveValue(/#d=/);
  const file = await download(page, info, 'sample');
  inspectFile(file.html, 'd', baseURL!);
  expect(file.filename).toMatch(/\.html$/);
  expect(authorNetwork.unexpected).toEqual([]);

  const readerContext = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'UTC' });
  try {
    const network = await isolateNetwork(readerContext);
    const reader = await readerContext.newPage();
    const log = await observe(reader);
    await reader.goto(pathToFileURL(file.path).href);
    await expectDocument(reader, SAMPLE_DOC);
    const text = await reader.locator('.readonly-document').innerText();
    for (const sentinel of SAMPLE_SENTINELS) expect(text, sentinel).toContain(sentinel);
    for (const body of SAMPLE_REPLY_BODIES) expect(text, body).toContain(body);

    // Settings still work offline inside the file; content stays complete.
    await reader.getByRole('button', { name: 'Settings', exact: true }).click();
    await reader.getByRole('radio', { name: 'Large', exact: true }).click();
    await reader.getByRole('radio', { name: 'Paper' }).click();
    await reader.getByRole('radio', { name: 'Dark', exact: true }).click();
    await reader.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(reader.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(reader.locator('.editor-wrap')).toHaveCSS('--prose-size', '21px');
    await expectDocument(reader, SAMPLE_DOC);
    expect(await noPageOverflow(reader)).toBe(true);
    await shot(reader, `file-reading-${info.project.name}.png`);

    // Re-export from the file works without any network access.
    await reader.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(reader.getByLabel('Shareable link')).toHaveValue(/#d=/);
    const second = await download(reader, info, 'sample-again');
    inspectFile(second.html, 'd', baseURL!);
    expect(network.requests).toEqual([]);
    await log.clean(network.failed);
  } finally {
    await readerContext.close();
  }
});
