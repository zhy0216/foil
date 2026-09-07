import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const PASSWORD = 'correct horse battery staple';
const DOCUMENT_MARKER = 'e2e sharing marker: 跨浏览器密码分享';

// This is the same pinned quicknet information used by the time-capsule unit
// tests. The round-1000 beacon is a real, verified beacon, so the browser runs
// the actual tlock encryption/decryption code while the test remains offline.
const DRAND_INFO = {
  hash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  public_key:
    '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  genesis_time: 1692803367,
  period: 3,
  schemeID: 'bls-unchained-g1-rfc9380',
  groupHash: 'f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e',
  metadata: { beaconID: 'quicknet' },
};

const DRAND_BEACON = {
  round: 1000,
  randomness: 'fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd',
  signature:
    'b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39',
};

const DRAND_ORIGINS = new Set([
  'https://api.drand.sh',
  'https://drand.cloudflare.com',
  'https://api2.drand.sh',
  'https://api3.drand.sh',
]);

const ROUND_1000_UNLOCK_MS = (DRAND_INFO.genesis_time + (DRAND_BEACON.round - 1) * DRAND_INFO.period) * 1000;

type ClockWindow = Window & {
  __foilAdvanceTime?: (ms: number) => void;
};

async function installClock(page: Page, now: number) {
  await page.addInitScript((initialNow) => {
    let current = initialNow;
    Date.now = () => current;
    (window as ClockWindow).__foilAdvanceTime = (ms: number) => {
      current += ms;
    };
  }, now);
}

async function routeLocalAndDrand(context: BrowserContext, baseURL: string, externalRequests: string[]) {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      await route.continue();
      return;
    }
    if (DRAND_ORIGINS.has(url.origin) && url.pathname.endsWith('/info')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DRAND_INFO),
      });
      return;
    }
    if (DRAND_ORIGINS.has(url.origin) && url.pathname.endsWith(`/public/${DRAND_BEACON.round}`)) {
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

async function createPasswordLink(page: Page, password = PASSWORD) {
  await page.getByRole('button', { name: /Share/ }).click();
  await expect(page.getByRole('heading', { name: 'Share this document' })).toBeVisible();
  await page.getByRole('switch').nth(0).click();
  await page.locator('input[type="password"]').fill(password);
  const link = page.locator('.url-row input');
  await expect(link).toHaveValue(/#e=/, { timeout: 30_000 });
  return link.inputValue();
}

test('opens a password-only share with the correct password and preserves the document', async ({ page, context, baseURL }) => {
  const externalRequests: string[] = [];
  await routeLocalAndDrand(context, baseURL!, externalRequests);
  await page.goto('./');
  const sourceSnapshot = await enterMarker(page);

  const shareURL = await createPasswordLink(page);
  expect(shareURL).toMatch(/#e=[A-Za-z0-9_-]+$/);
  expect(shareURL).not.toContain('#te=');

  const recipient = await context.newPage();
  await recipient.goto(shareURL);
  await expect(recipient.getByRole('heading', { name: 'This document is encrypted' })).toBeVisible();
  await expect(recipient.getByRole('heading', { name: /Time capsule/ })).toHaveCount(0);
  expect(new URL(recipient.url()).hash).toBe('');

  const passwordInput = recipient.locator('input[type="password"]');
  await passwordInput.fill('wrong password');
  await recipient.getByRole('button', { name: 'Unlock' }).click();
  await expect(recipient.getByText('Wrong password or corrupt link.')).toBeVisible();
  await expect(recipient.locator('.editor')).toHaveCount(0);

  await passwordInput.fill(PASSWORD);
  await recipient.getByRole('button', { name: 'Unlock' }).click();
  await expect(recipient.locator('.editor.readonly')).toBeVisible();
  await expect(recipient.locator('.editor')).toContainText(DOCUMENT_MARKER);
  await expect.poll(() => editorSnapshot(recipient)).toBe(sourceSnapshot);
  await expect(recipient.getByRole('heading', { name: /Time capsule/ })).toHaveCount(0);
  await expect(recipient.getByText('Viewing shared link')).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test('opens a password-protected time capsule after the one-minute wait', async ({ page, context, baseURL }) => {
  const externalRequests: string[] = [];
  await routeLocalAndDrand(context, baseURL!, externalRequests);

  // Generate a round-1000 capsule with the one-hour preset. The recipient is
  // then placed one minute before that same round so the test can advance the
  // unlock wait without sleeping for an hour or relying on wall-clock dates.
  await installClock(page, ROUND_1000_UNLOCK_MS - 3_600_000);
  await page.goto('./');
  const sourceSnapshot = await enterMarker(page);
  await page.getByRole('button', { name: /Share/ }).click();
  await expect(page.getByRole('heading', { name: 'Share this document' })).toBeVisible();
  const switches = page.getByRole('switch');
  await switches.nth(0).click();
  await page.locator('input[type="password"]').fill(PASSWORD);
  await switches.nth(1).click();
  await page.getByRole('button', { name: '+1 hour' }).click();
  const link = page.locator('.url-row input');
  await expect(link).toHaveValue(/#te=/, { timeout: 30_000 });
  const shareURL = await link.inputValue();
  expect(shareURL).toMatch(/#te=[A-Za-z0-9_-]+$/);

  const recipient = await context.newPage();
  await installClock(recipient, ROUND_1000_UNLOCK_MS - 60_000);
  await recipient.goto(shareURL);
  await expect(recipient.getByRole('heading', { name: 'This document is encrypted' })).toBeVisible();

  const passwordInput = recipient.locator('input[type="password"]');
  await passwordInput.fill(PASSWORD);
  await recipient.getByRole('button', { name: 'Unlock' }).click();
  await expect(recipient.getByRole('heading', { name: /Time capsule/ })).toBeVisible();
  await expect(recipient.locator('.tc-countdown-time')).toHaveText(/00:01:00/);
  await expect(recipient.getByRole('button', { name: 'Decrypt' })).toBeHidden();

  await recipient.evaluate(() => (window as ClockWindow).__foilAdvanceTime?.(61_000));
  await expect(recipient.getByText('Unsealed')).toBeVisible({ timeout: 5_000 });
  await recipient.getByRole('button', { name: 'Decrypt' }).click();
  await expect(recipient.locator('.editor.readonly')).toBeVisible({ timeout: 30_000 });
  await expect(recipient.locator('.editor')).toContainText(DOCUMENT_MARKER);
  await expect.poll(() => editorSnapshot(recipient)).toBe(sourceSnapshot);
  await expect(recipient.getByText('Viewing shared link')).toBeVisible();
  expect(externalRequests).toEqual([]);
});
