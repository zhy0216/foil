import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { DRAND_BEACON, DRAND_INFO, DRAND_ORIGINS, UNLOCK_MS } from './helpers/drand';

const test = base.extend<{ recipient: Page }>({
  recipient: async ({ browser }, use) => {
    // A recipient must decrypt the link without access to the author's local docs.
    const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'UTC' });
    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
});

test.use({ timezoneId: 'UTC' });

const PASSWORD = 'correct horse battery staple';
const DOCUMENT_MARKER = 'e2e sharing marker: 跨浏览器密码分享';

async function routeLocalAndDrand(
  context: BrowserContext,
  baseURL: string,
  externalRequests: string[],
  drandRequests: string[] = [],
) {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      await route.continue();
      return;
    }
    if (DRAND_ORIGINS.has(url.origin) && url.pathname.endsWith('/info')) {
      drandRequests.push('info');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DRAND_INFO),
      });
      return;
    }
    if (DRAND_ORIGINS.has(url.origin) && url.pathname.endsWith(`/public/${DRAND_BEACON.round}`)) {
      drandRequests.push('beacon');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DRAND_BEACON),
      });
      return;
    }
    externalRequests.push(url.toString());
    await route.abort();
  });
}

async function editorSnapshot(page: Page) {
  return page.locator('.editor').evaluate((editor) =>
    Array.from(editor.querySelectorAll('.ln'))
      .map((line) => (line.textContent ?? '').replace(/\u200b/g, ''))
      .join('\n'),
  );
}

