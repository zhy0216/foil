import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, type AppProps } from './index';
import { decodeUrl, encodeUrl } from './share';
import { decodeHtmlPayload } from './lib/url-codec';
import { loadStandaloneRuntime } from './lib/standalone-runtime-loader';
import { readEmbeddedShareData } from './standalone/resources';
import type { DocState } from './types';

vi.mock('./lib/standalone-runtime-loader', () => ({ loadStandaloneRuntime: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const doc: DocState = { title: 'Host boundary', md: '# Shared host\n\nText 中文', comments: [] };
let root: Root;
let container: HTMLDivElement;
let downloads: Blob[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  downloads = [];
  vi.stubGlobal('URL', Object.assign(class extends URL {}, {
    createObjectURL: (blob: Blob) => { downloads.push(blob); return 'blob:foil'; },
    revokeObjectURL: vi.fn(),
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.mocked(loadStandaloneRuntime).mockReset().mockResolvedValue({ script: '/* reader fixture */', styles: 'body{color:blue}' });
  localStorage.clear();
  sessionStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function button(label: string) {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find(element => element.textContent?.trim() === label);
  if (!found) throw new Error('Missing button: ' + label);
  return found;
}

async function settle(assertion: () => void) {
  // waitFor advances fake timers outside act. Keep timers and real codec I/O
  // within act here, then inspect the committed DOM after each flush.
  let failure: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    try { assertion(); return; }
    catch (error) { failure = error; }
  }
  throw failure;
}

describe.each(['editing', 'read-only'] as const)('%s host boundary', mode => {
  it.each([
    { path: '/foil/', shareBaseUrl: undefined, expected: '/foil/' },
    { path: '/', shareBaseUrl: undefined, expected: '/' },
    { path: '/packaged/index.html', shareBaseUrl: 'https://public.test/foil/?private=query#fragment', expected: 'https://public.test/foil/' },
    { path: '/packaged/index.html', shareBaseUrl: 'http://public.test/?private=query#fragment', expected: 'http://public.test/' },
  ])('uses $expected for links and HTML, with working header actions', async ({ path, shareBaseUrl, expected }) => {
    const payload = await encodeUrl(doc);
    history.replaceState(null, '', path + '?ignored=query' + (mode === 'read-only' ? payload : ''));
    if (mode === 'editing') {
      localStorage.setItem('foil_doc_host', JSON.stringify({ ...doc, id: 'host', createdAt: 1, updatedAt: 1 }));
      sessionStorage.setItem('foil_current_id', 'host');
    }
    const hostAction = vi.fn();
    const props: AppProps = {
      shareBaseUrl,
      headerActions: <button onClick={hostAction}>Host action</button>,
    };
    await act(async () => root.render(<StrictMode><App {...props} /></StrictMode>));
    await settle(() => expect(container.querySelector('.topbar-actions')).not.toBeNull());
    const action = button('Host action');
    expect(action.closest('.topbar-actions')).not.toBeNull();
    await act(async () => action.click());
    expect(hostAction).toHaveBeenCalledOnce();
    if (mode === 'read-only') {
      expect(container.querySelector('.preview')).not.toBeNull();
      expect(Object.keys(localStorage).filter(key => key.startsWith('foil_doc_'))).toEqual([]);
      expect(window.location.hash).toBe('');
    }
    await act(async () => button('Share').click());
    await settle(() => expect(container.querySelector<HTMLInputElement>('#share-url')?.value).toContain('#d='));
    const url = container.querySelector<HTMLInputElement>('#share-url')!.value;
    const base = expected.startsWith('/') ? window.location.origin + expected : expected;
    expect(url.split('#')[0]).toBe(base);
    expect(await decodeUrl(new URL(url).hash)).toEqual({ state: doc });
    expect(loadStandaloneRuntime).not.toHaveBeenCalled();

    await act(async () => button('Export HTML').click());
    await settle(() => expect(downloads).toHaveLength(1));
    expect(loadStandaloneRuntime).toHaveBeenCalledOnce();
    const html = new DOMParser().parseFromString(await downloads[0].text(), 'text/html');
    const data = readEmbeddedShareData(html);
    expect(data.shareBaseUrl).toBe(base);
    expect(await decodeHtmlPayload(data.payload)).toEqual({ state: doc });

    if (mode === 'read-only') {
      await act(async () => button('Done').click());
      await act(async () => button('Edit anyway').click());
      expect(container.querySelector('.editor[contenteditable="true"]')).not.toBeNull();
      expect(button('Host action').closest('.topbar-actions')).not.toBeNull();
    }
  });
});
