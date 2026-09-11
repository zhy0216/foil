import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { decodeUrl } from './lib/url-codec';
import type { DocState } from './types';

vi.mock('./lib/url-codec', async (load) => ({
  ...(await load<typeof import('./lib/url-codec')>()),
  decodeUrl: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shared: DocState = { title: 'Shared title', md: '# Shared\n\nText', comments: [] };

let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.mocked(decodeUrl).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
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
  localStorage.clear();
  sessionStorage.clear();
});

async function mount() {
  root = createRoot(container);
  await act(async () => {
    root?.render(<StrictMode><App /></StrictMode>);
    await Promise.resolve();
  });
}

function button(text: string, within: ParentNode = container) {
  const found = Array.from(within.querySelectorAll<HTMLButtonElement>('button')).find((el) =>
    el.textContent?.trim() === text || el.getAttribute('aria-label') === text);
  if (!found) throw new Error('Button not found: ' + text);
  return found;
}

function allButtons(text: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter((el) =>
    el.textContent?.trim() === text || el.getAttribute('aria-label') === text);
}

const editor = () => container.querySelector<HTMLDivElement>('.editor')!;

describe('shared reading entry points', () => {
  it('opens read-only with no local reading entry and forks via Edit anyway', async () => {
    window.history.replaceState(null, '', '/#d=shared');
    vi.mocked(decodeUrl).mockResolvedValue({ state: shared });
    await mount();
    expect(container.querySelector('.readonly-document')).not.toBeNull();
    expect(container.textContent).toContain('Viewing shared link');
    expect(allButtons('Read')).toHaveLength(0);
    expect(container.querySelector('.editor')).toBeNull();
    await act(async () => button('Edit anyway').click());
    expect(editor().getAttribute('contenteditable')).toBe('true');
    expect(allButtons('Read')).toHaveLength(0);
  });
});
