import { useEffect, useMemo, useRef, useState } from 'react';
import { encodeUrl } from '../lib/url-codec';
import { roundAtUnix, unixMsAtRound } from '../lib/timecapsule';
import type { DocState } from '../types';
import { IconCopy } from './Icons';

interface Props {
  open: boolean;
  onClose: () => void;
  getState: () => DocState;
  onToast: (msg: string) => void;
  onLearnMore: () => void;
}

type Preset = '1h' | '1d' | '1mo' | '1y' | 'custom';

interface Result {
  url: string;
  size: number;
  snapshot: string;
  scheme: 'd' | 'e' | 'td' | 'te';
}

const PRESETS: { id: Preset; label: string; ms: number | null }[] = [
  { id: '1h', label: '+1 hour', ms: 3_600_000 },
  { id: '1d', label: '+1 day', ms: 86_400_000 },
  { id: '1mo', label: '+1 month', ms: 30 * 86_400_000 },
  { id: '1y', label: '+1 year', ms: 365 * 86_400_000 },
  { id: 'custom', label: 'Custom', ms: null },
];

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d} days`;
  const mo = Math.round(d / 30);
  if (mo < 24) return `${mo} months`;
  return `${(d / 365).toFixed(1)} years`;
}

/** Render a datetime-local input value (`YYYY-MM-DDTHH:MM`) for a unix ms. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ShareModal({ open, onClose, getState, onToast, onLearnMore }: Props) {
  const [usePassword, setUsePassword] = useState(false);
  const [useTimelock, setUseTimelock] = useState(false);
  const [password, setPassword] = useState('');
  const [preset, setPreset] = useState<Preset>('1d');
  const [customLocal, setCustomLocal] = useState(() =>
    toLocalInput(Date.now() + 86_400_000)
  );
  const [url, setUrl] = useState('');
  const [size, setSize] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [, setClockNow] = useState(() => Date.now());
  const generation = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidate = () => {
    generation.current += 1;
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    setResult(null);
    setUrl('');
    setSize(0);
    setBusy(false);
  };

  const close = () => {
    invalidate();
    onClose();
  };

  // Keep expiry and the 30-second safety window visible while the dialog stays open.
  useEffect(() => {
    if (!open || !useTimelock) return;
    const id = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, useTimelock]);

  // Reset transient state every time the modal opens
  useEffect(() => {
    if (!open) return;
    invalidate();
    setUsePassword(false);
    setUseTimelock(false);
    setPassword('');
    setPreset('1d');
    setCustomLocal(toLocalInput(Date.now() + 86_400_000));
  }, [open]);

  const targetMs = useMemo(() => {
    if (!useTimelock) return null;
    if (preset === 'custom') {
      const ms = new Date(customLocal).getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    const ms = PRESETS.find((p) => p.id === preset)?.ms ?? null;
    return ms ? Date.now() + ms : null;
  }, [useTimelock, preset, customLocal]);

  // The actual unlock moment is roundTime(round), which may be 0–3s after target.
  const unlockMs = useMemo(() => {
    if (!targetMs) return null;
    if (targetMs <= Date.now() + 30_000) return null; // require ≥30s in the future
    return unixMsAtRound(roundAtUnix(targetMs));
  }, [targetMs]);
  const round = unlockMs ? roundAtUnix(unlockMs) : null;

  const passwordMissing = usePassword && !password;
  const timelockMissing = useTimelock && (!unlockMs || !targetMs || targetMs <= Date.now() + 30_000);
  const ready = !passwordMissing && !timelockMissing;

  // Read the state for every render so a caller that keeps a stable getState callback
  // is covered too. The serialized value is only a comparison key; the password is
  // never included in this document snapshot or sent to logging/URL code.
  const currentStateKey = (() => {
    try {
      return JSON.stringify(getState());
    } catch {
      return '';
    }
  })();
  const currentSnapshot = useMemo(
    () => JSON.stringify({ state: currentStateKey, usePassword, password, useTimelock, targetMs, unlockMs }),
    [currentStateKey, usePassword, password, useTimelock, targetMs, unlockMs]
  );
  const latestSnapshot = useRef(currentSnapshot);
  latestSnapshot.current = currentSnapshot;

  const timelockStillValid = () =>
    !useTimelock ||
    (unlockMs !== null && targetMs !== null && targetMs > Date.now() + 30_000 && unlockMs > Date.now());

  // Build the URL whenever inputs settle.
  useEffect(() => {
    if (!open) {
      invalidate();
      return;
    }
    invalidate();
    if (!ready) {
      return;
    }

    if (!timelockStillValid()) {
      onToast('Unlock time must be at least 30 seconds from now');
      return;
    }

    const request = ++generation.current;
    const snapshot = currentSnapshot;
    setBusy(true);
    debounceTimer.current = setTimeout(async () => {
      debounceTimer.current = null;
      try {
        if (request !== generation.current || snapshot !== latestSnapshot.current) return;
        if (!timelockStillValid()) {
          onToast('Unlock time must be at least 30 seconds from now');
          return;
        }
        const state: DocState = JSON.parse(currentStateKey);
        const opts: { password?: string | null; unlockMs?: number | null } = {};
        if (usePassword) opts.password = password;
        if (useTimelock) opts.unlockMs = unlockMs!;
        const hash = await encodeUrl(state, opts);
        if (request !== generation.current || snapshot !== latestSnapshot.current) return;
        if (!timelockStillValid()) {
          setResult(null);
          setUrl('');
          setSize(0);
          onToast('Unlock time must be at least 30 seconds from now');
          return;
        }
        const scheme = hash.slice(1, hash.indexOf('=')) as Result['scheme'];
        const next = { url: window.location.origin + window.location.pathname + hash, size: hash.length, snapshot, scheme };
        setResult(next);
        setUrl(next.url);
        setSize(next.size);
      } catch (e) {
        if (request === generation.current) {
          setResult(null);
          setUrl('');
          setSize(0);
          onToast("Couldn't build link: " + (e instanceof Error ? e.message : 'Unknown error'));
        }
      } finally {
        if (request === generation.current) setBusy(false);
      }
    }, 250);
    return () => {
      // Crypto already in flight cannot be aborted; make its eventual result inert.
      if (generation.current === request) generation.current += 1;
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [open, ready, usePassword, useTimelock, password, unlockMs, targetMs, currentSnapshot, getState, onToast]);

  if (!open) return null;

  const copy = async () => {
    if (!result || result.snapshot !== currentSnapshot || !timelockStillValid()) {
      invalidate();
      if (useTimelock) onToast('Unlock time must be at least 30 seconds from now');
      return;
    }
    try {
      await navigator.clipboard.writeText(result.url);
      const toast = result.scheme === 'td' || result.scheme === 'te'
        ? result.scheme === 'te'
          ? 'Encrypted time capsule copied'
          : 'Time capsule copied'
        : result.scheme === 'e'
          ? 'Encrypted link copied'
          : 'Link copied';
      onToast(toast);
      close();
    } catch {
      onToast("Couldn't copy — select the box and copy manually");
    }
  };

  const resultIsCurrent = result?.snapshot === currentSnapshot && timelockStillValid();
  const sizeKb = ((resultIsCurrent ? size : 0) / 1024).toFixed(1);
  const tooBig = resultIsCurrent && size > 8000;
  const tooSoon = useTimelock && targetMs && targetMs <= Date.now() + 30_000;

  const linkPlaceholder = busy
    ? 'Building link…'
    : passwordMissing
      ? 'Enter a password…'
      : timelockMissing
        ? 'Pick an unlock time…'
      : '';

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Share this document</h3>
        <p className="modal-sub">
          Everything — text, comments, title — lives in the link itself. Nothing leaves your
          browser.
        </p>

        <div className="share-option">
          <div className="share-option-head">
            <div
              className={'toggle' + (usePassword ? ' on' : '')}
              role="switch"
              aria-checked={usePassword}
              tabIndex={0}
              onClick={() => { invalidate(); setUsePassword((v) => !v); }}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  invalidate();
                  setUsePassword((v) => !v);
                }
              }}
            />
            <div className="label-stack">
              <b>Require a password</b>
              <span>
                Encrypts the link so only people you give the password to can open it.{' '}
                <button type="button" className="learn-more-link" onClick={onLearnMore}>
                  Learn more
                </button>
              </span>
            </div>
          </div>
          {usePassword && (
            <input
              type="password"
              value={password}
              autoFocus
              onChange={(e) => { invalidate(); setPassword(e.target.value); }}
              placeholder="Choose a password"
              style={{ marginTop: 10 }}
            />
          )}
        </div>

        <div className="share-option">
          <div className="share-option-head">
            <div
              className={'toggle' + (useTimelock ? ' on' : '')}
              role="switch"
              aria-checked={useTimelock}
              tabIndex={0}
              onClick={() => { invalidate(); setUseTimelock((v) => !v); }}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  invalidate();
                  setUseTimelock((v) => !v);
                }
              }}
            />
            <div className="label-stack">
              <b>Time-lock until a future date</b>
              <span>
                Seals the link until a date you pick. No one — not even you — can open it before
                then.{' '}
                <button type="button" className="learn-more-link" onClick={onLearnMore}>
                  Learn more
                </button>
              </span>
            </div>
          </div>

          {useTimelock && (
            <>
              <div className="preset-row" style={{ marginTop: 10 }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={'preset' + (preset === p.id ? ' on' : '')}
                    onClick={() => { invalidate(); setPreset(p.id); }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {preset === 'custom' && (
                <input
                  type="datetime-local"
                  value={customLocal}
                  min={toLocalInput(Date.now() + 60_000)}
                  onChange={(e) => { invalidate(); setCustomLocal(e.target.value); }}
                  style={{ marginTop: 8 }}
                />
              )}

              {tooSoon && (
                <div className="stat-row" style={{ color: 'var(--cerulean-400)' }}>
                  ⚠ Unlock time must be at least 30 seconds from now
                </div>
              )}

              {unlockMs && round && !timelockMissing && (
                <div className="tc-readout">
                  <div>
                    <b>Unlocks</b> {fmtDate(unlockMs)}
                  </div>
                  <div className="tc-readout-sub">
                    in {fmtDuration(unlockMs - Date.now())} · drand round #{round.toLocaleString()}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <label style={{ marginTop: 16 }}>Shareable link</label>
        <div className="url-row">
          <input
            type="text"
            readOnly
            value={linkPlaceholder || (resultIsCurrent ? url : '')}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="btn btn-primary"
            onClick={copy}
            disabled={busy || !url || !ready || !resultIsCurrent}
          >
            <IconCopy /> Copy
          </button>
        </div>
        <div className="stat-row">
          <span>
            {tooBig
              ? '⚠ Some browsers cap URLs around 8 KB'
              : useTimelock
                ? 'Locked via drand quicknet — if that network ever goes dark, the document is unrecoverable.'
                : 'Fits in any modern browser'}
          </span>
          <span>{sizeKb} KB</span>
        </div>

        <div className="modal-actions">
          <div className="spacer" />
          <button className="btn btn-ghost-bordered" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
