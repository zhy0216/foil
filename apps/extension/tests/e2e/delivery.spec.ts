import { pathToFileURL } from 'node:url';
import { test, expect, shareBase } from './fixtures';
import { DOC, PASSWORD, expectDocument, expectHidden, hasPassword, hasTime, modes, openShare, options, passwordGate, seedDocument, share, UNLOCK_MS } from './helpers';
import { block, download, inspectFile } from '../../../web/tests/e2e/helpers/html-export';

for (const mode of modes) {
  test(`${mode}: installed Export HTML downloads a portable file, refreshes and re-exports in a fresh file browser`, async ({ extension, recipient }, info) => {
    const author = await extension.page();
    await author.clock.setFixedTime(UNLOCK_MS - 3_600_000);
    await seedDocument(author);
    if (hasTime(mode)) {
      await extension.context.setOffline(false);
      extension.network.allowDrand = true;
    }
    const link = await share(author, mode);
    expect(link.split('#')[0]).toBe(shareBase);
    expect(extension.scripts.filter(url => url.includes('foil-standalone.js'))).toEqual([]);
    expect(await author.evaluate(() => typeof (globalThis as { Buffer?: unknown }).Buffer)).toBe(hasTime(mode) ? 'function' : 'undefined');
    const first = await download(author, info, `${mode}-extension`);
    const original = inspectFile(first.html, mode, shareBase);
    expect(first.html).not.toContain('chrome-extension:');
    expect(first.filename).toMatch(/\.html$/);
    if (mode !== 'd') expect(first.filename).toBe('foil-shared-document.html');
    expect(extension.scripts).toContain(extension.entry.replace('index.html', 'foil-standalone.js'));
    if (!hasTime(mode)) expect(extension.network.requests).toEqual([]);
    await extension.close();

    const reader = await recipient({ drand: hasTime(mode) });
    const page = reader.page;
    await page.clock.setFixedTime(UNLOCK_MS - 60_000);
    await page.goto(pathToFileURL(first.path).href);
    expect(new URL(page.url()).protocol).toBe('file:');
    if (hasPassword(mode)) {
      await passwordGate(page, 'wrong password');
      await expect(page.getByText('Incorrect password or damaged share link')).toBeVisible();
      await expectHidden(page);
      expect(reader.network.requests).toEqual([]);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Reading cancelled' })).toBeVisible();
      await expectHidden(page);
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await passwordGate(page);
    }
    if (hasTime(mode)) {
      await expect(page.locator('.tc-countdown-time')).toHaveText('00:01:00');
      await expect(page.getByRole('button', { name: 'Decrypt', exact: true })).toHaveCount(0);
      await expectHidden(page);
      expect(reader.network.requests).toEqual([]);
      await page.clock.setFixedTime(UNLOCK_MS);
      await expect(page.getByText('Unsealed', { exact: true })).toBeVisible();
      await expectHidden(page);
      reader.network.failDrand = true;
      await page.getByRole('button', { name: 'Decrypt', exact: true }).click();
      await expect(page.getByText(/Could not reach drand/)).toBeVisible();
      await expectHidden(page);
      reader.network.failDrand = false;
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
    }
    await expectDocument(page);
    await page.reload();
    if (hasPassword(mode)) await passwordGate(page);
    if (hasTime(mode)) await page.getByRole('button', { name: 'Decrypt', exact: true }).click();
    await expectDocument(page);

    // Every sharing session resets protection. Explicitly select it again,
    // using the same fixed future beacon for the new time capsule.
    await page.clock.setFixedTime(UNLOCK_MS - 3_600_000);
    await openShare(page);
    const continuedLink = await page.getByLabel('Shareable link').inputValue();
    expect(continuedLink.split('#')[0]).toBe(shareBase);
    await options(page, mode, PASSWORD + ' second');
    await expect(page.getByLabel('Shareable link')).toHaveValue(new RegExp(`#${mode}=`), { timeout: 30_000 });
    const second = await download(page, info, `${mode}-file-again`);
    const regenerated = inspectFile(second.html, mode, shareBase, PASSWORD + ' second');
    expect(regenerated.script).toBe(original.script);
    expect(regenerated.styles).toBe(original.styles);
    // Compression differs across engines, and randomized tlock envelopes need
    // not compress to the same length. All non-payload bytes must be identical;
    // reopen below to verify the entire regenerated document and protection.
    expect({ ...regenerated.data, payload: undefined }).toEqual({ ...original.data, payload: undefined });
    expect(second.html.replace(block(second.html, 'script', 'foil-share-data'), '[share data]'))
      .toBe(first.html.replace(block(first.html, 'script', 'foil-share-data'), '[share data]'));
    expect(second.html).not.toContain('chrome-extension:');
    if (!hasTime(mode)) expect(reader.network.requests).toEqual([]);
    await reader.close();

    const reopened = await recipient({ drand: hasTime(mode) });
    await reopened.page.clock.setFixedTime(UNLOCK_MS);
    await reopened.page.goto(pathToFileURL(second.path).href);
    if (hasPassword(mode)) {
      await passwordGate(reopened.page, PASSWORD);
      await expect(reopened.page.getByText('Incorrect password or damaged share link')).toBeVisible();
      await passwordGate(reopened.page, PASSWORD + ' second');
    }
    if (hasTime(mode)) await reopened.page.getByRole('button', { name: 'Decrypt', exact: true }).click();
    await expectDocument(reopened.page);
    if (!hasTime(mode)) expect(reopened.network.requests).toEqual([]);

    const website = await recipient({ publicWebsite: true });
    await website.page.goto(continuedLink);
    await expectDocument(website.page, DOC, true);
    await expect(website.page).toHaveURL(shareBase);
  });
}
