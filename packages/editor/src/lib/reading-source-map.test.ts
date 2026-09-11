import { describe, expect, it } from 'vitest';
import { parseReadingDocument } from './reading-document';
import { locateComments, planFragmentPieces, type CommentAnchorRef, type FragmentRange } from './reading-source-map';

function thread(id: string, quote: string, before = '', after = ''): CommentAnchorRef {
  return { id, quote, before, after };
}

function locate(markdown: string, threads: CommentAnchorRef[]) {
  const doc = parseReadingDocument(markdown);
  const locations = locateComments(doc, threads);
  const visible = (id: string) =>
    (locations.located.get(id) ?? []).map((piece) => {
      const fragment = doc.fragments[piece.fragment];
      if (!fragment.charOffsets) return fragment.text;
      const offsets = fragment.charOffsets;
      const codepoints = [...fragment.text];
      let text = '';
      for (let i = 0; i < codepoints.length; i++) {
        if (offsets[i] < piece.end && offsets[i + 1] > piece.start) text += codepoints[i];
      }
      return text;
    });
  return { doc, locations, visible };
}

function ranges(id: string, pieces: Array<{ start: number; end: number }>): FragmentRange[] {
  return pieces.map((piece) => ({ id, ...piece }));
}

describe('locateComments', () => {
  it('locates a quote whose syntax markers are folded away', () => {
    const md = 'a **bold** c';
    const { locations, visible } = locate(md, [thread('t', 'bold')]);
    expect(locations.located.get('t')).toEqual([{ fragment: 1, start: md.indexOf('bold'), end: md.indexOf('bold') + 4 }]);
    expect(visible('t')).toEqual(['bold']);
  });

  it('maps escapes without losing characters', () => {
    const md = 'x \\*star\\* y';
    const { locations, visible } = locate(md, [thread('t', '\\*star\\*')]);
    expect(locations.located.get('t')).toHaveLength(1);
    expect(visible('t')).toEqual(['*star*']);
  });

  it('snaps entity quotes to whole decoded codepoints', () => {
    const md = '&amp; &lt; x';
    const { locations, visible } = locate(md, [thread('t', '&am')]);
    expect(locations.located.get('t')).toHaveLength(1);
    expect(visible('t')).toEqual(['&']);
    const { visible: v2 } = locate(md, [thread('u', 'lt;')]);
    expect(v2('u')).toEqual(['<']);
  });

  it('maps soft line endings onto the visible space', () => {
    const md = 'a\nb\nc';
    const { locations, visible } = locate(md, [thread('t', 'a\nb')]);
    expect(locations.located.get('t')).toHaveLength(1);
    expect(visible('t')).toEqual(['a b']);
  });

  it('splits quotes across hard breaks into visible pieces', () => {
    const md = 'a\\\nb';
    const { locations, visible } = locate(md, [thread('t', 'a\\\nb')]);
    expect(locations.located.get('t')).toHaveLength(2);
    expect(visible('t')).toEqual(['a', 'b']);
  });

  it('crosses table cell boundaries, skipping delimiter rows and pipes', () => {
    const md = '| a | b |\n| - | - |\n| c | d |';
    const quote = md.slice(md.indexOf('b'), md.indexOf('c') + 1);
    const { locations, visible } = locate(md, [thread('t', quote)]);
    expect(locations.located.get('t')).toHaveLength(2);
    expect(visible('t')).toEqual(['b', 'c']);
  });

  it('maps cross-block quotes to multiple pieces', () => {
    const md = 'one **two**\n\nthree ==four==';
    const quote = md.slice(md.indexOf('two'), md.indexOf('three') + 5);
    const { locations, visible } = locate(md, [thread('t', quote)]);
    expect(locations.located.get('t')).toHaveLength(2);
    expect(visible('t')).toEqual(['two', 'three']);
  });

  it('locates quotes inside code spans and fenced code per codepoint', () => {
    const span = 'use `let x = 1` here';
    const spanResult = locate(span, [thread('t', 'x = 1')]);
    const fragment = spanResult.doc.fragments[1];
    const pieces = planFragmentPieces(fragment, ranges('t', spanResult.locations.located.get('t')!));
    expect(pieces).toEqual([
      { text: 'let ', anchors: [] },
      { text: 'x = 1', anchors: ['t'] },
    ]);
    const fenced = '```js\nlet y = 2;\n```';
    const { locations, visible } = locate(fenced, [thread('t', 'y = 2')]);
    expect(locations.located.get('t')).toHaveLength(1);
    expect(visible('t')).toEqual(['y = 2']);
  });

  it('locates quotes in raw html, which stays visible text', () => {
    const { locations, visible } = locate('<span>raw</span> x', [thread('t', 'span')]);
    expect(locations.located.get('t')).toHaveLength(1);
    expect(visible('t')).toEqual(['span']);
  });

  it('locates the visible part of a quote that includes list markers', () => {
    const { visible } = locate('- item', [thread('marker', '- item')]);
    expect(visible('marker')).toEqual(['item']);
  });

  it('locates image alt quotes as the whole readable placeholder', () => {
    const md = '![diagram](https://e.com/i.png)';
    const { locations, visible } = locate(md, [thread('t', 'diagram')]);
    expect(locations.located.get('t')).toHaveLength(1);
    expect(visible('t')).toEqual(['diagram (image: https://e.com/i.png)']);
  });

  it('never cuts surrogate pairs or combining sequences in half', () => {
    const md = '👩🏽‍💻 tail';
    const { visible } = locate(md, [thread('t', md.slice(0, 1))]);
    const pieces = visible('t');
    expect(pieces).toEqual(['👩']);
    const combining = 'e\u0301x';
    const { visible: cv } = locate(combining, [thread('t', combining.slice(0, 2))]);
    expect(cv('t')).toEqual(['e\u0301']);
  });

  it('uses before/after context to pick the right occurrence', () => {
    const md = 'dup\ndup word\ndup';
    const { locations } = locate(md, [thread('t', 'dup', '\n', ' word')]);
    const pieces = locations.located.get('t')!;
    expect(pieces).toHaveLength(1);
    expect(md.slice(pieces[0].start, pieces[0].end)).toBe('dup');
    expect(pieces[0].start).toBe(4);
  });

  it('falls back to unlocated for syntax-only, invisible and missing targets', () => {
    const cases: Array<[string, CommentAnchorRef]> = [
      ['**bold**', thread('syntax', '**')],
      ['```mermaid\ngraph;\n```', thread('fenceinfo', 'mermaid')],
      ['[text](https://x.com "title")', thread('dest', 'https://x.com')],
      ['[text](https://x.com "title")', thread('title', 'title')],
      ['[a][d]\n\n[d]: https://x.com', thread('def', 'https://x.com')],
      ['plain', thread('missing', 'absent')],
      ['plain', thread('empty', '')],
    ];
    for (const [md, anchor] of cases) {
      const { locations } = locate(md, [anchor]);
      expect(locations.located.has(anchor.id), `${md} / ${anchor.quote}`).toBe(false);
      expect(locations.unlocated).toContain(anchor.id);
    }
  });

  it('reports unlocated ids for hosts to keep reachable', () => {
    const { locations } = locate('one two', [thread('a', 'one'), thread('b', 'zzz'), thread('c', '**')]);
    expect(locations.unlocated).toEqual(['b', 'c']);
    expect([...locations.located.keys()]).toEqual(['a']);
  });
});

