# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run workspace commands from the repository root. Bun manages `apps/*` and `packages/*`; Turbo schedules and caches tasks. The website is `@foil/web` in `apps/web`, and `@foil/typescript-config` provides shared base/React settings. Keep dependencies in the package that uses them and use `workspace:*` for internal dependencies. The root owns the pinned toolchain, Turbo and the single `bun.lock`.

```bash
bun install --frozen-lockfile
bun run dev        # workspace dev servers (Foil: port 5173)
bun run build      # tsc -b, then vite build → apps/web/dist/
bun run preview    # serve the built bundle
bun run test       # vitest run (jsdom)
bun run typecheck  # tsc --noEmit
bun run test:e2e:install # install Chromium/WebKit; Linux CI adds --with-deps
bun run test:e2e   # production build, then Chromium/WebKit website + real file tests
```

Use `--filter=@foil/web` to select the website. For package-specific arguments, invoke the installed Turbo CLI directly: Bun's script runner consumes the first `--` separator. Run a single test file, by name, or limit browser workers:

```bash
bunx --no-install turbo run test --filter=@foil/web -- src/lib/url-codec.test.ts
bunx --no-install turbo run test --filter=@foil/web -- -t "round-trips"
bunx --no-install turbo run test:e2e -- --workers=2
```

Unit/component tests live next to their subjects in `apps/web/src/`. Browser tests live in `apps/web/tests/e2e/`. Run typecheck, the full unit suite, then build/e2e sequentially: concurrent builds can starve the real 600k-round KDF tests of their five-second budget. After the default e2e suite completes, validate the root variant with `bunx --no-install turbo run build --filter=@foil/web -- --base /` followed by `FOIL_E2E_BASE=/ bun run --cwd apps/web test:e2e --workers=2`. The package-level browser command uses the existing build; the root Turbo command depends on the default build. Never build both variants into `apps/web/dist/` concurrently. `FOIL_E2E_PORT` selects an alternate preview port (default 4173). Browser tests are uncached; build, typecheck and unit tests use Turbo's local cache.

## What this is

A markdown editor with **no backend**. Local docs live in `localStorage`; sharing serializes a snapshot into a URL fragment (`#...`), which browsers never transmit, or a self-contained HTML file. The static `apps/web/dist/` is the entire website. Read `README.md` for the privacy/threat model.

The default build targets GitHub Pages under a subpath, so `apps/web/vite.config.ts` sets `base: '/foil/'`. `bun run deploy` builds only the website with `--base /` through Turbo, then uploads `apps/web/dist/` to Cloudflare Pages. A strict CSP is injected into `index.html` **at build time only** (`cspPlugin` in the Vite config); dev skips it so HMR works. If you add any external fetch, you must whitelist its origin in that CSP's `connect-src` — the drand endpoints are already listed there for time capsules.

## Architecture

The application source lives in `apps/web/src/`. Paths beginning with `src/`, `build/` or `tests/` below are relative to `apps/web/`.

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
| `#te=` | gzip → tlock → AES-GCM → base64url |

Key facts: the **password (AES-GCM-256, PBKDF2-SHA256 600k rounds) is always the outermost layer**, hiding the unlock round and tlock envelope. For `#te=` that single AES layer gates access to the tlock ciphertext, so opening the capsule needs both the password and the published unlock signature (see `buildEnvelope`/`openTimeCapsule`). Time-lock uses the drand "quicknet" beacon; `tlock-js`/`drand-client` are **dynamically imported** on the website so they stay out of the main bundle until you seal or open a capsule. `roundAtUnix`/`unixMsAtRound` are pure local math; sealing fetches and verifies chain information, while decryption also fetches the round signature.

### Standalone HTML sharing

