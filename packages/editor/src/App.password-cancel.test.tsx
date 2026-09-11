import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { decodeUrl, type DecodeResult } from './lib/url-codec';
import { getMarkdown } from './lib/editor-dom';

vi.mock('./lib/url-codec', async load => ({
  ...await load<typeof import('./lib/url-codec')>(), decodeUrl: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const local = { id: 'local', title: 'Local draft', md: 'Keep this draft', comments: [], createdAt: 1, updatedAt: 1 };
const shared = { title: 'Unlocked snapshot', md: 'PRIVATE_SHARED_TEXT', comments: [] };
let root: Root;
let container: HTMLDivElement;
let pending: ((result: DecodeResult) => void)[];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  pending = [];
  vi.mocked(decodeUrl).mockReset().mockImplementation((_fragment, password) => password === undefined
    ? Promise.resolve({ encrypted: 'password' })
    : new Promise(resolve => pending.push(resolve)));
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('foil_doc_local', JSON.stringify(local));
  sessionStorage.setItem('foil_current_id', 'local');
  history.replaceState(null, '', '/#e=fixture');
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<StrictMode><App /></StrictMode>));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/');
  vi.unstubAllGlobals(); vi.useRealTimers();
});

async function submit() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

it.each<DecodeResult>([
  { state: shared },
  { timeCapsule: { v: 1, age: 'unit capsule', round: 992, unlockMs: Date.now() + 60_000 } },
  { error: 'Incorrect password or damaged share link' },
])('does not apply a late password result after cancellation: %j', async result => {
  await submit();
  expect(pending).toHaveLength(1);
  const cancel = [...container.querySelectorAll('button')].find(button => button.textContent === 'Cancel')!;
  await act(async () => cancel.click());
  await act(async () => { pending[0](result); await vi.advanceTimersByTimeAsync(500); });
  expect(getMarkdown(container.querySelector('.editor')!)).toBe(local.md);
  expect(container.querySelector('.editor')?.getAttribute('contenteditable')).toBe('true');
  expect(container.querySelector('.modal')).toBeNull();
  expect(container.textContent).not.toContain(shared.md);
  expect(sessionStorage.getItem('foil_current_id')).toBe(local.id);
  expect(localStorage.getItem('foil_doc_local')).toBe(JSON.stringify(local));
  expect(Object.keys(localStorage).filter(key => key.startsWith('foil_doc_'))).toEqual(['foil_doc_local']);
});

it('a newer password attempt wins over an older late result', async () => {
  await submit(); await submit();
  expect(pending).toHaveLength(2);
  await act(async () => pending[1]({ state: shared }));
  await act(async () => pending[0]({ error: 'Old failed attempt' }));
  expect(container.querySelector('.reading-preview')!.textContent).toContain(shared.md);
  const source = [...container.querySelectorAll('button')].find(button => button.textContent === 'Source')!;
  await act(async () => source.click());
  expect(getMarkdown(container.querySelector('.preview')!)).toBe(shared.md);
  expect(container.querySelector('.modal')).toBeNull();
  expect(localStorage.getItem('foil_doc_local')).toBe(JSON.stringify(local));
});
