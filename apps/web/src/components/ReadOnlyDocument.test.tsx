import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadOnlyDocument, type ReadOnlyDocumentProps } from './ReadOnlyDocument';
import { SettingsModal } from './SettingsModal';
import { HelpModal } from './HelpModal';
import { Thread } from './Thread';
import { DEFAULT_SETTINGS, PROSE_FONT_MAP } from '../lib/settings-config';
import { getMarkdown } from '../lib/editor-dom';
import type { DocState } from '../types';

// Importing the reader must never initialize editing, storage or sharing code.
vi.mock('./Editor', () => { throw new Error('Reader imported Editor'); });
vi.mock('./Composer', () => { throw new Error('Reader imported Composer'); });
vi.mock('./DocSwitcher', () => { throw new Error('Reader imported DocSwitcher'); });
vi.mock('../lib/doc-store', () => { throw new Error('Reader imported document storage'); });
vi.mock('../lib/url-codec', () => { throw new Error('Reader imported the codec'); });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const doc: DocState = {
  title: 'Shared 中文 <title>', md: 'Intro 🌱\nfirst\n\nlast tail\nLater',
  comments: [
    { id: 'cross"[]', quote: 'first\n\nlast', before: '\n', after: ' tail', replies: [
      { id: 'r1', author: 'Author', ts: 1, body: 'First comment\nwith detail' },
      { id: 'r2', author: 'Reader', ts: 2, body: 'Existing reply' },
    ] },
    { id: 'missing', quote: 'Removed quote', before: '', after: '', replies: [
      { id: 'r3', author: 'Other', ts: 3, body: 'Unlocated comment' },
    ] },
    { id: 'later', quote: 'Later', before: '', after: '', replies: [
      { id: 'r4', author: 'Other', ts: 4, body: 'Later comment' },
    ] },
  ],
};
let host: HTMLDivElement;
let root: Root;
let props: ReadOnlyDocumentProps;
let mobile: boolean;
let light: boolean;
let anchorTop: number;
let cardHeight: number;
let resizeCallbacks: Set<() => void>;
let mediaListeners: Map<string, Set<() => void>>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = { doc, settings: DEFAULT_SETTINGS };
  mobile = false;
  light = false;
  anchorTop = 150;
  cardHeight = 140;
  resizeCallbacks = new Set();
  mediaListeners = new Map();
  vi.stubGlobal('matchMedia', (query: string) => {
    const listeners = mediaListeners.get(query) ?? new Set();
    mediaListeners.set(query, listeners);
    return {
      get matches() { return query.includes('max-width') ? mobile : light; },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    };
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) { resizeCallbacks.add(callback); }
    observe() {}
    disconnect() { resizeCallbacks.delete(this.callback); }
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains('anchor-hl') ? anchorTop : this.classList.contains('preview') ? 140 : 100;
    return { top, bottom: top + cardHeight, height: cardHeight, left: 0, right: 300, width: 300, x: 0, y: top, toJSON() {} };
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  document.getSelection()?.removeAllRanges();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});
function render(next: Partial<ReadOnlyDocumentProps> = {}) {
  props = { ...props, ...next };
  act(() => root.render(<ReadOnlyDocument {...props} />));
}
function button(text: string, within: ParentNode = host) {
  const found = Array.from(within.querySelectorAll<HTMLButtonElement>('button')).find((el) =>
    el.textContent?.trim() === text || el.getAttribute('aria-label') === text);
  if (!found) throw new Error('Button not found: ' + text);
  return found;
}
function click(text: string, within: ParentNode = host) {
  act(() => button(text, within).click());
}
function highlight() { return host.querySelector<HTMLElement>('.anchor-hl[role="button"]')!; }