- `encodeHtmlPayload` / `decodeHtmlPayload` reuse the four codec schemes with a separate bounded file transport budget. URL's 256 KiB cap remains unchanged; file decoding retains the 4 MiB layer, 8 MiB cumulative and document-schema limits. `html-share-format.ts` validates `{ format: 'foil-share', version: 1, payload, shareBaseUrl? }`.
- `Preview` decorates Markdown without importing `Editor`. `ReadOnlyDocument` composes it with read-only threads, all-comment navigation, mobile drawer, statistics and host actions. `useReadingSettings` applies presentation. Website previews supply **Edit anyway**; standalone files supply only Share/Settings/Help.
- `src/standalone/main.tsx` / `StandaloneApp.tsx` read fixed embedded data once, then manage password, time gate, cancellation, error/retry and preview states. Documents never enter local storage; only preferences attempt storage, with an in-memory fallback. `resources.ts` reads the fixed data/script/style blocks, not unlocked DOM.
- `build/standalone.ts`, wired into Vite, builds a Buffer bootstrap IIFE before the reader IIFE and collects all CSS. Build assertions reject editor, library, website resource-loader and external-chunk dependencies. The emitted `foil-standalone.js` is a resource-string module, not a second app launched on the website. Development serves a fresh on-demand build at the same base-relative path.
- Only the website imports `standalone-runtime-loader.ts`, and only an HTML export requests the resource module. `ShareModal` takes `shareBaseUrl` and `exportHtml(state, options, shareBaseUrl)`; the callback returns `{ html, filename }`. The modal handles snapshot/expiry checks and actual Blob download independently of URL-generation success. The file callback reuses its fixed runtime/style blocks so re-export needs no server and cannot recursively embed the template.
- `html-export.ts` safely assembles non-executable JSON, a generic protected filename/title and a CSP hash of the final inline script bytes. File CSP allows only drand connections; website CSP remains `script-src 'self'`. No unsafe browser flags are needed. Ordinary/password files work offline; time capsules retain the drand dependency. New sharing sessions require protection to be selected again.
- `tests/e2e/html-export.spec.ts` clicks real Share downloads, saves to test output, navigates fresh recipient contexts to `file://`, refreshes and re-exports. Fixed quicknet/beacon fixtures are shared with website tests. All HTTP(S) is intercepted, with CORS-enabled drand fixtures only for capsules; do not use `page.setContent` or WebKit's offline switch as a substitute for this path. The latter rejects even simple static file navigation. From the repository root, run this file after a matching build with `bun run --cwd apps/web test:e2e tests/e2e/html-export.spec.ts --workers=2`.

### App state & persistence

`App.tsx` is the single stateful component (no router, no global store). Flow:

- **Bootstrap** (mount effect): if the URL has a fragment, decode it and immediately `history.replaceState` to strip it from the address bar; the doc loads **read-only**. A password link short-circuits to `PasswordPromptModal`; a time capsule short-circuits to `TimeCapsuleUnlock` (both `return` early from render, replacing the whole UI). Otherwise load the current doc from `doc-store`, creating a sample doc if none exists.
- **Persistence** (`lib/doc-store.ts`): each doc is its own `localStorage` entry under `foil_doc_<id>`; the current tab's binding lives in `sessionStorage` (`foil_current_id`) so two tabs edit different docs independently. Saves are debounced (~400ms) and skipped in read-only mode. Settings are in `foil_settings`; the comment author name is in `foil_name`.
- **Editing a shared link** forks it into a new local doc (`handleEditShared`) — read-only docs are never written back to the URL.

`lib/settings-config.ts` holds the theme/accent/font/width maps; settings are applied by writing CSS custom properties onto `document.documentElement` (see the effects at the top of `App.tsx` and `src/styles/`).

## Conventions

- Stack is React 18 + TypeScript + Vite, strict mode. Crypto runtime dependencies are `buffer`, `tlock-js` and `drand-client`.
- DOM-level editor logic is plain TypeScript in `lib/` (testable without React); React components in `components/` stay thin and delegate to it.
- When touching the editor, prefer editing the markdown string and re-rendering over mutating the live DOM — that is the model the whole component assumes.
