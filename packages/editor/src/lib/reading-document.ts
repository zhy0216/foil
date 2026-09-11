/* Semantic reading document: parses normalized Markdown into a render-ready
   structure in which every visible text fragment records UTF-16 source
   offsets (offsets per displayed codepoint, plus a terminal end offset).
   Raw HTML is kept as text, never as markup. Independent of the line-based
   editor: only the pure normalizeMarkdown string helper is shared. */

import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { normalizeMarkdown } from './editor-dom';

/** One run of visible text. charOffsets[i] is the source offset of displayed
 *  codepoint i and charOffsets[codepointCount] === end; null means the run is
 *  atomic (highlighted all-or-nothing) because per-character decoding could
 *  not be verified against the parser's own text. */
export interface ReadingFragment {
  text: string;
  start: number;
  end: number;
  charOffsets: number[] | null;
}

/** Resolved navigation for a reading link. Only external/mailto/internal
 *  targets may navigate; everything else stays inert visible text. */
export type ReadingLinkTarget =
  | { kind: 'external'; href: string }
  | { kind: 'mailto'; href: string }
  | { kind: 'internal'; headingId: string }
  | { kind: 'inert'; href: string };

export type ReadingInline =
  | { type: 'text'; fragment: number }
  | { type: 'emphasis'; children: ReadingInline[] }
  | { type: 'strong'; children: ReadingInline[] }
  | { type: 'delete'; children: ReadingInline[] }
  | { type: 'mark'; children: ReadingInline[] }
  | { type: 'code'; fragment: number }
  | { type: 'html'; fragment: number }
  | { type: 'break' }
  | { type: 'link'; href: string; title: string | null; target: ReadingLinkTarget; children: ReadingInline[] }
  | { type: 'image'; fragment: number }
  | { type: 'footnoteRef'; fragment: number };

export interface ReadingListItem {
  checked: boolean | null;
  children: ReadingBlock[];
}

export type ReadingBlock =
  | { type: 'heading'; level: number; id: string; children: ReadingInline[] }
  | { type: 'paragraph'; children: ReadingInline[] }
  | { type: 'blockquote'; children: ReadingBlock[] }
  | { type: 'list'; ordered: boolean; start: number | null; tight: boolean; items: ReadingListItem[] }
  | { type: 'code'; fragment: number }
  | { type: 'html'; fragment: number }
  | { type: 'thematicBreak' }
  | {
      type: 'table';
      align: Array<'left' | 'right' | 'center' | null>;
      head: ReadingInline[][];
      rows: ReadingInline[][][];
    };

export interface ReadingHeading {
  id: string;
  level: number;
  text: string;
}

/** Marker fragment (`[^label]:`) plus the definition's blocks, rendered last. */
export interface ReadingFootnote {
  marker: number;
  blocks: ReadingBlock[];
}

export interface ReadingDocument {
  /** Normalized source every fragment offset refers to. */
  markdown: string;
  blocks: ReadingBlock[];
  /** Visible text runs in source order; disjoint, sorted by start. */
  fragments: ReadingFragment[];
  headings: ReadingHeading[];
  footnotes: ReadingFootnote[];
}

interface MdPoint { offset: number }
interface MdNode {
  type: string;
  position?: { start: MdPoint; end: MdPoint };
  children?: MdNode[];
  value?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  lang?: string | null;
  depth?: number;
  ordered?: boolean;
  start?: number | null;
  spread?: boolean;
  checked?: boolean | null;
  label?: string;
  identifier?: string;
  align?: Array<'left' | 'right' | 'center' | null>;
}

/* ---------- ==mark== syntax (Foil highlight), modeled on GFM strikethrough ---------- */

interface MarkPoint { line: number; column: number; offset: number }
interface MarkToken { type: string; start: MarkPoint; end: MarkPoint; _open?: boolean; _close?: boolean }
type MarkEvent = ['enter' | 'exit', MarkToken, unknown];
interface MarkEffects {
  enter(type: string): MarkToken;
  exit(type: string): MarkToken;
  consume(code: number | null): void;
}
type MarkState = (code: number | null) => MarkState | void;
interface MarkContext {
  sliceSerialize(range: { start: MarkPoint; end: MarkPoint }): string;
  parser: { constructs: { insideSpan: { null?: Array<{ resolveAll?: MarkResolver }> } } };
}
type MarkResolver = (events: MarkEvent[], context: MarkContext) => MarkEvent[];

