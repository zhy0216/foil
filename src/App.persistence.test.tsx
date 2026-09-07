import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { loadInitialSettings } from './App';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
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
