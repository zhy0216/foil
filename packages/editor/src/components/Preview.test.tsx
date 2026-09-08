import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Preview, type PreviewProps } from './Preview';
import { getMarkdown, getSelectionOffsets, normalizeMarkdown, setSelectionOffsets } from '../lib/editor-dom';
import { renderDecorated } from '../lib/markdown';
import type { CommentThread } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let props: PreviewProps;
const markdown = '# 中文 👩🏽‍💻 é\n\n- [ ] **list**\n  2. second\n\n```ts\n  <script> & "\n\n```\n> quote\n\n';

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = { markdown, anchors: [], activeAnchorId: null };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.getSelection()?.removeAllRanges();
});
function render(next: Partial<PreviewProps> = {}) {
  props = { ...props, ...next };
  act(() => root.render(<Preview {...props} />));
  return host.querySelector<HTMLDivElement>('.preview')!;
}

describe('Preview reading invariants', () => {
  it.each([markdown, '', 'first\r\n\r\nlast\r', 'reserved\u200b placeholder'])('uses the existing decoration and line representation: %j', (source) => {
    const preview = render({ markdown: source });
    const reference = document.createElement('div');
    reference.innerHTML = renderDecorated(normalizeMarkdown(source));
    expect(preview.innerHTML).toBe(reference.innerHTML);
    expect(getMarkdown(preview)).toBe(normalizeMarkdown(source));
    expect(Array.from(preview.children).map((line) => line.textContent!.replace(/\u200b/g, '')))
      .toEqual(normalizeMarkdown(source).split('\n'));
    expect(preview.querySelector('script')).toBeNull();
  });

  it('resolves contextual, overlapping and cross-line anchors without changing text or selection on activation', () => {
    const md = 'repeat\n# 中文\n\n- repeat **end**';
    const anchors: CommentThread[] = [
      { id: 'cross"[]', quote: '中文\n\n- repeat', before: '# ', after: ' **end**', replies: [] },
      { id: 'second', quote: 'repeat', before: '\n- ', after: ' **end**', replies: [] },
      { id: 'missing', quote: 'removed', before: '', after: '', replies: [] },
    ];
    const activate = vi.fn();
    const preview = render({ markdown: md, anchors, onAnchorClick: activate });
    const highlights = Array.from(preview.querySelectorAll<HTMLElement>('.anchor-hl'));
    expect(highlights.filter((span) => span.dataset.anchorId === 'cross"[]').length).toBeGreaterThan(1);
    expect(preview.querySelectorAll('[role="button"]')).toHaveLength(2);
    const second = highlights.find((span) => span.dataset.anchorId === 'second')!;
    expect(second.closest('.ln')?.getAttribute('data-i')).toBe('3');
    act(() => second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(activate).toHaveBeenCalledWith('second');
    const selection = { anchor: md.length, focus: 7 };
    setSelectionOffsets(preview, selection);
    const line = preview.firstChild;
    render({ activeAnchorId: 'cross"[]' });
    expect(preview.firstChild).toBe(line);
    expect(getSelectionOffsets(preview)).toEqual(selection);
    expect(getMarkdown(preview)).toBe(md);
    expect(preview.querySelectorAll('.anchor-hl.active').length).toBeGreaterThan(1);
    act(() => second.click());
    expect(activate).toHaveBeenCalledTimes(1);
    // Refreshing comment metadata preserves a selection, without duplicate wrappers.
    render({ anchors: [...anchors] });
    expect(preview.querySelectorAll('.anchor-hl')).toHaveLength(highlights.length);
    expect(getSelectionOffsets(preview)).toEqual(selection);
    render({ markdown: 'replacement' });
    expect(getMarkdown(preview)).toBe('replacement');
    expect(preview.querySelector('.anchor-hl')).toBeNull();
  });

  it('exposes no editing surface and copies the exact selected Markdown across blank lines', () => {
    const preview = render();
    expect(preview.getAttribute('contenteditable')).toBe('false');
    expect(host.querySelector('input, textarea, [contenteditable="true"]')).toBeNull();
    setSelectionOffsets(preview, { anchor: 0, focus: markdown.length });
    const initialDOM = preview.innerHTML;
    act(() => {
      for (const key of ['a', 'Enter', 'Backspace', 'Delete', 'b', 'i', 'k', 'z', 'y']) {
        preview.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: key.length === 1, bubbles: true }));
        preview.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: key.length === 1, bubbles: true }));
      }
      for (const type of ['beforeinput', 'input', 'paste', 'drop', 'compositionstart', 'compositionend']) {
        preview.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
      }
    });
    expect(preview.innerHTML).toBe(initialDOM);
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    const setData = vi.fn();
    Object.defineProperty(copy, 'clipboardData', { value: { setData } });
    act(() => preview.dispatchEvent(copy));
    expect(copy.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledExactlyOnceWith('text/plain', markdown);
    expect(getMarkdown(preview)).toBe(markdown);
  });
});
