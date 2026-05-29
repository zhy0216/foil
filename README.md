# Foil

A markdown editor that lives entirely in your browser. Type, format, share by copying a link.

## Privacy

**There is no backend. There is no database. Nothing you write leaves your device.**

Your local documents are kept in `localStorage`. When you want to share one, Foil packs it into a link of the form:

```
https://foil.example/#d=H4sIAAAAAAAAA02OTQ...
```

The piece after `#` is called the **URL fragment**. Browsers, by design, **never send fragments to the server** in HTTP requests. So the host that serves Foil sees only that you loaded the page; it has no way to read what you wrote, what's in the link you opened, or what links you shared. When a recipient opens a share link, Foil decodes the fragment and immediately strips it from the address bar, so the encoded blob doesn't linger in tab titles or screen-shared windows.

What this means in practice:

- **No accounts, no telemetry, no logs.** The static HTML/JS is the entire app.
- **Your library is local.** Documents live in your browser's `localStorage` under per-doc keys; clearing site data wipes them. Switch between them, rename, or delete from the title-bar dropdown.
- **Sharing = copying a link.** The link *is* the document. Anyone with the link has the document; anyone without it does not.
- **Shared links open read-only.** Recipients see a preview; one click forks it into their own local library, where their edits stay on their device.
- **Encrypted sharing.** Optionally lock a link with a password before sharing. The document is encrypted with AES-GCM-256 using a key derived via PBKDF2-SHA256 (600,000 rounds) from your password. The password is never in the URL — only the ciphertext, salt, and IV are.
- **Time capsules.** Optionally seal a link until a future date. Until then *nobody* — not even you — can open it. This uses [drand](https://drand.love) time-lock encryption (tlock): the document is encrypted against a future round of the drand "quicknet" beacon, and only becomes decryptable once that round's signature is published. The wait is enforced by a public randomness network, not by Foil. Combine it with a password and the chain is `plaintext → AES → tlock → AES`, so even an unsealed capsule is useless without the password.
- **Settings stay local too.** Theme, font, and your display name for comments are kept in `localStorage` and never travel with a share link.

If the host disappears tomorrow, your old links keep working as long as you have a copy of Foil's static files and the URL.

### Threat model, briefly

- **Hosting provider can't read your docs** — fragments aren't transmitted.
- **Anyone with the link can read it** — treat unencrypted links like a file you emailed. Use the password option for sensitive content.
- **Browser history, sync, and clipboard managers** will see the full URL. If you share a link over a channel that logs URLs (some chat apps, analytics-laden redirectors), the document goes with it. Encrypt first if that matters.
- **No forward secrecy.** A leaked password decrypts every link made with it.
- **Time capsules depend on drand.** A capsule can only be opened once the drand quicknet beacon publishes the unlock round. If that network disappears permanently, a sealed capsule is unrecoverable — even by you. Holding the link does *not* let anyone open it early.

## How it works

**Local editing.** Each document is a JSON blob in `localStorage` under `foil_doc_<id>`. The currently open doc is tracked in `sessionStorage`, so two tabs can edit different docs side by side. Edits debounce-save back to the same key; the URL is never used for storage.

**Sharing.** When you open the share dialog, Foil serializes the document to JSON, compresses it with `CompressionStream('gzip')`, and packs it into one of four fragment schemes depending on the options you pick:

| Fragment | Options | Layers |
| --- | --- | --- |
| `#d=…`  | plain                 | gzip → base64url |
| `#e=…`  | password              | gzip → AES-GCM → base64url |
| `#td=…` | time capsule          | gzip → tlock → base64url |
| `#te=…` | time capsule + password | gzip → tlock → AES-GCM → base64url |

The password layer is always outermost, so someone without the password can't even tell a capsule from a plain encrypted link, nor read its unlock round. The result is written to the clipboard as a link.

**Loading a shared link.** On load, if the URL has a fragment, Foil decodes it and clears the fragment from the address bar. Password links prompt for the password; time capsules show an unlock screen and stay sealed until drand publishes the unlock round. Once open, the document renders read-only — click the edit affordance to fork it into your local library.

See `src/lib/url-codec.ts` (packing), `src/lib/timecapsule.ts` (drand tlock), and `src/lib/doc-store.ts` (local storage) for the full implementations.

## Features

- WYSIWYG-ish markdown — formatting renders inline as you type
- Local document library: switch, rename, delete from the title-bar dropdown
- Inline comments anchored to text, traveling with the link
- Password-encrypted share links
- Time-capsule share links sealed until a future date via drand tlock (and optionally password-protected too)
- Read-only previews for shared links, one-click fork into your library
- Light/dark/auto theme, configurable accent, prose font, width, and density
- Keyboard shortcuts: ⌘B / ⌘I / ⌘K

## Develop

```bash
bun install
bun run dev       # vite dev server
bun run build     # typecheck + bundle to dist/
bun run preview   # serve the built bundle
bun run test      # vitest (url-codec, markdown)
```

Stack: React 18 + TypeScript + Vite. The only runtime dependency beyond React is `tlock-js` (with `drand-client`) for time capsules, dynamically imported so it stays out of the main bundle until you seal or open one.

## Deploy

`bun run build` produces a fully static `dist/`. Drop it on any static host (GitHub Pages, Netlify, S3, a USB stick). There is nothing else to run.
