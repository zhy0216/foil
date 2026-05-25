import { useEffect, useState } from 'react';
import {
  openTimeCapsule,
  type TimeCapsuleEnvelope,
} from '../lib/url-codec';
import { NotYetReadyError } from '../lib/timecapsule';
import type { DocState } from '../types';
import { IconClock } from './Icons';

interface Props {
  envelope: TimeCapsuleEnvelope;
  password?: string | null;
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

export function TimeCapsuleUnlock({ envelope, password, onUnlocked, onCancel }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [phase, setPhase] = useState<Phase>(
    envelope.unlockMs <= Date.now() ? 'ready' : 'locked'
  );
  const [error, setError] = useState<string | null>(null);

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
    setPhase('unlocking');
    setError(null);

    // The signature is published within seconds of unlockMs, but drand nodes
    // can lag a beat. Retry NotYetReadyError up to 10x with 3s spacing.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const state = await openTimeCapsule(envelope, password ?? undefined);
        onUnlocked(state);
        return;
      } catch (err) {
        if (err instanceof NotYetReadyError) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        setPhase('error');
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
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
          <button type="button" className="btn" onClick={onCancel}>
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
