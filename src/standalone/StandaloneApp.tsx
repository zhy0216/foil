import { useCallback, useEffect, useRef, useState } from 'react';
import { HelpModal } from '../components/HelpModal';
import { PasswordPromptModal } from '../components/PasswordPromptModal';
import { ReadOnlyDocument } from '../components/ReadOnlyDocument';
import { SettingsModal } from '../components/SettingsModal';
import { TimeCapsuleUnlock } from '../components/TimeCapsuleUnlock';
import { HtmlShareFormatError } from '../lib/html-share-format';
import { DEFAULT_SETTINGS, parseSettings } from '../lib/settings-config';
import type { StandaloneRuntime } from '../lib/standalone-runtime';
import { decodeHtmlPayload, type TimeCapsuleEnvelope } from '../lib/url-codec';
import type { DocState, Settings } from '../types';
import { readEmbeddedShareData, readStandaloneRuntime } from './resources';

export interface StandaloneShareContext {
  doc: DocState;
  /** Missing in older/hand-made files; never substitute a file:// URL. */
  shareBaseUrl?: string;
  loadRuntime: () => Promise<StandaloneRuntime>;
}

export interface StandaloneAppProps {
  /** 04 supplies the Share UI; this callback is reachable only after unlocking. */
  onShare?: (context: StandaloneShareContext) => void;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'password'; busy: boolean; error: string | null }
  | { kind: 'time-capsule'; envelope: TimeCapsuleEnvelope }
  | { kind: 'preview'; doc: DocState }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' };

function capabilityError(): string | null {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== 'function') {
    return 'This browser cannot read this file because Web Crypto is unavailable. Try a current browser.';
  }
  try {
    new CompressionStream('gzip');
    new DecompressionStream('gzip');
    if (typeof Blob.prototype.stream !== 'function') throw new Error();
  } catch {
    return 'This browser cannot read this file because gzip support is unavailable. Try a current browser.';
  }
  if (typeof atob !== 'function' || typeof btoa !== 'function') {
    return 'This browser cannot decode this shared file. Try a current browser.';
  }
  return null;
}

function initialSettings(): Settings {
  try { return parseSettings(JSON.parse(localStorage.getItem('foil_settings') ?? 'null')); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function StandaloneApp({ onShare }: StandaloneAppProps) {
  // Capture the file once. Retry, StrictMode and location.hash never select a
  // different document, and no document-store fallback exists in this entry.
  const [source] = useState(() => {
    try { return { data: readEmbeddedShareData() }; }
    catch (error) {
      return { error: error instanceof HtmlShareFormatError ? error.message : 'Could not read this shared file.' };
    }
  });
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const generation = useRef(0);
  const [settings, setSettings] = useState(initialSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const decode = useCallback(async (password?: string) => {
    const request = ++generation.current;
    const unavailable = capabilityError();
    if (!source.data || unavailable) {
      setPhase({ kind: 'error', message: source.error ?? unavailable! });
      return;
    }
    setPhase(password === undefined ? { kind: 'loading' } : { kind: 'password', busy: true, error: null });
    try {
      const result = await decodeHtmlPayload(source.data.payload, password);
      if (generation.current !== request) return;
      if (result.state) setPhase({ kind: 'preview', doc: result.state });
      else if (result.timeCapsule) setPhase({ kind: 'time-capsule', envelope: result.timeCapsule });
      else if (result.encrypted || password !== undefined) {
        setPhase({ kind: 'password', busy: false, error: result.error ?? (password === undefined ? null : 'Enter the password to read this file.') });
      } else setPhase({ kind: 'error', message: result.error ?? 'Could not read this shared file.' });
    } catch {
      if (generation.current === request) {
        setPhase(password === undefined
          ? { kind: 'error', message: 'Could not read this shared file. Please retry.' }
          : { kind: 'password', busy: false, error: 'Could not unlock this shared file. Please retry.' });
      }
    }
  }, [source]);

  useEffect(() => {
    void decode();
    return () => { generation.current += 1; };
  }, [decode]);

  const cancel = () => {
    generation.current += 1;
    setPhase({ kind: 'cancelled' });
  };
  const changeSettings = (next: Settings) => {
    setSettings(next);
    try { localStorage.setItem('foil_settings', JSON.stringify(next)); }
    catch { /* Reading preferences continue in memory when storage is denied. */ }
  };

  if (phase.kind === 'password') return <PasswordPromptModal
    error={phase.error} busy={phase.busy} onSubmit={password => void decode(password)} onCancel={cancel}
  />;
  if (phase.kind === 'time-capsule') {
    const request = generation.current;
    return <TimeCapsuleUnlock key={request} envelope={phase.envelope} onCancel={cancel} onUnlocked={doc => {
      if (generation.current === request) {
        generation.current += 1;
        setPhase({ kind: 'preview', doc });
      }
    }} />;
  }
  if (phase.kind === 'preview') return <>
    <ReadOnlyDocument doc={phase.doc} settings={settings}
      onSettings={() => setSettingsOpen(true)} onHelp={() => setHelpOpen(true)}
      onShare={onShare ? () => onShare({
        doc: phase.doc, shareBaseUrl: source.data?.shareBaseUrl,
        loadRuntime: async () => readStandaloneRuntime(),
      }) : undefined}
    />
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings}
      onChange={changeSettings} onReset={() => changeSettings({ ...DEFAULT_SETTINGS })} />
    <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
  </>;
  return <main className="modal-backdrop">
    <div className="modal" role={phase.kind === 'error' ? 'alert' : 'status'}>
      <h3>{phase.kind === 'loading' ? 'Opening shared document…' : phase.kind === 'cancelled' ? 'Reading cancelled' : 'Could not open this file'}</h3>
      <p className="modal-sub">{phase.kind === 'error' ? phase.message : phase.kind === 'cancelled' ? 'The document stays in this file. Retry whenever you are ready.' : 'Preparing your read-only preview.'}</p>
      <div className="modal-actions">
        {phase.kind === 'loading' ? <button className="btn" onClick={cancel}>Cancel</button>
          : <button className="btn btn-primary" onClick={() => void decode()}>Retry</button>}
      </div>
    </div>
  </main>;
}
