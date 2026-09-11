import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

test.use({ timezoneId: 'UTC' });

/* Task 04 host-level acceptance: Reading is the default official reading
   view, the TOC never rewrites the share fragment, local Read/Write keeps
   the document and caret, and the reader-view preference stays local. */

const FILLER = Array.from({ length: 24 }, (_, i) => `Filler paragraph ${i} 填充段落 to force real scrolling.`).join(' ');

const ARTICLE = {
  title: 'Annual Report 年度报告',
  md: [
    '# Annual Report 年度报告',
    '',
    'Intro paragraph with ==highlight== and **bold** text.',
    '',
    '## Section One',
    '',
    FILLER,
    '',
    '## Section One',
    '',
    'Body of the duplicate section.',
    '',
    FILLER,
    '',
    '### Details 细节',
    '',
    'Tail text.',
  ].join('\n'),
  comments: [
    { id: 'located', quote: 'highlight', before: 'with ==', after: '== and', replies: [
      { id: 'r1', author: 'Author 作者', ts: 1, body: 'READING_COMMENT_BODY 评论' },
    ] },
    { id: 'unlocated', quote: 'This quote was removed', before: '', after: '', replies: [
      { id: 'r2', author: 'Other', ts: 2, body: 'UNLOCATED_READING_BODY' },
    ] },
  ],
};

const LOCAL = { title: 'Local notes', md: '# Local notes\n\n## Section\n\nbody 中文', comments: [] };
const SHORT = { title: 'Short Brief 简报', md: '# Heading A\n\n## Heading B\n\ntext', comments: [] };

async function seed(context: BrowserContext, doc: Record<string, unknown>) {
  await context.addInitScript((value: Record<string, unknown>) => {
    localStorage.setItem('foil_doc_seed', JSON.stringify({ ...value, id: 'seed', createdAt: 1, updatedAt: 1 }));
    sessionStorage.setItem('foil_current_id', 'seed');
  }, doc);
}

async function shareLinkOf(page: Page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const link = page.locator('.url-row input');
  await expect(link).toHaveValue(/#d=[A-Za-z0-9_-]+$/, { timeout: 15_000 });
  const url = await link.inputValue();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  return url;
}

async function sourceSnapshot(page: Page) {
  return page.locator('.editor').evaluate((el) =>
    Array.from(el.querySelectorAll('.ln'))
      .map((line) => (line.textContent ?? '').replace(/\u200b/g, ''))
      .join('\n'));
}

/** Fresh recipient context: isolated storage, all non-origin requests blocked and recorded. */
async function newRecipient(browser: Browser, baseURL: string, options: {
  viewport?: { width: number; height: number };
  readerView?: string;
} = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'UTC', viewport: options.viewport });
  const external: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL).origin) return route.continue();
    external.push(url.toString());
    return route.abort();
  });
  if (options.readerView !== undefined) {
    await context.addInitScript(([key, value]) => localStorage.setItem(key, value), ['foil_reader_view', options.readerView] as const);
  }
  return { context, page: await context.newPage(), external };
}