const PUNCTUATION =
  /[!-/:-@[-`{-~\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u09FD\u0A76\u0AF0\u0C77\u0C84\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4F\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]/;

function classifyCharacter(code: number | null | undefined): 0 | 1 | 2 {
  if (code === null || code === undefined || code < 0 || code === 32 || code === 9) return 1;
  return PUNCTUATION.test(String.fromCodePoint(code)) ? 2 : 0;
}

function resolveAllConstructs(
  constructs: Array<{ resolveAll?: MarkResolver }>,
  events: MarkEvent[],
  context: MarkContext
): MarkEvent[] {
  const called: MarkResolver[] = [];
  for (const construct of constructs) {
    const resolve = construct?.resolveAll;
    if (resolve && !called.includes(resolve)) {
      events = resolve(events, context);
      called.push(resolve);
    }
  }
  return events;
}

function tokenizeMark(
  this: { previous: number | null }, effects: MarkEffects, ok: MarkState, nok: MarkState
): MarkState {
  const previous = this.previous;
  let size = 0;
  return start;
  function start(code: number | null): MarkState | void {
    effects.enter('markSequenceTemporary');
    return more(code);
  }
  function more(code: number | null): MarkState | void {
    if (code === 61 /* = */) {
      if (size > 1) return nok(code);
      effects.consume(code);
      size++;
      return more;
    }
    if (size < 2) return nok(code);
    const token = effects.exit('markSequenceTemporary');
    const before = classifyCharacter(previous);
    const after = classifyCharacter(code);
    token._open = !after || (after === 2 && Boolean(before));
    token._close = !before || (before === 2 && Boolean(after));
    return ok(code);
  }
}

function resolveAllMark(events: MarkEvent[], context: MarkContext): MarkEvent[] {
  let index = -1;
  while (++index < events.length) {
    const closer = events[index][1];
    if (events[index][0] !== 'enter' || closer.type !== 'markSequenceTemporary' || !closer._close) continue;
    let open = index;
    while (open--) {
      const opener = events[open][1];
      if (events[open][0] !== 'exit' || opener.type !== 'markSequenceTemporary' || !opener._open) continue;
      // Foil parity with its `(==)([^=\n]+)(==)` decoration: the highlighted
      // run is non-empty and contains neither `=` nor a line ending.
      const between = context.sliceSerialize({ start: opener.end, end: closer.start });
      if (between === '' || between.includes('=') || between.includes('\n')) break;
      closer.type = 'markSequence';
      opener.type = 'markSequence';
      const mark: MarkToken = { type: 'mark', start: { ...opener.start }, end: { ...closer.end } };
      const markText: MarkToken = { type: 'markText', start: { ...opener.end }, end: { ...closer.start } };
      const nextEvents: MarkEvent[] = [
        ['enter', mark, context],
        ['enter', opener, context],
        ['exit', opener, context],
        ['enter', markText, context],
      ];
      const insideSpan = context.parser.constructs.insideSpan.null;
      if (insideSpan) {
        nextEvents.push(...resolveAllConstructs(insideSpan, events.slice(open + 1, index), context));
      }
      nextEvents.push(
        ['exit', markText, context],
        ['enter', closer, context],
        ['exit', closer, context],
        ['exit', mark, context]
      );
      events.splice(open - 1, index - open + 3, ...nextEvents);
      index = open + nextEvents.length - 2;
      break;
    }
  }
  index = -1;
  while (++index < events.length) {
    if (events[index][1].type === 'markSequenceTemporary') events[index][1].type = 'data';
  }
  return events;
}

const markTokenizer = { name: 'mark', tokenize: tokenizeMark, resolveAll: resolveAllMark };
const markSyntax = {
  text: { 61: markTokenizer },
  insideSpan: { null: [markTokenizer] },
  attentionMarkers: { null: [61] },
};

interface MarkCompileContext {
  enter(node: { type: string; children: unknown[] }, token: unknown): void;
  exit(token: unknown): void;
}
const markFromMarkdown = {
  canContainEols: ['mark'],
  enter: {
    mark(this: MarkCompileContext, token: unknown) {
      this.enter({ type: 'mark', children: [] }, token);
    },
  },
  exit: {
    mark(this: MarkCompileContext, token: unknown) {
      this.exit(token);
    },
  },
};

/* ---------- link classification ---------- */

export function classifyLinkHref(rawHref: string, headingIds: ReadonlySet<string>): ReadingLinkTarget {
  if (rawHref.startsWith('#')) {
    const raw = rawHref.slice(1);
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch {
      /* keep the raw fragment */
    }
    return id && headingIds.has(id) ? { kind: 'internal', headingId: id } : { kind: 'inert', href: rawHref };
  }
  let url: URL;
  try {
    // WHATWG URL strips tabs/newlines and lowercases the scheme, so obfuscated
    // javascript:/data:/file: inputs are recognized and rejected here.
    url = new URL(rawHref);
  } catch {
    return { kind: 'inert', href: rawHref };
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return { kind: 'external', href: url.href };
  if (url.protocol === 'mailto:') return { kind: 'mailto', href: url.href };
  return { kind: 'inert', href: rawHref };
}

/* ---------- per-codepoint source offset decoders ---------- */

const MAX_VISIBLE_TARGET = 100;

function asciiPunctuation(code: number): boolean {
  return (code >= 0x21 && code <= 0x2f) || (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) || (code >= 0x7b && code <= 0x7e);
}

function decodeNumericReference(value: string, base: number): string {
  const code = Number.parseInt(value, base);
  // Mirrors micromark-util-decode-numeric-character-reference exactly so the
  // cross-check below cannot disagree with the parser on numeric entities.
  if (
    code < 9 || code === 11 || (code > 13 && code < 32) ||
    (code > 126 && code < 160) ||
    (code > 55295 && code < 57344) ||
    (code > 64975 && code < 65008) || (code & 65535) === 65535 || (code & 65535) === 65534 ||
    code > 1114111
  ) {
    return '\uFFFD';
  }
  return String.fromCodePoint(code);
}

function readCharacterReference(md: string, start: number, end: number): { text: string; end: number } | null {
  let i = start + 1;
  if (i >= end) return null;
  if (md[i] === '#') {
    i++;
    let base = 10;
    if (i < end && (md[i] === 'x' || md[i] === 'X')) {
      base = 16;
      i++;
    }
    const digits = i;
    const max = base === 16 ? 6 : 7;
    while (i < end && i - digits < max) {
      const c = md.charCodeAt(i);
      const valid = base === 16
        ? (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
        : c >= 48 && c <= 57;
      if (!valid) break;
      i++;
    }
    if (i === digits || i >= end || md[i] !== ';') return null;
    return { text: decodeNumericReference(md.slice(digits, i), base), end: i + 1 };
  }
  const name = i;
  while (i < end && i - name < 31) {
    const c = md.charCodeAt(i);
    const alnum = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    if (!alnum) break;
    i++;
  }
  if (i === name || i >= end || md[i] !== ';') return null;
  const decoded = decodeNamedCharacterReference(md.slice(name, i));
  return decoded ? { text: decoded, end: i + 1 } : null;
}

/** Text nodes: escapes, character references and soft line endings decoded
 *  per codepoint; returns null when the decode disagrees with the parser. */
function decodeTextOffsets(md: string, start: number, end: number, display: string): number[] | null {
  const offsets: number[] = [];
  let text = '';
  let i = start;
  while (i < end) {
    const c = md[i];
    if (c === '\\' && i + 1 < end && asciiPunctuation(md.charCodeAt(i + 1))) {
      text += md[i + 1];
      offsets.push(i);
      i += 2;
    } else if (c === '&') {
      const reference = readCharacterReference(md, i, end);
      if (reference) {
        for (const ch of reference.text) {
          text += ch;
          offsets.push(i);
        }
        i = reference.end;
      } else {
        text += '&';
        offsets.push(i);
        i += 1;
      }
    } else if (c === '\n') {
      text += ' ';
      offsets.push(i);
      i += 1;
    } else {
      const ch = String.fromCodePoint(md.codePointAt(i)!);
      text += ch;
      offsets.push(i);
      i += ch.length;
    }
  }
  offsets.push(end);
  return text === display ? offsets : null;
}

/** Code spans: backtick fences, one-space edge stripping and line endings
 *  turned into spaces, all per codepoint. */
function decodeCodeSpanOffsets(md: string, start: number, end: number, value: string): number[] | null {
  let fence = 0;
  while (start + fence < end && md[start + fence] === '`') fence++;
  let contentStart = start + fence;
  let contentEnd = end - fence;
  if (contentStart < contentEnd && md[contentStart] === ' ' && md[contentEnd - 1] === ' ' &&
      !/^ +$/.test(md.slice(contentStart, contentEnd))) {
    contentStart++;
    contentEnd--;
  }
  const offsets: number[] = [];
  let text = '';
  let i = contentStart;
  while (i < contentEnd) {
    const c = md[i];
    if (c === '\n') {
      text += ' ';
      offsets.push(i);
      i += 1;
    } else {
      const ch = String.fromCodePoint(md.codePointAt(i)!);
      text += ch;
      offsets.push(i);
      i += ch.length;
    }
  }
  offsets.push(contentEnd);
  return text === value ? offsets : null;
}

/** Fenced/indented code: match dedented source lines against the parser's
 *  value lines in order; anything unexpected degrades to an atomic fragment. */
function decodeCodeBlockOffsets(
  md: string, start: number, end: number, value: string,
  skipFirstLine: boolean, indent: number
): number[] | null {
  const valueLines = value.split('\n');
  const source = md.slice(start, end).split('\n');
  let pos = start;
  if (skipFirstLine) {
    pos += (source.shift()?.length ?? 0) + 1;
    const last = source[source.length - 1] ?? '';
    if (/^ {0,3}(?:`{3,}|~{3,})[ \t]*$/.test(last)) source.pop();
  }
  const offsets: number[] = [];
  let text = '';
  let v = 0;
  for (const line of source) {
    if (v >= valueLines.length) break;
    let skip = 0;
    while (skip < indent && line[skip] === ' ') skip++;
    const content = line.slice(skip);
    if (content === valueLines[v]) {
      if (v > 0) {
        text += '\n';
        offsets.push(pos - 1);
      }
      let offset = pos + skip;
      for (const ch of content) {
        text += ch;
        offsets.push(offset);
        offset += ch.length;
      }
      v++;
    }
    pos += line.length + 1;
  }
  offsets.push(end);
  return v === valueLines.length && text === value ? offsets : null;
}

function identityOffsets(text: string, start: number, end: number): number[] | null {
  const offsets: number[] = [];
  let offset = start;
  for (const ch of text) {
    offsets.push(offset);
    offset += ch.length;
  }
  offsets.push(end);
  return offset === end ? offsets : null;
}

export function truncateTarget(target: string): string {
  return target.length > MAX_VISIBLE_TARGET ? target.slice(0, MAX_VISIBLE_TARGET) + '\u2026' : target;
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return slug || 'section';
}

class Builder {
  readonly fragments: ReadingFragment[] = [];
  readonly headings: ReadingHeading[] = [];
  readonly footnotes: ReadingFootnote[] = [];
  private readonly usedIds = new Set<string>();
  private readonly definitions = new Map<string, { url: string; title: string | null }>();

  constructor(private readonly md: string) {}

  collectDefinitions(nodes: MdNode[]): void {
    for (const node of nodes) {
      if (node.type === 'definition' && node.identifier) {
        this.definitions.set(node.identifier, { url: node.url ?? '', title: node.title ?? null });
      }
      if (node.children) this.collectDefinitions(node.children);
    }
  }

  addFragment(text: string, start: number, end: number, charOffsets: number[] | null): number {
    this.fragments.push({ text, start, end, charOffsets });
    return this.fragments.length - 1;
  }

  private pos(node: MdNode): { start: number; end: number } {
    return node.position
      ? { start: node.position.start.offset, end: node.position.end.offset }
      : { start: 0, end: 0 };
  }

  private textFragment(node: MdNode): number {
    const display = (node.value ?? '').replace(/\n/g, ' ');
    const { start, end } = this.pos(node);
    const offsets = start < end ? decodeTextOffsets(this.md, start, end, display) : null;
    return this.addFragment(display, start, end, offsets);
  }

  // ponytail: atomic all-or-nothing highlight unit (images, footnote
  // markers); per-codepoint mapping only if anchors inside alt text matter.
  private atomicFragment(text: string, node: MdNode): number {
    const { start, end } = this.pos(node);
    return this.addFragment(text, start, end, null);
  }

  private rawFragment(node: MdNode): number {
    const value = node.value ?? '';
    const { start, end } = this.pos(node);
    const offsets = this.md.slice(start, end) === value ? identityOffsets(value, start, end) : null;
    return this.addFragment(value, start, end, offsets);
  }

  private headingId(text: string): string {
    const base = slugify(text);
    let id = base;
    for (let n = 1; this.usedIds.has(id); n++) id = `${base}-${n}`;
    this.usedIds.add(id);
    return id;
  }

  inlineText(nodes: ReadingInline[]): string {
    let out = '';
    for (const node of nodes) {
      if ('fragment' in node) out += this.fragments[node.fragment]?.text ?? '';
      else if ('children' in node) out += this.inlineText(node.children);
    }
    return out;
  }

  convertBlocks(nodes: MdNode[]): ReadingBlock[] {
    const blocks: ReadingBlock[] = [];
    for (const node of nodes) {
      const block = this.convertBlock(node);
      if (block) blocks.push(block);
    }
    return blocks;
  }

  private convertBlock(node: MdNode): ReadingBlock | null {
    switch (node.type) {
      case 'heading': {
        const children = this.convertInlines(node.children ?? []);
        const text = this.inlineText(children);
        const id = this.headingId(text);
        this.headings.push({ id, level: node.depth ?? 1, text });
        return { type: 'heading', level: node.depth ?? 1, id, children };
      }
      case 'paragraph':
        return { type: 'paragraph', children: this.convertInlines(node.children ?? []) };
      case 'blockquote':
        return { type: 'blockquote', children: this.convertBlocks(node.children ?? []) };
      case 'list':
        return {
          type: 'list',
          ordered: Boolean(node.ordered),
          start: node.ordered ? node.start ?? 1 : null,
          tight: !node.spread,
          items: (node.children ?? []).map((item) => ({
            checked: item.checked ?? null,
            children: this.convertBlocks(item.children ?? []),
          })),
        };
      case 'code': {
        const value = node.value ?? '';
        const { start, end } = this.pos(node);
        const newline = this.md.indexOf('\n', start);
        const firstLine = this.md.slice(start, newline < 0 || newline > end ? end : newline);
        const fence = firstLine.match(/^(\s*)(`{3,}|~{3,})/);
        const offsets = start < end
          ? decodeCodeBlockOffsets(this.md, start, end, value, Boolean(fence), fence ? fence[1].length : 4)
          : null;
        return { type: 'code', fragment: this.addFragment(value, start, end, offsets) };
      }
      case 'html':
        return { type: 'html', fragment: this.rawFragment(node) };
      case 'thematicBreak':
        return { type: 'thematicBreak' };
      case 'table': {
        const rows = (node.children ?? []).map((row) =>
          (row.children ?? []).map((cell) => this.convertInlines(cell.children ?? [])));
        return {
          type: 'table',
          align: node.align ?? [],
          head: rows[0] ?? [],
          rows: rows.slice(1),
        };
      }
      case 'definition':
        return null;
      case 'footnoteDefinition': {
        const { start } = this.pos(node);
        const markerEnd = this.md.indexOf(']:', start);
        const marker = markerEnd >= 0
          ? this.md.slice(start, markerEnd + 2)
          : `[${node.label ?? node.identifier ?? ''}]:`;
        this.footnotes.push({
          marker: this.addFragment(marker, start, start + marker.length, null),
          blocks: this.convertBlocks(node.children ?? []),
        });
        return null;
      }
      default:
        // Readable fallback for unknown block types: never drop content.
        if (node.value != null) return { type: 'paragraph', children: [{ type: 'text', fragment: this.rawFragment(node) }] };
        if (node.children) return { type: 'paragraph', children: this.convertInlines(node.children) };
        return null;
    }
  }

  convertInlines(nodes: MdNode[]): ReadingInline[] {
    const out: ReadingInline[] = [];
    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          out.push({ type: 'text', fragment: this.textFragment(node) });
          break;
        case 'inlineCode': {
          const value = node.value ?? '';
          const { start, end } = this.pos(node);
          const offsets = start < end ? decodeCodeSpanOffsets(this.md, start, end, value) : null;
          out.push({ type: 'code', fragment: this.addFragment(value, start, end, offsets) });
          break;
        }
        case 'emphasis':
          out.push({ type: 'emphasis', children: this.convertInlines(node.children ?? []) });
          break;
        case 'strong':
          out.push({ type: 'strong', children: this.convertInlines(node.children ?? []) });
          break;
        case 'delete':
          out.push({ type: 'delete', children: this.convertInlines(node.children ?? []) });
          break;
        case 'mark':
          out.push({ type: 'mark', children: this.convertInlines(node.children ?? []) });
          break;
        case 'break':
          out.push({ type: 'break' });
          break;
        case 'link':
        case 'linkReference': {
          const definition = node.type === 'linkReference' ? this.definitions.get(node.identifier ?? '') : null;
          const href = node.type === 'linkReference' ? definition?.url ?? '' : node.url ?? '';
          const title = node.type === 'linkReference' ? definition?.title ?? null : node.title ?? null;
          out.push({ type: 'link', href, title, target: { kind: 'inert', href }, children: this.convertInlines(node.children ?? []) });
          break;
        }
        case 'image':
        case 'imageReference': {
          const definition = node.type === 'imageReference' ? this.definitions.get(node.identifier ?? '') : null;
          const url = node.type === 'imageReference' ? definition?.url ?? '' : node.url ?? '';
          const alt = node.alt ?? '';
          const target = truncateTarget(url);
          out.push({
            type: 'image',
            fragment: this.atomicFragment(alt ? `${alt} (image: ${target})` : `(image: ${target})`, node),
          });
          break;
        }
        case 'html':
          out.push({ type: 'html', fragment: this.rawFragment(node) });
          break;
        case 'footnoteReference': {
          const label = node.label ?? node.identifier ?? '';
          out.push({ type: 'footnoteRef', fragment: this.atomicFragment(`[${label}]`, node) });
          break;
        }
        default:
          // Readable fallback for unknown inline types: never drop content.
          if (node.value != null) out.push({ type: 'text', fragment: this.rawFragment(node) });
          else if (node.children) out.push(...this.convertInlines(node.children));
      }
    }
    return out;
  }

  finalizeLinks(blocks: ReadingBlock[]): void {
    const ids = new Set(this.headings.map((heading) => heading.id));
    const visitInlines = (nodes: ReadingInline[]): void => {
      for (const node of nodes) {
        if (node.type === 'link') node.target = classifyLinkHref(node.href, ids);
        else if ('children' in node) visitInlines(node.children);
      }
    };
    const visitBlocks = (list: ReadingBlock[]): void => {
      for (const block of list) {
        switch (block.type) {
          case 'heading':
          case 'paragraph':
            visitInlines(block.children);
            break;
          case 'blockquote':
            visitBlocks(block.children);
            break;
          case 'list':
            for (const item of block.items) visitBlocks(item.children);
            break;
          case 'table':
            for (const cell of block.head) visitInlines(cell);
            for (const row of block.rows) for (const cell of row) visitInlines(cell);
            break;
        }
      }
    };
    visitBlocks(blocks);
    for (const footnote of this.footnotes) visitBlocks(footnote.blocks);
  }
}

export function parseReadingDocument(markdown: string): ReadingDocument {
  const md = normalizeMarkdown(markdown);
  const tree = fromMarkdown(md, {
    extensions: [gfm(), markSyntax as unknown as ReturnType<typeof gfm>],
    mdastExtensions: [gfmFromMarkdown(), markFromMarkdown as unknown as ReturnType<typeof gfmFromMarkdown>[number]],
  }) as unknown as MdNode;
  const builder = new Builder(md);
  builder.collectDefinitions(tree.children ?? []);
  const blocks = builder.convertBlocks(tree.children ?? []);
  builder.finalizeLinks(blocks);
  return {
    markdown: md,
    blocks,
    fragments: builder.fragments,
    headings: builder.headings,
    footnotes: builder.footnotes,
  };
}
