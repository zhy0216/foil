import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import { renderDecorated } from '../lib/markdown';
import {
  clearEditorHighlights,
  enterMarkdown,
  findAnchorRange,
  getMarkdown,
  getRangeOffsets,
  getSelectionOffsets,
  normalizeMarkdown,
  replaceMarkdownSelection,
  setSelectionOffsets,
  wrapRangeInEditor,
  type MarkdownEdit,
  type MarkdownSelection,
} from '../lib/editor-dom';
import type { CommentThread, SelectionInfo } from '../types';

export interface EditorHandle {
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
  focus: () => void;
  el: () => HTMLDivElement | null;
  // Toolbar commands use the live selection, or the last editor selection after
  // toolbar focus. An explicit saved selection can also be supplied by the caller.
  getSelection: () => MarkdownSelection | null;
  replaceSelection: (text: string, selection?: MarkdownSelection) => boolean;
  wrapSelection: (wrap: string, selection?: MarkdownSelection) => boolean;
  insertLink: (selection?: MarkdownSelection) => boolean;
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

interface Snapshot {
  markdown: string;
  selection: MarkdownSelection | null;
}

function plainTransfer(data: DataTransfer | null): string | null {
  if (!data || data.files?.length || Array.from(data.items ?? []).some((item) => item.kind === 'file')) {
    return null;
  }
  // Do not fall back to HTML, URLs, or reading files as markup.
  const text = data.getData('text/plain');
  return text ? normalizeMarkdown(text) : null;
}

function dropSelection(el: HTMLElement, x: number, y: number): MarkdownSelection | null {
  const doc = el.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const point = doc.caretPositionFromPoint?.(x, y);
  const range = point ? {
    startContainer: point.offsetNode, startOffset: point.offset,
    endContainer: point.offsetNode, endOffset: point.offset,
  } : doc.caretRangeFromPoint?.(x, y);
  if (!range) return null;
  const offsets = getRangeOffsets(el, range);
  return offsets ? { anchor: offsets.start, focus: offsets.start } : null;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const { initialMarkdown, onChange, onSelectionChange, readOnly, anchors, activeAnchorId, onAnchorClick } = props;
  const elRef = useRef<HTMLDivElement>(null);
  const lastMd = useRef(normalizeMarkdown(initialMarkdown || ''));
  const initialized = useRef(false);
  const composing = useRef(false);
  const compositionFlush = useRef(false);
  const pendingReplacement = useRef<string | null>(null);
  const previousProp = useRef(initialMarkdown);
  const savedSelection = useRef<MarkdownSelection | null>(null);
  const beforeInputSelection = useRef<MarkdownSelection | null>(null);
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);
  const decorated = useRef<{ anchors: CommentThread[]; active: string | null } | null>(null);

  const refreshHighlights = useCallback((force = false) => {
    const el = elRef.current;
    if (!el || composing.current || compositionFlush.current) return;
    if (!force && decorated.current?.anchors === anchors && decorated.current.active === activeAnchorId) return;
    const selection = getSelectionOffsets(el);
    clearEditorHighlights(el);
    const md = getMarkdown(el);
    for (const anchor of anchors) {
      const range = findAnchorRange(md, anchor);
      if (range) wrapRangeInEditor(el, range.start, range.end,
        'anchor-hl' + (anchor.id === activeAnchorId ? ' active' : ''), anchor.id);
    }
    decorated.current = { anchors, active: activeAnchorId };
    if (selection) setSelectionOffsets(el, selection);
  }, [anchors, activeAnchorId]);

  // Every DOM rebuild goes through this lifecycle, including imperative updates.
  const paint = useCallback((md: string, selection: MarkdownSelection | null) => {
    const el = elRef.current;
    if (!el) return;
    el.innerHTML = renderDecorated(md);
    lastMd.current = md;
    initialized.current = true;
    el.classList.toggle('is-empty', !md);
    refreshHighlights(true);
    if (selection) setSelectionOffsets(el, selection);
    savedSelection.current = selection ? getSelectionOffsets(el) : null;
  }, [refreshHighlights]);

  const replaceDocument = useCallback((md: string) => {
    const el = elRef.current;
    if (!el) return;
    undo.current = [];
    redo.current = [];
    beforeInputSelection.current = null;
    paint(normalizeMarkdown(md), getSelectionOffsets(el));
  }, [paint]);

  useLayoutEffect(() => {
    const changedProp = previousProp.current !== initialMarkdown;
    previousProp.current = initialMarkdown;
    if (readOnly && (composing.current || compositionFlush.current)) {
      composing.current = false;
      compositionFlush.current = false;
      const md = changedProp ? initialMarkdown : pendingReplacement.current ?? lastMd.current;
      pendingReplacement.current = null;
      replaceDocument(md);
      return;
    }
    if (composing.current || compositionFlush.current) {
      if (changedProp) pendingReplacement.current = normalizeMarkdown(initialMarkdown || '');
      return;
    }
    const md = normalizeMarkdown(initialMarkdown || '');
    if (!initialized.current || (changedProp && md !== lastMd.current)) replaceDocument(md);
    else refreshHighlights();
    elRef.current?.classList.toggle('is-empty', !lastMd.current);
  }, [initialMarkdown, replaceDocument, refreshHighlights, readOnly]);