describe('ReadOnlyDocument', () => {
  it('reads the title, raw text, every reply and unlocated comments without storage or writing controls', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    const snapshot = JSON.stringify(doc);
    render();
    expect(host.querySelector('h1')?.textContent).toBe(doc.title);
    expect(getMarkdown(host.querySelector('.preview')!)).toBe(doc.md);
    for (const thread of doc.comments) {
      for (const reply of thread.replies) expect(host.textContent).toContain(reply.body);
    }
    expect(host.querySelector('.unlocated-comment')?.textContent).toContain('Quoted text not found');
    expect(host.querySelector('input, textarea, [contenteditable="true"], .sel-toolbar, .composer, .doc-switcher')).toBeNull();
    expect(Array.from(host.querySelectorAll('button')).map((el) => el.textContent)).not.toEqual(expect.arrayContaining(['Reply', 'Delete', 'Edit anyway']));
    expect(host.querySelector('.statusbar')?.textContent).toContain(`${doc.md.length} chars`);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('activates cross-line highlights with the keyboard and locates their text from desktop comments', () => {
    render();
    const anchor = highlight();
    act(() => anchor.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })));
    const quote = host.querySelector<HTMLButtonElement>('.gutter-comments .anchor')!;
    expect(document.activeElement).toBe(quote);
    expect(host.querySelectorAll('.anchor-hl.active').length).toBeGreaterThan(1);
    act(() => quote.click());
    expect(document.activeElement).toBe(anchor);
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    click('"Removed quote"');
    expect(host.querySelectorAll('.comment-thread.active')[0]?.textContent).toContain('Unlocated comment');
    expect(getMarkdown(host.querySelector('.preview')!)).toBe(doc.md);
  });

  it('stacks measured card heights and repositions on settings, resize and content reflow', () => {
    render();
    const cards = host.querySelectorAll<HTMLElement>('.readonly-thread-position');
    const top = (index: number) => Number.parseFloat(cards[index].style.top);
    expect(top(0)).toBe(50);
    expect(top(2)).toBeGreaterThanOrEqual(top(0) + cardHeight);
    expect(top(1)).toBeGreaterThanOrEqual(top(2) + cardHeight);
    anchorTop = 260;
    render({ settings: { ...DEFAULT_SETTINGS, proseSize: 'large' } });
    expect(top(0)).toBe(160);
    anchorTop = 380;
    act(() => window.dispatchEvent(new Event('resize')));
    expect(top(0)).toBe(280);
    cardHeight = 280;
    act(() => resizeCallbacks.forEach((callback) => callback()));
    expect(top(2)).toBeGreaterThanOrEqual(top(0) + cardHeight);
    expect(top(1)).toBeGreaterThanOrEqual(top(2) + cardHeight);
  });

  it('offers all comments in the mobile drawer, traps focus and restores the opener on close or resize', () => {
    mobile = true;
    render();
    const opener = button('Read 3 comments');
    opener.focus();
    act(() => opener.click());
    const drawer = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(drawer.textContent).toContain('Unlocated comment');
    expect(host.querySelector('.readonly-content')?.hasAttribute('inert')).toBe(true);
    const close = button('Close', drawer);
    expect(document.activeElement).toBe(close);
    act(() => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
    const last = Array.from(drawer.querySelectorAll('button')).at(-1)!;
    expect(document.activeElement).toBe(last);
    act(() => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(close);
    act(() => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
    expect(host.querySelector('.readonly-content')?.hasAttribute('inert')).toBe(false);

    act(() => highlight().click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    click('Close');
    expect(document.activeElement).toBe(highlight());
    act(() => highlight().click());
    click('"first\n\nlast"', host.querySelector('[role="dialog"]')!);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(highlight());
    act(() => opener.click());
    mobile = false;
    act(() => mediaListeners.get('(max-width: 1100px)')!.forEach((listener) => listener()));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('uses host actions and the existing settings/help modals for every reading preference', () => {
    const share = vi.fn();
    function ReadingHost() {
      const [settings, setSettings] = useState(DEFAULT_SETTINGS);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [helpOpen, setHelpOpen] = useState(false);
      return <>
        <ReadOnlyDocument doc={doc} settings={settings} onShare={share} onSettings={() => setSettingsOpen(true)} onHelp={() => setHelpOpen(true)} />
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onChange={setSettings} onReset={() => setSettings({ ...DEFAULT_SETTINGS })} />
        <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      </>;
    }
    act(() => root.render(<ReadingHost />));
    click('Share');
    expect(share).toHaveBeenCalledOnce();
    click('Settings');
    click('Light');
    click('Large');
    click('Compact');
    click('Wide');
    click('Violet');
    const mono = Array.from(host.querySelectorAll<HTMLButtonElement>('.font-card')).find((card) => card.textContent?.includes('Mono'))!;
    act(() => mono.click());
    const style = host.querySelector<HTMLElement>('.editor-wrap')!.style;
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#6f3ad9');
    expect(style.getPropertyValue('--prose-font')).toBe(PROSE_FONT_MAP.mono);
    expect(style.getPropertyValue('--prose-size')).toBe('21px');
    expect(style.getPropertyValue('--prose-leading')).toBe('1.55');
    expect(host.querySelector<HTMLElement>('.canvas')!.style.getPropertyValue('--editor-width')).toBe('960px');
    click('Reset to defaults');
    light = true;
    act(() => mediaListeners.get('(prefers-color-scheme: light)')!.forEach((listener) => listener()));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
    expect(style.getPropertyValue('--prose-size')).toBe('19px');
    click('Done');
    click('About Foil');
    expect(host.querySelector('.modal h3')?.textContent).toBe('About Foil');
    click('Done');
    expect(host.querySelector('.modal')).toBeNull();
    expect(getMarkdown(host.querySelector('.preview')!)).toBe(doc.md);
  });
});

describe('Thread modes', () => {
  it('preserves editing replies and deletion, and hides an open form when becoming read-only', () => {
    const reply = vi.fn(), remove = vi.fn();
    const thread = doc.comments[0];
    act(() => root.render(<Thread thread={thread} active onActivate={vi.fn()} onReply={reply} onDelete={remove} defaultName="Reader" />));
    click('Reply');
    const input = host.querySelector('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'A new reply');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click('Reply');
    expect(reply).toHaveBeenCalledExactlyOnceWith(thread.id, 'A new reply', 'Reader');
    click('Delete');
    expect(remove).toHaveBeenCalledExactlyOnceWith(thread.id);
    click('Reply');
    act(() => root.render(<Thread thread={thread} active onActivate={vi.fn()} readOnly />));
    expect(host.querySelector('input, textarea, .small-actions, .reply-input')).toBeNull();
    expect(host.textContent).toContain('Existing reply');
  });
});
