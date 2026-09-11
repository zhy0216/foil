import { describe, expect, it, vi } from 'vitest';
import { classifyLinkHref, parseReadingDocument, type ReadingBlock, type ReadingInline } from './reading-document';

const torture = [
  '# 标题 Head ==高亮==',
  'Setext',
  '------',
  '',
  'Para **bold** *em* ~~gone~~ `c d` ==mk *it*== &amp; &#38; &#x1F600; &notin; \\* \\= soft',
  'wrap hard\\',
  'break two  ',
  'again [ext](https://e.com "T") [ref][d] <https://auto.example> bare https://bare.example/x',
  '',
  '[d]: https://defined.example',
  '',
  '- 外层 item',
  '  - nested **x**',
  '    - deep',
  '1. first',
  '42) answer',
  '- [ ] todo',
  '- [x] done',
  '',
  '> 引用 ==mark==',
  '> tail',
  '',
  '| 表头 a | b |',
  '| ------ | -: |',
  '| ==cell== | `x` |',
  '',
  '```mermaid',
  'graph TD;',
  '```',
  '',
  '    indented code',
  '',
  '---',
  '',
  '<div class="x">block & html</div>',
  '',
  'inline <b>raw</b> html ![alt 图](https://e.com/i.png) ![data](data:image/png;base64,AAAA)',
  '',
  '===x== ==a=b== ==== == b ==',
  '',
  'emoji 👩🏽‍💻🌱 comb é中文',
  '',
  'ref[^n]',
  '',
  '[^n]: note ==text==',
].join('\r\n');

function blockTypes(blocks: ReadingBlock[]): string[] {
  return blocks.map((block) => block.type);
}

function inlinesOf(blocks: ReadingBlock[], index: number): ReadingInline[] {
  const block = blocks[index];
  if (block.type === 'paragraph' || block.type === 'heading') return block.children;
  throw new Error('not an inline container');
}

function textOf(doc: ReturnType<typeof parseReadingDocument>, nodes: ReadingInline[]): string {
  let out = '';
  for (const node of nodes) {
    if ('fragment' in node) out += doc.fragments[node.fragment].text;
    else if ('children' in node) out += textOf(doc, node.children);
  }
  return out;
}

function marksOf(nodes: ReadingInline[]): Array<Extract<ReadingInline, { type: 'mark' }>> {
  return nodes.flatMap((node) => (node.type === 'mark' ? [node] : []));
}

