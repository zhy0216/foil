import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { decodeUrl, encodeUrl, openTimeCapsule } from './lib/url-codec';
import { getMarkdown, getSelectionOffsets, setSelectionOffsets } from './lib/editor-dom';
import { renderDecorated } from './lib/markdown';
import type { DocState } from './types';

vi.mock('./lib/url-codec', async (load) => ({
  ...(await load<typeof import('./lib/url-codec')>()),
  decodeUrl: vi.fn(),
  encodeUrl: vi.fn(),
  openTimeCapsule: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const localDoc = {
  id: 'local1',
  title: 'Local 中文 doc',
  md: '# Local 中文 doc\n\n## One\n\nbody text\n\n## Two\n\nmore\n\n## Three\n\nend',
  comments: [{
    id: 'c1', quote: 'body text', before: '', after: '', replies: [
      { id: 'r1', author: 'Author', ts: 1, body: 'Local comment 评论' },
    ],
  }],
  createdAt: 1,
  updatedAt: 1,
};
const shared: DocState = { title: 'Shared title', md: '# Shared\n\nText', comments: [] };

let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(decodeUrl).mockReset();
  vi.mocked(encodeUrl).mockReset();
  vi.mocked(openTimeCapsule).mockReset();
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

async function seedLocal() {
  localStorage.setItem('foil_doc_local1', JSON.stringify(localDoc));
  sessionStorage.setItem('foil_current_id', localDoc.id);
  await mount(true);
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

function edit(markdown: string, selection: { anchor: number; focus: number } | null = null) {
  const editor = container.querySelector<HTMLDivElement>('.editor');
  if (!editor) throw new Error('editor did not mount');
  editor.innerHTML = renderDecorated(markdown);
  if (selection) setSelectionOffsets(editor, selection);
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
}

const editor = () => container.querySelector<HTMLDivElement>('.editor')!;

describe('local Read/Write switching', () => {
  it('keeps content, comments and the saved state across repeated switches without saving', async () => {
    await seedLocal();
    expect(editor().getAttribute('contenteditable')).toBe('true');
    expect(container.querySelector('.readonly-document')).toBeNull();
    const rawBefore = localStorage.getItem('foil_doc_local1');

    for (let round = 0; round < 3; round++) {
      await act(async () => button('Read').click());
      const reading = container.querySelector('.readonly-document')!;
      expect(reading.querySelector('.reading-preview')!.textContent).toContain('body text');
      expect(reading.querySelectorAll('.comment-thread')).toHaveLength(1);
      expect(reading.textContent).toContain('Local comment 评论');
      // Title equals the first heading: deduplicated; TOC still lists all four.
      expect(reading.querySelector('.reading-doc-title')).toBeNull();
      expect(reading.querySelectorAll('.reading-toc nav a')).toHaveLength(4);
      // The editing tree stays mounted (hidden), never unmounted.
      expect(container.querySelector<HTMLElement>('.app:not(.readonly-document)')!.style.display).toBe('none');
      expect(container.querySelector('.editor')).not.toBeNull();
      await act(async () => button('Back to editing').click());
      expect(container.querySelector('.readonly-document')).toBeNull();
      expect(editor().getAttribute('contenteditable')).toBe('true');
      expect(getMarkdown(editor())).toBe(localDoc.md);
    }
    // Switching alone never writes, never dirties, never re-saves.
    expect(localStorage.getItem('foil_doc_local1')).toBe(rawBefore);
    expect(container.querySelector('.save-state')?.textContent).toContain('saved');
    expect(container.querySelector('.save-state')?.textContent).not.toContain('not saved');
  });

  it('ends an active IME composition on switch without duplicated characters', async () => {
    await seedLocal();
    const el = editor();
    await act(async () => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      el.innerHTML = renderDecorated(localDoc.md + '汉字');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true }));
    });
    await act(async () => button('Read').click());
    // The composition is over: the editor repaints the last committed markdown
    // and the reading view shows the same snapshot — no doubled characters.
    expect(getMarkdown(el)).toBe(localDoc.md);
    expect(container.querySelector('.reading-preview')!.textContent).not.toContain('汉字');
    await act(async () => button('Back to editing').click());
    expect(getMarkdown(editor())).toBe(localDoc.md);
    await act(async () => { edit(localDoc.md + ' 继续'); });
    expect(getMarkdown(editor())).toBe(localDoc.md + ' 继续');
  });

  it('restores the caret and editing focus when returning to Write', async () => {
    await seedLocal();
    await act(async () => { edit(localDoc.md, { anchor: 5, focus: 5 }); });
    expect(getMarkdown(editor())).toBe(localDoc.md);
    await act(async () => button('Read').click());
    await act(async () => button('Back to editing').click());
    expect(getSelectionOffsets(editor())).toEqual({ anchor: 5, focus: 5 });
    expect(document.activeElement).toBe(editor());
    // Typing continues from the restored context.
    await act(async () => { edit('typed again', { anchor: 11, focus: 11 }); });
    expect(getMarkdown(editor())).toBe('typed again');
  });

  it('preserves dirty and save-error state across a switch', async () => {
    await seedLocal();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError', code: 22 });
    });
    await act(async () => { edit('draft survives'); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(container.querySelector('.save-state')?.textContent).toContain('not saved');
    await act(async () => button('Read').click());
    expect(container.querySelector('.readonly-document .save-state')?.textContent).toContain('not saved');
    await act(async () => button('Back to editing').click());
    expect(getMarkdown(editor())).toBe('draft survives');
    expect(container.querySelector('.save-state')?.textContent).toContain('not saved');
    // The dirty flag survived the round trip: pagehide still flushes the draft.
    vi.restoreAllMocks();
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(JSON.parse(localStorage.getItem('foil_doc_local1')!).md).toBe('draft survives');
  });

  it('persists the reader view locally and falls back to Reading on invalid values', async () => {
    await seedLocal();
    await act(async () => button('Read').click());
    expect(container.querySelector('.reading-preview')).not.toBeNull();
    await act(async () => button('Source').click());
    expect(container.querySelector('.preview')).not.toBeNull();
    expect(localStorage.getItem('foil_reader_view')).toBe('source');
    // The preference is recipient-local: a fresh boot restores it.
    await act(async () => root?.unmount());
    await mount(true);
    await act(async () => button('Read').click());
    expect(container.querySelector('.preview')).not.toBeNull();

    localStorage.setItem('foil_reader_view', 'garbage');
    await act(async () => root?.unmount());
    await mount(true);
    await act(async () => button('Read').click());
    expect(container.querySelector('.reading-preview')).not.toBeNull();
    expect(container.querySelector('.preview')).toBeNull();
  });
});

describe('shared reading entry points', () => {
  it('offers no Write entry on a read-only share and still forks via Edit anyway', async () => {
    window.history.replaceState(null, '', '/#d=shared');
    vi.mocked(decodeUrl).mockResolvedValue({ state: shared });
    await mount(true);
    expect(container.querySelector('.readonly-document')).not.toBeNull();
    expect(container.textContent).toContain('Viewing shared link');
    expect(allButtons('Back to editing')).toHaveLength(0);
    expect(allButtons('Read')).toHaveLength(0);
    expect(container.querySelector('.editor')).toBeNull();
    await act(async () => button('Edit anyway').click());
    expect(editor().getAttribute('contenteditable')).toBe('true');
    // The forked local document gains the Read switch.
    expect(allButtons('Read')).toHaveLength(1);
  });
});
