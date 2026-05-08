import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Composer } from './components/Composer';
import { Editor, type EditorHandle } from './components/Editor';
import {
  IconBold,
  IconComment,
  IconItalic,
  IconLink,
  IconSettings,
  IconShare,
} from './components/Icons';
import { PasswordPromptModal } from './components/PasswordPromptModal';
import { SettingsModal } from './components/SettingsModal';
import { ShareModal } from './components/ShareModal';
import { Thread } from './components/Thread';
import {
  ACCENT_MAP,
  DEFAULT_SETTINGS,
  EDITOR_WIDTHS,
  PROSE_FONT_MAP,
  PROSE_SIZES,
} from './lib/settings-config';
import { decodeUrl, encodeUrl } from './lib/url-codec';
import type {
  CommentThread,
  ComposerState,
  DocState,
  SelectionInfo,
  Settings,
  Theme,
} from './types';

const SAMPLE_MD = `# Welcome to Foil

A small markdown editor that lives entirely in your browser. **Type to format**, share by copying a link.

## What's nice about it

- Live styling — no separate preview pane
- Share links carry the entire document; nothing is sent to a server
- Optional **password** before you share → AES-GCM, 200k PBKDF2 rounds
- Highlight any text and **leave a comment**. Comments travel with the link.

## Markdown that works

You can type \`inline code\`, **bold**, *italic*, ~~strike~~, and ==highlight==. Tasks too:

- [ ] Try writing a heading
- [ ] Highlight a word and click *Comment*
- [x] Open the share modal

> "The pen is mightier than the sword — but only if it's also URL-safe."

\`\`\`js
// fenced code blocks render with a frame
const greet = (name) => \`hello, \${name}\`;
\`\`\`

---

Press **⌘B / ⌘I** to bold or italicise the selection. Hit **⌘K** to insert a link.
`;

function loadInitialSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem('foil_settings') || 'null');
    if (saved) return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    /* ignore */
  }
  const legacyTheme = localStorage.getItem('foil_theme') as Theme | null;
  return { ...DEFAULT_SETTINGS, theme: legacyTheme ?? 'auto' };
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadInitialSettings);
  useEffect(() => {
    localStorage.setItem('foil_settings', JSON.stringify(settings));
  }, [settings]);

  // Theme follow-OS
  useEffect(() => {
    const apply = () => {
      const t =
        settings.theme === 'auto'
          ? matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : settings.theme;
      document.documentElement.setAttribute('data-theme', t);
    };
    apply();
    if (settings.theme === 'auto') {
      const mq = matchMedia('(prefers-color-scheme: light)');
      const handler = () => apply();
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [settings.theme]);

  // Accent overrides
  useEffect(() => {
    const root = document.documentElement;
    const keys = [
      '--accent',
      '--accent-hover',
      '--accent-hi',
      '--accent-lo',
      '--link',
      '--link-hover',
    ];
    keys.forEach((k) => root.style.removeProperty(k));
    const a = ACCENT_MAP[settings.accent];
    if (a?.overrides) {
      Object.entries(a.overrides).forEach(([k, v]) => root.style.setProperty(k, v));
    }
  }, [settings.accent]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [title, setTitle] = useState('Untitled document');
  const [markdown, setMarkdown] = useState(SAMPLE_MD);
  const [comments, setComments] = useState<CommentThread[]>([]);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [pwPrompt, setPwPrompt] = useState<{ hash: string; error: string | null } | null>(
    null
  );
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [readOnly, setReadOnly] = useState(false);

  const editorRef = useRef<EditorHandle>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const userName = useMemo(() => localStorage.getItem('foil_name') || '', []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  // Load from URL on mount
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash.length < 3) return;
    (async () => {
      const res = await decodeUrl(hash);
      if (res.encrypted) {
        setPwPrompt({ hash, error: null });
        setReadOnly(true);
        return;
      }
      if (res.state) {
        applyState(res.state);
        setReadOnly(true);
      } else if (res.error) {
        showToast('Could not load link: ' + res.error);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyState(state: DocState) {
    if (state.title) setTitle(state.title);
    if (typeof state.md === 'string') setMarkdown(state.md);
    if (Array.isArray(state.comments)) setComments(state.comments);
  }

  const onUnlock = async (pw: string) => {
    if (!pwPrompt) return;
    const res = await decodeUrl(pwPrompt.hash, pw);
    if (res.state) {
      applyState(res.state);
      setPwPrompt(null);
      showToast('Unlocked');
    } else {
      setPwPrompt({ ...pwPrompt, error: 'Wrong password or corrupt link.' });
    }
  };

  // Sync to URL (debounced, plain only)
  const isEncryptedView =
    pwPrompt !== null || (window.location.hash || '').startsWith('#e=');
  useEffect(() => {
    if (pwPrompt) return;
    if (isEncryptedView && readOnly) return;
    setSaveState('saving');
    const handle = setTimeout(async () => {
      const state: DocState = { md: markdown, comments, title };
      try {
        const hash = await encodeUrl(state, null);
        history.replaceState(null, '', window.location.pathname + hash);
        setSaveState('saved');
      } catch {
        setSaveState('saved');
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [markdown, comments, title, pwPrompt, isEncryptedView, readOnly]);

  // Anchor positions
  const [anchorPositions, setAnchorPositions] = useState<Record<string, number | null>>({});
  useEffect(() => {
    const ed = editorRef.current?.el();
    if (!ed) return;
    const wrap = ed.parentElement;
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    const positions: Record<string, number | null> = {};
    comments.forEach((c) => {
      const span = ed.querySelector<HTMLElement>(`[data-anchor-id="${c.id}"]`);
      if (span) {
        const r = span.getBoundingClientRect();
        positions[c.id] = r.top - wrapRect.top;
      } else {
        positions[c.id] = null;
      }
    });
    setAnchorPositions(positions);
  }, [comments, markdown, activeAnchorId]);

  const stackedThreads = useMemo(() => {
    const items = comments
      .map((c) => ({ ...c, top: anchorPositions[c.id] }))
      .filter((c): c is CommentThread & { top: number } => c.top != null)
      .sort((a, b) => a.top - b.top);
    let lastBottom = 0;
    const minHeight = 96;
    return items.map((c) => {
      const top = Math.max(c.top, lastBottom + 8);
      lastBottom = top + minHeight;
      return { ...c, top };
    });
  }, [comments, anchorPositions]);

  const startNewComment = () => {
    if (!selection || !selection.text.trim()) return;
    if (readOnly) showToast('This is a shared link — open in editor to comment');
    const md = editorRef.current?.getMarkdown() ?? '';
    const idx = md.indexOf(selection.text);
    const ctxLen = 12;
    const before = idx > 0 ? md.slice(Math.max(0, idx - ctxLen), idx) : '';
    const after =
      idx >= 0 ? md.slice(idx + selection.text.length, idx + selection.text.length + ctxLen) : '';
    const wrapRect = editorWrapRef.current!.getBoundingClientRect();
    setComposer({
      quote: selection.text,
      before,
      after,
      top: selection.rect.bottom - wrapRect.top + window.scrollY + 8,
      left: Math.min(selection.rect.left - wrapRect.left, wrapRect.width - 340),
    });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const submitNewComment = (body: string, author: string) => {
    if (!composer) return;
    const id = 'c' + Math.random().toString(36).slice(2, 9);
    localStorage.setItem('foil_name', author);
    setComments((cs) => [
      ...cs,
      {
        id,
        quote: composer.quote,
        before: composer.before,
        after: composer.after,
        replies: [
          { id: 'r' + Math.random().toString(36).slice(2, 9), author, ts: Date.now(), body },
        ],
      },
    ]);
    setComposer(null);
    setActiveAnchorId(id);
  };

  const addReply = (threadId: string, body: string, author: string) => {
    localStorage.setItem('foil_name', author);
    setComments((cs) =>
      cs.map((c) =>
        c.id === threadId
          ? {
              ...c,
              replies: [
                ...c.replies,
                {
                  id: 'r' + Math.random().toString(36).slice(2, 9),
                  author,
                  ts: Date.now(),
                  body,
                },
              ],
            }
          : c
      )
    );
  };

  const deleteThread = (threadId: string) => {
    setComments((cs) => cs.filter((c) => c.id !== threadId));
    if (activeAnchorId === threadId) setActiveAnchorId(null);
  };

  const stats = useMemo(() => {
    const text = markdown.replace(/[`*_~#>\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = text ? text.split(' ').length : 0;
    const chars = markdown.length;
    const minutes = Math.max(1, Math.round(words / 220));
    return { words, chars, minutes };
  }, [markdown]);

  const getState = useCallback<() => DocState>(
    () => ({ md: markdown, comments, title }),
    [markdown, comments, title]
  );

  // Selection-toolbar inline-wrap helpers (uses execCommand on the live selection)
  function wrapInline(wrap: string) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const text = sel.toString();
    if (!text) return;
    document.execCommand('insertText', false, wrap + text + wrap);
  }
  function insertLink() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const text = sel.toString();
    if (!text) return;
    document.execCommand('insertText', false, `[${text}](url)`);
  }

  const editorWrapStyle: CSSProperties & Record<string, string> = {
    '--prose-font': PROSE_FONT_MAP[settings.proseFont] || PROSE_FONT_MAP.serif,
    '--prose-size': (PROSE_SIZES[settings.proseSize] || PROSE_SIZES.default) + 'px',
    '--prose-leading': settings.density === 'compact' ? '1.55' : '1.7',
  };

  const canvasStyle: CSSProperties & Record<string, string> = {
    '--editor-width': EDITOR_WIDTHS[settings.editorWidth] || EDITOR_WIDTHS.default,
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">F</div>
          <span>Foil</span>
        </div>
        <input
          className="doc-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled document"
          disabled={readOnly}
        />
        {readOnly && (
          <span className="viewing-chip">
            <span className="dot" />
            Viewing shared {pwPrompt ? 'encrypted ' : ''}link
            <button
              className="btn"
              style={{ padding: '0 6px', fontSize: 11, color: 'inherit' }}
              onClick={() => {
                setReadOnly(false);
                showToast('Editing enabled — your changes update the URL');
              }}
            >
              Edit anyway
            </button>
          </span>
        )}
        {comments.length > 0 && (
          <span className="count-pill">
            <IconComment />
            {comments.length}
          </span>
        )}
        <div className="topbar-actions">
          <button
            className="btn btn-icon"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            <IconSettings />
          </button>
          <button className="btn btn-ghost-bordered" onClick={() => setShareOpen(true)}>
            <IconShare /> Share
          </button>
        </div>
      </header>

      <main className="canvas" style={canvasStyle}>
        <div className="editor-wrap" ref={editorWrapRef} style={editorWrapStyle}>
          <style>{`.editor { font-family: var(--prose-font); font-size: var(--prose-size, 19px); line-height: var(--prose-leading, 1.7); }`}</style>
          <Editor
            ref={editorRef}
            initialMarkdown={markdown}
            onChange={setMarkdown}
            onSelectionChange={setSelection}
            readOnly={readOnly}
            anchors={comments}
            activeAnchorId={activeAnchorId}
          />

          {selection && !composer && editorWrapRef.current && (
            <div
              className="sel-toolbar"
              style={{
                top:
                  selection.rect.top -
                  editorWrapRef.current.getBoundingClientRect().top +
                  window.scrollY,
                left:
                  selection.rect.left +
                  selection.rect.width / 2 -
                  editorWrapRef.current.getBoundingClientRect().left,
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  wrapInline('**');
                }}
                title="Bold (⌘B)"
              >
                <IconBold />
              </button>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  wrapInline('*');
                }}
                title="Italic (⌘I)"
              >
                <IconItalic />
              </button>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  wrapInline('`');
                }}
                title="Code"
              >
                {'</>'}
              </button>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertLink();
                }}
                title="Link (⌘K)"
              >
                <IconLink />
              </button>
              <span className="sep" />
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  startNewComment();
                }}
                title="Comment"
              >
                <IconComment /> Comment
              </button>
            </div>
          )}

          {composer && (
            <Composer
              pos={composer}
              quote={composer.quote}
              defaultName={userName}
              onCancel={() => setComposer(null)}
              onSubmit={submitNewComment}
            />
          )}
        </div>

        <div className="gutter-comments" style={{ position: 'relative', minHeight: 1 }}>
          {stackedThreads.map((t) => (
            <Thread
              key={t.id}
              thread={t}
              active={activeAnchorId === t.id}
              onActivate={setActiveAnchorId}
              onReply={addReply}
              onDelete={deleteThread}
              defaultName={userName}
            />
          ))}
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={setSettings}
        onReset={() => setSettings({ ...DEFAULT_SETTINGS })}
      />

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        getState={getState}
        onToast={showToast}
      />

      {pwPrompt && (
        <PasswordPromptModal
          error={pwPrompt.error}
          onSubmit={onUnlock}
          onCancel={() => {
            setPwPrompt(null);
            history.replaceState(null, '', window.location.pathname);
            setReadOnly(false);
          }}
        />
      )}

      <div className="statusbar">
        <span>{stats.words.toLocaleString()} words</span>
        <span className="sep">·</span>
        <span>{stats.chars.toLocaleString()} chars</span>
        <span className="sep">·</span>
        <span>{stats.minutes} min read</span>
        <div className="right">
          <span>Markdown</span>
          <span className={'save-state ' + (saveState === 'saving' ? 'saving' : '')}>
            {saveState === 'saving' ? '● saving' : '● in URL'}
          </span>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
