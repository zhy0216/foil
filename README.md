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
- **Encrypted sharing.** Optionally lock a link with a password before sharing. The document is encrypted with AES-GCM-256 using a key derived via PBKDF2-SHA256 (200,000 rounds) from your password. The password is never in the URL — only the ciphertext, salt, and IV are.
- **Settings stay local too.** Theme, font, and your display name for comments are kept in `localStorage` and never travel with a share link.

If the host disappears tomorrow, your old links keep working as long as you have a copy of Foil's static files and the URL.

### Threat model, briefly

- **Hosting provider can't read your docs** — fragments aren't transmitted.
- **Anyone with the link can read it** — treat unencrypted links like a file you emailed. Use the password option for sensitive content.
- **Browser history, sync, and clipboard managers** will see the full URL. If you share a link over a channel that logs URLs (some chat apps, analytics-laden redirectors), the document goes with it. Encrypt first if that matters.
- **No forward secrecy.** A leaked password decrypts every link made with it.

## How it works

**Local editing.** Each document is a JSON blob in `localStorage` under `foil_doc_<id>`. The currently open doc is tracked in `sessionStorage`, so two tabs can edit different docs side by side. Edits debounce-save back to the same key; the URL is never used for storage.

**Sharing.** When you open the share dialog, Foil:

1. Serializes the document to JSON.
2. Compresses it with `CompressionStream('gzip')`.
3. Either base64url-encodes it as `#d=…` (plain) or encrypts it with AES-GCM and encodes as `#e=…` (password-protected).
4. Writes the result to the clipboard as a link.

**Loading a shared link.** On load, if the URL has a fragment, Foil decodes it, clears the fragment from the address bar, and renders the document in read-only mode. Click the edit affordance to fork it into your local library.

See `src/lib/url-codec.ts` and `src/lib/doc-store.ts` for the full implementations.

## Features

- WYSIWYG-ish markdown — formatting renders inline as you type
- Local document library: switch, rename, delete from the title-bar dropdown
- Inline comments anchored to text, traveling with the link
- Password-encrypted share links
- Read-only previews for shared links, one-click fork into your library
- Light/dark/auto theme, configurable accent, prose font, width, and density
- Keyboard shortcuts: ⌘B / ⌘I / ⌘K

## Develop

```bash
bun install
bun run dev       # vite dev server
bun run build     # typecheck + bundle to dist/
bun run preview   # serve the built bundle
```

Stack: React 18 + TypeScript + Vite. No runtime dependencies beyond React.

## Deploy

`bun run build` produces a fully static `dist/`. Drop it on any static host (GitHub Pages, Netlify, S3, a USB stick). There is nothing else to run.
