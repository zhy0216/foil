import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { renderDecorated } from '../lib/markdown';
import {
  getCharOffset,
  setCharOffset,
  getMarkdown,
  wrapRangeInEditor,
} from '../lib/editor-dom';
import type { CommentThread, SelectionInfo } from '../types';

export interface EditorHandle {
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
  focus: () => void;
  el: () => HTMLDivElement | null;
}

interface EditorProps {
  initialMarkdown: string;
  onChange?: (md: string) => void;
  onSelectionChange?: (sel: SelectionInfo | null) => void;
  readOnly?: boolean;
  anchors: CommentThread[];
  activeAnchorId: string | null;
  onAnchorClick?: (id: string) => void;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const {
    initialMarkdown,
    onChange,
    onSelectionChange,
    readOnly,
    anchors,
    activeAnchorId,
    onAnchorClick,
  } = props;
  const elRef = useRef<HTMLDivElement>(null);
  const lastMd = useRef<string>(initialMarkdown || '');
  const composing = useRef<boolean>(false);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    el.innerHTML = renderDecorated(initialMarkdown || '');
    lastMd.current = initialMarkdown || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if ((initialMarkdown || '') === lastMd.current) return;
    el.innerHTML = renderDecorated(initialMarkdown || '');
    lastMd.current = initialMarkdown || '';
  }, [initialMarkdown]);

  const reRender = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const md = getMarkdown(el);
    if (md === lastMd.current) return;
    const off = getCharOffset(el);
    el.innerHTML = renderDecorated(md);
    if (document.activeElement === el) setCharOffset(el, off);
    lastMd.current = md;
    el.classList.toggle('is-empty', md.length === 0);
    onChange?.(md);
  }, [onChange]);

  useImperativeHandle(ref, () => ({
    getMarkdown: () => getMarkdown(elRef.current!),
    setMarkdown: (md: string) => {
      const el = elRef.current;
      if (!el) return;
      el.innerHTML = renderDecorated(md || '');
      lastMd.current = md || '';
      el.classList.toggle('is-empty', !md);
    },
    focus: () => elRef.current?.focus(),
    el: () => elRef.current,
  }));

  const onInput = useCallback(() => {
    if (composing.current) return;
    reRender();
  }, [reRender]);

  const onCompositionEnd = useCallback(() => {
    composing.current = false;
    reRender();
  }, [reRender]);

  const insertAtCursor = useCallback(
    (el: HTMLElement, md: string, off: number, ins: string) => {
      const next = md.slice(0, off) + ins + md.slice(off);
      el.innerHTML = renderDecorated(next);
      setCharOffset(el, off + ins.length);
      lastMd.current = next;
      onChange?.(next);
    },
    [onChange]
  );

  const replaceCurrentLine = useCallback(
    (md: string, start: number, end: number, replacement: string) => {
      const next = md.slice(0, start) + replacement + md.slice(end);
      const el = elRef.current;
      if (!el) return;
      el.innerHTML = renderDecorated(next);
      setCharOffset(el, start + replacement.length);
      lastMd.current = next;
      onChange?.(next);
    },
    [onChange]
  );

  const wrapSelection = useCallback(
    (el: HTMLElement, wrap: string | null, isLink: boolean) => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer)) return;
      const md = getMarkdown(el);
      const startOff = getCharOffset(el);
      if (range.collapsed) return;
      const endRange = range.cloneRange();
      endRange.collapse(false);
      sel.removeAllRanges();
      sel.addRange(endRange);
      const endOff = getCharOffset(el);
      sel.removeAllRanges();
      sel.addRange(range);
      if (startOff == null || endOff == null) return;
      const a = Math.min(startOff, endOff);
      const b = Math.max(startOff, endOff);
      const sliced = md.slice(a, b);
      if (isLink) {
        const next = md.slice(0, a) + '[' + sliced + '](url)' + md.slice(b);
        el.innerHTML = renderDecorated(next);
        setCharOffset(el, a + sliced.length + 3);
        lastMd.current = next;
        onChange?.(next);
      } else if (wrap) {
        const next = md.slice(0, a) + wrap + sliced + wrap + md.slice(b);
        el.innerHTML = renderDecorated(next);
        setCharOffset(el, a + wrap.length + sliced.length + wrap.length);
        lastMd.current = next;
        onChange?.(next);
      }
    },
    [onChange]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const el = elRef.current;
        if (!el) return;
        const off = getCharOffset(el);
        const md = getMarkdown(el);
        if (off == null) return;
        const before = md.slice(0, off);
        const after = md.slice(off);
        const lineStart = before.lastIndexOf('\n') + 1;
        const lineEnd = after.indexOf('\n');
        const curLine = md.slice(
          lineStart,
          off + (lineEnd === -1 ? after.length : lineEnd)
        );
        let m: RegExpMatchArray | null;
        if ((m = curLine.match(/^(\s*)([-*+])\s\[( |x|X)\]\s(.*)$/))) {
          e.preventDefault();
          if (!m[4]) replaceCurrentLine(md, lineStart, lineStart + curLine.length, '');
          else insertAtCursor(el, md, off, '\n' + m[1] + m[2] + ' [ ] ');
          return;
        }
        if ((m = curLine.match(/^(\s*)([-*+])\s+(.*)$/))) {
          e.preventDefault();
          if (!m[3]) replaceCurrentLine(md, lineStart, lineStart + curLine.length, '');
          else insertAtCursor(el, md, off, '\n' + m[1] + m[2] + ' ');
          return;
        }
        if ((m = curLine.match(/^(\s*)(\d+)([.)])\s+(.*)$/))) {
          e.preventDefault();
          if (!m[4]) replaceCurrentLine(md, lineStart, lineStart + curLine.length, '');
          else
            insertAtCursor(
              el,
              md,
              off,
              '\n' + m[1] + (parseInt(m[2], 10) + 1) + m[3] + ' '
            );
          return;
        }
        if ((m = curLine.match(/^(\s*>+)\s(.*)$/))) {
          e.preventDefault();
          if (!m[2]) replaceCurrentLine(md, lineStart, lineStart + curLine.length, '');
          else insertAtCursor(el, md, off, '\n' + m[1] + ' ');
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === 'b' || k === 'i' || k === 'k') {
          e.preventDefault();
          if (elRef.current)
            wrapSelection(elRef.current, k === 'b' ? '**' : k === 'i' ? '*' : null, k === 'k');
        }
      }
    },
    [insertAtCursor, replaceCurrentLine, wrapSelection]
  );

  useEffect(() => {
    if (!onSelectionChange) return;
    const handler = () => {
      const el = elRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) {
        onSelectionChange(null);
        return;
      }
      const r = sel.getRangeAt(0);
      if (!el.contains(r.startContainer)) {
        onSelectionChange(null);
        return;
      }
      if (r.collapsed) {
        onSelectionChange(null);
        return;
      }
      const rect = r.getBoundingClientRect();
      const text = sel.toString();
      const range = sel.getRangeAt(0);
      const startRange = range.cloneRange();
      startRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(startRange);
      const startOff = getCharOffset(el);
      const endRange = range.cloneRange();
      endRange.collapse(false);
      sel.removeAllRanges();
      sel.addRange(endRange);
      const endOff = getCharOffset(el);
      sel.removeAllRanges();
      sel.addRange(range);
      onSelectionChange({ text, rect, startOff, endOff });
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [onSelectionChange]);

  // Anchor highlights
  useEffect(() => {
    const el = elRef.current;
    if (!el || !anchors) return;
    el.querySelectorAll('.anchor-hl').forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      (parent as Element).normalize?.();
    });
    const md = getMarkdown(el);
    anchors.forEach((a) => {
      if (!a.quote) return;
      let idx = -1;
      if (a.before || a.after) {
        const probe = (a.before || '') + a.quote + (a.after || '');
        idx = md.indexOf(probe);
        if (idx >= 0) idx += (a.before || '').length;
      }
      if (idx < 0) idx = md.indexOf(a.quote);
      if (idx < 0) return;
      try {
        wrapRangeInEditor(
          el,
          idx,
          idx + a.quote.length,
          'anchor-hl' + (a.id === activeAnchorId ? ' active' : ''),
          a.id
        );
      } catch {
        /* skip if range can't be resolved */
      }
    });
  }, [anchors, activeAnchorId]);

  // Delegated click handler — tapping a highlight focuses its thread.
  useEffect(() => {
    const el = elRef.current;
    if (!el || !onAnchorClick) return;
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('.anchor-hl');
      if (!target) return;
      const id = target.dataset.anchorId;
      if (id) onAnchorClick(id);
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [onAnchorClick]);

  return (
    <div
      ref={elRef}
      className={
        'editor' +
        (readOnly ? ' readonly' : '') +
        ((initialMarkdown || '').length === 0 ? ' is-empty' : '')
      }
      contentEditable={!readOnly}
      suppressContentEditableWarning
      spellCheck
      data-placeholder="Start writing — Markdown shortcuts work as you type. Try # heading, **bold**, - list, > quote…"
      onInput={onInput}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={onCompositionEnd}
      onKeyDown={onKeyDown}
    />
  );
});
