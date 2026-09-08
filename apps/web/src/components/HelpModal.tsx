import { IconClose } from './Icons';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function HelpModal({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h3>About Foil</h3>
          <button className="btn btn-icon" onClick={onClose} title="Close" aria-label="Close">
            <IconClose />
          </button>
        </div>
        <p className="modal-sub">
          A markdown editor that lives entirely in your browser — and how it keeps what you share private.
        </p>

        <div className="settings-section">
          <div className="settings-label">What Foil is</div>
          <p className="help-text">
            Foil is a markdown editor that runs entirely in your browser. There is no backend, no
            database, and no accounts. The static HTML and JavaScript you loaded is the whole app.
          </p>
        </div>

        <div className="settings-section">
          <div className="settings-label">Where your data lives</div>
          <p className="help-text">
            Documents you edit on the website stay in this browser's local library. Clearing
            site data removes that library. Shared HTML files keep their document in the file
            and do not add it to a local library. Reading preferences stay on this device;
            if storage is unavailable, you can still read and adjust them for this session.
          </p>
        </div>

        <div className="settings-section">
          <div className="settings-label">How sharing works</div>
          <p className="help-text">
            A share link contains a compressed snapshot of the title, text and comments after{' '}
            <code>#</code> in the URL — for example <code>foil.example/#d=H4sIAAA…</code>. Browsers,
            by design, never send the part after <code>#</code> to servers, so the host that serves
            Foil cannot see what you shared. When a recipient opens the link, Foil decodes the
            fragment and immediately strips it from the address bar.
          </p>
        </div>

        <div className="settings-section">
          <div className="settings-label">Share an HTML file</div>
          <p className="help-text">
            Open Share, choose any password or time lock, then select <strong>Export HTML</strong>.
            Send the downloaded .html file directly. The recipient saves it and opens it in a
            current browser with JavaScript enabled. The reading program and styles are included:
            ordinary and password-protected files work offline. Creating or opening time capsules
            needs a connection to drand, even when the unlock date has passed.
          </p>
          <p className="help-text">
            Files provide a read-only preview with the title, text, all comments, comment
            navigation, reading settings and sharing. They have no editor or comment-writing
            controls. A snapshot never follows later author edits; changing reading preferences
            does not change the saved document. Share can export another file or create a link
            to the source website. Choose protection again each time you share.
          </p>
          <p className="help-text">
            Local files are tested in Chromium and WebKit. Mail and chat attachment previews
            may not run the reading program; download the attachment and open it in your browser.
          </p>
        </div>

        <div className="settings-section">
          <div className="settings-label">Password encryption</div>
          <p className="help-text">
            A password-protected link or HTML file (<code>#e=</code>) is encrypted with AES-GCM-256. The key is
            derived from your password using PBKDF2-SHA256 with <strong>600,000 rounds</strong>,
            with a random salt and IV per share. Only the ciphertext, salt, and IV end up in the
            link or file — never the password itself. Protected files also hide the title and
            comments until unlocked. Give the recipient the password separately.
          </p>
        </div>

        <div className="settings-section">
          <div className="settings-label">Time capsule</div>
          <p className="help-text">
            A time capsule link or HTML file (<code>#td=</code>) uses{' '}
            <a href="https://drand.love" target="_blank" rel="noopener noreferrer">
              drand
            </a>{' '}
            quicknet's tlock. drand publishes a fresh BLS signature every 3 seconds, but the
            signature needed to decrypt your capsule does not yet exist on the network — it will
            only be published at the unlock time you chose. <code>#te=</code> adds a password
            layer on top, so the recipient needs both the time <em>and</em> the password.
          </p>
          <p className="help-text">
            One thing to note: unlocking a capsule fetches the round signature from a public drand
            endpoint, so the drand network can see that <em>some</em> client (your IP) is unlocking
            <em> some</em> capsule at that time. drand never sees the ciphertext or the plaintext,
            and the same signature serves countless capsules — but if request-time visibility
            matters, you may want to route the unlock through a proxy or Tor.
          </p>
        </div>

        <div className="settings-section">
          <div className="settings-label">Learn more</div>
          <p className="help-text">
            Full details, threat model, and source live in the{' '}
            <a
              href="https://github.com/zhy0216/foil#readme"
              target="_blank"
              rel="noopener noreferrer"
            >
              README on GitHub
            </a>
            .
          </p>
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
