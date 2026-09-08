# Foil

A markdown editor that lives entirely in your browser. Type, format, share a link or an HTML file.

Open Foil on [Cloudflare Pages](https://foil-47v.pages.dev/). If that site is unavailable, use the [GitHub Pages backup](https://zhy0216.github.io/foil/).

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
- **Share a link or HTML file.** Each contains a snapshot of the title, text and comments. Anyone holding an unprotected copy can read it.
- **Shared links open read-only.** Recipients see a preview; one click forks it into their own local library, where their edits stay on their device.
- **Encrypted sharing.** Optionally lock a link or HTML file with a password before sharing. The document is encrypted with AES-GCM-256 using a key derived via PBKDF2-SHA256 (600,000 rounds) from your password. The password is never in the link or file — only the ciphertext, salt, and IV are. Protected files use a generic filename and hide the title, text and comments until unlocked.
- **Time capsules.** Optionally seal a link or HTML file until a future date. Until then *nobody* — not even you — can open it. This uses [drand](https://drand.love) time-lock encryption (tlock): the document is encrypted against a future round of the drand "quicknet" beacon, and only becomes decryptable once that round's signature is published. The wait is enforced by a public randomness network, not by Foil. Combine it with a password and the chain is `gzip → tlock → AES-GCM`, so opening it needs both the published signature and the password.
- **Settings stay local too.** Theme, font, and your display name for comments are kept in `localStorage` and never travel with a share link or HTML file.

If the host disappears tomorrow, your old links keep working as long as you have a copy of Foil's static files and the URL.

### Threat model, briefly

- **Hosting provider can't read your docs** — fragments aren't transmitted.
- **Anyone with the link can read it** — treat unencrypted links like a file you emailed. Use the password option for sensitive content.
- **Browser history, sync, and clipboard managers** will see the full URL. If you share a link over a channel that logs URLs (some chat apps, analytics-laden redirectors), the document goes with it. Encrypt first if that matters.
- **No forward secrecy.** A leaked password decrypts password-protected links and files made with it; time capsules also require their drand unlock signature.
- **Time capsules depend on drand.** A capsule can only be opened once the drand quicknet beacon publishes the unlock round. If that network disappears permanently, a sealed capsule is unrecoverable — even by you. Holding the link does *not* let anyone open it early.

## Share an HTML file

1. Open **Share**, choose an optional password and/or time lock, and click **Export HTML**.
2. Send the downloaded `.html` file directly. Give the recipient any password separately.
3. The recipient saves the attachment and opens it in a current browser with JavaScript enabled. Enter the password if prompted; a time capsule also waits for its unlock date, then offers **Decrypt**.

The file includes its entire reading program and styles. **Ordinary and password-protected files work offline**, including reopening, refreshing and exporting another file. Time capsules need drand access when created or decrypted, including when the unlock date has already passed. No document text or ciphertext is sent to drand. If the connection fails, retry after restoring it; cancelling leaves the file available to reopen.

Files provide a read-only preview: title, Markdown text, all existing comments and replies, desktop comment anchors, a mobile comment drawer, text selection/copy, reading statistics, settings, help and sharing. They have no editor, document library, title editing or comment-writing controls. Website share links can still be forked into a local library with **Edit anyway**.

Each export is a snapshot and never follows later author edits. Reading settings change presentation, not the document saved in the file; they remain usable for the session if browser storage is denied. From the file's **Share** dialog you can export again or copy a link to its source website. Each new sharing session starts without protection: select any password or time lock again. Website links still have a 256 KiB limit; larger documents within the file format's limits can use HTML export.

Actual local file opening is tested in Playwright Chromium and WebKit. Support is not guaranteed for every browser or mail/chat attachment preview; save the attachment and open it in a browser instead of relying on an embedded preview.

## How it works

**Local editing.** Each document is a JSON blob in `localStorage` under `foil_doc_<id>`. The currently open doc is tracked in `sessionStorage`, so two tabs can edit different docs side by side. Edits debounce-save back to the same key; the URL is never used for storage.

**Sharing.** When you open the share dialog, Foil serializes the document to JSON, compresses it with `CompressionStream('gzip')`, and packs it into one of four fragment schemes depending on the options you pick:

| Fragment | Options | Layers |
| --- | --- | --- |
| `#d=…`  | plain                 | gzip → base64url |
| `#e=…`  | password              | gzip → AES-GCM → base64url |
| `#td=…` | time capsule          | gzip → tlock → base64url |
| `#te=…` | time capsule + password | gzip → tlock → AES-GCM → base64url |

The password layer is always outermost, so someone without the password cannot read the capsule's unlock round or tlock envelope. Copy writes a website link to the clipboard. Export HTML embeds the same payload schemes in versioned file data with a self-contained read-only program; it has a separate bounded transport budget and retains the codec's decompression and document-structure limits.

**Loading a shared link.** On load, if the URL has a fragment, Foil decodes it and clears the fragment from the address bar. Password links prompt for the password; time capsules show an unlock screen and stay sealed until drand publishes the unlock round. Once open, the document renders read-only — click the edit affordance to fork it into your local library.

See `apps/web/src/lib/url-codec.ts` (packing), `apps/web/src/lib/timecapsule.ts` (drand tlock), and `apps/web/src/lib/doc-store.ts` (local storage) for the full implementations.

## Features

- WYSIWYG-ish markdown — formatting renders inline as you type
- Local document library: switch, rename, delete from the title-bar dropdown
- Inline comments anchored to text, traveling with the link
- Password-encrypted share links
- Time-capsule share links sealed until a future date via drand tlock (and optionally password-protected too)
- Read-only previews for shared links, one-click fork into your library
- Self-contained HTML snapshots, read-only with offline ordinary/password reading and re-export
- Light/dark/auto theme, configurable accent, prose font, width, and density
- Keyboard shortcuts: ⌘B / ⌘I / ⌘K

## Repository layout

This is a [Turborepo](https://turborepo.com/docs/crafting-your-repository/structuring-a-repository) monorepo using Bun workspaces and one root lockfile.

```text
apps/
  web/                       # @foil/web: the Foil website
    src/                     # React app, standalone reader and unit tests
    tests/e2e/               # Playwright website and local-file tests
    build/                   # Standalone HTML build plugin
    dist/                    # Generated static website (ignored)
packages/
  typescript-config/         # @foil/typescript-config: base and React TS configs
turbo.json                   # Task dependencies and cache settings
package.json                # Workspace definitions and root commands
bun.lock                    # Shared dependency lockfile
```

New applications belong in `apps/<name>` and shared libraries/configuration in `packages/<name>`. Give each a unique package name (for example `@foil/api`) and its own `package.json`, scripts and dependencies, then run `bun install` at the repository root. Declare internal dependencies with `workspace:*`; React apps can depend on `@foil/typescript-config` and extend `@foil/typescript-config/react.json`. Turbo discovers matching scripts automatically. Use a different development port for each app.

## Develop

Run these commands from the repository root with the versions pinned in `.node-version` and `package.json` (Node 22.22.3 and Bun 1.4.2):

```bash
bun install --frozen-lockfile
bun run dev       # run workspace dev servers (Foil: port 5173)
bun run build     # typecheck + bundle; Foil output: apps/web/dist/
bun run preview   # serve the already-built bundle
bun run typecheck
bun run test      # all unit/component tests; run before builds, not concurrently
bun run test:e2e:install # first use: install Chromium + WebKit; Linux CI adds --with-deps
bun run test:e2e   # production build, then Chromium + WebKit website/file tests
```

Root commands use Turbo. `build`, `typecheck` and `test` are cached in `.turbo/`; browser tests always run and depend on the production build. Dev and preview servers are persistent and uncached. Limit a task with `--filter=@foil/web`. For package-specific arguments, invoke the installed Turbo CLI directly with `bunx --no-install` so Bun's script runner does not consume Turbo's `--` separator:

```bash
bun run dev --filter=@foil/web
bunx --no-install turbo run test --filter=@foil/web -- src/lib/url-codec.test.ts
bunx --no-install turbo run test:e2e -- --workers=2
```

For root-path regression, finish the default suite first, then run these commands sequentially:

```bash
bunx --no-install turbo run build --filter=@foil/web -- --base /
FOIL_E2E_BASE=/ bun run --cwd apps/web test:e2e --workers=2
```

`FOIL_E2E_PORT=4273` can select a free preview port for either test command. The package-level `test:e2e` runs Playwright against the existing build, so use it for the root-path variant; the root-level Turbo command first ensures the default `/foil/` build. Do not run two builds against the same `apps/web/dist/`. To run only the file matrix after a matching build, use `bun run --cwd apps/web test:e2e tests/e2e/html-export.spec.ts --workers=2` (add `FOIL_E2E_BASE=/` for a root build). Downloads and reports stay in ignored Playwright output directories under `apps/web/`; tests use only fixtures from the current checkout and never use public drand services. WebKit file tests reject all HTTP(S) through routing instead of Playwright's offline switch, which also prevents static file navigation.

Stack: React 18 + TypeScript + Vite, with `buffer`, `tlock-js` and `drand-client` for time capsules. Website crypto stays dynamically loaded. The standalone reader includes crypto and styles in one file; its resource module is loaded by the website only when exporting HTML. Each build checks that the standalone entry has no editor/document-library dependencies or external chunks.

## Deploy

With Wrangler installed and logged into the Cloudflare account that owns the `foil` Pages project (`wrangler login`), run:

```bash
bun run deploy
```

Bun reserves `deploy` as a built-in subcommand, so the `run` keyword is required.

This uses Turbo to typecheck and build only `@foil/web` into `apps/web/dist/` with root asset paths (`--base /`), then publishes it to the `foil` project's `main` production branch at [foil-47v.pages.dev](https://foil-47v.pages.dev/). The upload runs outside Turbo's cache and environment filtering.

`bun run build` produces a fully static `apps/web/dist/` with `/foil/` asset paths for the GitHub Pages backup; its workflow uploads this directory. For a host serving at `/`, use `bunx --no-install turbo run build --filter=@foil/web -- --base /` and the same output directory. If configuring [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/configuration/monorepos/), keep the repository root as the build root, use this root-path build command, and set the output directory to `apps/web/dist`.

Use **Share → Export HTML** to send a single document that opens directly as a local file.
