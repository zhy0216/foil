import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Composer } from './components/Composer';
import { DocSwitcher } from './components/DocSwitcher';
import { Editor, type EditorHandle } from './components/Editor';
import {
  IconBold,
  IconComment,
  IconHelp,
  IconItalic,
  IconLink,
  IconSettings,
  IconShare,
} from './components/Icons';
import { HelpModal } from './components/HelpModal';
import { PasswordPromptModal } from './components/PasswordPromptModal';
import { ReadOnlyDocument } from './components/ReadOnlyDocument';
import { SettingsModal } from './components/SettingsModal';
import { ShareModal } from './components/ShareModal';
import { Thread } from './components/Thread';
import { TimeCapsuleUnlock } from './components/TimeCapsuleUnlock';
import { useReadingSettings } from './hooks/useReadingSettings';
import {
  clearCurrentId,
  createDocResult,
  deleteDoc,
  listDocsDetailed,
  readCurrentId,
  readDoc,
  readStorageItem,
  saveDoc,
  setCurrentId as persistCurrentId,
  writeStorageItem,
  type DocMeta,
  type StoredDoc,
  type StorageFailure,
} from './lib/doc-store';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  isTheme,
} from './lib/settings-config';
import { decodeUrl, encodeHtmlPayload, type ShareOptions, type TimeCapsuleEnvelope } from './lib/url-codec';
import { assembleHtmlShare } from './lib/html-export';
import { loadStandaloneRuntime } from './lib/standalone-runtime-loader';
import type {
  CommentThread,
  ComposerState,
  DocState,
  SelectionInfo,
  Settings,
} from './types';

async function exportWebsiteHtml(state: DocState, options: ShareOptions, shareBaseUrl?: string) {
  const runtime = await loadStandaloneRuntime();
  const payload = await encodeHtmlPayload(state, options);
  return assembleHtmlShare({ payload, runtime, title: state.title, shareBaseUrl });
}

