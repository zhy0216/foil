# Foil

A markdown editor that lives entirely in your browser. Type, format, share by copying a link.

## Privacy

**There is no backend. There is no database. Nothing you write leaves your device.**

Foil stores the entire document — text, title, comments — inside the URL itself, after the `#`:

```
https://foil.example/#d=H4sIAAAAAAAAA02OTQ...
```

The piece after `#` is called the **URL fragment**. Browsers, by design, **never send fragments to the server** in HTTP requests. So the host that serves Foil sees only that you loaded the page; it has no way to read what you wrote, what's in the link you opened, or what links you shared.

What this means in practice:

- **No accounts, no telemetry, no logs.** The static HTML/JS is the entire app.
- **Sharing = copying a link.** The link *is* the document. Anyone with the link has the document; anyone without it does not.
- **Encrypted sharing.** Optionally lock a link with a password before sharing. The document is encrypted with AES-GCM-256 using a key derived via PBKDF2-SHA256 (200,000 rounds) from your password. The password is never in the URL — only the ciphertext, salt, and IV are.
- **localStorage stays local.** Personal settings (theme, font, your display name for comments) are kept in your browser's localStorage and never travel with the link.

If the host disappears tomorrow, your old links keep working as long as you have a copy of Foil's static files and the URL.

### Threat model, briefly

- **Hosting provider can't read your docs** — fragments aren't transmitted.
- **Anyone with the link can read it** — treat unencrypted links like a file you emailed. Use the password option for sensitive content.
- **Browser history, sync, and clipboard managers** will see the full URL. If you share a link over a channel that logs URLs (some chat apps, analytics-laden redirectors), the document goes with it. Encrypt first if that matters.
- **No forward secrecy.** A leaked password decrypts every link made with it.

## How it works

1. The document is serialized to JSON.
2. Compressed with `CompressionStream('gzip')`.
3. Either base64url-encoded as `#d=…` (plain) or encrypted with AES-GCM and encoded as `#e=…` (password-protected).
4. Written back to `window.location.hash` via `history.replaceState` on every edit (debounced).
5. On load, the hash is decoded and the document is restored.

See `src/lib/url-codec.ts` for the full implementation — it's about 130 lines.

## Features

- WYSIWYG-ish markdown — formatting renders inline as you type
- Inline comments anchored to text, traveling with the link
- Password-encrypted share links
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
