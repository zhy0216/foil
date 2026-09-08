import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { renderDecorated } from '../lib/markdown';
import {
  findAnchorRange,
  getSelectionOffsets,
  normalizeMarkdown,
  setSelectionOffsets,
  wrapRangeInEditor,
} from '../lib/editor-dom';
import type { CommentThread } from '../types';

export interface PreviewProps {
  markdown: string;
  anchors: CommentThread[];
  activeAnchorId: string | null;
  onAnchorClick?: (id: string) => void;
}

/** Only decoration and reading interactions; no editor input lifecycle. */
export const Preview = forwardRef<HTMLDivElement, PreviewProps>(function Preview(
  { markdown, anchors, activeAnchorId, onAnchorClick }, ref
) {
  const elRef = useRef<HTMLDivElement>(null);
  const paintedMarkdown = useRef<string | null>(null);
  const md = normalizeMarkdown(markdown);
  useImperativeHandle(ref, () => elRef.current!, []);

  useLayoutEffect(() => {
    const el = elRef.current!;
    const selection = paintedMarkdown.current === md ? getSelectionOffsets(el) : null;
    el.innerHTML = renderDecorated(md);
    for (const anchor of anchors) {
      const range = findAnchorRange(md, anchor);
      if (range) wrapRangeInEditor(el, range.start, range.end, 'anchor-hl', anchor.id);
    }
    // A cross-line quote has several spans, but only one keyboard stop.
    const seen = new Set<string>();
    for (const span of el.querySelectorAll<HTMLElement>('.anchor-hl')) {
      const id = span.dataset.anchorId!;
      if (seen.has(id) || !onAnchorClick) continue;
      seen.add(id);
      span.tabIndex = 0;
      span.setAttribute('role', 'button');
      span.setAttribute('aria-label', `Read comment: ${anchors.find((anchor) => anchor.id === id)!.quote}`);
    }
    paintedMarkdown.current = md;
    if (selection) setSelectionOffsets(el, selection);
  }, [md, anchors, !!onAnchorClick]);

  // Activation never rebuilds the DOM or disturbs a reader's selection.
  useLayoutEffect(() => {
    for (const span of elRef.current!.querySelectorAll<HTMLElement>('.anchor-hl')) {
      const active = span.dataset.anchorId === activeAnchorId;
      span.classList.toggle('active', active);
      if (span.hasAttribute('role')) span.setAttribute('aria-pressed', String(active));
    }
  }, [md, anchors, activeAnchorId, !!onAnchorClick]);

  return (
    <div
      ref={elRef}
      className="editor readonly preview"
      contentEditable={false}
      role="document"
      aria-label="Document text"
      onClick={(event) => {
        if (!elRef.current?.ownerDocument.getSelection()?.isCollapsed) return;
        const span = event.target instanceof Element ? event.target.closest<HTMLElement>('.anchor-hl') : null;
        if (span?.dataset.anchorId) onAnchorClick?.(span.dataset.anchorId);
      }}
      onKeyDown={(event) => {
        const span = event.target instanceof HTMLElement ? event.target : null;
        if ((event.key === 'Enter' || event.key === ' ') && span?.dataset.anchorId) {
          event.preventDefault();
          onAnchorClick?.(span.dataset.anchorId);
        }
      }}
      onCopy={(event) => {
        const selection = getSelectionOffsets(event.currentTarget);
        if (!selection || selection.anchor === selection.focus) return;
        event.clipboardData.setData('text/plain', md.slice(
          Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus)
        ));
        event.preventDefault();
      }}
    />
  );
});
