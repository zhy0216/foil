import { useEffect, useRef, useState } from 'react';
import {
  openTimeCapsule,
  type TimeCapsuleEnvelope,
} from '../lib/url-codec';
import { NoEndpointError, NotYetReadyError } from '../lib/timecapsule';
import type { DocState } from '../types';
import { IconClock } from './Icons';

interface Props {
  envelope: TimeCapsuleEnvelope;
  onUnlocked: (state: DocState) => void;
  onCancel: () => void;
}

type Phase = 'locked' | 'ready' | 'unlocking' | 'error';

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(h)}:${pad(m)}:${pad(sec)}`;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function fmtAbsolute(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TimeCapsuleUnlock({ envelope, onUnlocked, onCancel }: Props) {
  const operation = useRef<AbortController | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [phase, setPhase] = useState<Phase>(
    envelope.unlockMs <= Date.now() ? 'ready' : 'locked'
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
    setPhase(envelope.unlockMs <= Date.now() ? 'ready' : 'locked');
    setError(null);
    return () => {
      operation.current?.abort();
      operation.current = null;
    };
  }, [envelope]);

  // 1s tick — drives both the countdown and the locked→ready transition.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (phase === 'locked' && now >= envelope.unlockMs) setPhase('ready');
  }, [now, envelope.unlockMs, phase]);

  const remaining = envelope.unlockMs - now;

  async function attemptUnlock() {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const { signal } = controller;
    setPhase('unlocking');
    setError(null);

    // The signature is published within seconds of unlockMs, but drand nodes
    // can lag a beat. Retry NotYetReadyError up to 10x with 3s spacing.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const state = await openTimeCapsule(envelope);
        if (signal.aborted) return;
        operation.current = null;
        onUnlocked(state);
        return;
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof NotYetReadyError) {
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              signal.removeEventListener('abort', done);
              resolve();
            };
            const timer = setTimeout(done, 3000);
            signal.addEventListener('abort', done, { once: true });
          });
          if (signal.aborted) return;
          continue;
        }
        operation.current = null;
        setPhase('error');
        setError(err instanceof NoEndpointError
          ? 'Could not reach drand. Check your connection and retry.'
          : 'Could not open time capsule. Please retry.');
        return;
      }
    }
    if (signal.aborted) return;
    operation.current = null;
    setPhase('error');
    setError("Signature still not published after several tries. Try again in a minute.");
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <IconClock /> Time capsule
          </span>
        </h3>
        <p className="modal-sub">
          This document was sealed until {fmtAbsolute(envelope.unlockMs)}. No one — not even the
          author — can read it before then.
        </p>

        <div className="tc-countdown">
          {phase === 'ready' || phase === 'unlocking' ? (
            <div className="tc-ready">
              <div className="tc-ready-label">Unsealed</div>
              <div className="tc-ready-sub">
                The drand signature for round #{envelope.round.toLocaleString()} is public.
              </div>
            </div>
          ) : (
            <>
              <div className="tc-countdown-time">{fmtCountdown(remaining)}</div>
              <div className="tc-countdown-sub">
                until drand round #{envelope.round.toLocaleString()} publishes
              </div>
            </>
          )}
        </div>

        {phase === 'error' && error && (
          <div className="stat-row" style={{ color: 'var(--cerulean-400)' }}>
            ⚠ {error}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => {
            operation.current?.abort();
            operation.current = null;
            onCancel();
          }}>
            Cancel
          </button>
          <div className="spacer" />
          {phase !== 'locked' && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={phase === 'unlocking'}
              onClick={attemptUnlock}
            >
              {phase === 'unlocking'
                ? 'Decrypting…'
                : phase === 'error'
                  ? 'Retry'
                  : 'Decrypt'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
