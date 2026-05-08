import { useEffect, useState } from 'react';
import { encodeUrl } from '../lib/url-codec';
import type { DocState } from '../types';
import { IconCopy, IconLock } from './Icons';

interface Props {
  open: boolean;
  onClose: () => void;
  getState: () => DocState;
  onToast: (msg: string) => void;
}

export function ShareModal({ open, onClose, getState, onToast }: Props) {
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [size, setSize] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const state = getState();
        const hash = await encodeUrl(state, usePassword && password ? password : null);
        if (cancelled) return;
        const u = window.location.origin + window.location.pathname + hash;
        setUrl(u);
        setSize(hash.length);
      } catch (e) {
        if (!cancelled) onToast("Couldn't build link: " + (e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, usePassword, password, getState, onToast]);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      onToast(usePassword && password ? 'Encrypted link copied' : 'Link copied');
      onClose();
    } catch {
      onToast("Couldn't copy — select the box and copy manually");
    }
  };

  const sizeKb = (size / 1024).toFixed(1);
  const tooBig = size > 8000;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Share this document</h3>
        <p className="modal-sub">
          Everything — text, comments, title — lives in the link itself. Nothing leaves your
          browser.
        </p>

        <div className="switch-row">
          <IconLock />
          <div className="label-stack">
            <b>Encrypt with a password</b>
            <span>
              AES-GCM 256, PBKDF2 200k rounds. Anyone with the link will need this password.
            </span>
          </div>
          <div
            className={'toggle' + (usePassword ? ' on' : '')}
            onClick={() => setUsePassword((v) => !v)}
          />
        </div>

        {usePassword && (
          <>
            <label>Password</label>
            <input
              type="password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Choose a password"
            />
          </>
        )}

        <label style={{ marginTop: 16 }}>Shareable link</label>
        <div className="url-row">
          <input
            type="text"
            readOnly
            value={busy ? 'Building link…' : url}
            onFocus={(e) => e.target.select()}
          />
          <button className="btn btn-primary" onClick={copy} disabled={busy || !url}>
            <IconCopy /> Copy
          </button>
        </div>
        <div className="stat-row">
          <span>{tooBig ? '⚠ Some browsers cap URLs around 8 KB' : 'Fits in any modern browser'}</span>
          <span>{sizeKb} KB</span>
        </div>

        <div className="modal-actions">
          <div className="spacer" />
          <button className="btn btn-ghost-bordered" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
