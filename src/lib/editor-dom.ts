/* DOM utilities for translating between caret position and markdown char-offsets,
   and for wrapping a markdown-offset range in a span. */

const ZWSP_RE = /​/g;

export function getCharOffset(root: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  let offset = 0;
  const blocks = root.querySelectorAll<HTMLElement>(':scope > .ln');
  for (let bi = 0; bi < blocks.length; bi++) {
    if (bi > 0) offset += 1;
    const block = blocks[bi];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node === range.startContainer) {
        offset += range.startOffset;
        const before = node.textContent!.slice(0, range.startOffset);
        offset -= (before.match(ZWSP_RE) || []).length;
        return offset;
      }
      const txt = node.textContent ?? '';
      offset += txt.length;
      offset -= (txt.match(ZWSP_RE) || []).length;
    }
    if (range.startContainer === block) return offset;
  }
  return null;
}

export function setCharOffset(root: HTMLElement, offset: number | null): void {
  if (offset == null) return;
  const blocks = root.querySelectorAll<HTMLElement>(':scope > .ln');
  let remaining = offset;
  for (let bi = 0; bi < blocks.length; bi++) {
    if (bi > 0) {
      if (remaining <= 0) {
        placeAtBlockStart(blocks[bi]);
        return;
      }
      remaining -= 1;
    }
    const block = blocks[bi];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    let lastNode: Text | null = null;
    while ((node = walker.nextNode() as Text | null)) {
      lastNode = node;
      const txt = node.textContent ?? '';
      const realLen = txt.length - (txt.match(ZWSP_RE) || []).length;
      if (remaining <= realLen) {
        let domOff = 0;
        let consumed = 0;
        while (consumed < remaining && domOff < txt.length) {
          if (txt[domOff] !== '​') consumed++;
          domOff++;
        }
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();
        range.setStart(node, domOff);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= realLen;
    }
    if (remaining === 0) {
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      if (lastNode) range.setStart(lastNode, lastNode.textContent!.length);
      else range.setStart(block, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
  }
  const last = blocks[blocks.length - 1];
  if (last) placeAtBlockEnd(last);
}

function placeAtBlockStart(block: HTMLElement): void {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode() as Text | null;
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  if (node) range.setStart(node, 0);
  else range.setStart(block, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeAtBlockEnd(block: HTMLElement): void {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  let last: Text | null = null;
  while ((node = walker.nextNode() as Text | null)) last = node;
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  if (last) range.setStart(last, last.textContent!.length);
  else range.setStart(block, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function getMarkdown(root: HTMLElement): string {
  const blocks = root.querySelectorAll<HTMLElement>(':scope > .ln');
  const lines: string[] = [];
  for (const b of blocks) {
    const t = (b.textContent ?? '').replace(ZWSP_RE, '');
    lines.push(t);
  }
  return lines.join('\n');
}

export function wrapRangeInEditor(
  root: HTMLElement,
  start: number,
  end: number,
  cls: string,
  id: string
): void {
  const blocks = root.querySelectorAll<HTMLElement>(':scope > .ln');

  function findNodeAt(target: number): { node: Text; off: number } | null {
    let consumed = 0;
    for (let bi = 0; bi < blocks.length; bi++) {
      if (bi > 0) consumed += 1;
      const block = blocks[bi];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const t = node.textContent ?? '';
        const real = t.length - (t.match(ZWSP_RE) || []).length;
        if (consumed + real >= target) {
          const want = target - consumed;
          let domOff = 0;
          let c = 0;
          while (c < want && domOff < t.length) {
            if (t[domOff] !== '​') c++;
            domOff++;
          }
          return { node, off: domOff };
        }
        consumed += real;
      }
    }
    return null;
  }

  const a = findNodeAt(start);
  const b = findNodeAt(end);
  if (!a || !b) return;
  if (a.node === b.node) {
    const t = a.node.textContent ?? '';
    const before = t.slice(0, a.off);
    const middle = t.slice(a.off, b.off);
    const after = t.slice(b.off);
    const span = document.createElement('span');
    span.className = cls;
    if (id) span.dataset.anchorId = id;
    span.textContent = middle;
    const parent = a.node.parentNode!;
    const beforeNode = document.createTextNode(before);
    const afterNode = document.createTextNode(after);
    parent.insertBefore(beforeNode, a.node);
    parent.insertBefore(span, a.node);
    parent.insertBefore(afterNode, a.node);
    parent.removeChild(a.node);
  }
}
