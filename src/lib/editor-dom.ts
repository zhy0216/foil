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

  function blockOf(node: Node): HTMLElement | null {
    let n: Node | null = node;
    while (n && n !== root) {
      const el = n as HTMLElement;
      if (el.classList && el.classList.contains('ln')) return el;
      n = n.parentNode;
    }
    return null;
  }

  function wrapSegment(node: Text, from: number, to: number): void {
    if (from >= to) return;
    const t = node.textContent ?? '';
    const middle = t.slice(from, to);
    if (middle.replace(ZWSP_RE, '') === '') return;
    const before = t.slice(0, from);
    const after = t.slice(to);
    const span = document.createElement('span');
    span.className = cls;
    if (id) span.dataset.anchorId = id;
    span.textContent = middle;
    const parent = node.parentNode!;
    if (before) parent.insertBefore(document.createTextNode(before), node);
    parent.insertBefore(span, node);
    if (after) parent.insertBefore(document.createTextNode(after), node);
    parent.removeChild(node);
  }

  const a = findNodeAt(start);
  const b = findNodeAt(end);
  if (!a || !b) return;
  if (a.node === b.node) {
    wrapSegment(a.node, a.off, b.off);
    return;
  }
  const blockA = blockOf(a.node);
  const blockB = blockOf(b.node);
  if (!blockA || !blockB) return;
  const blockArr = Array.from(blocks);
  const ia = blockArr.indexOf(blockA);
  const ib = blockArr.indexOf(blockB);
  if (ia < 0 || ib < 0 || ia > ib) return;

  const segments: Array<{ node: Text; from: number; to: number }> = [];
  for (let i = ia; i <= ib; i++) {
    const block = blockArr[i];
    const isFirst = i === ia;
    const isLast = i === ib;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    let started = !isFirst;
    while ((node = walker.nextNode() as Text | null)) {
      const len = (node.textContent ?? '').length;
      if (!started) {
        if (node !== a.node) continue;
        started = true;
        const to = isLast && node === b.node ? b.off : len;
        segments.push({ node, from: a.off, to });
        if (isLast && node === b.node) break;
        continue;
      }
      if (isLast && node === b.node) {
        segments.push({ node, from: 0, to: b.off });
        break;
      }
      segments.push({ node, from: 0, to: len });
    }
  }
  for (const seg of segments) wrapSegment(seg.node, seg.from, seg.to);
}
