import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useReadingSettings } from '../hooks/useReadingSettings';
import type { DocState, Settings } from '../types';
import { IconComment, IconHelp, IconSettings, IconShare } from './Icons';
import { Preview } from './Preview';
import { Thread } from './Thread';

export interface ReadOnlyDocumentProps {
  doc: DocState;
  settings: Settings;
  onShare?: () => void;
  onSettings?: () => void;
  onHelp?: () => void;
  viewingLabel?: string;
  /** Host-provided actions, e.g. the website's explicit fork button. */
  viewingActions?: ReactNode;
}

interface ThreadPosition { id: string; top: number; anchored: boolean }
const MOBILE_QUERY = '(max-width: 1100px)';

export function ReadOnlyDocument({
  doc, settings, onShare, onSettings, onHelp,
  viewingLabel = 'Read-only preview', viewingActions,
}: ReadOnlyDocumentProps) {
  const { editorWrapStyle, canvasStyle } = useReadingSettings(settings);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [mobile, setMobile] = useState(() => matchMedia(MOBILE_QUERY).matches);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [layout, setLayout] = useState<{ positions: ThreadPosition[]; height: number }>({ positions: [], height: 0 });
  const previewRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const commentsButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const drawerId = useId();
  const drawerVisible = mobile && drawerOpen;

  // IDs come from shared data: compare datasets instead of interpolating selectors.
  const findHighlight = useCallback((id: string) =>
    Array.from(previewRef.current?.querySelectorAll<HTMLElement>('.anchor-hl') ?? [])
      .find((span) => span.dataset.anchorId === id), []);
  const findThread = (root: HTMLElement | null, id: string) =>
    Array.from(root?.querySelectorAll<HTMLElement>('[data-thread-id]') ?? [])
      .find((thread) => thread.dataset.threadId === id);

  useEffect(() => {
    const mq = matchMedia(MOBILE_QUERY);
    const update = () => {
      setMobile(mq.matches);
      if (!mq.matches) setDrawerOpen(false);
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    const preview = previewRef.current!;
    const gutter = gutterRef.current;
    if (!gutter) return;
    const measure = () => {
      // The first Markdown heading can collapse its margin inside the prose
      // wrapper. Position cards relative to their own containing block.
      const origin = gutter.getBoundingClientRect().top;
      const anchors = new Map<string, number>();
      for (const span of preview.querySelectorAll<HTMLElement>('.anchor-hl')) {
        const id = span.dataset.anchorId!;
        if (!anchors.has(id)) anchors.set(id, span.getBoundingClientRect().top - origin);
      }
      const cards = new Map(Array.from(gutter.querySelectorAll<HTMLElement>('[data-thread-id]'))
        .map((card) => [card.dataset.threadId!, card]));
      let bottom = 0;
      const positions = doc.comments.map((thread) => ({
        id: thread.id, anchorTop: anchors.get(thread.id),
      })).sort((a, b) => (a.anchorTop ?? Infinity) - (b.anchorTop ?? Infinity))
        .map(({ id, anchorTop }) => {
          const top = Math.max(anchorTop ?? 0, bottom);
          bottom = top + (cards.get(id)?.getBoundingClientRect().height ?? 0) + 14;
          return { id, top, anchored: anchorTop != null };
        });
      setLayout((previous) => previous.height === bottom &&
        previous.positions.length === positions.length &&
        previous.positions.every((position, i) => position.id === positions[i].id &&
          position.top === positions[i].top && position.anchored === positions[i].anchored)
        ? previous : { positions, height: bottom });
    };
    measure();
    window.addEventListener('resize', measure);
    // Text wrapping, font loading and comment heights can change independently.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(preview);
    gutter.querySelectorAll<HTMLElement>('[data-thread-id]').forEach((card) => observer?.observe(card));
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [doc.md, doc.comments, settings, mobile]);

  useEffect(() => {
    setActiveAnchorId(null);
    setDrawerOpen(false);
  }, [doc.md, doc.comments]);

  useLayoutEffect(() => {
    if (!drawerVisible) return;
    const content = contentRef.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    content.setAttribute('inert', '');
    closeButtonRef.current?.focus();
    return () => {
      content.removeAttribute('inert');
      document.body.style.overflow = overflow;
      const origin = returnFocusRef.current;
      (origin?.isConnected ? origin : commentsButtonRef.current)?.focus({ preventScroll: true });
    };
  }, [drawerVisible]);

  useEffect(() => {
    if (drawerVisible && activeAnchorId) {
      findThread(drawerRef.current, activeAnchorId)?.scrollIntoView({ block: 'nearest' });
    }
  }, [drawerVisible, activeAnchorId]);

  const activateAnchor = useCallback((id: string) => {
    setActiveAnchorId(id);
    if (mobile) {
      returnFocusRef.current = findHighlight(id) ?? commentsButtonRef.current;
      setDrawerOpen(true);
    } else {
      const thread = findThread(gutterRef.current, id);
      thread?.scrollIntoView({ block: 'nearest' });
      thread?.querySelector<HTMLButtonElement>('.anchor')?.focus({ preventScroll: true });
    }
  }, [mobile, findHighlight]);

  const locateThread = (id: string) => {
    setActiveAnchorId(id);
    const highlight = findHighlight(id);
    if (!highlight) return;
    if (drawerVisible) {
      returnFocusRef.current = highlight;
      setDrawerOpen(false);
    }
    highlight.scrollIntoView({ block: 'center' });
    highlight.focus({ preventScroll: true });
  };

  const text = doc.md.replace(/[`*_~#>\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  const positions = new Map(layout.positions.map((position) => [position.id, position]));

  return (
    <div className="app readonly-document">
      <div className="readonly-content" ref={contentRef}>
        <header className="topbar">
          <div className="brand"><div className="brand-mark">F</div><span>Foil</span></div>
          <h1 className="readonly-title">{doc.title || 'Untitled document'}</h1>
          <span className="viewing-chip"><span className="dot" />{viewingLabel}{viewingActions}</span>
          {doc.comments.length > 0 && (
            <button
              type="button" className="count-pill" ref={commentsButtonRef}
              aria-label={`Read ${doc.comments.length} comments`}
              aria-haspopup={mobile ? 'dialog' : undefined}
              aria-expanded={mobile ? drawerVisible : undefined}
              aria-controls={drawerVisible ? drawerId : undefined}
              onClick={() => {
                if (mobile) {
                  returnFocusRef.current = commentsButtonRef.current;
                  setActiveAnchorId(null);
                  setDrawerOpen(true);
                } else activateAnchor(activeAnchorId ?? doc.comments[0].id);
              }}
            ><IconComment />{doc.comments.length}</button>
          )}
          <div className="topbar-actions">
            {onSettings && <button type="button" className="btn btn-icon" onClick={onSettings} title="Settings" aria-label="Settings"><IconSettings /></button>}
            {onShare && <button type="button" className="btn btn-ghost-bordered" onClick={onShare}><IconShare /> Share</button>}
          </div>
        </header>

        <main className={'canvas' + (doc.comments.length ? ' has-comments' : '')} style={canvasStyle}>
          <div className="editor-wrap" style={editorWrapStyle}>
            <Preview ref={previewRef} markdown={doc.md} anchors={doc.comments} activeAnchorId={activeAnchorId} onAnchorClick={activateAnchor} />
          </div>
          {doc.comments.length > 0 && (
            <aside className="gutter-comments" aria-label="Comments" ref={gutterRef} style={{ minHeight: layout.height }}>
              {doc.comments.map((thread) => (
                <div className="readonly-thread-position" data-thread-id={thread.id} key={thread.id} style={{ top: positions.get(thread.id)?.top ?? 0 }}>
                  <Thread thread={thread} active={activeAnchorId === thread.id} onActivate={locateThread} readOnly mode="sheet" />
                  {positions.get(thread.id)?.anchored === false && <p className="unlocated-comment">Quoted text not found in this document.</p>}
                </div>
              ))}
            </aside>
          )}
        </main>

        <div className="statusbar">
          <span>{words.toLocaleString()} words</span><span className="sep">·</span>
          <span>{doc.md.length.toLocaleString()} chars</span><span className="sep">·</span>
          <span>{Math.max(1, Math.round(words / 220))} min read</span>
          <span className="spacer" aria-hidden="true" />
          <div className="right">
            {onHelp && <button type="button" onClick={onHelp} aria-label="About Foil" title="About Foil" className="help-link"><IconHelp /></button>}
            <a href="https://github.com/zhy0216/foil" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository" className="github-link">GitHub</a>
            <span className="save-state">● shared view</span>
          </div>
        </div>
      </div>

      {drawerVisible && (
        <div
          className="mobile-thread-overlay" role="dialog" aria-modal="true" aria-labelledby={drawerId + '-title'} id={drawerId}
          onClick={() => setDrawerOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setDrawerOpen(false);
            } else if (event.key === 'Tab') {
              const buttons = drawerRef.current!.querySelectorAll<HTMLButtonElement>('button');
              const first = buttons[0], last = buttons[buttons.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus();
              }
            }
          }}
        >
          <div className="mobile-thread-sheet" ref={drawerRef} onClick={(event) => event.stopPropagation()}>
            <h2 className="readonly-comments-heading" id={drawerId + '-title'}>Comments</h2>
            <button type="button" className="mobile-thread-close" ref={closeButtonRef} onClick={() => setDrawerOpen(false)} aria-label="Close">×</button>
            {doc.comments.map((thread) => (
              <div className="readonly-thread-item" data-thread-id={thread.id} key={thread.id}>
                <Thread thread={thread} active={activeAnchorId === thread.id} onActivate={locateThread} readOnly mode="sheet" />
                {positions.get(thread.id)?.anchored === false && <p className="unlocated-comment">Quoted text not found in this document.</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
