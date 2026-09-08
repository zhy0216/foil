import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderDecorated } from './markdown';
import {
  clearEditorHighlights, enterMarkdown, findAnchorRange, getCharOffset, getMarkdown,
  getRangeOffsets, getSelectionOffsets, normalizeMarkdown, replaceMarkdownSelection,
  setCharOffset, setSelectionOffsets, wrapRangeInEditor,
} from './editor-dom';

function host(html: string): HTMLDivElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function select(node: Node, start: number, endNode = node, end = start): void {
  document.getSelection()!.setBaseAndExtent(node, start, endNode, end);
}

function roundTrip(root: HTMLElement, md: string): void {
  expect(getMarkdown(root)).toBe(md);
  for (let offset = 0; offset <= md.length; offset++) {
    setCharOffset(root, offset);
    expect(getCharOffset(root), `offset ${offset} in ${JSON.stringify(md)}`).toBe(offset);
    expect(getSelectionOffsets(root)).toEqual({ anchor: offset, focus: offset });
  }
}

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Markdown DOM boundary mapping', () => {
  it('maps block offset zero and every syntax child boundary to their source position', () => {
    const root = host(renderDecorated('**abc**'));
    const block = root.firstChild!;
    for (const [childOffset, markdownOffset] of [[0, 0], [1, 2], [2, 5], [3, 7]]) {
      select(block, childOffset);
      expect(getCharOffset(root)).toBe(markdownOffset);
    }
    select(root, 0);
    expect(getCharOffset(root)).toBe(0);
    select(root, 1);
    expect(getCharOffset(root)).toBe(7);
  });

  it('maps root boundaries to the following line and retains empty lines', () => {
    const root = host(renderDecorated('first\n\nlast\n'));
    [0, 6, 7, 12, 12].forEach((offset, child) => {
      select(root, child);
      expect(getCharOffset(root)).toBe(offset);
    });
  });

  it.each([
    ['', ''],
    ['<div>new text</div>', 'new text'],
    ['<div class="ln">first<br>second</div>', 'first\nsecond'],
    ['first<br>second', 'first\nsecond'],
    ['<div>first</div><div>second</div>', 'first\nsecond'],
    ['first<div>second</div>third', 'first\nsecond\nthird'],
    ['<div>first<div>second</div>third</div>', 'first\nsecond\nthird'],
    ['<div><br></div>', ''],
    ['<div><br></div><div><br></div>', '\n'],
    ['<div>first</div><div><br></div><p>third</p><div><br></div>', 'first\n\nthird\n'],
    ['<div>first<br></div><div>second<br></div>', 'first\nsecond'],
    ['<div>first<br><br></div>', 'first\n'],
    ['<div><span>first<br></span></div>', 'first'],
    ['<div class="ln"><span class="syn">**</span><span class="md-bold"><span class="anchor-hl">中😀</span>x</span><span class="syn">**</span></div><div class="ln">​</div><div class="ln">z</div>', '**中😀x**\n\nz'],
  ])('round-trips every UTF-16 offset in native/decorated HTML %s', (html, md) => {
    roundTrip(host(html), md);
  });

  it.each([
    '', '\n', '\n\n', '**abc**', '#  heading\n-\t[x]\titem\n\n>quote',
    '😀中\n🧑‍💻\n\nlast\n', '```ts\n\nconst x = "<b>";\n```',
    ' [**label**](https://example.com)\n\t  ',
  ])('round-trips all offsets in decorated Markdown %j', (md) => {
    roundTrip(host(renderDecorated(md)), md);
  });

  it('normalizes CRLF/lone CR and reserves every ZWSP, including inside text nodes', () => {
    const root = host('');
    root.append(document.createTextNode('​a\r\n😀\r​b​​'));
    const expected = 'a\n😀\nb';
    expect(normalizeMarkdown(root.textContent!)).toBe(expected);
    roundTrip(root, expected);
    select(root.firstChild!, 1);
    expect(getCharOffset(root)).toBe(0);
    select(root.firstChild!, 4);
    expect(getCharOffset(root)).toBe(2);
  });

  it('normalizes a CRLF pair split across inline text nodes', () => {
    const root = host('<span></span><span></span>');
    root.children[0].textContent = 'a\r';
    root.children[1].textContent = '\nb';
    roundTrip(root, 'a\nb');
  });

  it('round-trips every forward/backward range without dropping a multiline selection', () => {
    const md = '**a😀**\n\nz';
    const root = host(renderDecorated(md));
    wrapRangeInEditor(root, 2, 9, 'anchor-hl', 'comment');
    for (let anchor = 0; anchor <= md.length; anchor++) {
      for (let focus = 0; focus <= md.length; focus++) {
        setSelectionOffsets(root, { anchor, focus });
        expect(getSelectionOffsets(root)).toEqual({ anchor, focus });
        expect(getCharOffset(root)).toBe(Math.min(anchor, focus));
        expect(getRangeOffsets(root, document.getSelection()!.getRangeAt(0))).toEqual({
          start: Math.min(anchor, focus), end: Math.max(anchor, focus),
        });
      }
    }
  });

  it('reads both endpoints without modifying the global Selection', () => {
    const root = host(renderDecorated('first\nsecond'));
    setSelectionOffsets(root, { anchor: 10, focus: 2 });
    const sel = document.getSelection()!;
    const methods = ['setBaseAndExtent', 'removeAllRanges', 'addRange', 'collapse'] as const;
    const spies = methods.map((method) => vi.spyOn(sel, method));
    for (let i = 0; i < 5; i++) {
      expect(getSelectionOffsets(root)).toEqual({ anchor: 10, focus: 2 });
      expect(getRangeOffsets(root, sel.getRangeAt(0))).toEqual({ start: 2, end: 10 });
    }
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it('rejects selections crossing either editor boundary in either direction', () => {
    const before = host('before');
    const root = host(renderDecorated('inside'));
    const after = host('after');
    const inside = root.firstChild!.firstChild!;
    for (const outside of [before.firstChild!, after.firstChild!]) {
      for (const backward of [false, true]) {
        select(backward ? outside : inside, 1, backward ? inside : outside, 2);
        expect(getCharOffset(root)).toBeNull();
        expect(getSelectionOffsets(root)).toBeNull();
        expect(getRangeOffsets(root, document.getSelection()!.getRangeAt(0))).toBeNull();
      }
    }
  });

  it('clamps restored offsets and supports a completely empty editor root', () => {
    const root = host('');
    setSelectionOffsets(root, { anchor: -10, focus: 30 });
    expect(getSelectionOffsets(root)).toEqual({ anchor: 0, focus: 0 });
    root.innerHTML = renderDecorated('abc');
    setSelectionOffsets(root, { anchor: 30, focus: -10 });
    expect(getSelectionOffsets(root)).toEqual({ anchor: 3, focus: 0 });
  });
});

