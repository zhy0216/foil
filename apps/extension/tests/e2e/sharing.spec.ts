import { test, expect, shareBase } from './fixtures';
import { DOC, documents, expectDocument, expectHidden, fork, hasTime, modes, seedDocument, share, unlock, UNLOCK_MS } from './helpers';

for (const mode of modes) {
  test(`${mode}: packaged author shares title, Markdown and comments to an independent website and explicit fork`, async ({ extension, recipient }) => {
    const source = await extension.page();
    await source.clock.setFixedTime(UNLOCK_MS - 3_600_000);
    await seedDocument(source);
    if (hasTime(mode)) {
      await extension.context.setOffline(false);
      extension.network.allowDrand = true;
    }
    const before = await documents(source);
    const link = await share(source, mode);
    expect(link.split('#')[0]).toBe(shareBase);
    expect(new URL(link).protocol).toMatch(/^https?:$/);
    expect(link).not.toContain('chrome-extension:');
    if (mode !== 'd') for (const secret of [DOC.title, 'FILE_BODY_SENTINEL', 'FILE_COMMENT_SENTINEL']) expect(link).not.toContain(secret);

    const reader = await recipient({ publicWebsite: true, drand: hasTime(mode) });
    await reader.page.clock.setFixedTime(UNLOCK_MS - 60_000);
    await reader.page.goto(link);
    await expect(reader.page).toHaveURL(shareBase);
    if (mode !== 'd') await expectHidden(reader.page);
    await unlock(reader.page, mode, () => expect(reader.network.drand).toEqual([]));
    await expectDocument(reader.page, DOC, true);
    expect(await documents(reader.page)).toEqual({});
    await fork(reader.page);
    expect(Object.keys(await documents(reader.page))).toHaveLength(1);
    expect(await documents(source)).toEqual(before);
    if (hasTime(mode)) expect(reader.network.drand.some(url => url.endsWith('/public/992'))).toBe(true);
    else expect(extension.network.requests).toEqual([]);
  });
}
