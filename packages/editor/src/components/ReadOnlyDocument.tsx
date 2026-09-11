import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useReadingSettings } from '../hooks/useReadingSettings';
import { parseReadingDocument } from '../lib/reading-document';
import type { DocState, ReaderView, Settings } from '../types';
import { Brand } from './Brand';
import { IconComment, IconHelp, IconSettings, IconShare } from './Icons';
import { Preview } from './Preview';
import { CopyMarkdownButton, ReadingPreview } from './ReadingPreview';
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
  /** Optional host controls beside Settings/Share; standalone files omit them. */
  headerActions?: ReactNode;
  /** Recipient-local view preference. Hosts own persistence; a missing or
   *  invalid value falls back to the semantic Reading view. */
  readerView?: ReaderView;
  onReaderViewChange?: (view: ReaderView) => void;
}

const isReaderView = (value: unknown): value is ReaderView => value === 'reading' || value === 'source';
/** Title/heading dedup compares readable text, not byte-for-byte source. */
const dedupeKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const MIN_TOC_HEADINGS = 3;

interface ThreadPosition { id: string; top: number; anchored: boolean }
const MOBILE_QUERY = '(max-width: 1100px)';

export function ReadOnlyDocument({
  doc, settings, onShare, onSettings, onHelp,
  viewingLabel = 'Read-only preview', viewingActions, headerActions,
  readerView, onReaderViewChange,
}: ReadOnlyDocumentProps) {
  const { editorWrapStyle, canvasStyle } = useReadingSettings(settings);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [mobile, setMobile] = useState(() => matchMedia(MOBILE_QUERY).matches);
  // Hosts persist the preference; uncontrolled fallback keeps the component
  // usable on its own and defaults to Reading for missing/invalid values.
  const [internalView, setInternalView] = useState<ReaderView>(() => (isReaderView(readerView) ? readerView : 'reading'));
  const view: ReaderView = isReaderView(readerView) ? readerView : internalView;
  const changeView = useCallback((next: ReaderView) => {
    setInternalView(next);
    onReaderViewChange?.(next);
  }, [onReaderViewChange]);
  // One parse feeds the front-matter title, the TOC and the reading body.
  const parsed = useMemo(() => (view === 'reading' ? parseReadingDocument(doc.md) : null), [doc.md, view]);
  const frontTitle = useMemo(() => {
    if (!parsed || view !== 'reading') return null;
    const title = doc.title.trim();
    if (!title) return null;
    const firstHeading = parsed.headings[0]?.text;
    return firstHeading != null && dedupeKey(title) === dedupeKey(firstHeading) ? null : doc.title;
  }, [parsed, view, doc.title]);
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
    // A Reading/Source switch swaps the preview element, so the anchor
    // positions and observed nodes must be re-derived for the new view.
  }, [doc.md, doc.comments, settings, mobile, view, parsed]);

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

  // Section jumps locate the heading element and scroll to it. The default
  // anchor navigation is suppressed so the URL fragment — which carries share
  // payloads — is never rewritten. Headings keep scroll-margin-block padding.
  const jumpToHeading = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const id = event.currentTarget.getAttribute('href')?.slice(1);
    const preview = previewRef.current;
    if (!id || !preview) return;
    const target = preview.ownerDocument.getElementById(id);
    if (!target || !preview.contains(target)) return;
    target.scrollIntoView();
    target.focus({ preventScroll: true });
  }, []);

  const text = doc.md.replace(/[`*_~#>\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  const positions = new Map(layout.positions.map((position) => [position.id, position]));

  return (
    <div className="app readonly-document">
      <div className="readonly-content" ref={contentRef}>
        <header className="topbar">
          <Brand />
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
            <div className="view-toggle" role="group" aria-label="Document view">
              <button type="button" className="btn" aria-pressed={view === 'reading'} onClick={() => changeView('reading')}>Reading</button>
              <button type="button" className="btn" aria-pressed={view === 'source'} onClick={() => changeView('source')}>Source</button>
            </div>
            {view === 'reading' && <CopyMarkdownButton markdown={doc.md} />}
            {headerActions}
            {onSettings && <button type="button" className="btn btn-icon" onClick={onSettings} title="Settings" aria-label="Settings"><IconSettings /></button>}
            {onShare && <button type="button" className="btn btn-ghost-bordered" onClick={onShare}><IconShare /> Share</button>}
          </div>
        </header>

        <main className={'canvas' + (doc.comments.length ? ' has-comments' : '')} style={canvasStyle}>
          <div className="editor-wrap" style={editorWrapStyle}>
            {view === 'reading' ? (
              <>
                {(frontTitle || (parsed && parsed.headings.length >= MIN_TOC_HEADINGS)) && (
                  <div className="reading-front">
                    {frontTitle && <h1 className="reading-doc-title">{frontTitle}</h1>}
                    {parsed && parsed.headings.length >= MIN_TOC_HEADINGS && (
                      // Native collapsible region: open on desktop, a compact
                      // chapter menu on mobile. Never a third fixed column.
                      <details className="reading-toc" open={!mobile}>
                        <summary>Contents</summary>
                        <nav aria-label="Table of contents">
                          <ol>
                            {parsed.headings.map((heading) => (
                              <li key={heading.id} className={`toc-h${Math.min(6, Math.max(1, heading.level))}`}>
                                <a href={`#${heading.id}`} onClick={jumpToHeading}>{heading.text}</a>
                              </li>
                            ))}
                          </ol>
                        </nav>
                      </details>
                    )}
                  </div>
                )}
                <ReadingPreview
                  ref={previewRef} doc={parsed ?? undefined} markdown={doc.md} anchors={doc.comments}
                  activeAnchorId={activeAnchorId} onAnchorClick={activateAnchor}
                />
              </>
            ) : (
              <Preview ref={previewRef} markdown={doc.md} anchors={doc.comments} activeAnchorId={activeAnchorId} onAnchorClick={activateAnchor} />
            )}
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