  const commit = useCallback((edit: MarkdownEdit, before: MarkdownSelection | null) => {
    const changed = edit.markdown !== lastMd.current;
    if (changed) {
      // Bounded checkpoints cover the transactions that replace the DOM. Native
      // keystrokes and IME commits enter the same history; no persistent history.
      undo.current.push({ markdown: lastMd.current, selection: before });
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
    }
    beforeInputSelection.current = null;
    paint(edit.markdown, edit.selection);
    if (changed) onChange?.(edit.markdown);
  }, [paint, onChange]);

  const syncInput = useCallback((force = false) => {
    const el = elRef.current;
    if (!el || readOnly || composing.current || compositionFlush.current) return;
    const md = getMarkdown(el);
    if (md === lastMd.current) {
      beforeInputSelection.current = null;
      if (force) paint(md, getSelectionOffsets(el));
      return;
    }
    const selection = getSelectionOffsets(el) ?? { anchor: md.length, focus: md.length };
    commit({ markdown: md, selection }, beforeInputSelection.current ?? savedSelection.current ?? selection);
  }, [readOnly, paint, commit]);

  const commandSelection = useCallback((explicit?: MarkdownSelection): MarkdownSelection | null => {
    const el = elRef.current;
    if (!el) return null;
    if (explicit) return explicit;
    const live = getSelectionOffsets(el);
    if (live) return live;
    const sel = el.ownerDocument.getSelection();
    // A partially external selection must never reuse a stale editor selection.
    if (sel?.rangeCount && (el.contains(sel.anchorNode) || el.contains(sel.focusNode))) return null;
    return savedSelection.current;
  }, []);

  const applyReplacement = useCallback((text: string, explicit?: MarkdownSelection) => {
    const el = elRef.current;
    if (!el || readOnly || composing.current || compositionFlush.current) return false;
    const selection = commandSelection(explicit);
    if (!selection) return false;
    el.focus();
    commit(replaceMarkdownSelection(getMarkdown(el), selection, text), selection);
    return true;
  }, [readOnly, commandSelection, commit]);

