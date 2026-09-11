import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { contrastRatio } from './helpers/contrast';

// A mixed Chinese/English sample: heading, prose with a link, list, quote and
// a fenced block whose comment is Chinese, so CJK fallbacks are exercised.
const SAMPLE_MD = [
  '# 排版样本 Typography',
  '',
  '中文正文段落 with **bold** and a [link](https://example.com/).',
  '',
  '### 小节 Subsection',
  '',
  '- 列表项 list item',
  '',
  '> 引用 quote line',
  '',
  '```ts',
  '// 中文注释 inside code',
  'const value = 42;',
  '```',
].join('\n');

const THREAD = {
  id: 'cjk-thread',
  quote: '中文正文段落',
  before: '',
  after: ' with',
  replies: [{ id: 'r1', author: 'Reader', ts: 1, body: '中文评论 comment body' }],
};

const DOC_ID = 'e2e-fonts-paper';
const FONTS = ['serif', 'modern-serif', 'cjk-serif', 'sans', 'humanist', 'mono'];
const ACCENTS = ['cerulean', 'emerald', 'ember', 'violet', 'graphite'];

// Personal settings and the document live in browser storage, so seeding them
// exercises the real bootstrap path without driving the settings UI first.
async function seedDoc(page: Page, settings: Record<string, unknown>) {
  await page.goto('./');
  await page.evaluate(({ md, id, thread, next }) => {
    const now = Date.now();
    localStorage.setItem('foil_settings', JSON.stringify(next));
    localStorage.setItem(`foil_doc_${id}`, JSON.stringify({
      id, title: '排版样本', md, comments: [thread], createdAt: now, updatedAt: now,
    }));
    sessionStorage.setItem('foil_current_id', id);
  }, { md: SAMPLE_MD, id: DOC_ID, thread: THREAD, next: settings });
  await page.reload();
  await expect(page.locator('.editor[contenteditable="true"]')).toBeVisible();
}

function base(overrides: Record<string, unknown> = {}) {
  return {
    theme: 'light',
    proseFont: 'serif',
    proseSize: 'default',
    accent: 'cerulean',
    editorWidth: 'default',
    density: 'comfortable',
    ...overrides,
  };
}

// Every HTTP(S) request is intercepted; only the local build may answer. A
// downloaded font would show up here as well as in document.fonts.
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

const computed = (target: Locator, property: string) =>
  target.first().evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);

const firstFace = (family: string) => family.split(',')[0].trim().replace(/^["']|["']$/g, '');

const storedSettings = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('foil_settings') ?? 'null') as Record<string, unknown>);

