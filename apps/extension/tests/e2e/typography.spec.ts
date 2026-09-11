import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { snapshot } from './helpers';
// Test-only reuse: the task-07 fixed sample remains owned by the website suite.
import { SAMPLE_COMMENTS, SAMPLE_DOC, SAMPLE_MD, SAMPLE_SENTINELS, visualBaselineDir } from '../../../web/tests/e2e/helpers/samples';

const BASELINE = visualBaselineDir(import.meta.url);
const shot = (page: Page, name: string) => page.screenshot({ path: join(BASELINE, name) });

/* Task 07 host coverage: the same fixed sample renders correctly in the
   packaged extension editor and its local Read view, offline, with the
   recipient-independent personal settings applied. */

test('packaged extension renders the full sample with settings, comments and Read view offline', async ({ extension }) => {
  const page = await extension.page();
  await page.evaluate(({ doc, comments }) => {
    localStorage.clear();
    localStorage.setItem('foil_settings', JSON.stringify({
      theme: 'dark', proseFont: 'cjk-serif', proseSize: 'large', accent: 'violet',
      editorWidth: 'default', density: 'compact', readingStyle: 'paper',
    }));
    localStorage.setItem('foil_doc_sample', JSON.stringify({ ...doc, comments, id: 'sample', createdAt: 1, updatedAt: 1 }));
    sessionStorage.setItem('foil_current_id', 'sample');
  }, { doc: SAMPLE_DOC, comments: SAMPLE_COMMENTS });
  await page.reload();

  const editor = page.locator('.editor[contenteditable="true"]');
  await expect(editor).toBeVisible();
  // The raw markdown round-trips exactly and ordered markers stay visible.
  await expect.poll(() => snapshot(page)).toBe(SAMPLE_MD);
  expect(await page.locator('.editor .ln.olist').first().textContent()).toBe('1. First ordered item');
  expect(await page.locator('.editor .ln.olist').nth(2).textContent()).toBe('42) Answer with a different delimiter');

  // Personal settings actually apply inside the packaged tab.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.dataset.readingStyle)).toBe('paper');
  const paragraph = editor.locator('.ln.p').first();
  await expect(paragraph).toHaveCSS('font-size', '21px');
  expect(await paragraph.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Source Han Serif SC');
  expect(await paragraph.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))).toBeCloseTo(21 * 1.55, 1);
  // Every located comment thread is anchored; unlocated threads stay in read views.
  await expect(page.locator('.gutter-comments .comment-thread')).toHaveCount(SAMPLE_COMMENTS.length - 1);
  for (const quote of ['排版的核心', 'cross-block', '好的排版是隐形的', '排版是隐形']) {
    await expect(page.locator('.anchor-hl').filter({ hasText: quote }).first(), quote).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await shot(page, 'ext-editor.png');

  // Local Read view: full content, TOC jumps without touching the URL hash.
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  const reading = page.locator('.readonly-document .reading-preview');
  await expect(reading).toBeVisible();
  const text = await page.locator('.readonly-document').innerText();
  for (const sentinel of SAMPLE_SENTINELS) expect(text, sentinel).toContain(sentinel);
  const entries = page.locator('.reading-toc nav a');
  expect(await entries.count()).toBeGreaterThanOrEqual(3);
  await entries.first().click();
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.locator('.readonly-document .gutter-comments .comment-thread')).toHaveCount(SAMPLE_COMMENTS.length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await shot(page, 'ext-reading.png');

  await page.locator('.readonly-document').getByRole('button', { name: 'Back to editing', exact: true }).click();
  await expect(editor).toBeVisible();
  expect(await snapshot(page)).toBe(SAMPLE_MD);

  // A phone-width window keeps the sample inside the viewport.
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await shot(page, 'ext-editor-375.png');
  await page.setViewportSize({ width: 1400, height: 1000 });
});
