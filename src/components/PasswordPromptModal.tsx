import { useState } from 'react';

interface Props {
  error: string | null;
  onSubmit: (pw: string) => void;
  onCancel: () => void;
}

export function PasswordPromptModal({ error, onSubmit, onCancel }: Props) {
  const [pw, setPw] = useState('');
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>This document is encrypted</h3>
        <p className="modal-sub">Enter the password to read it.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(pw);
          }}
        >
          <label>Password</label>
          <input
            type="password"
            value={pw}
            autoFocus
            onChange={(e) => setPw(e.target.value)}
          />
          {error && (
            <div className="stat-row" style={{ color: 'var(--cerulean-400)' }}>
              ⚠ {error}
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <div className="spacer" />
            <button type="submit" className="btn btn-primary">
              Unlock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