test('font cards sample Chinese and switch prose and headings without downloading a font', async ({ page, context, baseURL }) => {
  const external: string[] = [];
  await blockExternal(context, baseURL!, external);
  await seedDoc(page, base());
  const editor = page.locator('.editor[contenteditable="true"]');

  await page.getByRole('button', { name: 'Settings' }).click();
  const previews = page.locator('.font-card-preview');
  await expect(previews).toHaveCount(FONTS.length);
  // Each card shows a Chinese + Latin + digit sample in its own stack.
  expect(await previews.allTextContents()).toEqual(Array(FONTS.length).fill('中文 Aa 123'));

  const cjkCard = page.locator('.font-card').filter({ hasText: 'CJK Serif' });
  const sampleFamily = await computed(cjkCard.locator('.font-card-preview'), 'font-family');
  // Engines serialize quoted family names differently, so compare unquoted.
  expect(firstFace(sampleFamily)).toBe('Source Han Serif SC');
  expect(sampleFamily).toContain('Songti SC');
  expect(sampleFamily).toContain('Charter');
  expect(sampleFamily).not.toMatch(/url\(|https?:/i);
  // Card copy stays in the UI face, so the picker itself never follows prose.
  const labelFamily = await computed(cjkCard.locator('.font-card-label'), 'font-family');
  expect(labelFamily).toContain('ui-sans-serif');
  expect(labelFamily).not.toContain('Source Han');

  await cjkCard.click();
  expect((await storedSettings(page)).proseFont).toBe('cjk-serif');
  await expect.poll(() => computed(editor, 'font-family')).toBe(sampleFamily);
  // Document headings follow the chosen face.
  await expect.poll(() => computed(editor.locator('.ln.h1'), 'font-family')).toBe(sampleFamily);
  await expect.poll(() => computed(editor.locator('.ln.h3'), 'font-family')).toBe(sampleFamily);
  // Code keeps the mono stack, now with local CJK candidates for comments.
  const codeFamily = await computed(editor.locator('.ln.code'), 'font-family');
  expect(codeFamily).toContain('Noto Sans Mono CJK SC');
  expect(codeFamily).toContain('PingFang SC');
  expect(codeFamily).not.toContain('Source Han Serif');
  // Body tracking is untouched: no letter-spacing on prose.
  expect(await computed(editor.locator('.ln.p'), 'letter-spacing')).toBe('normal');

  await page.getByRole('button', { name: 'Done' }).click();
  // Buttons, top bar and status bar keep their UI faces, never the prose face.
  expect(await computed(page.locator('.topbar'), 'font-family')).toContain('ui-sans-serif');
  expect(await computed(page.locator('.statusbar'), 'font-family')).toContain('ui-monospace');
  expect(await computed(page.locator('.btn-ghost-bordered'), 'font-family')).toContain('ui-sans-serif');
  for (const selector of ['.topbar', '.statusbar', '.btn-ghost-bordered']) {
    expect(await computed(page.locator(selector), 'font-family')).not.toContain('Source Han');
  }
  expect(await page.evaluate(() => document.fonts.size)).toBe(0);
  expect(external).toEqual([]);
});

test('a record without readingStyle stays standard and paper retints only the document area', async ({ page, context, baseURL }) => {
  const external: string[] = [];
  await blockExternal(context, baseURL!, external);
  const canvas = page.locator('.canvas');
  const editor = page.locator('.editor[contenteditable="true"]');

  for (const theme of ['light', 'dark'] as const) {
    // Written by an older build: no readingStyle field at all.
    await seedDoc(page, base({ theme }));
    expect(await page.evaluate(() => document.documentElement.dataset.readingStyle)).toBe('standard');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);

    const sample = async () => ({
      canvasBg: await computed(canvas, 'background-color'),
      bodyBg: await computed(page.locator('body'), 'background-color'),
      topbarBg: await computed(page.locator('.topbar'), 'background-color'),
      statusbarFg: await computed(page.locator('.statusbar'), 'color'),
      heading: await computed(editor.locator('.ln.h1'), 'color'),
      prose: await computed(editor.locator('.ln.p'), 'color'),
      quote: await computed(editor.locator('.ln.quote'), 'color'),
      code: await computed(editor.locator('.ln.code'), 'color'),
      codeBg: await computed(editor.locator('.ln.code'), 'background-color'),
      cardFg: await computed(page.locator('.gutter-comments .comment-thread .body'), 'color'),
      cardBg: await computed(page.locator('.gutter-comments .comment-thread'), 'background-color'),
    });
    const standard = await sample();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('radio', { name: 'Paper' }).click();
    await expect(page.evaluate(() => document.documentElement.dataset.readingStyle)).resolves.toBe('paper');
    const paper = await sample();
    expect((await storedSettings(page)).readingStyle).toBe('paper');

    // The document area is retinted; chrome keeps the interface palette.
    for (const key of ['canvasBg', 'heading', 'prose', 'quote', 'code', 'codeBg', 'cardBg'] as const) {
      expect(paper[key], key).not.toBe(standard[key]);
    }
    for (const key of ['bodyBg', 'topbarBg', 'statusbarFg'] as const) {
      expect(paper[key], key).toBe(standard[key]);
    }

    // Readable prose, quotes, code and comment text on the paper sheet.
    expect(await contrastRatio(page, paper.heading, paper.canvasBg)).toBeGreaterThanOrEqual(7);
    expect(await contrastRatio(page, paper.prose, paper.canvasBg)).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(page, paper.quote, paper.canvasBg)).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(page, paper.code, paper.codeBg)).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(page, paper.cardFg, paper.cardBg)).toBeGreaterThanOrEqual(4.5);

    // A responsive reading column, not a fixed page: no texture, no shadow.
    expect(await computed(canvas, 'background-image')).toBe('none');
    expect(await computed(canvas, 'box-shadow')).toBe('none');
    await page.getByRole('button', { name: 'Done' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const width = (await canvas.boundingBox())!.width;
    expect(width).toBeLessThanOrEqual(1280);
    expect(width).toBeGreaterThan(600);

    // Standard is one click away again, and nothing else moved.
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('radio', { name: 'Standard' }).click();
    await expect.poll(() => computed(canvas, 'background-color')).toBe(standard.canvasBg);
    await page.getByRole('button', { name: 'Done' }).click();
  }
  expect(external).toEqual([]);
});

test('paper keeps every accent link and comment anchor legible in both themes', async ({ page, context, baseURL }) => {
  const external: string[] = [];
  await blockExternal(context, baseURL!, external);
  const editor = page.locator('.editor[contenteditable="true"]');

  for (const theme of ['light', 'dark'] as const) {
    for (const accent of ACCENTS) {
      await seedDoc(page, base({ theme, accent, readingStyle: 'paper' }));
      const canvasBg = await computed(page.locator('.canvas'), 'background-color');

      // Links keep the chosen accent and stay readable on the sheet.
      const link = await computed(editor.locator('.md-link'), 'color');
      expect(link).not.toBe(await computed(editor.locator('.ln.p'), 'color'));
      expect(await contrastRatio(page, link, canvasBg), `${theme}/${accent}`).toBeGreaterThanOrEqual(4.5);

      // Comment positioning is visible, and activation is a distinct state.
      const highlight = editor.locator('.anchor-hl').first();
      await expect(highlight).toBeVisible();
      const idle = await computed(highlight, 'background-color');
      expect(idle).not.toBe('rgba(0, 0, 0, 0)');
      expect(idle).not.toBe(canvasBg);
      await page.locator('.gutter-comments .comment-thread .anchor').first().click();
      await expect.poll(() => computed(editor.locator('.anchor-hl.active'), 'background-color')).not.toBe(idle);

      // The active thread card announces itself against the paper sheet.
      const card = page.locator('.gutter-comments .comment-thread').first();
      expect(await computed(card, 'border-top-color')).not.toBe(await computed(card, 'background-color'));
    }
  }
  expect(external).toEqual([]);
});

test('a narrow viewport keeps paper inside the reading column', async ({ page, context, baseURL }) => {
  const external: string[] = [];
  await blockExternal(context, baseURL!, external);
  await page.setViewportSize({ width: 375, height: 720 });
  await seedDoc(page, base({ readingStyle: 'paper', theme: 'light' }));
  const canvas = page.locator('.canvas');
  const box = await canvas.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await contrastRatio(
    page,
    await computed(page.locator('.editor .ln.p'), 'color'),
    await computed(canvas, 'background-color')
  )).toBeGreaterThanOrEqual(4.5);
  expect(external).toEqual([]);
});
