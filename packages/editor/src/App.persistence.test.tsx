import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { loadInitialSettings } from './App';
import { decodeUrl, encodeUrl, openTimeCapsule, type DecodeResult, type TimeCapsuleEnvelope } from './lib/url-codec';
import { getMarkdown } from './lib/editor-dom';
import type { DocState } from './types';

vi.mock('./lib/url-codec', async (load) => ({
  ...(await load<typeof import('./lib/url-codec')>()),
  decodeUrl: vi.fn(),
  encodeUrl: vi.fn(),
  openTimeCapsule: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(decodeUrl).mockReset();
  vi.mocked(openTimeCapsule).mockReset();
  vi.mocked(encodeUrl).mockReset().mockResolvedValue('#d=shared');
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

const shared: DocState = {
  title: 'Shared title', md: '# Shared 中文\n\nAcross\nlines', comments: [{
    id: 'shared-comment', quote: 'Across\nlines', before: '', after: '', replies: [
      { id: 'shared-reply', author: 'Author', body: 'Shared comment', ts: 1 },
    ],
  }],
};

function button(text: string) {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((el) =>
    el.textContent?.trim() === text || el.getAttribute('aria-label') === text);
  if (!found) throw new Error('Button not found: ' + text);
  return found;
}

function documentKeys() {
  return Object.keys(localStorage).filter((key) => key.startsWith('foil_doc_'));
}

describe('shared reading persistence', () => {
  it('keeps StrictMode bootstrap read-only while decoding, without creating local documents or accepting stale results', async () => {
    window.history.replaceState(null, '', '/#d=shared');
    const pending: Array<(value: DecodeResult) => void> = [];
    vi.mocked(decodeUrl).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    await mount(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Opening document…');
    expect(container.querySelector('.editor')).toBeNull();
    expect(documentKeys()).toEqual([]);
    expect(pending).toHaveLength(2);
    expect(window.location.hash).toBe('');
    await act(async () => pending[1]({ state: shared }));
    expect(container.querySelector('.preview')).not.toBeNull();
    await act(async () => pending[0]({ state: { title: 'Stale', md: 'stale', comments: [] } }));
    expect(getMarkdown(container.querySelector('.preview')!)).toBe(shared.md);
    expect(documentKeys()).toEqual([]);
    expect(sessionStorage.getItem('foil_current_id')).toBeNull();
  });

  it.each(['d', 'e', 'td', 'te'])('opens #%s read-only and writes only an explicitly forked local document', async (scheme) => {
    const author = { id: 'author', title: 'Local author document', md: 'Author original', comments: [], createdAt: 10, updatedAt: 20 };
    const authorRaw = JSON.stringify(author);
    const sharedRaw = JSON.stringify(shared);
    localStorage.setItem('foil_doc_author', authorRaw);
    sessionStorage.setItem('foil_current_id', author.id);
    window.history.replaceState(null, '', '/#' + scheme + '=shared');
    const envelope: TimeCapsuleEnvelope = { v: 1, age: 'test capsule', round: 1, unlockMs: Date.now() - 1 };
    vi.mocked(decodeUrl).mockImplementation(async (_, password) => {
      if ((scheme === 'e' || scheme === 'te') && !password) return { encrypted: 'password' };
      if (scheme === 'td' || scheme === 'te') return { timeCapsule: envelope };
      return { state: shared };
    });
    vi.mocked(openTimeCapsule).mockResolvedValue(shared);
    await mount(true);
    if (scheme === 'e' || scheme === 'te') {
      expect(container.querySelector('.editor')).toBeNull();
      const input = container.querySelector('input[type="password"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'password');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    }
    if (scheme === 'td' || scheme === 'te') {
      expect(container.querySelector('.editor')).toBeNull();
      await act(async () => button('Decrypt').click());
      expect(openTimeCapsule).toHaveBeenCalledWith(envelope);
    }
    const preview = container.querySelector<HTMLElement>('.preview')!;
    expect(preview.getAttribute('contenteditable')).toBe('false');
    expect(getMarkdown(preview)).toBe(shared.md);
    expect(container.querySelector('h1')?.textContent).toBe(shared.title);
    expect(container.textContent).toContain('Shared comment');
    expect(container.querySelector('input, textarea, .doc-switcher, .sel-toolbar, .small-actions')).toBeNull();
    await act(async () => button('Settings').click());
    await act(async () => button('Wide').click());
    await act(async () => button('Done').click());
    expect(container.querySelector<HTMLElement>('.canvas')?.style.getPropertyValue('--editor-width')).toBe('960px');
    await act(async () => button('About Foil').click());
    expect(container.querySelector('.modal h3')?.textContent).toBe('About Foil');
    await act(async () => button('Done').click());
    await act(async () => button('Share').click());
    await act(async () => vi.advanceTimersByTime(250));
    expect(encodeUrl).toHaveBeenCalledWith(shared, {});
    await act(async () => button('Done').click());
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(localStorage.getItem('foil_doc_author')).toBe(authorRaw);
    expect(documentKeys()).toEqual(['foil_doc_author']);
    expect(sessionStorage.getItem('foil_current_id')).toBe(author.id);
    expect(JSON.stringify(shared)).toBe(sharedRaw);

    await act(async () => button('Edit anyway').click());
    expect(container.querySelector('.preview')).toBeNull();
    expect(container.querySelector('.editor')?.getAttribute('contenteditable')).toBe('true');
    expect(currentRaw()).toMatchObject(shared);
    expect(currentRaw().id).not.toBe(author.id);
    expect(documentKeys()).toHaveLength(2);
    await act(async () => edit('Forked edits'));
    await act(async () => vi.advanceTimersByTime(400));
    expect(currentRaw().md).toBe('Forked edits');
    expect(localStorage.getItem('foil_doc_author')).toBe(authorRaw);
    expect(JSON.stringify(shared)).toBe(sharedRaw);
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

async function mount(strict = false) {
  root = createRoot(container);
  await act(async () => {
    root?.render(strict ? <StrictMode><App /></StrictMode> : <App />);
    await Promise.resolve();
  });
}

function edit(markdown: string) {
  const editor = container.querySelector<HTMLDivElement>('.editor');
  if (!editor) throw new Error('editor did not mount');
  editor.innerHTML = `<div class="ln" data-i="0">${markdown}</div>`;
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
}

function currentRaw(): Record<string, unknown> {
  const id = sessionStorage.getItem('foil_current_id');
  if (!id) throw new Error('current document was not bound');
  const raw = localStorage.getItem('foil_doc_' + id);
  if (!raw) throw new Error('current document was not persisted');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('local persistence lifecycle', () => {
  it('keeps legacy foil_theme compatibility when structured settings are unusable', () => {
    localStorage.setItem('foil_settings', '{broken');
    localStorage.setItem('foil_theme', 'dark');
    expect(loadInitialSettings().theme).toBe('dark');
  });

  it('does not rewrite a document merely by opening it and flushes one dirty snapshot on pagehide', async () => {
    const existing = {
      id: 'existing',
      title: 'Existing',
      md: 'original',
      comments: [],
      createdAt: 10,
      updatedAt: 20,
    };
    localStorage.setItem('foil_doc_existing', JSON.stringify(existing));
    sessionStorage.setItem('foil_current_id', existing.id);
    await mount(true);
    const before = currentRaw();
    expect(before).toEqual(existing);
    await act(async () => { edit('draft'); });
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    const after = currentRaw();
    expect(after.md).toBe('draft');
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt as number);
  });

  it('keeps the draft and status unsaved when the debounced write hits quota', async () => {
    await mount();
    const before = currentRaw();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError', code: 22 });
    });
    await act(async () => { edit('draft survives'); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(currentRaw().md).toBe(before.md);
    expect(container.querySelector('.save-state')?.textContent).toContain('not saved');
    expect(container.textContent).toContain('Browser storage is full');
  });
});
