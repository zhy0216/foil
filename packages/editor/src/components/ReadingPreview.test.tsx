import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyMarkdownButton, ReadingPreview, type ReadingPreviewProps } from './ReadingPreview';
import { parseReadingDocument } from '../lib/reading-document';
import type { CommentThread } from '../types';

// The reading view must never pull in editing, storage or sharing code, and
// never the line-based decoration pipeline.
vi.mock('./Editor', () => { throw new Error('ReadingPreview imported Editor'); });
vi.mock('./Composer', () => { throw new Error('ReadingPreview imported Composer'); });
vi.mock('./DocSwitcher', () => { throw new Error('ReadingPreview imported DocSwitcher'); });
vi.mock('../lib/doc-store', () => { throw new Error('ReadingPreview imported document storage'); });
vi.mock('../lib/url-codec', () => { throw new Error('ReadingPreview imported the codec'); });
vi.mock('../lib/markdown', () => { throw new Error('ReadingPreview imported the line decorator'); });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const markdown = [
  '# Head ==one==',
  '',
  'Text **bold** ~~old~~ `code` ==mk== &amp; \\* [ext](https://e.com) [mail](mailto:a@b.c) [in](#head-one) [js](javascript:x)',
  'soft line ![alt](https://e.com/i.png) <b>raw</b>',
  '',
  '- a',
  '  - b',
  '1. c',
  '- [x] d',
  '',
  '> q',
  '',
  '| x | y |',
  '| - | -: |',
  '| 1 | 2 |',
  '',
  '```mermaid',
  'g;',
  '```',
  '',
  '---',
  '',
  '<div>html</div>',
].join('\n');

const expectedText =
  'Head one' +
  'Text bold old code mk & * ext mail in js (javascript:x) soft line alt (image: https://e.com/i.png) <b>raw</b>' +
  'abcd' + 'q' + 'xy12' + 'g;' + '<div>html</div>';

const commentMarkdown = ['first **bold** tail', '', 'second para ==mark== end'].join('\n');
const anchors: CommentThread[] = [
  { id: 'cross', quote: 'tail\n\nsecond', before: '**bold** ', after: ' para', replies: [] },
  { id: 'syntax', quote: '**', before: '', after: '', replies: [] },
  { id: 'inmark', quote: 'mark', before: '==', after: '==', replies: [] },
  { id: 'absent', quote: 'removed', before: '', after: '', replies: [] },
];

let host: HTMLDivElement;
let root: Root;
let props: ReadingPreviewProps;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = { markdown, anchors: [], activeAnchorId: null };
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});
function render(next: Partial<ReadingPreviewProps> = {}) {
  props = { ...props, ...next };
  act(() => root.render(<ReadingPreview {...props} />));
  return host.querySelector<HTMLDivElement>('.reading-preview')!;
}

