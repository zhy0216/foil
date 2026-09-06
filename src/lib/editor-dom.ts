/* Markdown offsets count UTF-16 code units, including syntax and line breaks.
   CRLF/lone CR normalize to LF; every U+200B is reserved as a caret placeholder
   and is removed (literal user-authored ZWSP is not representable in this editor).
   Native blocks delimit lines; a terminal BR is browser caret padding, while
   interior BRs are line breaks. Thus <div><br></div> is one empty line and
   <div>text<br><br></div> ends in one real newline. */

export function normalizeMarkdown(md: string): string {
  return md.replace(/\r\n?/g, '\n').replace(/\u200b/g, '');
}

export interface MarkdownSelection {
  anchor: number;
  focus: number;
}

interface DOMPoint {
  node: Node;
  offset: number;
}

interface MarkdownDOM {
  markdown: string;
  boundaries: Map<Node, number[]>;
}

function isBlock(node: Node): boolean {
  return node instanceof Element &&
    (node.classList.contains('ln') || /^(DIV|P|LI|BLOCKQUOTE|PRE|H[1-6])$/.test(node.tagName));
}

// One traversal supplies the text and both endpoints, without touching Selection.
function readDOM(root: HTMLElement): MarkdownDOM {
  let markdown = '';
  let afterCR = false;
  const boundaries = new Map<Node, number[]>();

  function visit(node: Node, paddingBR: Node | null): void {
    const offsets = [markdown.length];
    boundaries.set(node, offsets);
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char !== '\u200b' && !(char === '\n' && afterCR)) {
          markdown += char === '\r' ? '\n' : char;
        }
        afterCR = char === '\r';
        offsets.push(markdown.length);
      }
      return;
    }
    if (node instanceof Element && node.tagName === 'BR') {
      if (node !== paddingBR) markdown += '\n';
      afterCR = false;
      return;
    }
    const children = Array.from(node.childNodes);
    if (node === root || isBlock(node)) {
      // Locate padding through inline wrappers, but not inside a nested block.
      let last = node.lastChild;
      while (last instanceof Element && last.tagName !== 'BR' && !isBlock(last)) {
        last = last.lastChild;
      }
      paddingBR = last instanceof Element && last.tagName === 'BR' ? last : null;
    }
    let previousBlock = false;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const block = isBlock(child);
      if (i > 0 && (previousBlock || block)) {
        markdown += '\n';
        afterCR = false;
      }
      // An element child boundary belongs to the following line, if any.
      offsets[i] = markdown.length;
      visit(child, paddingBR);
      offsets[i + 1] = markdown.length;
      previousBlock = block;
    }
  }

  visit(root, null);
  return { markdown, boundaries };
}

function offsetAt(dom: MarkdownDOM, node: Node, offset: number): number | null {
  return dom.boundaries.get(node)?.[offset] ?? null;
}

function pointAt(dom: MarkdownDOM, offset: number): DOMPoint {
  const target = Math.max(0, Math.min(dom.markdown.length, Math.trunc(offset) || 0));
  // Prefer text so typing continues inside the decorated line, including ZWSP.
  for (const [node, offsets] of dom.boundaries) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const index = offsets.indexOf(target);
    if (index >= 0) return { node, offset: index };
  }
  for (const [node, offsets] of dom.boundaries) {
    const index = offsets.indexOf(target);
    if (index >= 0) return { node, offset: index };
  }
  throw new Error('Unmapped markdown boundary');
}

export function getMarkdown(root: HTMLElement): string {
  return readDOM(root).markdown;
}

export function getRangeOffsets(
  root: HTMLElement,
  range: Pick<Range, 'startContainer' | 'startOffset' | 'endContainer' | 'endOffset'>
): { start: number; end: number } | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const dom = readDOM(root);
  const start = offsetAt(dom, range.startContainer, range.startOffset);
  const end = offsetAt(dom, range.endContainer, range.endOffset);
  return start == null || end == null ? null : { start, end };
}

export function getSelectionOffsets(root: HTMLElement): MarkdownSelection | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel?.rangeCount || !sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  const dom = readDOM(root);
  const anchor = offsetAt(dom, sel.anchorNode, sel.anchorOffset);
  const focus = offsetAt(dom, sel.focusNode, sel.focusOffset);
  return anchor == null || focus == null ? null : { anchor, focus };
}

// Compatibility: this returns the ordered range start, even for a backward selection.
export function getCharOffset(root: HTMLElement): number | null {
  const sel = getSelectionOffsets(root);
  return sel ? Math.min(sel.anchor, sel.focus) : null;
}

export function setSelectionOffsets(root: HTMLElement, selection: MarkdownSelection): void {
  const sel = root.ownerDocument.getSelection();
  if (!sel) return;
  const dom = readDOM(root);
  const anchor = pointAt(dom, selection.anchor);
  const focus = pointAt(dom, selection.focus);
  if (sel.anchorNode === anchor.node && sel.anchorOffset === anchor.offset &&
      sel.focusNode === focus.node && sel.focusOffset === focus.offset) return;
  sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
}