test('desktop reading: dedup title, TOC jumps without touching the share hash, comments and Source fidelity', async ({ page, context, browser, baseURL }) => {
  await seed(context, ARTICLE);
  await page.goto('./');
  const link = await shareLinkOf(page);
  const { page: reader, context: readerContext, external } = await newRecipient(browser, baseURL!);
  try {
    await reader.goto(link);
    // Official reading defaults to the semantic Reading view.
    await expect(reader.locator('.reading-preview')).toBeVisible({ timeout: 15_000 });
    await expect(reader.locator('.preview')).toHaveCount(0);
    // Title equals the first heading: deduplicated; the topbar keeps it.
    await expect(reader.locator('.reading-doc-title')).toHaveCount(0);
    await expect(reader.locator('.readonly-title')).toHaveText(ARTICLE.title);
    // TOC comes from the same parse: duplicate headings get unique targets.
    const entries = reader.locator('.reading-toc nav a');
    await expect(entries).toHaveCount(4);
    const hrefs = await entries.evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(4);
    expect(hrefs).toContain('#section-one');
    expect(hrefs).toContain('#section-one-1');
    await expect(reader.locator('.reading-toc')).toBeVisible();
    expect(await reader.locator('.reading-toc').evaluate((el: HTMLDetailsElement) => el.open)).toBe(true);

    // A TOC jump scrolls to the heading with top padding and never rewrites
    // the URL fragment that carries share payloads.
    await reader.locator('.reading-toc nav a', { hasText: 'Details 细节' }).click();
    expect(new URL(reader.url()).hash).toBe('');
    const heading = reader.locator('#details-细节');
    await expect(heading).toBeInViewport();
    const box = (await heading.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(80);
    expect(await reader.evaluate(() => document.activeElement?.id)).toBe('details-细节');
    // Keyboard activation behaves the same.
    await entries.first().focus();
    await reader.keyboard.press('Enter');
    expect(new URL(reader.url()).hash).toBe('');

    // Comments: located anchors highlight, unlocated threads stay reachable.
    await reader.locator('.reading-preview .anchor-hl').first().click();
    await expect(reader.locator('.gutter-comments .comment-thread.active')).toContainText('READING_COMMENT_BODY 评论');
    await expect(reader.getByText('Quoted text not found in this document.')).toBeVisible();
    await expect(reader.getByRole('button', { name: 'Copy Markdown', exact: true })).toBeVisible();

    // Source keeps the exact raw-markdown contract, Reading returns.
    await reader.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(reader.locator('.preview')).toBeVisible();
    expect(await sourceSnapshot(reader)).toBe(ARTICLE.md);
    await expect(reader.locator('.gutter-comments .comment-thread')).toHaveCount(2);
    await reader.getByRole('button', { name: 'Reading', exact: true }).click();
    await expect(reader.locator('.reading-preview')).toBeVisible();
    await expect(reader.locator('.reading-preview .anchor-hl').first()).toBeVisible();
    expect(external).toEqual([]);
  } finally {
    await readerContext.close();
  }
});

test('mobile 375px: compact chapter menu, comment drawer and no horizontal overflow', async ({ page, context, browser, baseURL }) => {
  await seed(context, ARTICLE);
  await page.goto('./');
  const link = await shareLinkOf(page);
  const { page: reader, context: readerContext, external } = await newRecipient(browser, baseURL!, { viewport: { width: 375, height: 812 } });
  try {
    await reader.goto(link);
    await expect(reader.locator('.reading-preview')).toBeVisible({ timeout: 15_000 });
    const toc = reader.locator('.reading-toc');
    await expect(toc).toBeVisible();
    expect(await toc.evaluate((el: HTMLDetailsElement) => el.open)).toBe(false);
    await toc.locator('summary').click();
    expect(await toc.evaluate((el: HTMLDetailsElement) => el.open)).toBe(true);
    await toc.locator('nav a', { hasText: 'Section One' }).first().click();
    expect(new URL(reader.url()).hash).toBe('');
    // The mobile comment drawer keeps every thread reachable.
    await reader.getByRole('button', { name: 'Read 2 comments' }).click();
    const drawer = reader.getByRole('dialog', { name: 'Comments', exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('READING_COMMENT_BODY 评论');
    await expect(drawer).toContainText('UNLOCATED_READING_BODY');
    await drawer.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(drawer).toHaveCount(0);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(external).toEqual([]);
  } finally {
    await readerContext.close();
  }
});

test('documents below the heading threshold show no fixed navigation and keep a readable page-head title', async ({ page, context, browser, baseURL }) => {
  await seed(context, SHORT);
  await page.goto('./');
  const link = await shareLinkOf(page);
  const { page: reader, context: readerContext, external } = await newRecipient(browser, baseURL!);
  try {
    await reader.goto(link);
    await expect(reader.locator('.reading-preview')).toBeVisible({ timeout: 15_000 });
    await expect(reader.locator('.reading-toc')).toHaveCount(0);
    // The title differs from the first heading, so the page head shows it.
    await expect(reader.locator('.reading-doc-title')).toHaveText('Short Brief 简报');
    expect(external).toEqual([]);
  } finally {
    await readerContext.close();
  }
});

test('local Read/Write switching keeps content, caret and saves; shared views offer no Write entry', async ({ page, context, browser, baseURL }) => {
  await seed(context, LOCAL);
  await page.goto('./');
  await expect(page.locator('.editor[contenteditable="true"]')).toBeVisible();
  await page.locator('.editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' appended 中文');
  await expect(page.locator('.save-state')).toHaveText('● saved', { timeout: 5_000 });
  const rawBefore = await page.evaluate(() => localStorage.getItem('foil_doc_seed'));

  await page.getByRole('button', { name: 'Read', exact: true }).click();
  const reading = page.locator('.readonly-document');
  await expect(reading).toBeVisible();
  await expect(reading.locator('.reading-preview')).toContainText('appended 中文');
  await expect(reading.getByRole('button', { name: 'Back to editing', exact: true })).toBeVisible();
  // Two headings: no fixed navigation on the local read view either.
  await expect(reading.locator('.reading-toc')).toHaveCount(0);
  // Switching alone never saves and never dirties the document.
  expect(await page.evaluate(() => localStorage.getItem('foil_doc_seed'))).toBe(rawBefore);

  await reading.getByRole('button', { name: 'Back to editing', exact: true }).click();
  await expect(page.locator('.editor[contenteditable="true"]')).toBeVisible();
  await expect(page.locator('.readonly-document')).toHaveCount(0);
  // The caret was restored at the end of the text: typing continues there.
  await page.keyboard.type('X');
  expect(await sourceSnapshot(page)).toContain('appended 中文X');
  await expect(page.locator('.save-state')).toHaveText('● saved', { timeout: 5_000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('foil_doc_seed')!).md)).toContain('appended 中文X');

  // A shared link keeps only the explicit fork entry.
  const link = await shareLinkOf(page);
  const { page: recipient, context: recipientContext, external } = await newRecipient(browser, baseURL!);
  try {
    await recipient.goto(link);
    await expect(recipient.locator('.reading-preview')).toBeVisible({ timeout: 15_000 });
    await expect(recipient.getByRole('button', { name: 'Back to editing', exact: true })).toHaveCount(0);
    await expect(recipient.getByRole('button', { name: 'Read', exact: true })).toHaveCount(0);
    await expect(recipient.getByRole('button', { name: 'Edit anyway', exact: true })).toBeVisible();
    expect(external).toEqual([]);
  } finally {
    await recipientContext.close();
  }
});

test('reader view is recipient-local: persisted per recipient, invalid values fall back to Reading', async ({ page, context, browser, baseURL }) => {
  await seed(context, ARTICLE);
  await page.goto('./');
  const link = await shareLinkOf(page);

  const first = await newRecipient(browser, baseURL!);
  try {
    await first.page.goto(link);
    await expect(first.page.locator('.reading-preview')).toBeVisible({ timeout: 15_000 });
    await first.page.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(first.page.locator('.preview')).toBeVisible();
    expect(await first.page.evaluate(() => localStorage.getItem('foil_reader_view'))).toBe('source');
    // The preference survives a fresh load for this recipient only.
    await first.page.goto(link);
    await expect(first.page.locator('.preview')).toBeVisible();
    await expect(first.page.locator('.reading-preview')).toHaveCount(0);
    expect(first.external).toEqual([]);
  } finally {
    await first.context.close();
  }

  const invalid = await newRecipient(browser, baseURL!, { readerView: 'garbage' });
  try {
    await invalid.page.goto(link);
    await expect(invalid.page.locator('.reading-preview')).toBeVisible({ timeout: 15_000 });
    // Reading does not rewrite the stored value; an explicit switch does.
    expect(await invalid.page.evaluate(() => localStorage.getItem('foil_reader_view'))).toBe('garbage');
    await invalid.page.getByRole('button', { name: 'Source', exact: true }).click();
    expect(await invalid.page.evaluate(() => localStorage.getItem('foil_reader_view'))).toBe('source');
    expect(invalid.external).toEqual([]);
  } finally {
    await invalid.context.close();
  }
});
