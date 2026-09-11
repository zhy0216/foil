import { gzipSync } from 'node:zlib';
import { test, expect } from './fixtures';
import { DOC, binding, closeShare, current, documents, expectDocument, expectHidden, fork, hasPassword, hasTime,
  importDialog, importField, importLink, modes, newDocument, openImport, passwordGate, seedDocument, share, snapshot, unlock, UNLOCK_MS } from './helpers';
import { fulfillDrand } from '../../../web/tests/e2e/helpers/html-export';
import { DRAND_INFO, DRAND_ORIGINS } from '../../../web/tests/e2e/helpers/drand';

for (const mode of modes) {
  test(`${mode}: website link imports through real tabs.create, gates, strips its fragment and forks only explicitly`, async ({ extension, recipient, baseURL }) => {
    const website = await recipient({ drand: hasTime(mode) });
    await website.page.clock.setFixedTime(UNLOCK_MS - 3_600_000);
    await website.page.goto(baseURL!);
    await seedDocument(website.page);
    const link = await share(website.page, mode);
    const websiteDocs = await documents(website.page);

    const source = await extension.page();
    await source.clock.setFixedTime(UNLOCK_MS - 60_000); // Context clock also applies to Chrome-created tabs.
    await newDocument(source, 'Source stays intact', 'Original extension draft');
    const sourceDoc = await current(source);
    const before = await documents(source);
    extension.network.allowDrand = hasTime(mode);
    if (hasTime(mode)) await extension.context.setOffline(false);
    const fragment = new URL(link).hash;
    const imported = await importLink(source, mode === 'e' ? fragment : 'https://never-contact-import.test/custom/?ignored=yes' + fragment);
    expect(await binding(imported)).toBeNull();
    expect(await documents(source)).toEqual(before);
    await unlock(imported, mode, () => expect(extension.network.drand).toEqual([]));
    await expectDocument(imported, DOC, true, false);
    await expect(imported).toHaveURL(extension.entry);
    expect(await documents(imported)).toEqual(before);
    expect(await binding(imported)).toBeNull();
    const id = await fork(imported);
    expect(id).not.toBe(sourceDoc.id);
    expect(Object.keys(await documents(source))).toHaveLength(Object.keys(before).length + 1);
    expect(await current(source)).toEqual(sourceDoc);
    expect(await snapshot(source)).toBe(sourceDoc.md);
    expect(await documents(website.page)).toEqual(websiteDocs);

    if (hasPassword(mode) || hasTime(mode)) {
      const cancelled = await importLink(source, link);
      if (mode === 'te') await passwordGate(cancelled);
      await expect(cancelled.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
      await cancelled.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(cancelled.locator('[contenteditable="true"]')).toBeVisible();
      expect((await current(cancelled)).md).not.toContain('FILE_BODY_SENTINEL');
      expect(await current(source)).toEqual(sourceDoc);
    }
  });
}

test('native import modal rejects unsafe, oversized and malformed input; tab API errors preserve the source and permit real retry', async ({ extension }) => {
  const source = await extension.page();
  await newDocument(source, 'Retained source', 'Never replace this draft');
  const link = await share(source, 'd');
  await closeShare(source);
  const before = await documents(source);
  const pages = extension.context.pages().length;
  for (const input of ['javascript:PRIVATE_PASSWORD#d=AAAA', 'file:///tmp/shared.html#d=AAAA',
    'https://name:PRIVATE_PASSWORD@never-contact-import.test/#d=AAAA', '#unknown=AAAA',
    'https://never-contact-import.test/#d=PRIVATE_DOCUMENT%', '#d=' + 'A'.repeat(256 * 1024)]) {
    await openImport(source);
    await importField(source).fill(input);
    await importDialog(source).getByRole('button', { name: 'Open in new tab', exact: true }).click();
    await expect(importDialog(source).getByRole('alert')).toBeVisible();
    expect(await importDialog(source).getByRole('alert').innerText()).not.toMatch(/PRIVATE_PASSWORD|PRIVATE_DOCUMENT/);
    await expect(importField(source)).toHaveValue(input);
    await expect(importField(source)).toBeFocused();
    await source.keyboard.press('Escape');
    await expect(source.getByRole('button', { name: 'Open shared link', exact: true })).toBeFocused();
  }
  await openImport(source);
  await importField(source).fill(link);
  // Native modal makes the background inert, including programmatic focus.
  await source.getByRole('button', { name: 'Share', exact: true }).evaluate(el => el.focus());
  await expect(importField(source)).toBeFocused();
  await importDialog(source).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(extension.context.pages()).toHaveLength(pages);
  expect(await documents(source)).toEqual(before);

  for (const failure of ['throw', 'reject'] as const) {
    await source.evaluate(failure => {
      const create = chrome.tabs.create;
      (window as unknown as { restoreTabs: () => void }).restoreTabs = () => { chrome.tabs.create = create; };
      chrome.tabs.create = (() => {
        if (failure === 'throw') throw new Error('PRIVATE_API_DETAIL');
        return Promise.reject(new Error('PRIVATE_API_DETAIL'));
      }) as typeof chrome.tabs.create;
    }, failure);
    try {
      await openImport(source);
      await importField(source).fill(link);
      await importDialog(source).getByRole('button', { name: 'Open in new tab', exact: true }).click();
      await expect(importDialog(source).getByRole('alert')).toHaveText('Could not open a new tab. Your link is still here; try again.');
      await expect(importField(source)).toHaveValue(link);
      expect(extension.context.pages()).toHaveLength(pages);
      expect(await documents(source)).toEqual(before);
    } finally { await source.evaluate(() => (window as unknown as { restoreTabs: () => void }).restoreTabs()); }
    await source.keyboard.press('Escape');
  }
  const retried = await importLink(source, link);
  await expect(retried.locator('.reading-preview')).toBeVisible();
  await retried.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(retried.locator('.preview')).toBeVisible();
  expect(await documents(source)).toEqual(before);
  // Valid transport framing, invalid document schema: the shared decoder is
  // still authoritative and cannot overwrite or persist anything on failure.
  const invalidSchema = '#d=' + gzipSync('{}').toString('base64url');
  const invalid = await importLink(source, invalidSchema);
  await expect(invalid.locator('.toast')).toContainText('Could not load link:');
  await expect(invalid.locator('.preview, .reading-preview')).toHaveCount(0);
  expect(await binding(invalid)).toBeNull();
  expect(await documents(source)).toEqual(before);
  expect(extension.network.requests).toEqual([]);
});

test('cancelled password import discards a late real AES result', async ({ extension }) => {
  const source = await extension.page();
  await seedDocument(source);
  const link = await share(source, 'e');
  await closeShare(source);
  const before = await current(source);
  const imported = await importLink(source, link);
  // Observe only the gated extension page, whose secure WebCrypto API exists;
  // a context init script also runs in Chrome's initial opaque about:blank.
  await imported.evaluate(() => {
    const probe = { ready: false, parsed: false, release: () => {} };
    (window as unknown as { unlockProbe: typeof probe }).unlockProbe = probe;
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    crypto.subtle.decrypt = async (...args) => {
      const actual = await decrypt(...args);
      await new Promise<void>(resolve => { probe.release = resolve; probe.ready = true; });
      return actual;
    };
    const parse = JSON.parse;
    JSON.parse = (...args: Parameters<typeof JSON.parse>) => {
      const value = parse(...args);
      if (value?.md?.includes?.('FILE_BODY_SENTINEL') && !('id' in value)) probe.parsed = true;
      return value;
    };
  });
  await passwordGate(imported);
  await expect.poll(() => imported.evaluate(() => (window as unknown as { unlockProbe: { ready: boolean } }).unlockProbe.ready)).toBe(true);
  await imported.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(imported.locator('[contenteditable="true"]')).toBeVisible();
  const cancelled = await current(imported);
  await imported.evaluate(() => (window as unknown as { unlockProbe: { release: () => void } }).unlockProbe.release());
  await expect.poll(() => imported.evaluate(() => (window as unknown as { unlockProbe: { parsed: boolean } }).unlockProbe.parsed)).toBe(true);
  await imported.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await snapshot(imported)).toBe(cancelled.md);
  expect(await current(imported)).toEqual(cancelled);
  expect(await current(source)).toEqual(before);
});

