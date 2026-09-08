import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const addListener = vi.fn<(listener: (tab: unknown) => Promise<void>) => void>();
const create = vi.fn().mockResolvedValue({ id: 1 });
const getURL = vi.fn((file: string) => `chrome-extension://installed-foil/${file}`);
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  create.mockResolvedValue({ id: 1 });
  getURL.mockImplementation(file => `chrome-extension://installed-foil/${file}`);
  vi.stubGlobal('chrome', { action: { onClicked: { addListener } }, tabs: { create }, runtime: { getURL } });
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('registers on module load, then opens one fixed packaged tab per click without reading the clicked tab', async () => {
  await import('./background');
  expect(addListener).toHaveBeenCalledTimes(1);
  expect(create).not.toHaveBeenCalled();
  expect(getURL).not.toHaveBeenCalled();
  const click = addListener.mock.calls[0][0];
  const clickedTab = new Proxy({}, { get: () => { throw new Error('Must not inspect the active tab'); } });
  await click(clickedTab);
  await click(clickedTab);
  expect(getURL.mock.calls).toEqual([['index.html'], ['index.html']]);
  expect(create.mock.calls).toEqual([
    [{ url: 'chrome-extension://installed-foil/index.html' }],
    [{ url: 'chrome-extension://installed-foil/index.html' }],
  ]);
  expect(error).not.toHaveBeenCalled();
});

it.each(['rejection', 'create throw', 'URL throw'])('handles API %s without an unhandled rejection or private diagnostics', async failure => {
  await import('./background');
  const privateError = new Error('PRIVATE_ACTIVE_TAB_URL');
  if (failure === 'rejection') create.mockRejectedValue(privateError);
  if (failure === 'create throw') create.mockImplementation(() => { throw privateError; });
  if (failure === 'URL throw') getURL.mockImplementation(() => { throw privateError; });
  await expect(addListener.mock.calls[0][0]({})).resolves.toBeUndefined();
  expect(error).toHaveBeenCalledExactlyOnceWith('Foil could not open an editor tab. Try the toolbar button again.');
});
