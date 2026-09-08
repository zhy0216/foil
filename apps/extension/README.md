# Foil extension

Chrome/Edge Manifest V3 application. Each click on **Open Foil** in the toolbar opens the full packaged editor in a new tab. Installation itself opens no tab. The editor, styles, crypto chunks and HTML reader resource are bundled in `dist/`; no development server is needed.

## Build and load locally

Use the repository's Node 22.22.3 and Bun 1.4.2. From the repository root:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build --filter=@foil/extension
bun run --cwd apps/extension check
bun run --cwd apps/extension package
```

`package` rebuilds production output, checks the manifest, local resource/import paths, worker and PNG dimensions, then writes `apps/extension/artifacts/foil-extension-0.1.0.zip`. The ZIP has `manifest.json` at its root and contains only runtime files. Its ordering/timestamps are fixed, and every compressed file is checked by an in-memory extraction. ZIPs, screenshots and exploratory profiles belong in ignored `artifacts/` or `test-results/`, outside `dist/`.

Open `chrome://extensions` in Chrome or `edge://extensions` in Edge, enable **Developer mode**, choose **Load unpacked**, and select `apps/extension/dist`. For the ZIP, extract it first and select the extracted directory containing `manifest.json`. Pin Foil from the browser's Extensions menu, then click its icon. See [Chrome's local extension instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) and [Edge's sideload/reload instructions](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading).

## Development

```bash
bun run dev --filter=@foil/extension
```

This runs a persistent, uncached production build watcher using Turbo's existing `dev` task. It emits local scripts under the same CSP as production. Wait for a completed build, click **Reload** on the extension card, then refresh or reopen Foil's tab. Reader-only source edits also trigger the shared HTML resource rebuild. Restart the watcher after changing build configuration, environment variables or generated icons. The website's dev server remains independent on port 5173; the extension watcher opens no port.

The existing root `build`, `typecheck` and `test` tasks discover this workspace. Build outputs use the existing `dist/**`/TypeScript cache metadata; all outputs stay app-local. Run tests, builds, and browser checks sequentially because the shared password tests perform a real KDF.

## Website sharing and storage

`src/config.ts` exports `resolveShareBaseUrl(value: string | undefined)` and `DEFAULT_SHARE_BASE_URL`. The mount passes the resolved value as `<App shareBaseUrl={...} />`. `undefined` defaults to `https://foil-47v.pages.dev/`; explicit invalid values (including empty strings, non-HTTP(S) schemes or credentials) fail the build. The shared normalizer preserves the path and removes search/hash. The same public base goes into links and exported HTML metadata, never the extension origin.

For a different website, set `VITE_FOIL_SHARE_BASE_URL` in the build environment or the app's production Vite env file. For example, preserving the GitHub Pages backup path:

```bash
VITE_FOIL_SHARE_BASE_URL=https://zhy0216.github.io/foil/ bun run --cwd apps/extension package
```

Local editing, ordinary/password links and their HTML exports work offline. Time capsules need drand's verified chain information/signatures. The extension keeps Foil's existing page-local `localStorage` documents/settings and per-tab `sessionStorage` binding. Its origin has a separate library from the website, with no automatic migration or sync. Clearing extension data, removing the extension, or losing the profile can lose documents; retain exported copies when needed. Existing storage error handling remains in the shared editor. Clipboard copying uses a user click and the existing manual-copy fallback on denial; HTML downloads use the existing Blob link.

## Manifest policy

Scripts run only from the local package (`script-src 'self'`); objects are disabled. Existing inline presentation styles, local/data images and local fonts are allowed. `connect-src` allows self (the packaged HTML resource) and exactly these host grants:

```text
https://api.drand.sh/*
https://drand.cloudflare.com/*
https://api2.drand.sh/*
https://api3.drand.sh/*
```

These retain the shared client's quicknet `/<chain-hash>/info` and `/<chain-hash>/public/<round>` requests, failover and signature verification. Host permissions allow the cross-origin drand requests; CSP independently restricts connections. The worker synchronously registers `chrome.action.onClicked` and only calls `chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })`, with a fixed error message on failure. Tab creation needs no `tabs` grant. There are no general API permissions, content scripts, popup, sandbox pages or web-accessible resources. See [action behavior](https://developer.chrome.com/docs/extensions/reference/api/action), [worker registration](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events), [tab permissions](https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions), [extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) and [cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

## Brand icons

The committed 16/32/48/128 px PNGs rasterize `@foil/editor/brand/foil-mark.svg` with its unchanged viewBox, padding, paths and ink. A pale rounded backing preserves contrast on dark toolbars. To reproduce with the pinned Playwright Chromium:

```bash
bun run test:e2e:install
bun run --cwd apps/extension icons
```

`scripts/icons.ts` uses the bundled browser's canvas renderer, with no AI image generation or remote assets. It also writes `artifacts/icon-preview.png` showing every actual size on white and dark backgrounds. Keep the pinned Playwright/browser version when comparing PNG bytes.

## Browser verification

Installed-package checks must use [Playwright's extension setup](https://playwright.dev/docs/chrome-extensions): bundled Chromium, `channel: 'chromium'`, `launchPersistentContext`, a fresh profile, extension-loading arguments, and service workers enabled. Keep normal CSP enforcement. An HTTP preview or a mocked `chrome` object does not establish installed-extension behavior. Native toolbar clicks and branded Chrome/Edge installations require separate manual checks; record those results independently of automated Chromium coverage. [Task 02's archived handoff](../../plans/browser-extension/todos/done/02-extension-package.md) records its passing Chromium 153.0.8010.12 smoke commands and limitations; task 04 owns the integrated browser suite and CI.