describe('planFragmentPieces', () => {
  it('returns one plain piece without ranges', () => {
    const doc = parseReadingDocument('hello world');
    expect(planFragmentPieces(doc.fragments[0], [])).toEqual([{ text: 'hello world', anchors: [] }]);
  });

  it('splits overlapping comments into nested coverage runs', () => {
    const doc = parseReadingDocument('hello world');
    const pieces = planFragmentPieces(doc.fragments[0], [
      { id: 'outer', start: 0, end: 11 },
      { id: 'inner', start: 3, end: 8 },
    ]);
    expect(pieces).toEqual([
      { text: 'hel', anchors: ['outer'] },
      { text: 'lo wo', anchors: ['outer', 'inner'] },
      { text: 'rld', anchors: ['outer'] },
    ]);
  });

  it('clips ranges to fragment bounds and keeps plain edges', () => {
    const doc = parseReadingDocument('alpha beta');
    const pieces = planFragmentPieces(doc.fragments[0], [{ id: 't', start: 2, end: 7 }]);
    expect(pieces).toEqual([
      { text: 'al', anchors: [] },
      { text: 'pha b', anchors: ['t'] },
      { text: 'eta', anchors: [] },
    ]);
  });

  it('ignores ranges that do not intersect the fragment', () => {
    const doc = parseReadingDocument('alpha');
    expect(planFragmentPieces(doc.fragments[0], [{ id: 't', start: 40, end: 44 }])).toEqual([
      { text: 'alpha', anchors: [] },
    ]);
  });

  it('highlights atomic fragments all-or-nothing', () => {
    const doc = parseReadingDocument('![alt](https://e.com/i.png)');
    const fragment = doc.fragments[0];
    expect(fragment.charOffsets).toBeNull();
    expect(planFragmentPieces(fragment, [{ id: 't', start: 2, end: 5 }])).toEqual([
      { text: 'alt (image: https://e.com/i.png)', anchors: ['t'] },
    ]);
  });
});
