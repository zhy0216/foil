import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ImportShareLinkError, parseShareLink } from '../lib/import-share-link';
import './OpenSharedLink.css';

export function OpenSharedLink() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  return (
    <>
      <button ref={triggerRef} type="button" className="btn" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Open shared link
      </button>
      {open && <ImportDialog onClose={close} />}
    </>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current!;
    // Native modal behavior confines keyboard focus and makes the app inert.
    dialog.showModal();
    inputRef.current?.focus();
    return () => dialog.close();
  }, []);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    let fragment: string;
    try {
      fragment = parseShareLink(input);
    } catch (failure) {
      setError(failure instanceof ImportShareLinkError ? failure.message : 'Could not read this share link.');
      inputRef.current?.focus();
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') + fragment });
      close();
    } catch {
      setError('Could not open a new tab. Your link is still here; try again.');
      inputRef.current?.focus();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal open-shared-link"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      onCancel={event => {
        event.preventDefault();
        if (!pending.current) close();
      }}
    >
      <h3 id={`${id}-title`}>Open shared link</h3>
      <p id={`${id}-help`} className="modal-sub">
        Open a read-only preview in a new tab. Choose Edit anyway there to save a local copy.
      </p>
      <form onSubmit={submit} aria-busy={busy}>
        <label htmlFor={`${id}-input`}>Foil share link or fragment</label>
        <textarea
          ref={inputRef}
          id={`${id}-input`}
          rows={4}
          value={input}
          readOnly={busy}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-format${error ? ` ${id}-error` : ''}`}
          onChange={event => { setInput(event.target.value); setError(null); }}
        />
        <p id={`${id}-format`} className="open-shared-link-hint">
          Paste an HTTP(S) URL or a #d=, #e=, #td= or #te= fragment.
        </p>
        {error && <p id={`${id}-error`} className="open-shared-link-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={close}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Opening…' : 'Open in new tab'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
