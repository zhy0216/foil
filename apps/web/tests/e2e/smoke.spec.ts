import { expect, test } from '@playwright/test';

test('opens the built app with CSP and keeps local edits after reload', async ({ page, context, baseURL }) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  const origin = new URL(baseURL!).origin;

  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      errors.push(message.text());
    }
  });
  // Each test has a fresh browser context. Only the local static preview may
  // receive requests; a regression must never contact public drand services.
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === origin) {
      await route.continue();
    } else {
      externalRequests.push(route.request().url());
      await route.abort();
    }
  });

  const response = await page.goto('./');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(`${baseURL}`);
  const editor = page.locator('.editor[contenteditable="true"]');
  await expect(editor).toBeVisible();

  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp?.split(';').map(value => value.trim()).filter(Boolean)).toEqual([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    'connect-src https://api.drand.sh https://drand.cloudflare.com https://api2.drand.sh https://api3.drand.sh',
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ]);

  const text = ' toolchain smoke 09.';
  await editor.locator('.ln').first().click();
  await page.keyboard.type(text);
  await expect(editor).toContainText(text);
  await expect.poll(() => page.evaluate(() => {
    const id = sessionStorage.getItem('foil_current_id');
    const stored = id && localStorage.getItem(`foil_doc_${id}`);
    return stored ? JSON.parse(stored).md : '';
  })).toContain(text);

  await page.reload();
  await expect(editor).toContainText(text);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});
