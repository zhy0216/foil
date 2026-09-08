difficulty: hard
agent: inherit

# Build and package the Manifest V3 extension

Read [the plan](../plan.md), [routing](README.md), and the completed 01 handoff. Start only after `01-shared-editor.md` is merged, from that updated baseline. One isolated worktree, one final commit.

## T1 · Create the extension workspace and production build

- Work: add `apps/extension` as `@foil/extension` using the existing React/Vite/TypeScript versions and `@foil/editor`/`@foil/typescript-config` workspace dependencies. Mount the shared editor and styles from a packaged `index.html`; implement a small manifest/build helper rather than adopting an unnecessary new framework. Use relative extension asset paths and an independent output directory.
- Expected files: new `apps/extension/package.json`, `index.html`, `manifest.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `src/main.tsx`, build helpers; update `bun.lock`, and `turbo.json`/root scripts only as needed.
- Work: include all lazy crypto chunks and the shared builder's `foil-standalone.js` in `apps/extension/dist`. Keep the extension CSP in the manifest, separate from website meta-CSP injection. Configure typecheck/unit/build scripts and an uncached persistent build-watch development command; document reload of the unpacked extension. No production URL may rely on a development server or `/foil/`.
- Acceptance: `bun run build --filter=@foil/extension` produces a loadable MV3 package with a root manifest, valid local page/assets/resource paths and no remote executable dependency. The shared editor and standalone resources are used without app-to-app imports. Root typecheck/test/build discover the package without port/output collisions.
- Dependencies: `01-shared-editor.md`.

## T2 · Implement the toolbar worker, policy and existing brand icons

- Work: register `chrome.action.onClicked` synchronously in a small module worker and open `chrome.runtime.getURL('index.html')` in a new tab on each deliberate click. No popup, install-time navigation or tab enumeration. Handle API failures without unhandled rejections. Keep React, DOM and document storage outside the worker graph.
- Work: manifest policy uses locally packaged scripts (`script-src 'self'`), no objects, compatible local/data image and style/font rules, and `connect-src` limited to self plus the four existing drand origins. `host_permissions` contains only exact HTTPS patterns for `api.drand.sh`, `drand.cloudflare.com`, `api2.drand.sh`, and `api3.drand.sh`. No broad hosts, tabs/activeTab/scripting/history/clipboard-read/downloads permissions, content scripts or web-accessible resources.
- Expected files: new `apps/extension/src/background.ts`, focused launch/policy/package tests, manifest/build helper, `public/icons/**` or equivalent packaged icon directory, and a reproducible conversion helper if needed.
- Work: reuse `docs/brand/foil-mark.png` or the relocated shared vector mark to create 16/32/48/128 px PNG icons. Inspect small sizes on light and dark backgrounds; preserve the existing identity and readable contrast. Do not create a different logo or add AI image generation.
- Acceptance: worker file names match the manifest and have no missing imports; a meaningful unit test checks event registration and correct fixed local tab creation/error handling. Chrome accepts the unpacked manifest under normal security settings. The page renders existing Foil UI with no CSP/page errors; icon references exist at their declared dimensions. Record a real toolbar-click smoke check when possible.
- Dependencies: `01-shared-editor.md`; T1 scaffolding.

## T3 · Configure interoperable sharing and preserve page-local persistence

- Work: implement app-local `src/config.ts` resolving `VITE_FOIL_SHARE_BASE_URL`, default `https://foil-47v.pages.dev/`. Use the shared HTTP(S) normalizer and reject an explicitly invalid value; supply the resulting base to the shared app. Support a subpath override such as the documented GitHub Pages backup. No extension URL may leak into links or HTML share-base metadata.
- Work: use the shared app's existing page-local storage, session binding, settings, storage error paths, comments, read-only/fork flow, clipboard and HTML Blob download. The worker must not mirror/cache document data. Verify that bundling with a relative base still loads the local HTML resource and crypto chunks on first use while offline.
- Expected files: `apps/extension/src/config.ts`, `src/main.tsx`, targeted config/host tests, and minimal shared-loader corrections only if integration exposes a defect (coordinate changed ownership with the coordinator).
- Acceptance: ordinary/password links and HTML exports work from the installed extension with no external requests; share URLs use the configured website origin/path. Time capsules retain all four existing drand endpoint paths and verification. Editing survives reload and documents/settings are isolated from the website origin. User-initiated clipboard copy uses the current fallback on denial rather than a broad permission.
- Dependencies: `01-shared-editor.md`; T1/T2.

## T4 · Produce an inspectable extension artifact and handoff

- Work: add an app-local `package` script that builds/checks the production extension and emits a ZIP outside `dist`, with `manifest.json` at its root. Include only runtime package files; exclude source, node_modules, profiles, tests, reports and prior ZIPs. Add appropriate ignore/cache/output metadata, and short build/watch/package instructions in `apps/extension/README.md` for later expansion.
- Expected files: `apps/extension/package.json`, packaging/check helper and useful artifact tests, extension README, `.gitignore` and `turbo.json` if required, root lockfile if dependencies change.
- Validation: run `bun install --frozen-lockfile`, then root `bun run typecheck`, `bun run test`, `bun run build` sequentially. Run the extension package command, inspect the archive's root/contents, and load the built directory in bundled Chromium with a fresh persistent profile and service workers enabled. Keep all exploratory profiles/downloads in ignored output or temporary directories. Do not weaken CSP to make the smoke pass.
- Acceptance: provide actual dist/ZIP paths, manifest permission rationale, launch behavior, host config API, watch/reload instructions and smoke results to 03/04. The ZIP is loadable after extraction. Scope ends at local packaging; no store submission, deployment or push.
- Dependencies: `01-shared-editor.md`; T1–T3.