test('time import verifies failover and signatures, retries offline failure and discards a cancelled late beacon', async ({ extension }) => {
  const source = await extension.page();
  await source.clock.setFixedTime(UNLOCK_MS - 3_600_000);
  await seedDocument(source);
  extension.network.allowDrand = true;
  extension.network.failover = true;
  await extension.context.setOffline(false);
  const link = await share(source, 'td');
  expect(new Set(extension.network.drand.map(url => new URL(url).origin))).toEqual(DRAND_ORIGINS);
  await closeShare(source);
  const before = await current(source);
  await source.clock.setFixedTime(UNLOCK_MS);
  await extension.context.addInitScript(() => {
    (window as unknown as { capsuleDecoded: boolean }).capsuleDecoded = false;
    const parse = JSON.parse;
    JSON.parse = (...args: Parameters<typeof JSON.parse>) => {
      const value = parse(...args);
      if (value?.md?.includes?.('FILE_BODY_SENTINEL') && !('id' in value)) (window as unknown as { capsuleDecoded: boolean }).capsuleDecoded = true;
      return value;
    };
  });
  const imported = await importLink(source, link);
  extension.network.forge = true;
  extension.expectedErrors.push('randomness did not match the signature');
  await imported.getByRole('button', { name: 'Decrypt', exact: true }).click();
  await expect(imported.getByText(/Could not open time capsule\. Please retry\./)).toBeVisible();
  await expectHidden(imported);
  extension.network.forge = false;
  extension.network.failDrand = true;
  await imported.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(imported.getByText(/Could not reach drand/)).toBeVisible();
  await expectHidden(imported);
  extension.network.failDrand = false;
  extension.network.holdBeacon = true;
  await imported.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => extension.network.held.length).toBe(1);
  await imported.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(imported.locator('[contenteditable="true"]')).toBeVisible();
  const cancelled = await current(imported);
  extension.network.holdBeacon = false;
  await fulfillDrand(extension.network.held.shift()!);
  await expect.poll(() => imported.evaluate(() => (window as unknown as { capsuleDecoded: boolean }).capsuleDecoded)).toBe(true);
  await imported.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await snapshot(imported)).toBe(cancelled.md);
  // Retrying is an explicit new import, using the real API and crypto again.
  const retried = await importLink(source, link);
  await retried.getByRole('button', { name: 'Decrypt', exact: true }).click();
  await expectDocument(retried, DOC, true, false);
  expect(await snapshot(imported)).toBe(cancelled.md);
  expect(await current(imported)).toEqual(cancelled);
  expect(await current(source)).toEqual(before);
  expect(extension.network.drand).toContain(`https://api3.drand.sh/${DRAND_INFO.hash}/public/992`);
});
