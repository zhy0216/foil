import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type EditorHandle } from './Editor';
import { getMarkdown, getSelectionOffsets, setSelectionOffsets } from '../lib/editor-dom';
import { renderDecorated } from '../lib/markdown';
import type { CommentThread } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const anchor: CommentThread = { id: 'thread-1', quote: 'world', before: 'hello ', after: '', replies: [] };

interface Harness {
  root: Root;
  container: HTMLDivElement;
  ref: { current: EditorHandle | null };
  changes: string[];
  render: (props?: Partial<React.ComponentProps<typeof Editor>>) => Promise<void>;
}

async function mount(initialMarkdown: string, extra: Partial<React.ComponentProps<typeof Editor>> = {}): Promise<Harness> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const ref: { current: EditorHandle | null } = { current: null };
  const changes: string[] = [];
  let current = { initialMarkdown, anchors: [], activeAnchorId: null, ...extra };
  const render = async (props: Partial<React.ComponentProps<typeof Editor>> = {}) => {
    current = { ...current, ...props };
    await act(async () => {
      root.render(<Editor ref={ref} {...current} onChange={(md) => changes.push(md)} />);
      await Promise.resolve();
    });
  };
  await render();
  return { root, container, ref, changes, render };
}

function textData(text: string, type = 'text/plain'): DataTransfer {
  return {
    files: [], items: [], types: [type],
    getData: (requested: string) => requested === type ? text : '',
    setData: vi.fn(), clearData: vi.fn(), dropEffect: 'none', effectAllowed: 'all',
  } as unknown as DataTransfer;
}

function dispatchClipboard(el: HTMLElement, type: 'paste' | 'drop', data: DataTransfer, x = 0, y = 0): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { clipboardData: { value: data }, dataTransfer: { value: data }, clientX: { value: x }, clientY: { value: y } });
  el.dispatchEvent(event);
  return event;
}