describe('Markdown selection transactions', () => {
  it('replaces an entire backward multiline selection and normalizes inserted text', () => {
    expect(replaceMarkdownSelection('first\n\nsecond', { anchor: 10, focus: 2 }, 'A\r\n\rB​')).toEqual({
      markdown: 'fiA\n\nBond', selection: { anchor: 6, focus: 6 },
    });
  });

  it('can place the caret inside the replacement for a link URL', () => {
    expect(replaceMarkdownSelection('a text z', { anchor: 6, focus: 2 }, '[text](url)', 7)).toEqual({
      markdown: 'a [text](url) z', selection: { anchor: 9, focus: 9 },
    });
  });

  it.each([
    ['abc', 1, 1, false, 'a\nbc', 2],
    ['first\nsecond', 9, 2, false, 'fi\nond', 3],
    ['\nlast', 0, 0, false, '\n\nlast', 1],
    ['- item', 6, 6, false, '- item\n- ', 9],
    ['- item', 6, 6, true, '- item\n', 7],
    ['  *   item', 10, 10, false, '  *   item\n  *   ', 17],
    ['-\t[x]\titem', 10, 10, false, '-\t[x]\titem\n-\t[ ]\t', 17],
    ['9. item', 7, 7, false, '9. item\n10. ', 12],
    ['2)\titem', 7, 7, false, '2)\titem\n3)\t', 11],
    ['>quote', 6, 6, false, '>quote\n>', 8],
    ['  >> quote', 10, 10, false, '  >> quote\n  >> ', 16],
    ['- ', 2, 2, false, '', 0],
    ['- [ ] ', 6, 6, false, '', 0],
    ['2. ', 3, 3, false, '', 0],
    ['> ', 2, 2, false, '', 0],
    ['- a\n- \nend', 6, 6, false, '- a\n\nend', 4],
    ['- abc\nother', 8, 3, false, '- a\n- her', 6],
    ['- abc', 0, 0, false, '\n- abc', 1],
  ])('Enter in %j at %i → %i (plain %s)', (md, anchor, focus, plain, expected, caret) => {
    expect(enterMarkdown(md, { anchor, focus }, plain)).toEqual({
      markdown: expected, selection: { anchor: caret, focus: caret },
    });
  });
});

describe('comment highlight helpers', () => {
  it('keeps existing contextual lookup and reusable quote fallback', () => {
    const anchor = { quote: 'word', before: 'the ', after: ' here' };
    expect(findAnchorRange('word then the word here', anchor)).toEqual({ start: 14, end: 18 });
    expect(findAnchorRange('only word', anchor)).toEqual({ start: 5, end: 9 });
    expect(findAnchorRange('absent', anchor)).toBeNull();
    expect(findAnchorRange('text', { quote: '', before: '', after: '' })).toBeNull();
  });

  it('wraps native/multiline text and overlapping comments without changing any source character', () => {
    const root = host('<div>first<br>second</div><div><br></div><div>😀last</div>');
    const md = 'first\nsecond\n\n😀last';
    wrapRangeInEditor(root, 2, 17, 'anchor-hl', 'one');
    wrapRangeInEditor(root, 8, 19, 'anchor-hl active', 'two');
    expect(Array.from(root.querySelectorAll('[data-anchor-id="one"]')).map((el) => el.textContent).join('')).toBe('rstsecond😀l');
    roundTrip(root, md);
    const count = root.querySelectorAll('.anchor-hl').length;
    wrapRangeInEditor(root, 2, 17, 'anchor-hl', 'one');
    expect(root.querySelectorAll('.anchor-hl')).toHaveLength(count);
    clearEditorHighlights(root);
    expect(root.querySelector('.anchor-hl')).toBeNull();
    roundTrip(root, md);
  });
});