describe('ReadingPreview content coverage', () => {
  it('renders every construct exactly once as semantic whitelisted nodes', () => {
    const preview = render();
    expect(preview.textContent).toBe(expectedText);
    expect(preview.getAttribute('role')).toBe('document');
    expect(preview.querySelector('h1')?.id).toBe('head-one');
    expect(preview.querySelector('mark.reading-mark')?.textContent).toBe('one');
    expect(preview.querySelector('strong')?.textContent).toBe('bold');
    expect(preview.querySelector('del')?.textContent).toBe('old');
    expect(preview.querySelector('code')?.textContent).toBe('code');
    expect(preview.querySelectorAll('ul')).toHaveLength(3);
    expect(preview.querySelectorAll('ol')).toHaveLength(1);
    const checkbox = preview.querySelector('input[type="checkbox"]')!;
    expect(checkbox.hasAttribute('disabled')).toBe(true);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect(preview.querySelector('blockquote p')?.textContent).toBe('q');
    const heads = Array.from(preview.querySelectorAll('th'));
    expect(heads.map((th) => th.textContent)).toEqual(['x', 'y']);
    expect(heads[1].style.textAlign).toBe('right');
    expect(Array.from(preview.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['1', '2']);
    expect(preview.querySelector('pre.reading-code code')?.textContent).toBe('g;');
    expect(preview.querySelector('hr')).toBeTruthy();
    expect(preview.querySelector('.ln')).toBeNull();
    expect(preview.querySelector('textarea, [contenteditable="true"], input:not([disabled])')).toBeNull();
  });

  it('normalizes CRLF and ZWSP input to the same visible text', () => {
    const crlf = render({ markdown: markdown.replace(/\n/g, '\r\n') + '\u200b' });
    expect(crlf.textContent).toBe(expectedText);
  });

  it('renders an empty document without crashing', () => {
    const preview = render({ markdown: '' });
    expect(preview.textContent).toBe('');
  });

  it('accepts a host-provided parse with byte-identical output', () => {
    const html = render({ markdown: commentMarkdown, anchors }).innerHTML;
    act(() => root.render(<ReadingPreview {...props} doc={parseReadingDocument(commentMarkdown)} />));
    expect(host.querySelector<HTMLDivElement>('.reading-preview')!.innerHTML).toBe(html);
  });

  it('keeps mermaid and unknown fences as source code text', () => {
    const preview = render({ markdown: '```mermaid\ngraph TD; A-->B;\n```\n\n$$e=mc^2$$' });
    expect(preview.querySelector('pre.reading-code code')?.textContent).toBe('graph TD; A-->B;');
    expect(preview.textContent).toContain('$$e=mc^2$$');
  });
});

describe('ReadingPreview safety boundary', () => {
  it('shows raw html as text and never creates script or foreign elements', () => {
    const preview = render();
    expect(preview.querySelector('script, iframe, object, embed, style, link')).toBeNull();
    expect(preview.querySelector('b')).toBeNull();
    expect(preview.innerHTML).not.toContain('<script');
    expect(preview.textContent).toContain('<b>raw</b>');
    expect(preview.querySelector('pre.reading-html')?.textContent).toBe('<div>html</div>');
    const xss = render({ markdown: '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>' });
    expect(xss.querySelector('script, img')).toBeNull();
    expect(xss.textContent).toContain('<script>alert(1)</script>');
    expect(xss.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('links only over safe protocols and never auto-prefetches', () => {
    const preview = render();
    const external = preview.querySelector<HTMLAnchorElement>('a[href="https://e.com/"]')!;
    expect(external.target).toBe('_blank');
    expect(external.rel).toBe('noopener noreferrer');
    const mail = preview.querySelector<HTMLAnchorElement>('a[href="mailto:a@b.c"]')!;
    expect(mail.target).toBe('');
    for (const link of Array.from(preview.querySelectorAll('a'))) {
      expect(link.getAttribute('href')).toMatch(/^(https?:|mailto:|#)/);
    }
    expect(preview.querySelector('[rel~="prefetch"], [rel~="preload"], [rel~="preconnect"]')).toBeNull();
    const inert = preview.querySelector('.reading-link-inert')!;
    expect(inert.textContent).toBe('js (javascript:x)');
    expect(inert.closest('a')).toBeNull();
    const dangerous = render({
      markdown: '[d](data:text/html,x) [f](file:///etc/passwd) [j](JaVaScRiPt:alert(1)) [r](/relative)',
    });
    expect(dangerous.querySelectorAll('a')).toHaveLength(0);
    expect(dangerous.textContent).toContain('data:text/html,x');
    expect(dangerous.textContent).toContain('file:///etc/passwd');
    expect(dangerous.textContent).toContain('/relative');
  });

  it('resolves in-document targets by scrolling without touching the URL fragment', () => {
    const preview = render();
    const heading = preview.querySelector('h1')!;
    const internal = preview.querySelector<HTMLAnchorElement>('a[href="#head-one"]')!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => internal.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(heading.scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('shows images as readable placeholders and never requests resources', () => {
    const fetchMock = vi.fn(() => {
      throw new Error('network access during render');
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const preview = render();
      expect(preview.querySelector('img')).toBeNull();
      expect(preview.innerHTML).not.toContain('<img');
      expect(preview.querySelector('.reading-image')?.textContent).toBe('alt (image: https://e.com/i.png)');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('ReadingPreview comments', () => {
  it('highlights located anchors, skips unlocated ones and keeps one keyboard stop each', () => {
    const activate = vi.fn();
    const preview = render({ markdown: commentMarkdown, anchors, onAnchorClick: activate });
    const cross = Array.from(preview.querySelectorAll<HTMLElement>('.anchor-hl[data-anchor-id="cross"]'));
    expect(cross.length).toBeGreaterThanOrEqual(2);
    expect(cross.map((span) => span.textContent).join('')).toBe('tailsecond');
    const inmark = preview.querySelectorAll<HTMLElement>('.anchor-hl[data-anchor-id="inmark"]');
    expect(inmark).toHaveLength(1);
    expect(inmark[0].closest('mark.reading-mark')).toBeTruthy();
    expect(preview.querySelectorAll('[data-anchor-id="syntax"], [data-anchor-id="absent"]')).toHaveLength(0);
    expect(preview.querySelectorAll('.anchor-hl[role="button"]')).toHaveLength(2);
    expect(cross[0].getAttribute('aria-label')).toBe('Read comment: tail\n\nsecond');
    act(() => inmark[0].click());
    expect(activate).toHaveBeenCalledWith('inmark');
    act(() => cross[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(activate).toHaveBeenCalledWith('cross');
    expect(activate).toHaveBeenCalledTimes(2);
    // A non-collapsed selection means the reader is selecting text, not activating.
    const range = document.createRange();
    range.selectNodeContents(preview.querySelector('strong')!);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    act(() => inmark[0].click());
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it('nests overlapping comments without duplicating wrappers', () => {
    const overlapping: CommentThread[] = [
      { id: 'outer', quote: 'hello world', before: '', after: '', replies: [] },
      { id: 'inner', quote: 'lo wo', before: '', after: '', replies: [] },
    ];
    const preview = render({ markdown: 'hello world', anchors: overlapping });
    const inner = preview.querySelector('[data-anchor-id="inner"]')!;
    expect(inner.closest('[data-anchor-id="outer"]')).toBeTruthy();
    expect(preview.textContent).toBe('hello world');
    // Without a click handler, highlights carry no interactive affordances.
    expect(preview.querySelector('[role="button"], [tabindex]')).toBeNull();
    // Three outer coverage runs plus the one inner run; refreshing metadata
    // must not grow the wrappers.
    expect(preview.querySelectorAll('[data-anchor-id="outer"]')).toHaveLength(3);
    expect(preview.querySelectorAll('[data-anchor-id="inner"]')).toHaveLength(1);
    render({ anchors: [...overlapping] });
    expect(preview.querySelectorAll('.anchor-hl')).toHaveLength(4);
  });

  it('activation only toggles state: same elements, kept selection, no scrolling', () => {
    const preview = render({ markdown: commentMarkdown, anchors, activeAnchorId: null, onAnchorClick: vi.fn() });
    const span = preview.querySelector<HTMLElement>('.anchor-hl[data-anchor-id="inmark"]')!;
    const strong = preview.querySelector('strong')!;
    const range = document.createRange();
    range.selectNodeContents(strong.firstChild!);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const anchorNode = selection.anchorNode;
    const scrollTop = document.documentElement.scrollTop;
    render({ activeAnchorId: 'inmark' });
    expect(preview.querySelector('.anchor-hl[data-anchor-id="inmark"]')).toBe(span);
    expect(span.classList.contains('active')).toBe(true);
    expect(span.getAttribute('aria-pressed')).toBe('true');
    expect(preview.querySelectorAll('.anchor-hl[data-anchor-id="cross"]').length).toBeGreaterThan(1);
    expect(selection.anchorNode).toBe(anchorNode);
    expect(strong.isConnected).toBe(true);
    expect(span.scrollIntoView).not.toHaveBeenCalled();
    expect(document.documentElement.scrollTop).toBe(scrollTop);
    render({ activeAnchorId: null });
    expect(span.classList.contains('active')).toBe(false);
    expect(span.getAttribute('aria-pressed')).toBe('false');
    expect(selection.anchorNode).toBe(anchorNode);
  });
});

describe('copy contracts', () => {
  it('reading mode copies exactly the visible text through the native selection', () => {
    const preview = render();
    const paragraph = preview.querySelectorAll('p')[0];
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(range.toString()).toBe(
      'Text bold old code mk & * ext mail in js (javascript:x) soft line alt (image: https://e.com/i.png) <b>raw</b>'
    );
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    const setData = vi.fn();
    Object.defineProperty(copy, 'clipboardData', { value: { setData } });
    act(() => preview.dispatchEvent(copy));
    // Native copy is deliberately not intercepted: the clipboard receives what
    // the selection shows. Preview keeps the opposite, raw-Markdown contract.
    expect(copy.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
    expect(range.toString()).not.toContain('**');
    expect(range.toString()).not.toContain('==');
  });

  it('Copy Markdown copies the exact raw source instead', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    act(() => root.render(<CopyMarkdownButton markdown={markdown} />));
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe('Copy Markdown');
    act(() => button.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(markdown);
    expect(writeText.mock.calls[0][0]).toContain('**bold**');
    expect(writeText.mock.calls[0][0]).toContain('==one==');
  });
});