const SAMPLE_MD = `# Welcome to Foil

A small markdown editor that lives entirely in your browser. **Type to format**, share by copying a link.

## What's nice about it

- Live styling — no separate preview pane
- Share links carry the entire document; nothing is sent to a server
- Optional **password** before you share → AES-GCM, 600k PBKDF2 rounds
- **Time capsule** — lock a link until a future moment. Nobody, not even you, can read it before the unlock time (powered by [drand](https://drand.love) tlock).
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

interface InitialPreferences {
  settings: Settings;
  authorName: string;
  errors: StorageFailure[];
}

function loadInitialPreferences(): InitialPreferences {
  const errors: StorageFailure[] = [];
  const settingsRaw = readStorageItem('local', 'foil_settings');
  let settings = { ...DEFAULT_SETTINGS };
  let structuredParsed = false;
  if (!settingsRaw.ok) {
    errors.push(settingsRaw.error);
  } else if (settingsRaw.value) {
    try {
      const parsed: unknown = JSON.parse(settingsRaw.value);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settings = parseSettings(parsed);
        structuredParsed = true;
      }
    } catch {
      settings = { ...DEFAULT_SETTINGS };
    }
  }
  if (settingsRaw.ok && !structuredParsed) {
    const legacy = readStorageItem('local', 'foil_theme');
    if (!legacy.ok) errors.push(legacy.error);
    else if (legacy.value != null && isTheme(legacy.value)) settings = { ...settings, theme: legacy.value };
  }

  const name = readStorageItem('local', 'foil_name');
  if (!name.ok) errors.push(name.error);
  return { settings, authorName: name.ok ? name.value || '' : '', errors };
}

/** Kept as a small public seam for settings tests and future non-React callers. */
export function loadInitialSettings(): Settings {
  return loadInitialPreferences().settings;
}

export default function App() {
  const [initialPreferences] = useState<InitialPreferences>(loadInitialPreferences);
  const [settings, setSettings] = useState<Settings>(initialPreferences.settings);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [title, setTitle] = useState('Untitled document');
  const [markdown, setMarkdown] = useState('');
  const [comments, setComments] = useState<CommentThread[]>([]);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [pwPrompt, setPwPrompt] = useState<{ hash: string; error: string | null } | null>(
    null
  );
  const [tcEnvelope, setTcEnvelope] = useState<TimeCapsuleEnvelope | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('unsaved');
  const [readOnly, setReadOnly] = useState(false);
  const { editorWrapStyle, canvasStyle } = useReadingSettings(settings, !readOnly);
  // StrictMode replays mount effects after the address-bar fragment is cleared.
  const [initialHash] = useState(() => window.location.hash);
  const [currentId, setCurrentIdState] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [dirtyRevision, setDirtyRevision] = useState(0);
  const dirtyRef = useRef(false);
  const dirtyRevisionRef = useRef(0);
  const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editorRef = useRef<EditorHandle>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const [userName, setUserName] = useState(initialPreferences.authorName);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2000);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const reportStorageError = useCallback(
    (error: StorageFailure) => {
      setStorageError(error.message);
      showToast(error.message);
    },
    [showToast]
  );

  useEffect(() => {
    if (initialPreferences.errors.length > 0) {
      reportStorageError(initialPreferences.errors[0]);
    }
  }, [initialPreferences.errors, reportStorageError]);

  // Do not rewrite malformed or unavailable settings during a read-only open.
  // Persist only an explicit preference change, and keep the UI usable if the
  // browser rejects the write.
  const settingsReadyRef = useRef(false);
  useEffect(() => {
    if (!settingsReadyRef.current) {
      settingsReadyRef.current = true;
      return;
    }
    const result = writeStorageItem('local', 'foil_settings', JSON.stringify(settings));
    if (!result.ok) reportStorageError(result.error);
  }, [settings, reportStorageError]);

  const refreshDocs = useCallback(() => {
    const result = listDocsDetailed();
    if (!result.ok) {
      reportStorageError(result.error);
      return false;
    }
    setDocs(result.value.docs);
    if (result.value.corrupt > 0) {
      reportStorageError({
        code: 'corrupt',
        operation: 'enumerate',
        message: `${result.value.corrupt} saved document${result.value.corrupt === 1 ? '' : 's'} could not be read and was left untouched.`,
      });
    }
    return true;
  }, [reportStorageError]);

  const applyState = useCallback((state: DocState) => {
    setTitle(state.title || 'Untitled document');
    setMarkdown(typeof state.md === 'string' ? state.md : '');
    setComments(Array.isArray(state.comments) ? state.comments : []);
    setActiveAnchorId(null);
  }, []);

  const latestDocRef = useRef<{
    id: string | null;
    title: string;
    md: string;
    comments: CommentThread[];
    createdAt: number | null;
  }>({ id: null, title: '', md: '', comments: [], createdAt: null });
  latestDocRef.current = { id: currentId, title, md: markdown, comments, createdAt: latestDocRef.current.createdAt };
  const createdAtByIdRef = useRef<Record<string, number>>({});

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    dirtyRevisionRef.current += 1;
    setDirtyRevision((v) => v + 1);
    setSaveState('saving');
  }, []);

  const adoptDoc = useCallback(
    (doc: StoredDoc, persisted = true) => {
      if (pendingSaveRef.current) {
        clearTimeout(pendingSaveRef.current);
        pendingSaveRef.current = null;
      }
      dirtyRef.current = false;
      dirtyRevisionRef.current += 1;
      setDirtyRevision((v) => v + 1);
      createdAtByIdRef.current[doc.id] = doc.createdAt;
      latestDocRef.current.createdAt = doc.createdAt;
      const currentResult = persistCurrentId(doc.id);
      setCurrentIdState(doc.id);
      setReadOnly(false);
      setSaveState(persisted && currentResult.ok ? 'saved' : 'error');
      if (!currentResult.ok) reportStorageError(currentResult.error);
      if (!persisted) setSaveState('unsaved');
      applyState({ md: doc.md, comments: doc.comments, title: doc.title });
    },
    [applyState, reportStorageError]
  );

  const saveSnapshot = useCallback(
    (snapshot: typeof latestDocRef.current, revision: number): boolean => {
      if (!snapshot.id) return true;
      const now = Date.now();
      const createdAt =
        snapshot.createdAt ?? createdAtByIdRef.current[snapshot.id] ?? now;
      const existing = readDoc(snapshot.id);
      if (!existing.ok) {
        setSaveState('error');
        reportStorageError(existing.error);
        return false;
      }
      if (
        existing.value &&
        existing.value.title === snapshot.title &&
        existing.value.md === snapshot.md &&
        JSON.stringify(existing.value.comments) === JSON.stringify(snapshot.comments)
      ) {
        if (snapshot.id === latestDocRef.current.id && revision === dirtyRevisionRef.current) {
          dirtyRef.current = false;
          setSaveState('saved');
        }
        setStorageError(null);
        return true;
      }
      const result = saveDoc({
        id: snapshot.id,
        title: snapshot.title,
        md: snapshot.md,
        comments: snapshot.comments,
        createdAt,
        updatedAt: now,
      });
      if (!result.ok) {
        setSaveState('error');
        reportStorageError(result.error);
        return false;
      }
      createdAtByIdRef.current[snapshot.id] = createdAt;
      if (snapshot.id === latestDocRef.current.id && revision === dirtyRevisionRef.current) {
        dirtyRef.current = false;
        setSaveState('saved');
      }
      setStorageError(null);
      refreshDocs();
      return true;
    },
    [refreshDocs, reportStorageError]
  );

  const flushSave = useCallback((): boolean => {
    if (pendingSaveRef.current) {
      clearTimeout(pendingSaveRef.current);
      pendingSaveRef.current = null;
    }
    if (readOnly || !currentId || !dirtyRef.current) return true;
    return saveSnapshot(latestDocRef.current, dirtyRevisionRef.current);
  }, [currentId, readOnly, saveSnapshot]);

  // One debounce path for all local edits. Capturing the identity and revision
  // prevents a delayed callback from writing a newer document's contents.
  useEffect(() => {
    if (!bootstrapped || readOnly || !currentId || !dirtyRef.current) return;
    const snapshot = { ...latestDocRef.current, comments: [...latestDocRef.current.comments] };
    const revision = dirtyRevisionRef.current;
    pendingSaveRef.current = setTimeout(() => {
      pendingSaveRef.current = null;
      saveSnapshot(snapshot, revision);
    }, 400);
    return () => {
      if (pendingSaveRef.current) {
        clearTimeout(pendingSaveRef.current);
        pendingSaveRef.current = null;
      }
    };
  }, [bootstrapped, currentId, dirtyRevision, readOnly, saveSnapshot]);

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushSave();
    };
    const flushOnPageHide = () => flushSave();
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', flushOnPageHide);
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', flushOnPageHide);
    };
  }, [flushSave]);

  // Bootstrap: load from URL hash if present (read-only), otherwise from doc-store
  useEffect(() => {
    const hash = initialHash;
    if (hash && hash.length > 2) {
      let cancelled = false;
      // Clear the URL immediately so the encoded blob isn't visible in the address bar
      history.replaceState(null, '', window.location.pathname);
      (async () => {
        const res = await decodeUrl(hash);
        if (cancelled) return;
        if (res.encrypted) {
          setPwPrompt({ hash, error: null });
          setReadOnly(true);
          refreshDocs();
          setBootstrapped(true);
          return;
        }
        if (res.timeCapsule) {
          setTcEnvelope(res.timeCapsule);
          setReadOnly(true);
          refreshDocs();
          setBootstrapped(true);
          return;
        }
        if (res.state) {
          applyState(res.state);
          setReadOnly(true);
        } else if (res.error) {
          showToast('Could not load link: ' + res.error);
        }
        refreshDocs();
        setBootstrapped(true);
      })();
      return () => { cancelled = true; };
    }
    const idResult = readCurrentId();
    if (!idResult.ok) reportStorageError(idResult.error);
    const id = idResult.ok ? idResult.value : null;
    const docResult = id ? readDoc(id) : { ok: true as const, value: null };
    if (!docResult.ok) reportStorageError(docResult.error);
    const doc = docResult.ok ? docResult.value : null;
    if (doc) {
      adoptDoc(doc, true);
    } else {
      const created = createDocResult({ md: SAMPLE_MD });
      if (!created.ok) reportStorageError(created.error);
      adoptDoc(created.value, created.ok);
    }
    refreshDocs();
    setBootstrapped(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUnlock = async (pw: string) => {
    if (!pwPrompt) return;
    const res = await decodeUrl(pwPrompt.hash, pw);
    if (res.timeCapsule) {
      // #te=: outer password layer peeled, what's left is a plain time capsule.
      setTcEnvelope(res.timeCapsule);
      setPwPrompt(null);
      return;
    }
    if (res.state) {
      applyState(res.state);
      setPwPrompt(null);
      showToast('Unlocked');
    } else {
      setPwPrompt({ ...pwPrompt, error: 'Wrong password or corrupt link.' });
    }
  };

  const handleSwitchDoc = (id: string) => {
    if (id === currentId) return;
    const result = readDoc(id);
    if (!result.ok) {
      reportStorageError(result.error);
      refreshDocs();
      return;
    }
    if (!result.value) {
      showToast('Document no longer exists');
      refreshDocs();
      return;
    }
    if (!flushSave()) return;
    adoptDoc(result.value, true);
    refreshDocs();
  };

  const handleNewDoc = () => {
    if (!flushSave()) return;
    const created = createDocResult({ md: '' });
    if (!created.ok) {
      reportStorageError(created.error);
      return;
    }
    adoptDoc(created.value, true);
    refreshDocs();
  };

  const handleDeleteDoc = (id: string) => {
    if (id === currentId && pendingSaveRef.current) {
      clearTimeout(pendingSaveRef.current);
      pendingSaveRef.current = null;
    }
    const removed = deleteDoc(id);
    if (!removed.ok) {
      reportStorageError(removed.error);
      return;
    }
    if (id === currentId) {
      const remaining = listDocsDetailed();
      if (remaining.ok && remaining.value.docs.length > 0) {
        const next = readDoc(remaining.value.docs[0].id);
        if (next.ok && next.value) {
          adoptDoc(next.value, true);
          refreshDocs();
          return;
        }
        if (!next.ok) reportStorageError(next.error);
      }
      const fresh = createDocResult({ md: SAMPLE_MD });
      if (fresh.ok) adoptDoc(fresh.value, true);
      else {
        reportStorageError(fresh.error);
        adoptDoc(fresh.value, false);
      }
    }
    refreshDocs();
  };

  const handleEditShared = () => {
    const created = createDocResult({ title, md: markdown, comments });
    if (!created.ok) {
      reportStorageError(created.error);
      return;
    }
    adoptDoc(created.value, true);
    refreshDocs();
    showToast('Saved as a local document — your edits stay on this device');
  };

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
  }, [comments, markdown, activeAnchorId, readOnly, bootstrapped]);

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
    if (readOnly) {
      showToast('This is a shared link — open in editor to comment');
      return;
    }
    const md = editorRef.current?.getMarkdown() ?? '';
    const ctxLen = 12;
    // Anchor context from the *actual* selection offsets, not indexOf — otherwise
    // commenting on a phrase that recurs earlier grabs the wrong occurrence's context.
    let start: number, end: number;
    if (selection.startOff != null && selection.endOff != null) {
      start = Math.min(selection.startOff, selection.endOff);
      end = Math.max(selection.startOff, selection.endOff);
    } else {
      start = md.indexOf(selection.text);
      end = start >= 0 ? start + selection.text.length : -1;
    }
    const before = start > 0 ? md.slice(Math.max(0, start - ctxLen), start) : '';
    const after = end >= 0 ? md.slice(end, end + ctxLen) : '';
    const wrapRect = editorWrapRef.current!.getBoundingClientRect();
    setComposer({
      quote: selection.text,
      before,
      after,
      top: selection.rect.bottom - wrapRect.top + 8,
      left: Math.min(selection.rect.left - wrapRect.left, wrapRect.width - 340),
    });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const rememberAuthor = useCallback(
    (author: string) => {
      setUserName(author);
      const result = writeStorageItem('local', 'foil_name', author);
      if (!result.ok) reportStorageError(result.error);
    },
    [reportStorageError]
  );

  const submitNewComment = (body: string, author: string) => {
    if (!composer || readOnly) return;
    const id = 'c' + Math.random().toString(36).slice(2, 9);
    rememberAuthor(author);
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
    markDirty();
    setComposer(null);
    setActiveAnchorId(id);
  };

  const addReply = (threadId: string, body: string, author: string) => {
    if (readOnly || !comments.some((c) => c.id === threadId)) return;
    rememberAuthor(author);
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
    markDirty();
  };

  const deleteThread = (threadId: string) => {
    if (readOnly || !comments.some((c) => c.id === threadId)) return;
    setComments((cs) => cs.filter((c) => c.id !== threadId));
    markDirty();
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

  const saveLabel = readOnly
    ? '● shared view'
    : saveState === 'saving'
      ? '● saving'
      : saveState === 'saved'
        ? '● saved'
        : '● not saved';

  if (!bootstrapped) {
    return <div className="document-loading" role="status">Opening document…</div>;
  }

  // While a password prompt or time capsule is awaiting unlock, render only
  // the modal — the empty editor frame and "Untitled document" chrome behind
  // it just confuses readers who arrived via a sealed link.
  if (pwPrompt) {
    return (
      <PasswordPromptModal
        error={pwPrompt.error}
        onSubmit={onUnlock}
        onCancel={() => {
          setPwPrompt(null);
          const idResult = readCurrentId();
          if (!idResult.ok) reportStorageError(idResult.error);
          const id = idResult.ok ? idResult.value : null;
          const docResult = id ? readDoc(id) : { ok: true as const, value: null };
          if (!docResult.ok) reportStorageError(docResult.error);
          if (docResult.ok && docResult.value) {
            adoptDoc(docResult.value, true);
          } else {
            const cleared = clearCurrentId();
            if (!cleared.ok) reportStorageError(cleared.error);
            const fresh = createDocResult({ md: SAMPLE_MD });
            if (!fresh.ok) reportStorageError(fresh.error);
            adoptDoc(fresh.value, fresh.ok);
          }
          refreshDocs();
        }}
      />
    );
  }

  if (tcEnvelope) {
    return (
      <TimeCapsuleUnlock
        envelope={tcEnvelope}
        onUnlocked={(state) => {
          applyState(state);
          setTcEnvelope(null);
          showToast('Time capsule unsealed');
        }}
        onCancel={() => {
          setTcEnvelope(null);
          const idResult = readCurrentId();
          if (!idResult.ok) reportStorageError(idResult.error);
          const id = idResult.ok ? idResult.value : null;
          const docResult = id ? readDoc(id) : { ok: true as const, value: null };
          if (!docResult.ok) reportStorageError(docResult.error);
          if (docResult.ok && docResult.value) {
            adoptDoc(docResult.value, true);
          } else {
            const cleared = clearCurrentId();
            if (!cleared.ok) reportStorageError(cleared.error);
            const fresh = createDocResult({ md: SAMPLE_MD });
            if (!fresh.ok) reportStorageError(fresh.error);
            adoptDoc(fresh.value, fresh.ok);
          }
          refreshDocs();
        }}
      />
    );
  }

  const modals = (
    <>
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
        onLearnMore={() => setHelpOpen(true)}
        shareBaseUrl={window.location.origin + window.location.pathname}
        exportHtml={exportWebsiteHtml}
      />

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {toast && <div className="toast">{toast}</div>}
    </>
  );

  if (readOnly) {
    return (
      <>
        <ReadOnlyDocument
          doc={{ md: markdown, comments, title }}
          settings={settings}
          onShare={() => setShareOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onHelp={() => setHelpOpen(true)}
          viewingLabel="Viewing shared link"
          viewingActions={(
            <button className="btn" style={{ padding: '0 6px', fontSize: 11, color: 'inherit' }} onClick={handleEditShared}>
              Edit anyway
            </button>
          )}
        />
        {modals}
      </>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">F</div>
          <span>Foil</span>
        </div>
        <DocSwitcher
          title={title}
          onTitleChange={(next) => {
            if (next === title) return;
            setTitle(next);
            markDirty();
          }}
          docs={docs}
          currentId={currentId}
          onSwitch={handleSwitchDoc}
          onDelete={handleDeleteDoc}
          onNew={handleNewDoc}
          readOnly={readOnly}
        />
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
          <Editor
            ref={editorRef}
            initialMarkdown={markdown}
            onChange={(next) => {
              setMarkdown(next);
              markDirty();
            }}
            onSelectionChange={setSelection}
            readOnly={readOnly}
            anchors={comments}
            activeAnchorId={activeAnchorId}
            onAnchorClick={setActiveAnchorId}
          />

          {selection && !composer && editorWrapRef.current && (
            <div
              className="sel-toolbar"
              style={{
                top:
                  selection.rect.top -
                  editorWrapRef.current.getBoundingClientRect().top,
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
              key={`${t.id}:${userName}`}
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

      {activeAnchorId &&
        (() => {
          const t = comments.find((c) => c.id === activeAnchorId);
          if (!t) return null;
          return (
            <div
              className="mobile-thread-overlay"
              onClick={() => setActiveAnchorId(null)}
              role="dialog"
              aria-modal="true"
            >
              <div className="mobile-thread-sheet" onClick={(e) => e.stopPropagation()}>
                <button
                  className="mobile-thread-close"
                  onClick={() => setActiveAnchorId(null)}
                  aria-label="Close"
                >
                  ×
                </button>
                <Thread
                  thread={t}
                  key={`${t.id}:${userName}:sheet`}
                  active
                  onActivate={() => {}}
                  onReply={addReply}
                  onDelete={(id) => {
                    deleteThread(id);
                    setActiveAnchorId(null);
                  }}
                  defaultName={userName}
                  mode="sheet"
                />
              </div>
            </div>
          );
        })()}

      {modals}

      <div className="statusbar">
        <span>{stats.words.toLocaleString()} words</span>
        <span className="sep">·</span>
        <span>{stats.chars.toLocaleString()} chars</span>
        <span className="sep">·</span>
        <span>{stats.minutes} min read</span>
        <span className="spacer" aria-hidden="true" />
        <div className="right">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="About Foil"
            title="About Foil"
            className="help-link"
          >
            <IconHelp />
          </button>
          <a
            href="https://github.com/zhy0216/foil"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            className="github-link"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
          </a>
          {storageError && !readOnly && (
            <span className="save-error" role="status" title={storageError}>
              not saved
            </span>
          )}
          <span className={'save-state ' + (saveState === 'saving' && !readOnly ? 'saving' : '')}>
            {saveLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