async function enterMarker(page: Page) {
  const editor = page.locator('.editor[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.locator('.ln').first().click();
  await page.keyboard.type(` ${DOCUMENT_MARKER}`);
  await expect(editor).toContainText(DOCUMENT_MARKER);
  return editorSnapshot(page);
}

async function createPasswordLink(page: Page, unlock?: '+1 hour' | 'Custom') {
  await page.getByRole('button', { name: /Share/ }).click();
  await expect(page.getByRole('heading', { name: 'Share this document' })).toBeVisible();
  await page.getByRole('switch').nth(0).click();
  await page.locator('input[type="password"]').fill(PASSWORD);
  if (unlock) {
    await page.getByRole('switch').nth(1).click();
    await page.getByRole('button', { name: unlock, exact: true }).click();
    if (unlock === 'Custom') {
      // Both browser contexts use UTC, so the local input matches this ISO date.
      await page.locator('input[type="datetime-local"]').fill(new Date(UNLOCK_MS).toISOString().slice(0, 16));
    }
    await expect(page.locator('.tc-readout-sub')).toContainText(`drand round #${DRAND_BEACON.round}`);
  }
  const link = page.locator('.url-row input');
  await expect(link).toHaveValue(unlock ? /#te=[A-Za-z0-9_-]+$/ : /#e=[A-Za-z0-9_-]+$/, { timeout: 30_000 });
  return link.inputValue();
}

async function expectPasswordGate(recipient: Page) {
  await expect(recipient.getByRole('heading', { name: 'This document is encrypted' })).toBeVisible();
  await expect(recipient.getByRole('heading', { name: /Time capsule/ })).toHaveCount(0);
  await expect(recipient.locator('.editor')).toHaveCount(0);
  await expect(recipient.getByText(DOCUMENT_MARKER, { exact: false })).toHaveCount(0);
  expect(new URL(recipient.url()).hash).toBe('');
}

async function expectSharedDocument(recipient: Page, sourceSnapshot: string) {
  await expect(recipient.locator('.editor.readonly')).toBeVisible({ timeout: 30_000 });
  await expect(recipient.locator('.editor')).toHaveAttribute('contenteditable', 'false');
  await expect(recipient.locator('.editor')).toContainText(DOCUMENT_MARKER);
  await expect.poll(() => editorSnapshot(recipient)).toBe(sourceSnapshot);
  await expect(recipient.getByRole('heading', { name: 'This document is encrypted' })).toHaveCount(0);
  await expect(recipient.getByRole('heading', { name: /Time capsule/ })).toHaveCount(0);
  await expect(recipient.getByText('Viewing shared link')).toBeVisible();
}

for (const attempt of ['on the first try', 'after a wrong password'] as const) {
  test(`opens a password-only share with the correct password ${attempt}`, async ({ page, context, recipient, baseURL }) => {
    const externalRequests: string[] = [];
    const drandRequests: string[] = [];
    await routeLocalAndDrand(context, baseURL!, externalRequests, drandRequests);
    await routeLocalAndDrand(recipient.context(), baseURL!, externalRequests, drandRequests);
    await page.goto('./');
    const sourceSnapshot = await enterMarker(page);

    const shareURL = await createPasswordLink(page);
    await recipient.goto(shareURL);
    await expectPasswordGate(recipient);

    const passwordInput = recipient.locator('input[type="password"]');
    if (attempt === 'after a wrong password') {
      await passwordInput.fill('wrong password');
      await recipient.getByRole('button', { name: 'Unlock' }).click();
      await expect(recipient.getByText('Wrong password or corrupt link.')).toBeVisible();
      await expectPasswordGate(recipient);
    }

    await passwordInput.fill(PASSWORD);
    await passwordInput.press('Enter');
    await expectSharedDocument(recipient, sourceSnapshot);
    await expect(recipient.getByText('Wrong password or corrupt link.')).toHaveCount(0);
    expect(drandRequests).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
}

for (const unlock of ['+1 hour', 'Custom'] as const) {
  test(`opens a password-protected time capsule only when its ${unlock} unlock date is reached`, async ({ page, context, recipient, baseURL }) => {
    const externalRequests: string[] = [];
    const recipientDrandRequests: string[] = [];
    await routeLocalAndDrand(context, baseURL!, externalRequests);
    await routeLocalAndDrand(recipient.context(), baseURL!, externalRequests, recipientDrandRequests);

    // Generate a capsule for the fixed beacon, then open it one minute before
    // release. Fixed clocks avoid real waits and wall-clock dependence.
    await page.clock.setFixedTime(UNLOCK_MS - 3_600_000);
    await page.goto('./');
    const sourceSnapshot = await enterMarker(page);
    const shareURL = await createPasswordLink(page, unlock);

    await recipient.clock.setFixedTime(UNLOCK_MS - 60_000);
    await recipient.goto(shareURL);
    await expectPasswordGate(recipient);
    expect(recipientDrandRequests).toEqual([]);

    await recipient.locator('input[type="password"]').fill(PASSWORD);
    await recipient.getByRole('button', { name: 'Unlock' }).click();
    await expect(recipient.getByRole('heading', { name: /Time capsule/ })).toBeVisible();
    await expect(recipient.getByRole('heading', { name: 'This document is encrypted' })).toHaveCount(0);
    await expect(recipient.locator('.tc-countdown-time')).toHaveText('00:01:00');
    await expect(recipient.getByRole('button', { name: 'Decrypt', exact: true })).toBeHidden();
    await expect(recipient.locator('.editor')).toHaveCount(0);

    await recipient.clock.setFixedTime(UNLOCK_MS - 1000);
    await expect(recipient.locator('.tc-countdown-time')).toHaveText('00:00:01');
    await expect(recipient.getByRole('button', { name: 'Decrypt', exact: true })).toBeHidden();
    await expect(recipient.locator('.editor')).toHaveCount(0);
    await expect(recipient.getByText(DOCUMENT_MARKER, { exact: false })).toHaveCount(0);
    expect(recipientDrandRequests).toEqual([]);

    await recipient.clock.setFixedTime(UNLOCK_MS);
    await expect(recipient.getByText('Unsealed', { exact: true })).toBeVisible();
    await expect(recipient.getByRole('button', { name: 'Decrypt', exact: true })).toBeEnabled();
    await expect(recipient.locator('.editor')).toHaveCount(0);
    expect(recipientDrandRequests).toEqual([]);
    await recipient.getByRole('button', { name: 'Decrypt', exact: true }).click();
    await expectSharedDocument(recipient, sourceSnapshot);
    expect(recipientDrandRequests).toContain('beacon');
    expect(externalRequests).toEqual([]);
  });
}

test('still requires the correct password when a custom unlock date has already passed', async ({ page, context, recipient, baseURL }) => {
  const externalRequests: string[] = [];
  const recipientDrandRequests: string[] = [];
  await routeLocalAndDrand(context, baseURL!, externalRequests);
  await routeLocalAndDrand(recipient.context(), baseURL!, externalRequests, recipientDrandRequests);
  await page.clock.setFixedTime(UNLOCK_MS - 3_600_000);
  await page.goto('./');
  const sourceSnapshot = await enterMarker(page);
  const shareURL = await createPasswordLink(page, 'Custom');

  await recipient.clock.setFixedTime(UNLOCK_MS + 60_000);
  await recipient.goto(shareURL);
  await expectPasswordGate(recipient);
  await recipient.locator('input[type="password"]').fill('wrong password');
  await recipient.getByRole('button', { name: 'Unlock' }).click();
  await expect(recipient.getByText('Wrong password or corrupt link.')).toBeVisible();
  await expectPasswordGate(recipient);
  expect(recipientDrandRequests).toEqual([]);

  await recipient.locator('input[type="password"]').fill(PASSWORD);
  await recipient.getByRole('button', { name: 'Unlock' }).click();
  await expect(recipient.getByRole('heading', { name: /Time capsule/ })).toBeVisible();
  await expect(recipient.getByText('Unsealed', { exact: true })).toBeVisible();
  await expect(recipient.locator('.tc-countdown-time')).toHaveCount(0);
  await expect(recipient.getByRole('button', { name: 'Decrypt' })).toBeEnabled();
  await expect(recipient.locator('.editor')).toHaveCount(0);
  expect(recipientDrandRequests).toEqual([]);
  await recipient.getByRole('button', { name: 'Decrypt' }).click();
  await expectSharedDocument(recipient, sourceSnapshot);
  expect(recipientDrandRequests).toContain('beacon');
  expect(externalRequests).toEqual([]);
});
