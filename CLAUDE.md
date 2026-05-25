# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install
bun run dev        # vite dev server (port 5173)
bun run build      # tsc -b, then vite build → static dist/
bun run preview    # serve the built bundle
bun run test       # vitest run (jsdom)
bun run typecheck  # tsc --noEmit
```

Run a single test file or by name:

```bash
bunx vitest run src/lib/url-codec.test.ts
bunx vitest run -t "round-trips"
```

Tests live next to their subject (`src/lib/*.test.ts`) and currently cover `url-codec` and `markdown` — the two pieces with tricky invariants.

## What this is

A markdown editor with **no backend**. The document *is* the URL: there is no server, database, or API. Local docs live in `localStorage`; sharing serializes the doc into the URL fragment (`#...`), which browsers never transmit. The static `dist/` is the entire app. Read `README.md` for the privacy/threat model — it is accurate and worth trusting.

Deployment target is GitHub Pages under a subpath, so `vite.config.ts` sets `base: '/foil/'`. A strict CSP is injected into `index.html` **at build time only** (`cspPlugin` in `vite.config.ts`); dev skips it so HMR works. If you add any external fetch, you must whitelist its origin in that CSP's `connect-src` — the drand endpoints are already listed there for time capsules.

## Architecture

### The editor is the crux (read these together)

`Editor.tsx`, `lib/markdown.ts`, and `lib/editor-dom.ts` implement a WYSIWYG-ish editor over a **single `contentEditable` div**, and the design is non-obvious:

- **Raw markdown is the source of truth, not the DOM.** Markdown syntax markers (`#`, `**`, `-`, etc.) stay *visible* on screen, wrapped in `.syn` spans that are styled but never hidden or removed.
- `renderDecorated(md)` (markdown.ts) converts markdown to HTML one line per `<div class="ln" data-i="N">`. `getMarkdown(root)` (editor-dom.ts) reconstructs the markdown by reading each `.ln` block's `textContent` and joining with `\n`.
- **The invariant that makes this work: a block's `textContent` equals its raw markdown line, character-for-character** (minus zero-width-space placeholders). If you change rendering in `markdown.ts`, you must not add, drop, or reorder any visible character, or the offset mapping below breaks.
- `​` (U+200B, ZWSP) is the placeholder for empty lines and empty code lines. `getMarkdown` and all offset math strip it; it does not count as a character.
- On every keystroke, `Editor.reRender()` reads the markdown back out, **regenerates the entire `innerHTML`**, then restores the caret via a char-offset round-trip: `getCharOffset` (caret → markdown offset) and `setCharOffset` (markdown offset → caret). These offsets count real markdown characters across blocks (blocks separated by 1 for the `\n`).
- Because `innerHTML` is rebuilt wholesale, nothing persists in the DOM between renders — selection, comment highlights, and caret are all re-derived each time.
- `onKeyDown` handles Enter (list/quote/task continuation) and ⌘B/⌘I/⌘K by editing the *markdown string* and re-rendering, never by mutating the DOM directly.

### Comment anchoring

Comments are **not** stored as offsets. Each `CommentThread` keeps the quoted text plus short `before`/`after` context strings (`types.ts`). After every render, `Editor`'s anchor effect calls `wrapRangeInEditor` (editor-dom.ts) to locate `before+quote+after` in the current markdown and wrap the quote in an `.anchor-hl` span (which may span multiple `.ln` blocks). This re-resolution on each render is why anchors survive edits and travel inside share links.

### Sharing & crypto pipeline

`lib/url-codec.ts` packs/unpacks the URL fragment; `lib/timecapsule.ts` wraps drand tlock. Four fragment schemes, each adding a layer over `gzip(JSON)`:

| Fragment | Layers (outermost last) |
| --- | --- |
| `#d=`  | gzip → base64url |
| `#e=`  | gzip → AES-GCM → base64url |
| `#td=` | gzip → tlock → base64url |
| `#te=` | gzip → AES-GCM → tlock → AES-GCM → base64url |

Key facts: the **password (AES-GCM-256, PBKDF2-SHA256 600k rounds) is always the outermost layer**, so it hides whether a link is even a capsule. `#te=` puts a *second* AES layer under tlock with the same password, so an unsealed capsule is still unreadable without it (see `buildEnvelope`/`openTimeCapsule`). Time-lock uses the drand "quicknet" beacon; `tlock-js`/`drand-client` are **dynamically imported** so they stay out of the main bundle until you seal or open a capsule. `roundAtUnix`/`unixMsAtRound` are pure local math — picking the unlock round needs no network; only decryption does.

### App state & persistence

`App.tsx` is the single stateful component (no router, no global store). Flow:

- **Bootstrap** (mount effect): if the URL has a fragment, decode it and immediately `history.replaceState` to strip it from the address bar; the doc loads **read-only**. A password link short-circuits to `PasswordPromptModal`; a time capsule short-circuits to `TimeCapsuleUnlock` (both `return` early from render, replacing the whole UI). Otherwise load the current doc from `doc-store`, creating a sample doc if none exists.
- **Persistence** (`lib/doc-store.ts`): each doc is its own `localStorage` entry under `foil_doc_<id>`; the current tab's binding lives in `sessionStorage` (`foil_current_id`) so two tabs edit different docs independently. Saves are debounced (~400ms) and skipped in read-only mode. Settings are in `foil_settings`; the comment author name is in `foil_name`.
- **Editing a shared link** forks it into a new local doc (`handleEditShared`) — read-only docs are never written back to the URL.

`lib/settings-config.ts` holds the theme/accent/font/width maps; settings are applied by writing CSS custom properties onto `document.documentElement` (see the effects at the top of `App.tsx` and `src/styles/`).

## Conventions

- Stack is React 18 + TypeScript + Vite, strict mode. The only non-React runtime dep is `tlock-js`.
- DOM-level editor logic is plain TypeScript in `lib/` (testable without React); React components in `components/` stay thin and delegate to it.
- When touching the editor, prefer editing the markdown string and re-rendering over mutating the live DOM — that is the model the whole component assumes.
