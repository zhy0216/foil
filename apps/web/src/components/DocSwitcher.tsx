import { useEffect, useRef, useState } from 'react';
import type { DocMeta } from '../lib/doc-store';

interface Props {
  title: string;
  onTitleChange: (next: string) => void;
  docs: DocMeta[];
  currentId: string | null;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  readOnly: boolean;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

const IconChevron = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const IconPencil = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

const IconTrash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </svg>
);

const IconPlus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export function DocSwitcher({
  title,
  onTitleChange,
  docs,
  currentId,
  onSwitch,
  onDelete,
  onNew,
  readOnly,
}: Props) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open && !renaming) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        if (renaming) commitRename();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setRenaming(false);
        setDraftTitle(title);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, renaming, title, draftTitle]);

  useEffect(() => {
    if (renaming) {
      setDraftTitle(title);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [renaming, title]);

  function commitRename() {
    const next = draftTitle.trim() || 'Untitled document';
    onTitleChange(next);
    setRenaming(false);
  }

  function startRename() {
    if (readOnly) return;
    setOpen(false);
    setRenaming(true);
  }

  return (
    <div className="doc-switcher" ref={wrapRef}>
      {renaming ? (
        <input
          ref={inputRef}
          className="doc-switcher-input"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            }
          }}
          onBlur={commitRename}
          placeholder="Untitled document"
        />
      ) : (
        <button
          className="doc-switcher-trigger"
          onClick={() => setOpen((v) => !v)}
          title="Switch document"
        >
          <span className="doc-switcher-title">{title || 'Untitled document'}</span>
          <span className="doc-switcher-chevron">
            <IconChevron />
          </span>
        </button>
      )}

      {!renaming && !readOnly && (
        <button
          className="doc-switcher-edit"
          onClick={startRename}
          title="Rename"
          aria-label="Rename document"
        >
          <IconPencil />
        </button>
      )}

      {open && !renaming && (
        <div className="doc-switcher-menu" role="menu">
          {docs.length === 0 && (
            <div className="doc-switcher-empty">No saved documents yet</div>
          )}
          {docs.map((d) => {
            const isConfirming = confirmDeleteId === d.id;
            return (
              <div
                key={d.id}
                className={'doc-switcher-row' + (d.id === currentId ? ' current' : '')}
              >
                <button
                  className="doc-switcher-row-main"
                  onClick={() => {
                    onSwitch(d.id);
                    setOpen(false);
                  }}
                >
                  <span className="doc-switcher-row-dot" aria-hidden="true" />
                  <span className="doc-switcher-row-title">
                    {d.title || 'Untitled document'}
                  </span>
                  <span className="doc-switcher-row-time">{relativeTime(d.updatedAt)}</span>
                </button>
                {isConfirming ? (
                  <div className="doc-switcher-confirm">
                    <button
                      className="doc-switcher-confirm-yes"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(d.id);
                        setConfirmDeleteId(null);
                      }}
                    >
                      Delete
                    </button>
                    <button
                      className="doc-switcher-confirm-no"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="doc-switcher-row-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(d.id);
                    }}
                    title="Delete"
                    aria-label="Delete document"
                  >
                    <IconTrash />
                  </button>
                )}
              </div>
            );
          })}
          <div className="doc-switcher-divider" />
          <button
            className="doc-switcher-new"
            onClick={() => {
              onNew();
              setOpen(false);
            }}
          >
            <IconPlus />
            <span>New document</span>
          </button>
        </div>
      )}
    </div>
  );
}
