# Help modal — design

Add a Help entry next to Settings in the top bar that opens a modal explaining what Foil is and how its encryption works. Content reuses the README's privacy section.

## Goal

A first-time visitor (or someone shown a shared link) can answer two questions in under a minute, without leaving the app:

1. What is this thing?
2. If I encrypt a share, what stops the host — or anyone in between — from reading it?

## Surface

A new `?`-in-circle icon button placed in the bottom status bar, **immediately left of the GitHub link**. Same visual weight as the GitHub icon (16px, 0.75 → 1 opacity on hover), so it reads as ambient meta-info rather than a primary action. Clicking opens a modal that visually matches `SettingsModal` (same backdrop, panel, head, section, and action styles).

```
123 words · 456 chars · 2 min read                          [ ? ] [ GH ]  Saved
                                                             ↑ new
```

## Components

- `IconHelp` in `src/components/Icons.tsx` — 16px SVG, circle + `?`, stroke style matching the other icons; sized to match the adjacent GitHub mark.
- `HelpModal` in `src/components/HelpModal.tsx` — same skeleton as `SettingsModal`: `.modal-backdrop` → `.modal.settings-modal` → `.settings-head` with `IconClose` → `.modal-sub` lede → six `.settings-section` blocks → `.modal-actions` with a single "Done" button. Props: `{ open: boolean; onClose: () => void }`.
- `App.tsx` — adds `helpOpen` state, a `.help-link` button inside `.statusbar .right` immediately before the GitHub link, and renders `<HelpModal>` alongside `<SettingsModal>`.
- `styles.css` — adds `.help-text` block (paragraph + code/link/strong) for in-modal prose, and extends the `.statusbar .github-link` selector to also cover `.help-link` (same opacity/hover treatment).

No state outside the open flag. No persistence. No keyboard shortcut.

## Content (English, six sections)

1. **What Foil is** — A markdown editor that runs entirely in your browser. No backend, no database, no accounts. The static HTML/JS is the whole app.
2. **Where your data lives** — Each document is a JSON blob in `localStorage` under `foil_doc_<id>`. Settings (theme, font, display name) stay local. Clearing site data wipes everything.
3. **How sharing works** — Foil gzips the document, base64url-encodes it, and writes it after `#` in the URL. Browsers never send the part after `#` to servers, so the host that serves Foil can't see what you shared. On open, Foil decodes the fragment and immediately strips it from the address bar.
4. **Password encryption (`#e=`)** — AES-GCM-256. The key is derived from your password with PBKDF2-SHA256 over 200,000 rounds, with a random salt and IV per share. The password never appears in the URL — only ciphertext, salt, and IV.
5. **Time capsule (`#td=` / `#te=`)** — Uses [drand](https://drand.love) quicknet's tlock: drand publishes a fresh BLS signature every 3 seconds, but the signature needed to decrypt your capsule doesn't exist on the network until the unlock time you chose. `#te=` adds the password layer on top.
6. **Learn more** — Link to `https://github.com/zhy0216/foil#readme`.

Each section is a `.settings-label` heading + 1–2 short paragraphs. Inline code uses `<code>`. External links use `target="_blank" rel="noopener noreferrer"`.

## Non-goals

- No i18n. Matches the rest of the UI (English).
- No interactive demo, no diagram. Text only.
- No analytics on opening the modal (the app has no analytics anywhere).
- No "don't show again" flag — this is on-demand, not onboarding.

## Verification

- `bun run build` passes (typecheck + bundle).
- Open dev server, confirm:
  - Help icon renders left of Settings, same size.
  - Clicking opens the modal; clicking backdrop or Done closes it.
  - External links open in a new tab.
  - On mobile width, the modal matches Settings' responsive behavior (already covered by shared CSS).