  const formatSelection = useCallback((wrap: string | null, explicit?: MarkdownSelection) => {
    const el = elRef.current;
    if (!el || readOnly || composing.current || compositionFlush.current) return false;
    const selection = commandSelection(explicit);
    if (!selection || selection.anchor === selection.focus) return false;
    const md = getMarkdown(el);
    const text = md.slice(Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus));
    const inserted = wrap === null ? `[${text}](url)` : wrap + text + wrap;
    el.focus();
    commit(replaceMarkdownSelection(md, selection, inserted, wrap === null ? text.length + 3 : undefined), selection);
    return true;
  }, [readOnly, commandSelection, commit]);

  const insertNewline = useCallback((plain: boolean, selection?: MarkdownSelection) => {
    const el = elRef.current;
    if (!el || readOnly || composing.current || compositionFlush.current) return;
    const current = selection ?? getSelectionOffsets(el);
    if (current) commit(enterMarkdown(getMarkdown(el), current, plain), current);
  }, [readOnly, commit]);

  const restoreHistory = useCallback((forward: boolean) => {
    const el = elRef.current;
    if (!el || readOnly || composing.current || compositionFlush.current) return;
    const source = forward ? redo.current : undo.current;
    const target = forward ? undo.current : redo.current;
    const snapshot = source.pop();
    if (!snapshot) return;
    target.push({ markdown: lastMd.current, selection: getSelectionOffsets(el) ?? savedSelection.current });
    beforeInputSelection.current = null;
    paint(snapshot.markdown, snapshot.selection);
    onChange?.(snapshot.markdown);
  }, [readOnly, paint, onChange]);

  useImperativeHandle(ref, () => ({
    getMarkdown: () => elRef.current ? getMarkdown(elRef.current) : lastMd.current,
    setMarkdown: (md) => {
      if (readOnly) return;
      if (composing.current || compositionFlush.current) pendingReplacement.current = normalizeMarkdown(md || '');
      else replaceDocument(md || '');
    },
    focus: () => elRef.current?.focus(),
    el: () => elRef.current,
    getSelection: () => commandSelection(),
    replaceSelection: applyReplacement,
    wrapSelection: (wrap, selection) => formatSelection(wrap, selection),
    insertLink: (selection) => formatSelection(null, selection),
  }));

  // Use the native event: React 18's beforeinput plugin does not expose all of
  // InputEvent's inputType/targetRanges paths (e.g. mobile Enter and menu undo).
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const handler = (event: InputEvent) => {
      if (readOnly) { event.preventDefault(); return; }
      if (composing.current || compositionFlush.current || event.isComposing) return;
      beforeInputSelection.current = getSelectionOffsets(el);
      if (!event.cancelable) return;
      const type = event.inputType;
      if (type === 'historyUndo' || type === 'historyRedo') {
        event.preventDefault();
        restoreHistory(type === 'historyRedo');
      } else if (type === 'insertParagraph' || type === 'insertLineBreak') {
        event.preventDefault();
        insertNewline(type === 'insertLineBreak');
      } else if (type === 'formatBold' || type === 'formatItalic') {
        event.preventDefault();
        formatSelection(type === 'formatBold' ? '**' : '*');
      } else if (type === 'insertFromPaste' || type === 'insertFromDrop' || type === 'insertFromPasteAsQuotation') {
        event.preventDefault();
        const text = plainTransfer(event.dataTransfer);
        const range = event.getTargetRanges?.()[0];
        const offsets = range ? getRangeOffsets(el, range) : null;
        const selection = offsets ? { anchor: offsets.start, focus: offsets.end } :
          (type === 'insertFromDrop' || range ? null : getSelectionOffsets(el));
        if (text != null && selection) applyReplacement(text, selection);
      }
    };
    el.addEventListener('beforeinput', handler);
    return () => el.removeEventListener('beforeinput', handler);
  }, [readOnly, restoreHistory, insertNewline, formatSelection, applyReplacement]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (composing.current || compositionFlush.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const command = (event.metaKey || event.ctrlKey) && !event.altKey;
    const key = event.key.toLowerCase();
    if (readOnly) {
      if (event.key === 'Enter' || (command && ['b', 'i', 'k', 'z', 'y'].includes(key))) event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && !command && !event.altKey) {
      event.preventDefault();
      insertNewline(event.shiftKey);
    } else if (command && (key === 'z' || (key === 'y' && !event.shiftKey))) {
      event.preventDefault();
      restoreHistory(event.shiftKey || key === 'y');
    } else if (command && !event.shiftKey && ['b', 'i', 'k'].includes(key)) {
      event.preventDefault();
      formatSelection(key === 'k' ? null : key === 'b' ? '**' : '*');
    }
  }, [readOnly, insertNewline, restoreHistory, formatSelection]);

  useEffect(() => {
    const handler = () => {
      const el = elRef.current;
      if (!el) return;
      const selection = getSelectionOffsets(el);
      if (selection) savedSelection.current = selection;
      if (!selection || selection.anchor === selection.focus) { onSelectionChange?.(null); return; }
      const startOff = Math.min(selection.anchor, selection.focus);
      const endOff = Math.max(selection.anchor, selection.focus);
      const range = el.ownerDocument.getSelection()!.getRangeAt(0);
      onSelectionChange?.({
        text: getMarkdown(el).slice(startOff, endOff),
        rect: range.getBoundingClientRect(),
        startOff, endOff,
      });
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [onSelectionChange]);

  return (
    <div
      ref={elRef}
      className={'editor' + (readOnly ? ' readonly' : '') + (!lastMd.current ? ' is-empty' : '')}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      spellCheck
      data-placeholder="Start writing — Markdown shortcuts work as you type. Try # heading, **bold**, - list, > quote…"
      onInput={(event) => { if (!(event.nativeEvent as InputEvent).isComposing) syncInput(); }}
      onCompositionStart={() => {
        if (readOnly) return;
        composing.current = true;
        compositionFlush.current = false;
        beforeInputSelection.current = elRef.current ? getSelectionOffsets(elRef.current) : null;
      }}
      onCompositionEnd={() => {
        if (readOnly) { composing.current = false; return; }
        composing.current = false;
        compositionFlush.current = true;
        // Read once after the browser's final composition input, whichever order
        // it uses for compositionend/input. A duplicate trailing input is a no-op.
        queueMicrotask(() => {
          if (!compositionFlush.current || composing.current || !elRef.current) return;
          compositionFlush.current = false;
          if (pendingReplacement.current != null) {
            const md = pendingReplacement.current;
            pendingReplacement.current = null;
            replaceDocument(md);
          } else syncInput(true);
        });
      }}
      onKeyDown={onKeyDown}
      onPaste={(event) => {
        event.preventDefault();
        const el = elRef.current;
        if (!el || readOnly || composing.current || compositionFlush.current) return;
        const text = plainTransfer(event.clipboardData);
        const selection = getSelectionOffsets(el);
        if (text != null && selection) applyReplacement(text, selection);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = readOnly ? 'none' : 'copy';
      }}
      onDrop={(event) => {
        event.preventDefault();
        const el = elRef.current;
        if (!el || readOnly || composing.current || compositionFlush.current) return;
        const text = plainTransfer(event.dataTransfer);
        const selection = dropSelection(el, event.clientX, event.clientY);
        if (text != null && selection) applyReplacement(text, selection);
      }}
      onClick={(event) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.anchor-hl') : null;
        if (target?.dataset.anchorId) onAnchorClick?.(target.dataset.anchorId);
      }}
    />
  );
});