export function setCharOffset(root: HTMLElement, offset: number | null): void {
  if (offset != null) setSelectionOffsets(root, { anchor: offset, focus: offset });
}

export interface MarkdownEdit {
  markdown: string;
  selection: MarkdownSelection;
}

/** All offsets refer to normalized Markdown, and either selection direction is valid. */
export function replaceMarkdownSelection(
  markdown: string,
  selection: MarkdownSelection,
  text: string,
  caretInText?: number
): MarkdownEdit {
  const md = normalizeMarkdown(markdown);
  const start = Math.max(0, Math.min(md.length, selection.anchor, selection.focus));
  const end = Math.max(start, Math.min(md.length, Math.max(selection.anchor, selection.focus)));
  const inserted = normalizeMarkdown(text);
  const caret = start + Math.max(0, Math.min(inserted.length, caretInText ?? inserted.length));
  return {
    markdown: md.slice(0, start) + inserted + md.slice(end),
    selection: { anchor: caret, focus: caret },
  };
}

/** Plain line breaks and list continuation use the same replacement operation. */
export function enterMarkdown(
  markdown: string,
  selection: MarkdownSelection,
  plain = false
): MarkdownEdit {
  const md = normalizeMarkdown(markdown);
  const start = Math.min(selection.anchor, selection.focus);
  const end = Math.max(selection.anchor, selection.focus);
  const lineStart = md.slice(0, start).lastIndexOf('\n') + 1;
  const lineEnd = md.indexOf('\n', start);
  const line = md.slice(lineStart, lineEnd < 0 ? md.length : lineEnd);
  let prefix = '';
  let content = '';
  let match: RegExpMatchArray | null;
  if (!plain) {
    if ((match = line.match(/^([\t ]*[-*+][\t ]+)\[[ xX]\]([\t ]+)(.*)$/))) {
      prefix = match[1] + '[ ]' + match[2];
      content = match[3];
    } else if ((match = line.match(/^([\t ]*[-*+][\t ]+)(.*)$/))) {
      prefix = match[1];
      content = match[2];
    } else if ((match = line.match(/^([\t ]*)(\d+)([.)])([\t ]+)(.*)$/))) {
      prefix = match[1] + (BigInt(match[2]) + 1n).toString() + match[3] + match[4];
      content = match[5];
    } else if ((match = line.match(/^([\t ]*>+[\t ]?)(.*)$/))) {
      prefix = match[1];
      content = match[2];
    }
    const prefixLength = line.length - content.length;
    if (prefix && start >= lineStart + prefixLength) {
      if (!content.trim()) {
        return replaceMarkdownSelection(md, {
          anchor: lineStart,
          focus: Math.max(end, lineStart + line.length),
        }, '');
      }
    } else prefix = '';
  }
  return replaceMarkdownSelection(md, selection, '\n' + prefix);
}

// Keep the existing context/fallback policy here so 06 can refine ambiguity independently.
export function findAnchorRange(
  markdown: string,
  anchor: { quote: string; before: string; after: string }
): { start: number; end: number } | null {
  if (!anchor.quote) return null;
  let start = -1;
  if (anchor.before || anchor.after) {
    start = markdown.indexOf(anchor.before + anchor.quote + anchor.after);
    if (start >= 0) start += anchor.before.length;
  }
  if (start < 0) start = markdown.indexOf(anchor.quote);
  return start < 0 ? null : { start, end: start + anchor.quote.length };
}

export function clearEditorHighlights(root: HTMLElement): void {
  root.querySelectorAll('.anchor-hl').forEach((span) => {
    span.replaceWith(...Array.from(span.childNodes));
  });
  root.normalize();
}

export function wrapRangeInEditor(
  root: HTMLElement,
  start: number,
  end: number,
  cls: string,
  id: string
): void {
  if (start >= end) return;
  const dom = readDOM(root);
  for (const [node, offsets] of dom.boundaries) {
    if (!(node instanceof Text)) continue;
    // Repeating the same highlight does not grow nested wrappers.
    let parent = node.parentElement;
    let alreadyWrapped = false;
    while (parent && parent !== root) {
      if (id && parent.dataset.anchorId === id) alreadyWrapped = true;
      parent = parent.parentElement;
    }
    if (alreadyWrapped) continue;
    const from = offsets.findIndex((offset) => offset >= start);
    let to = offsets.length - 1;
    while (to >= 0 && offsets[to] > end) to--;
    if (from < 0 || to <= from || offsets[to] <= offsets[from]) continue;
    const range = root.ownerDocument.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const span = root.ownerDocument.createElement('span');
    span.className = cls;
    if (id) span.dataset.anchorId = id;
    range.surroundContents(span);
  }
}
