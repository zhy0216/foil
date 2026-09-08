import { expect, type Page } from '@playwright/test';
import type { DocState } from '@foil/editor/types';
import { DOC, PASSWORD, expectDocument, expectHidden, hasPassword, hasTime, options, passwordGate, snapshot, type Mode } from '../../../web/tests/e2e/helpers/html-export';
import { UNLOCK_MS } from '../../../web/tests/e2e/helpers/drand';

// Test-only reuse: the hostile document, verified beacons and file assertions
// remain owned by the website suite. Neither application imports the other.
export { DOC, PASSWORD, expectDocument, expectHidden, hasPassword, hasTime, options, passwordGate, snapshot, UNLOCK_MS };
export type { Mode };
export const modes = ['d', 'e', 'td', 'te'] as const;

export const documents = (page: Page): Promise<Record<string, DocState & { id: string }>> => page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
  .filter(key => key.startsWith('foil_doc_')).sort().map(key => [key, JSON.parse(localStorage.getItem(key)!)])));
export const binding = (page: Page) => page.evaluate(() => sessionStorage.getItem('foil_current_id'));
export async function current(page: Page) { return (await documents(page))[`foil_doc_${await binding(page)}`]; }

export async function newDocument(page: Page, title: string, md: string) {
  await page.getByTitle('Switch document', { exact: true }).click();
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByRole('button', { name: 'Rename document', exact: true }).click();
  await page.getByPlaceholder('Untitled document').fill(title);
  await page.getByPlaceholder('Untitled document').press('Enter');
  await page.locator('[contenteditable="true"]').fill(md);
  await expect.poll(() => current(page)).toMatchObject({ title, md });
}

export async function selectDocument(page: Page, title: string) {
  await page.getByTitle('Switch document', { exact: true }).click();
  await page.locator('.doc-switcher-row-main').filter({ has: page.getByText(title, { exact: true }) }).click();
  await expect(page.getByTitle('Switch document', { exact: true })).toContainText(title);
}

export async function seedDocument(page: Page, doc = DOC) {
  // Deterministic authors only. UI create/edit/comment/persistence are tested
  // separately; all sharing/crypto/import/fork calls run the compiled UI.
  await page.evaluate(doc => {
    localStorage.clear();
    localStorage.setItem('foil_doc_author', JSON.stringify({ ...doc, id: 'author', createdAt: 1, updatedAt: 1 }));
    localStorage.setItem('foil_name', 'AUTHOR_PRIVATE_NAME_SENTINEL');
    sessionStorage.setItem('foil_current_id', 'author');
  }, doc);
  await page.reload();
  await expect.poll(() => snapshot(page)).toBe(doc.md);
}

export async function openShare(page: Page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Share this document' })).toBeVisible();
  await expect(page.getByLabel('Shareable link')).toHaveValue(/#d=/);
}
export async function share(page: Page, mode: Mode) {
  await openShare(page);
  await options(page, mode);
  await expect(page.getByLabel('Shareable link')).toHaveValue(new RegExp(`#${mode}=`), { timeout: 30_000 });
  return page.getByLabel('Shareable link').inputValue();
}
export const closeShare = (page: Page) => page.getByRole('button', { name: 'Done', exact: true }).click();

export const importDialog = (page: Page) => page.getByRole('dialog', { name: 'Open shared link', exact: true });
export const importField = (page: Page) => page.getByRole('textbox', { name: 'Foil share link or fragment', exact: true });
export async function openImport(page: Page) {
  await page.bringToFront();
  await page.getByRole('button', { name: 'Open shared link', exact: true }).click();
  await expect(importField(page)).toBeFocused();
  expect(await importDialog(page).evaluate(el => el.matches(':modal'))).toBe(true);
}
export async function importLink(page: Page, input: string) {
  await openImport(page);
  await importField(page).fill(input);
  const pending = page.context().waitForEvent('page');
  await importDialog(page).getByRole('button', { name: 'Open in new tab', exact: true }).click();
  const imported = await pending;
  await expect(importDialog(page)).toHaveCount(0);
  await expect(imported).toHaveURL(/^chrome-extension:\/\/[a-p]{32}\/index\.html$/);
  return imported;
}

export async function unlock(page: Page, mode: Mode, beforeDecrypt?: () => void) {
  if (hasPassword(mode)) {
    await passwordGate(page, 'wrong password');
    await expect(page.getByText(/Wrong password or corrupt link\./)).toBeVisible();
    await expectHidden(page);
    await passwordGate(page);
  }
  if (hasTime(mode)) {
    await expect(page.getByRole('heading', { name: 'Time capsule', exact: true })).toBeVisible();
    await expect(page.locator('.tc-countdown-time')).toHaveText('00:01:00');
    await expect(page.getByRole('button', { name: 'Decrypt', exact: true })).toHaveCount(0);
    await expectHidden(page);
    beforeDecrypt?.();
    await page.clock.setFixedTime(UNLOCK_MS);
    await expect(page.getByRole('button', { name: 'Decrypt', exact: true })).toBeEnabled();
    await expectHidden(page);
    await page.getByRole('button', { name: 'Decrypt', exact: true }).click();
  }
}

export async function fork(page: Page, doc = DOC) {
  await page.getByRole('button', { name: 'Edit anyway', exact: true }).click();
  await expect(page.locator('[contenteditable="true"]')).toBeVisible();
  const id = await binding(page);
  expect(id).not.toBeNull();
  expect(await current(page)).toMatchObject({ ...doc });
  await page.reload();
  await expect.poll(() => snapshot(page)).toBe(doc.md);
  expect(await binding(page)).toBe(id);
  expect(await current(page)).toMatchObject({ ...doc });
  return id;
}
