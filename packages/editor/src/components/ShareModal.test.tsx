import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareModal } from './ShareModal';
import { Blob as NodeBlob } from 'node:buffer';
import { htmlFileName, type HtmlExport } from '../lib/html-export';
import { encodeUrl } from '../lib/url-codec';
import type { ComponentProps } from 'react';
import type { DocState } from '../types';

vi.mock('../lib/url-codec', async (load) => ({
  ...(await load<typeof import('../lib/url-codec')>()),
  encodeUrl: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state: DocState = { md: '# hello', comments: [], title: 'Test' };
let root: Root;
let host: HTMLDivElement;
let close: ReturnType<typeof vi.fn<() => void>>;
let toast: ReturnType<typeof vi.fn<(msg: string) => void>>;
let clipboardWrite: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
let exportHtml: ReturnType<typeof vi.fn<ComponentProps<typeof ShareModal>['exportHtml']>>;
let createUrl: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
let revokeUrl: ReturnType<typeof vi.fn>;
let downloads: string[];

function render(getState = () => state, props: Partial<ComponentProps<typeof ShareModal>> = {}) {
  act(() => {
    root.render(
      <ShareModal
        open
        onClose={close}
        getState={getState}
        onToast={toast}
        onLearnMore={vi.fn()}
        shareBaseUrl="https://example.test/foil/?private#fragment"
        exportHtml={exportHtml}
        {...props}
      />
    );
  });
}

async function settleGeneration() {
  await act(async () => {
    vi.advanceTimersByTime(250);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(encodeUrl).mockReset().mockResolvedValue('#d=plain');
  vi.stubGlobal('Blob', NodeBlob);
  createUrl = vi.fn(() => 'blob:foil');
  revokeUrl = vi.fn();
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }));
  downloads = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  exportHtml = vi.fn(async (doc, options) => ({ html: '<!doctype html><p>snapshot</p>',
    filename: htmlFileName(doc.title, options.password || options.unlockMs ? '#e=protected' : '#d=plain') }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  close = vi.fn<() => void>();
  toast = vi.fn<(msg: string) => void>();
  clipboardWrite = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function button(label = 'Export HTML') {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find(el => el.textContent?.trim() === label);
  if (!found) throw new Error('Missing button: ' + label);
  return found;
}
function toggle(index: number) {
  act(() => host.querySelectorAll<HTMLElement>('[role="switch"]')[index].click());
}
function inputValue(selector: string, value: string) {
  act(() => {
    const input = host.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function exportClick() { await act(async () => button().click()); }
const file: HtmlExport = { html: '<p>prepared</p>', filename: 'prepared.html' };

describe('ShareModal HTML downloads', () => {
  it.each(['d', 'e', 'td', 'te'])('captures the entire current document and #%s protection only on click', async scheme => {
    const doc: DocState = { title: 'Current 文档', md: 'Current body', comments: [{
      id: 'c1', quote: 'body', before: 'Current ', after: '', replies: [
        { id: 'r1', author: 'Reader', ts: 1, body: 'Current comment' },
      ],
    }] };
    render(() => doc);
    if (scheme === 'e' || scheme === 'te') { toggle(0); inputValue('input[type="password"]', 'secret'); }
    if (scheme === 'td' || scheme === 'te') toggle(1);
    await settleGeneration();
    const urlCalls = vi.mocked(encodeUrl).mock.calls.length;
    expect(exportHtml).not.toHaveBeenCalled();
    await exportClick();
    expect(exportHtml).toHaveBeenCalledExactlyOnceWith(doc, {
      ...(scheme === 'e' || scheme === 'te' ? { password: 'secret' } : {}),
      ...(scheme === 'td' || scheme === 'te' ? { unlockMs: expect.any(Number) } : {}),
    }, 'https://example.test/foil/');
    const captured = exportHtml.mock.calls[0][0];
    expect(captured).not.toBe(doc);
    expect(captured.comments[0].replies).not.toBe(doc.comments[0].replies);
    expect(exportHtml.mock.calls[0][1]).toEqual(vi.mocked(encodeUrl).mock.calls.at(-1)![1]);
    expect(downloads).toEqual([scheme === 'd' ? 'Current 文档.html' : 'foil-shared-document.html']);
    expect(host.textContent).toContain('HTML download started.');
    expect(button().disabled).toBe(true);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(createUrl.mock.calls[0][0].type).toBe('text/html;charset=utf-8');
    expect(revokeUrl).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:foil');
    expect(encodeUrl).toHaveBeenCalledTimes(urlCalls);
  });

  it('gates duplicate clicks synchronously and keeps link generation independent', async () => {
    const pending = deferred<HtmlExport>(); exportHtml.mockReturnValue(pending.promise);
    render(); await settleGeneration();
    const exportButton = button();
    act(() => { exportButton.click(); exportButton.click(); });
    expect(exportHtml).toHaveBeenCalledOnce();
    expect(button('Exporting HTML…').disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('.url-row button')!.disabled).toBe(false);
    await act(async () => pending.resolve(file));
    expect(downloads).toEqual(['prepared.html']);
  });

  it.each(['title', 'md', 'comments', 'password', 'password switch', 'time switch', 'preset', 'date', 'source'])
  ('discards an assembled result after %s changes', async change => {
    const pending = deferred<HtmlExport>(); exportHtml.mockReturnValue(pending.promise);
    let doc = { ...state };
    const getState = () => doc;
    render(getState);
    if (change === 'password' || change === 'password switch') { toggle(0); inputValue('input[type="password"]', 'secret'); }
    if (change === 'preset' || change === 'date') toggle(1);
    if (change === 'date') act(() => button('Custom').click());
    await exportClick();
    if (change === 'title' || change === 'md') { doc = { ...doc, [change]: 'changed' }; render(getState); }
    else if (change === 'comments') {
      doc = { ...doc, comments: [{ id: 'c', quote: 'hello', before: '', after: '', replies: [] }] }; render(getState);
    } else if (change === 'password') inputValue('input[type="password"]', 'new secret');
    else if (change === 'password switch') toggle(0);
    else if (change === 'time switch') toggle(1);
    else if (change === 'preset') act(() => button('+1 year').click());
    else if (change === 'date') inputValue('input[type="datetime-local"]', '2099-01-01T00:00');
    else render(getState, { shareBaseUrl: 'https://other.test/' });
    await act(async () => pending.resolve(file));
    expect(createUrl).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
    expect(host.textContent).not.toContain('HTML download started.');
  });

  it.each(['close', 'reopen', 'unmount'])('invalidates pending exports on %s', async action => {
    const first = deferred<HtmlExport>(); exportHtml.mockReturnValueOnce(first.promise);
    render(); await exportClick();
    if (action === 'unmount') act(() => root.render(null));
    else {
      act(() => button('Done').click());
      render(undefined, { open: false });
      if (action === 'reopen') { render(); await exportClick(); }
    }
    await act(async () => first.resolve(file));
    expect(downloads).toEqual(action === 'reopen' ? ['Test.html'] : []);
    expect(downloads).not.toContain('prepared.html');
  });

  it.each(['resolve', 'reject'])('ignores a late %s after a newer export succeeds', async completion => {
    const first = deferred<HtmlExport>(); exportHtml.mockReturnValueOnce(first.promise);
    render(); await exportClick();
    toggle(0); inputValue('input[type="password"]', 'secret');
    await exportClick();
    await act(async () => completion === 'resolve' ? first.resolve(file) : first.reject(new Error('stale error')));
    expect(downloads).toEqual(['foil-shared-document.html']);
    expect(host.textContent).toContain('HTML download started.');
    expect(host.textContent).not.toContain('stale error');
  });

  it('discards an already assembled file when a switch toggles off and back before the download continuation', async () => {
    const pending = deferred<HtmlExport>(); exportHtml.mockReturnValue(pending.promise);
    render(); await exportClick();
    await act(async () => {
      pending.resolve(file);
      const switchButton = host.querySelector<HTMLElement>('[role="switch"]')!;
      switchButton.click(); switchButton.click();
    });
    expect(host.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
    expect(createUrl).not.toHaveBeenCalled(); expect(downloads).toEqual([]);
    expect(button().disabled).toBe(false);
  });

  it.each([false, true])('rechecks expiry at completion, with clock tick = %s', async tick => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const pending = deferred<HtmlExport>(); exportHtml.mockReturnValue(pending.promise);
    render(); toggle(1); await exportClick();
    vi.setSystemTime(new Date('2026-01-01T23:59:30Z'));
    if (tick) await act(async () => vi.advanceTimersByTime(1000));
    await act(async () => pending.resolve(file));
    expect(createUrl).not.toHaveBeenCalled(); expect(downloads).toEqual([]);
    expect(button().disabled).toBe(true);
  });

  it('rechecks the live document even without a parent render', async () => {
    let doc = state;
    const pending = deferred<HtmlExport>(); exportHtml.mockReturnValue(pending.promise);
    render(() => doc); await exportClick();
    doc = { ...state, title: 'Updated outside React' };
    await act(async () => pending.resolve(file));
    expect(createUrl).not.toHaveBeenCalled(); expect(downloads).toEqual([]);
    expect(button().disabled).toBe(false);
    await exportClick();
    expect(exportHtml.mock.calls.at(-1)![0]).toEqual(doc);
    expect(downloads).toEqual(['prepared.html']);
  });

  it.each(['document', 'switch', 'expiry'])('checks %s again after Blob preparation and disposes stale resources', async change => {
    let doc = state;
    render(() => doc);
    if (change === 'expiry') toggle(1);
    createUrl.mockImplementation(() => {
      if (change === 'document') doc = { ...state, md: 'new body' };
      else if (change === 'switch') host.querySelector<HTMLElement>('[role="switch"]')!.click();
      else vi.setSystemTime(Date.now() + 86_400_000);
      return 'blob:foil';
    });
    await exportClick();
    expect(createUrl).toHaveBeenCalledOnce(); expect(downloads).toEqual([]);
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:foil');
  });

  it('rejects invalid protection options for both outputs without running encryption', async () => {
    render(); toggle(0);
    expect(button().disabled).toBe(true);
    await exportClick(); await settleGeneration();
    expect(exportHtml).not.toHaveBeenCalled(); expect(encodeUrl).not.toHaveBeenCalled();
    toggle(0); toggle(1); act(() => button('Custom').click());
    inputValue('input[type="datetime-local"]', '');
    await exportClick(); await settleGeneration();
    expect(button().disabled).toBe(true);
    expect(exportHtml).not.toHaveBeenCalled(); expect(encodeUrl).not.toHaveBeenCalled();
  });

  it.each(['The HTML reading program could not be loaded. Please retry.', 'Encryption failed.'])
  ('reports %s without downloading a previous plain file and permits retry', async message => {
    render(); await exportClick();
    expect(downloads).toEqual(['Test.html']);
    toggle(0); inputValue('input[type="password"]', 'secret');
    exportHtml.mockRejectedValueOnce(new Error(message));
    await exportClick();
    expect(host.textContent).toContain("Couldn't export HTML: " + message);
    expect(downloads).toEqual(['Test.html']);
    expect(button().disabled).toBe(false);
    await exportClick();
    expect(downloads).toEqual(['Test.html', 'foil-shared-document.html']);
    expect(exportHtml.mock.calls.slice(1).every(([, options]) => options.password === 'secret')).toBe(true);
  });

  it.each(['blob', 'click'])('reports a %s failure and releases any created URL', async failure => {
    render();
    if (failure === 'blob') createUrl.mockImplementation(() => { throw new Error('Download unavailable.'); });
    else vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => { throw new Error('denied'); });
    await exportClick();
    expect(host.textContent).toContain("Couldn't export HTML:");
    expect(host.textContent).not.toContain('HTML download started.');
    expect(downloads).toEqual([]); expect(button().disabled).toBe(false);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeUrl).toHaveBeenCalledTimes(failure === 'click' ? 1 : 0);
  });

  it('allows HTML when the URL length limit fails', async () => {
    vi.mocked(encodeUrl).mockRejectedValue(new Error('Share link exceeds the 256 KiB limit'));
    const longDoc = { ...state, md: 'long document '.repeat(30_000) };
    render(() => longDoc); await settleGeneration();
    expect(host.querySelector<HTMLButtonElement>('.url-row button')!.disabled).toBe(true);
    expect(host.textContent).toContain('256 KiB'); expect(button().disabled).toBe(false);
    await exportClick();
    expect(exportHtml.mock.calls[0][0]).toEqual(longDoc); expect(downloads).toEqual(['Test.html']);
  });

  it.each([undefined, 'file:///private.html', 'null/private.html', 'https://user:pass@example.test/'])
  ('exports without generating an invalid website link for base %s', async shareBaseUrl => {
    render(undefined, { shareBaseUrl }); await settleGeneration();
    expect(encodeUrl).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLButtonElement>('.url-row button')!.disabled).toBe(true);
    expect(host.textContent).toContain('no valid source website');
    await exportClick();
    expect(exportHtml).toHaveBeenCalledWith(state, {}, undefined);
    expect(downloads).toEqual(['Test.html']);
  });

  it('keeps a valid website link selected for manual copying when clipboard access fails', async () => {
    clipboardWrite.mockRejectedValue(new Error('denied'));
    render(); await settleGeneration();
    await act(async () => button('Copy').click());
    expect(close).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Couldn't copy — select the box and copy manually");
    const input = host.querySelector<HTMLInputElement>('.url-row input')!;
    expect(input.value).toBe('https://example.test/foil/#d=plain');
    act(() => input.focus());
    expect(input.selectionEnd).toBe(input.value.length);
    expect(button().disabled).toBe(false);
  });
});

describe('ShareModal generation boundaries', () => {
  it('discards a prior plain URL immediately when a protected generation fails', async () => {
    render();
    await settleGeneration();
    expect(host.querySelector<HTMLInputElement>('.url-row input')?.value).toContain('#d=plain');

    vi.mocked(encodeUrl).mockRejectedValueOnce(new Error('Share data exceeds the 4 MiB limit'));
    const toggles = host.querySelectorAll<HTMLElement>('[role="switch"]');
    act(() => toggles[0].click());
    expect(host.querySelector<HTMLInputElement>('.url-row input')?.value).toBe('Enter a password…');
    const password = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, 'secret');
      password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settleGeneration();

    expect(host.querySelector<HTMLInputElement>('.url-row input')?.value).toBe('');
    expect(host.querySelector<HTMLButtonElement>('.btn-primary')?.disabled).toBe(true);
    expect(toast).toHaveBeenCalledWith("Couldn't build link: Share data exceeds the 4 MiB limit");
  });

  it('ignores a late result from an older request', async () => {
    let resolveFirst!: (value: string) => void;
    vi.mocked(encodeUrl).mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    render();
    await act(async () => vi.advanceTimersByTime(250));
    expect(vi.mocked(encodeUrl)).toHaveBeenCalledTimes(1);

    const toggles = host.querySelectorAll<HTMLElement>('[role="switch"]');
    act(() => toggles[0].click());
    const password = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, 'new secret');
      password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settleGeneration();
    resolveFirst('#d=stale');
    await act(async () => Promise.resolve());
    expect(host.querySelector<HTMLInputElement>('.url-row input')?.value).not.toContain('stale');
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it('debounces password typing to one final generation', async () => {
    render();
    await settleGeneration();
    const initialCalls = vi.mocked(encodeUrl).mock.calls.length;
    const toggle = host.querySelector<HTMLElement>('[role="switch"]')!;
    act(() => toggle.click());
    const password = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    for (const value of ['s', 'se', 'sec', 'secret']) {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, value);
        password.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(100);
      });
    }
    expect(vi.mocked(encodeUrl).mock.calls.length).toBe(initialCalls);
    await settleGeneration();
    expect(vi.mocked(encodeUrl).mock.calls.length).toBe(initialCalls + 1);
    expect(vi.mocked(encodeUrl).mock.calls.at(-1)?.[1]).toEqual({ password: 'secret' });
  });

  it('hides and disables a capsule link after its safety window expires', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.mocked(encodeUrl).mockResolvedValue('#td=capsule');
    render();
    const switches = host.querySelectorAll<HTMLElement>('[role="switch"]');
    act(() => switches[1].click());
    await settleGeneration();
    expect(host.querySelector<HTMLInputElement>('.url-row input')?.value).toContain('#td=capsule');

    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(host.querySelector<HTMLInputElement>('.url-row input')?.value).toBe('Pick an unlock time…');
    expect(host.querySelector<HTMLButtonElement>('.url-row button')?.disabled).toBe(true);
    expect(host.querySelector('.tc-readout')).toBeNull();
  });

  it('copies the successful scheme and toast from the captured result', async () => {
    vi.mocked(encodeUrl).mockResolvedValue('#te=sealed');
    render();
    const switches = host.querySelectorAll<HTMLElement>('[role="switch"]');
    act(() => switches[0].click());
    const password = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, 'secret');
      password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => switches[1].click());
    await settleGeneration();
    const copy = host.querySelector<HTMLButtonElement>('.url-row button')!;
    expect(copy.disabled).toBe(false);
    act(() => copy.click());
    await act(async () => Promise.resolve());
    expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining('#te=sealed'));
    expect(toast).toHaveBeenCalledWith('Encrypted time capsule copied');
    expect(close).toHaveBeenCalled();
  });
});