async function editDOM(harness: Harness, markdown: string, selection: { anchor: number; focus: number } | null = null): Promise<void> {
  const el = harness.ref.current!.el()!;
  el.innerHTML = renderDecorated(markdown);
  if (selection) setSelectionOffsets(el, selection);
  await act(async () => {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await Promise.resolve();
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('Editor input transactions', () => {
  it('pastes plain text only, replacing a reverse selection and never HTML', async () => {
    const h = await mount('hello world');
    const el = h.ref.current!.el()!;
    setSelectionOffsets(el, { anchor: 11, focus: 6 });
    const event = dispatchClipboard(el, 'paste', textData('<img src=x onerror=alert(1)>'));
    expect(event.defaultPrevented).toBe(true);
    expect(getMarkdown(el)).toBe('hello <img src=x onerror=alert(1)>');
    expect(el.querySelector('img')).toBeNull();
    expect(h.changes).toEqual(['hello <img src=x onerror=alert(1)>']);
    expect(getSelectionOffsets(el)).toEqual({ anchor: 34, focus: 34 });
  });

  it('drops plain text at the browser caret and ignores files/HTML-only payloads', async () => {
    const h = await mount('abcd');
    const el = h.ref.current!.el()!;
    const text = el.querySelector('.ln')!.firstChild!;
    Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true, value: () => ({ offsetNode: text, offset: 2 }) });
    const event = dispatchClipboard(el, 'drop', textData('X'), 10, 10);
    expect(event.defaultPrevented).toBe(true);
    expect(getMarkdown(el)).toBe('abXcd');
    expect(dispatchClipboard(el, 'drop', textData('<b>X</b>', 'text/html'), 10, 10).defaultPrevented).toBe(true);
    expect(getMarkdown(el)).toBe('abXcd');
    const fileData = textData('file text');
    Object.defineProperty(fileData, 'files', { value: [{ name: 'x.html' }] });
    dispatchClipboard(el, 'drop', fileData, 10, 10);
    expect(getMarkdown(el)).toBe('abXcd');
  });

  it('handles Enter, Shift+Enter and shortcut formatting through one replacement path', async () => {
    const h = await mount('- item');
    const el = h.ref.current!.el()!;
    setSelectionOffsets(el, { anchor: 6, focus: 6 });
    await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await Promise.resolve(); });
    expect(getMarkdown(el)).toBe('- item\n- ');
    setSelectionOffsets(el, { anchor: 9, focus: 9 });
    await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })); await Promise.resolve(); });
    expect(getMarkdown(el)).toBe('- item\n- \n');

    setSelectionOffsets(el, { anchor: 0, focus: 6 });
    await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })); await Promise.resolve(); });
    expect(getMarkdown(el)).toContain('**- item**');
    expect(h.changes.length).toBe(3);
  });

  it('does one post-composition synchronization and does not hijack composition Enter', async () => {
    const h = await mount('a');
    const el = h.ref.current!.el()!;
    await act(async () => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      el.innerHTML = renderDecorated('a中');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    });
    expect(getMarkdown(el)).toBe('a中');
    expect(h.changes).toEqual(['a中']);
  });

  it('readOnly blocks keyboard, paste, drop and programmatic editing', async () => {
    const h = await mount('safe', { readOnly: true });
    const el = h.ref.current!.el()!;
    setSelectionOffsets(el, { anchor: 0, focus: 4 });
    await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await Promise.resolve(); });
    dispatchClipboard(el, 'paste', textData('changed'));
    h.ref.current!.setMarkdown('changed');
    expect(getMarkdown(el)).toBe('safe');
    expect(h.changes).toEqual([]);
  });

  it('restores comment highlights after input and prop rebuilds without nesting growth', async () => {
    const clicked: string[] = [];
    const h = await mount('hello world', { anchors: [anchor], onAnchorClick: (id) => clicked.push(id) });
    const el = h.ref.current!.el()!;
    expect(el.querySelectorAll('.anchor-hl')).toHaveLength(1);
    expect(el.querySelector('.anchor-hl')!.textContent).toBe('world');
    await editDOM(h, 'hello world!', { anchor: 12, focus: 12 });
    expect(getMarkdown(el)).toBe('hello world!');
    expect(el.querySelector('.anchor-hl')!.textContent).toBe('world');
    expect(el.querySelectorAll('.anchor-hl')).toHaveLength(1);
    el.querySelector<HTMLElement>('.anchor-hl')!.click();
    expect(clicked).toEqual(['thread-1']);
    await h.render({ initialMarkdown: 'new world', anchors: [anchor] });
    expect(getMarkdown(el)).toBe('new world');
    expect(el.querySelectorAll('.anchor-hl')).toHaveLength(1);
    expect(getMarkdown(el)).toBe('new world');
    h.ref.current!.setMarkdown('hello world');
    expect(getMarkdown(el)).toBe('hello world');
    expect(el.querySelectorAll('.anchor-hl')).toHaveLength(1);
  });

  it('exposes the same selection operations for toolbar callers after focus moves', async () => {
    const h = await mount('hello');
    const el = h.ref.current!.el()!;
    setSelectionOffsets(el, { anchor: 0, focus: 5 });
    document.body.focus();
    expect(h.ref.current!.getSelection()).toEqual({ anchor: 0, focus: 5 });
    expect(h.ref.current!.wrapSelection('**')).toBe(true);
    expect(getMarkdown(el)).toBe('**hello**');
    expect(h.ref.current!.insertLink()).toBe(false);
    expect(h.ref.current!.replaceSelection('x')).toBe(true);
    expect(getMarkdown(el)).toBe('**hello**x');
  });

  it('supports bounded undo and redo for custom transactions', async () => {
    const h = await mount('abc');
    const el = h.ref.current!.el()!;
    setSelectionOffsets(el, { anchor: 3, focus: 3 });
    expect(h.ref.current!.replaceSelection('X')).toBe(true);
    expect(getMarkdown(el)).toBe('abcX');
    await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await Promise.resolve(); });
    expect(getMarkdown(el)).toBe('abc');
    await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true })); await Promise.resolve(); });
    expect(getMarkdown(el)).toBe('abcX');
  });
});