describe('reading document structure', () => {
  it('parses every supported block into the reading structure', () => {
    const doc = parseReadingDocument(torture);
    expect(doc.markdown).toBe(torture.replace(/\r\n/g, '\n'));
    expect(blockTypes(doc.blocks)).toEqual([
      'heading', 'heading', 'paragraph',
      'list', 'list', 'list', 'list',
      'blockquote', 'table', 'code', 'code', 'thematicBreak', 'html',
      'paragraph', 'paragraph', 'paragraph', 'paragraph',
    ]);
    const [h1, h2] = doc.blocks;
    expect(h1.type === 'heading' && h1.level).toBe(1);
    expect(h1.type === 'heading' && h1.id).toBe('标题-head-高亮');
    expect(h2.type === 'heading' && h2.level).toBe(2);
    const lists = doc.blocks.filter((block): block is Extract<ReadingBlock, { type: 'list' }> => block.type === 'list');
    expect(lists.map((list) => [list.ordered, list.start, list.tight])).toEqual([
      [false, null, true], [true, 1, true], [true, 42, true], [false, null, true],
    ]);
    expect(lists[0].items[0].children.length).toBe(2);
    expect(lists[3].items.map((item) => item.checked)).toEqual([false, true]);
    const table = doc.blocks[8];
    expect(table.type === 'table' && table.align).toEqual([null, 'right']);
    expect(table.type === 'table' && table.head.length).toBe(2);
    expect(table.type === 'table' && table.rows.length).toBe(1);
    const quote = doc.blocks[7];
    expect(quote.type === 'blockquote' && quote.children.length).toBe(1);
  });

  it('parses inline emphasis, delete, code, mark, links, images, breaks, footnotes and raw html', () => {
    const doc = parseReadingDocument(torture);
    const para = inlinesOf(doc.blocks, 2);
    expect(para.map((node) => node.type)).toEqual([
      'text', 'strong', 'text', 'emphasis', 'text', 'delete', 'text', 'code', 'text',
      'mark', 'text', 'break', 'text', 'break', 'text',
      'link', 'text', 'link', 'text', 'link', 'text', 'link',
    ]);
    const mark = marksOf(para)[0];
    expect(mark.children.map((child) => child.type)).toEqual(['text', 'emphasis']);
    expect(textOf(doc, mark.children)).toBe('mk it');
    expect(textOf(doc, [para[10]])).toBe(' & & 😀 ∉ * = soft wrap hard');
    const links = para.filter((node): node is Extract<ReadingInline, { type: 'link' }> => node.type === 'link');
    expect(links.length).toBe(4);
    const [ext, ref, auto, bare] = links;
    expect(ext.target).toEqual({ kind: 'external', href: 'https://e.com/' });
    expect(ext.title).toBe('T');
    expect(ref.target).toEqual({ kind: 'external', href: 'https://defined.example/' });
    expect(auto.href).toBe('https://auto.example');
    expect(bare.href).toBe('https://bare.example/x');
    const htmlParagraph = inlinesOf(doc.blocks, 13);
    expect(htmlParagraph.filter((node) => node.type === 'image').length).toBe(2);
    expect(htmlParagraph.filter((node) => node.type === 'html').length).toBe(2);
    expect(htmlParagraph.some((node) => node.type === 'footnoteRef')).toBe(false);
    expect(inlinesOf(doc.blocks, 16).some((node) => node.type === 'footnoteRef')).toBe(true);
    expect(textOf(doc, htmlParagraph.filter((node) => node.type === 'html'))).toBe('<b></b>');
  });

  it('keeps Foil ==highlight== parity without over-matching', () => {
    const doc = parseReadingDocument('===x== ==a=b== ==== == b == ==ok==');
    const para = inlinesOf(doc.blocks, 0);
    const marks = marksOf(para);
    expect(marks.map((mark) => textOf(doc, mark.children))).toEqual(['x', 'ok']);
    const literal = para
      .filter((node): node is Extract<ReadingInline, { type: 'text' }> => node.type === 'text')
      .map((node) => doc.fragments[node.fragment].text)
      .join('');
    expect(literal).toContain('==a=b==');
    expect(literal).toContain('====');
    expect(literal).toContain('== b ==');
  });

  it('decodes escapes and entities into per-codepoint source offsets without losing characters', () => {
    const doc = parseReadingDocument('&amp;&#38;&#x26; \\* `x`');
    expect(doc.fragments[0].text).toBe('&&& * ');
    expect(doc.fragments[0].charOffsets).toEqual([0, 5, 10, 16, 17, 19, 20]);
    expect(doc.fragments[1].text).toBe('x');
    expect(doc.fragments[1].charOffsets).toEqual([21, 22]);
    const astral = parseReadingDocument('&#x1F600;x');
    expect(astral.fragments[0].text).toBe('😀x');
    expect(astral.fragments[0].charOffsets).toEqual([0, 9, 10]);
  });

  it('maps soft line endings to a visible space with the newline source offset', () => {
    const doc = parseReadingDocument('a\nb');
    expect(doc.fragments[0].text).toBe('a b');
    expect(doc.fragments[0].charOffsets).toEqual([0, 1, 2, 3]);
  });

  it('keeps fragment invariants across the torture sample: ordered, bounded, codepoint-sized', () => {
    const doc = parseReadingDocument(torture);
    expect(doc.fragments.length).toBeGreaterThan(30);
    let previousEnd = 0;
    for (const fragment of doc.fragments) {
      expect(fragment.start).toBeLessThan(fragment.end);
      expect(fragment.start).toBeGreaterThanOrEqual(previousEnd);
      previousEnd = fragment.end;
      if (!fragment.charOffsets) continue;
      const codepoints = [...fragment.text].length;
      expect(fragment.charOffsets).toHaveLength(codepoints + 1);
      for (let i = 0; i <= codepoints; i++) {
        expect(fragment.charOffsets[i]).toBeGreaterThanOrEqual(i ? fragment.charOffsets[i - 1] : fragment.start);
        expect(fragment.charOffsets[i]).toBeLessThanOrEqual(fragment.end);
      }
    }
  });

  it('excludes syntax from fragment source ranges: cells, fences, markers, code span padding', () => {
    const doc = parseReadingDocument('| a | b |\n| - | - |\n| c | d |\n\n```js\n  code\n```\n\n` pad `');
    const cells = doc.fragments.filter((fragment) => ['a', 'b', 'c', 'd'].includes(fragment.text));
    expect(cells.length).toBe(4);
    for (const cell of cells) {
      expect(doc.markdown.slice(cell.start, cell.end)).toBe(cell.text);
    }
    const code = doc.fragments.find((fragment) => fragment.text === '  code')!;
    expect(code.charOffsets).toEqual([37, 38, 39, 40, 41, 42, 47]);
    const span = doc.fragments.find((fragment) => fragment.text === 'pad')!;
    expect(span.charOffsets).toEqual([51, 52, 53, 54]);
  });

  it('decodes indented code with dedented per-line offsets', () => {
    const doc = parseReadingDocument('para\n\n    first line\n    second\n');
    const code = doc.fragments.find((fragment) => fragment.text === 'first line\nsecond')!;
    expect(code.charOffsets).not.toBeNull();
    const newline = code.charOffsets![10];
    expect(doc.markdown[newline]).toBe('\n');
    expect(doc.markdown.slice(code.charOffsets![11], code.charOffsets![11] + 6)).toBe('second');
  });

  it('normalizes CRLF and strips ZWSP placeholders before mapping', () => {
    const doc = parseReadingDocument('a\r\nb\r\n\r\n- x\u200b');
    expect(doc.markdown).toBe('a\nb\n\n- x');
    const x = doc.fragments.find((fragment) => fragment.text === 'x')!;
    expect(doc.markdown.slice(x.start, x.end)).toBe('x');
  });

  it('generates deterministic unique heading ids, including CJK, and resolves them for internal links', () => {
    const doc = parseReadingDocument(
      '# Same\n\n# Same\n\n# 中文 标题!\n\n# ==\n\n[ok](#same-1) [cjk](#%E4%B8%AD%E6%96%87-%E6%A0%87%E9%A2%98) [bad](#nope)'
    );
    expect(doc.headings.map((heading) => heading.id)).toEqual(['same', 'same-1', '中文-标题', 'section']);
    const links = inlinesOf(doc.blocks, 4)
      .filter((node): node is Extract<ReadingInline, { type: 'link' }> => node.type === 'link');
    expect(links[0].target).toEqual({ kind: 'internal', headingId: 'same-1' });
    expect(links[1].target).toEqual({ kind: 'internal', headingId: '中文-标题' });
    expect(links[2].target.kind).toBe('inert');
  });

  it('collects footnote definitions for a trailing section and keeps markers atomic', () => {
    const doc = parseReadingDocument('ref[^n]\n\n[^n]: note text');
    expect(doc.footnotes).toHaveLength(1);
    const marker = doc.fragments[doc.footnotes[0].marker];
    expect(marker.text).toBe('[^n]:');
    expect(marker.charOffsets).toBeNull();
    expect(doc.fragments.some((fragment) => fragment.text === 'note text')).toBe(true);
  });

  it('renders images and unknown targets as readable text, never as resources', () => {
    const doc = parseReadingDocument('![alt 图](https://e.com/i.png)');
    const image = inlinesOf(doc.blocks, 0)[0];
    expect(image.type).toBe('image');
    const fragment = doc.fragments[image.type === 'image' ? image.fragment : -1];
    expect(fragment.text).toBe('alt 图 (image: https://e.com/i.png)');
    expect(fragment.charOffsets).toBeNull();
  });

  it('keeps raw html as text fragments with identity offsets', () => {
    const doc = parseReadingDocument('<div class="x">&amp;</div>');
    const html = doc.blocks[0];
    expect(html.type).toBe('html');
    const fragment = doc.fragments[html.type === 'html' ? html.fragment : -1];
    expect(fragment.text).toBe('<div class="x">&amp;</div>');
    expect(doc.markdown.slice(fragment.start, fragment.end)).toBe(fragment.text);
    expect(fragment.charOffsets![0]).toBe(fragment.start);
  });

  it('never touches the network while parsing', () => {
    const fetchMock = vi.fn(() => {
      throw new Error('network access during parse');
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('XMLHttpRequest', class {
      constructor() {
        throw new Error('network access during parse');
      }
    });
    try {
      parseReadingDocument(torture);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('classifyLinkHref', () => {
  const none = new Set<string>();
  it.each([
    ['https://x.com/a?b#c', { kind: 'external', href: 'https://x.com/a?b#c' }],
    ['http://x.com', { kind: 'external', href: 'http://x.com/' }],
    ['HTTPS://X.com', { kind: 'external', href: 'https://x.com/' }],
    ['mailto:a@b.c', { kind: 'mailto', href: 'mailto:a@b.c' }],
  ])('allows %s', (href, target) => {
    expect(classifyLinkHref(href, none)).toEqual(target);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'jav\nascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'vbscript:x',
    'about:blank',
    'blob:https://x/y',
    'foo/bar.html',
    './relative',
    '//protocol-relative.com',
    '/absolute-path',
    '',
  ])('rejects %s as inert', (href) => {
    expect(classifyLinkHref(href, none).kind).toBe('inert');
  });

  it('resolves in-document targets only against known heading ids', () => {
    expect(classifyLinkHref('#sec', new Set(['sec']))).toEqual({ kind: 'internal', headingId: 'sec' });
    expect(classifyLinkHref('#%E4%B8%AD', new Set(['中']))).toEqual({ kind: 'internal', headingId: '中' });
    expect(classifyLinkHref('#sec', none).kind).toBe('inert');
    expect(classifyLinkHref('#', none).kind).toBe('inert');
    expect(classifyLinkHref('#%', none).kind).toBe('inert');
  });
});
