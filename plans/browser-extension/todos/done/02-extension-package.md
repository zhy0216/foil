difficulty: hard
agent: inherit

# Build and package the Manifest V3 extension

Read [the plan](../../plan.md), [routing](../README.md), and the completed 01 handoff. Start only after `01-shared-editor.md` is merged, from that updated baseline. One isolated worktree, one final commit.

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

## Completion and handoff · 2026-09-08

Completed only task 02 on `herdr/plan-browser-extension-02-extension-package`, starting at merged/cleaned task 01 commit `86d6aaa18b2525a7ab0f147d4ddb1a6fe30ee460`. The single task commit is `feat(extension): package Foil as a Manifest V3 editor` (the commit containing this note; its hash is reported in the completion message). Integration awaits explicit coordinator instruction. No rebase, merge, branch switch, push, publication, deployment, PR, stash or worktree cleanup was performed. Tasks 03/04 and the plan's final execution section remain with the coordinator.

### Files and APIs for 03/04

- Added `apps/extension` as `@foil/extension`: `package.json`, `index.html`, `manifest.json`, Vite/TypeScript/Vitest configurations, `src/main.tsx`, `src/config.ts`, `src/background.ts`, focused tests, build/package/icon helpers, four committed PNGs and an app README. Root changes are only the workspace lockfile and an ignore entry for extension artifacts, plus this queue/archive update. Existing Turbo tasks already cover app-local `dist/**`/TypeScript outputs and persistent uncached `dev`; no root script or Turbo configuration change was necessary.
- `src/main.tsx` imports named `App`, the two shared style exports, and `resolveShareBaseUrl`. It mounts `<App shareBaseUrl={shareBaseUrl} />` in StrictMode. Task 03 can add its control through `headerActions`. There are no app-to-app runtime imports or copied editor/codec implementations.
- `src/config.ts` exports `DEFAULT_SHARE_BASE_URL = 'https://foil-47v.pages.dev/'` and `resolveShareBaseUrl(value: string | undefined): string`. It calls `normalizeShareBaseUrl` from `@foil/editor/share`, defaults only for `undefined`, retains HTTP(S) origin/path, strips search/hash, and rejects explicitly empty/invalid input without echoing it. `scripts/check-config.ts` validates Vite's production-mode env resolution before build/watch emits output. Shell overrides have Vite's normal precedence. Restart watch after env/config changes. The documented backup is `https://zhy0216.github.io/foil/`.
- `vite.config.ts` uses `base: './'`, separate HTML/worker entries, stable `background.js`, shared `standalonePlugin()` with no arguments, Buffer alias/global setup, React deduplication and the existing toolchain versions. The manifest plugin watches reader-only sources as well as the manifest, and asserts a dependency-free worker plus fully local chunk imports.
- The worker synchronously registers one action listener and calls only `chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })`. Every deliberate click requests a new tab; no popup, installation navigation, tab enumeration or document storage. Both synchronous API errors and rejected promises produce one fixed diagnostic with no unhandled rejection or active-tab data.
- `scripts/artifact.ts` checks allowed runtime files, symlinks/directories, manifest policy/capabilities, HTML and JS/CSS resource paths, inline-script absence, the worker, standalone resource and PNG dimensions. Packaging sorts names, fixes ZIP timestamps and round-trips every runtime byte. `package` is app-local and uncached; it builds before checking/zipping, and places the archive outside `dist`.
- Vitest currently runs Node-based worker/config/package tests (`src/**/*.test.ts`, `scripts/**/*.test.ts`). Task 03 can extend that configuration and declare its own DOM-test dependencies for the new import dialog. Task 04 owns the permanent installed-extension suite/CI; exploratory browser probes below are ignored artifacts, not a new root e2e task.
- **Coordinator notice: no shared-loader or shared-editor corrections were necessary.** `packages/editor`, `apps/web`, existing test files, website/file policies and persisted formats are unchanged. The watch probe temporarily edited reader text and restored its exact original bytes. Extension and website `foil-standalone.js` are byte-identical, SHA-256 `7dbac5572e21a800c27be97e947740d87a280a75205efe11ac6fc5882c458173`.

### Acceptance evidence

| Acceptance | Observed result |
| --- | --- |
| T1: workspace discovery and production bundle | Root typecheck runs editor/web/extension. Root unit tests run shared tests once plus the extension tests. Root builds output independently to `apps/web/dist` and `apps/extension/dist`; filtered extension build succeeds. The extension has a root manifest/index, local CSS/JS, lazy Buffer/crypto chunks and `foil-standalone.js`, with no server or `/foil/` asset dependency. |
| T1: watch loop | Actual `bun run dev --filter=@foil/extension` is persistent/uncached and opens no port. A reader-only text change regenerated the HTML resource; a manifest description change re-emitted the manifest; both restored versions were observed. Turbo's dry graph recognizes Vite and forwards `VITE_FOIL_SHARE_BASE_URL` through framework inference. |
| T2: launch and manifest | Four meaningful worker tests cover startup registration/no eager launch, two clicks ignoring a hostile active-tab object, rejected tab creation, synchronous create failure and URL failure. The real installed worker reports its action listener registered. Capturing the unchanged built callback through DevTools in that worker and invoking it twice creates two actual fixed `chrome-extension://…/index.html` pages through real Chrome APIs. This is a handler smoke, **not a native toolbar click**. |
| T2: policy/icons | Bundled Chromium accepts the unpacked manifest under normal CSP enforcement; UI renders with the existing Foil brand, editor and comments. No CSP/page errors. All 16/32/48/128 PNG dimensions pass checks. Actual-size white/dark preview was visually inspected; the original vector geometry/ink/padding is unchanged, with pale rounded backing for contrast. Re-running rasterization produced byte-identical PNGs. No AI generation used. |
| T3: sharing/HTML/offline | Installed pages with offline mode and all HTTP(S) blocked generate ordinary/password links and actual Blob HTML downloads. Links and HTML metadata use the default public website. First export imports local root `foil-standalone.js`. Fresh Chromium file recipients read, refresh and re-export both modes offline; independent website recipients served from local built bytes round-trip Markdown/title/comments and strip fragments. No ordinary/password external requests. |
| T3: config override | An installed build using `https://zhy0216.github.io/foil/?from=extension#old` generates ordinary/password links and protected HTML metadata with exactly `https://zhy0216.github.io/foil/`, offline with no page/CSP errors. A `chrome-extension://…` build setting fails before changing any existing dist bytes. Sixteen config cases also cover undefined, HTTP, subpaths, empty values, credentials, malformed/unsupported schemes and length bounds. |
| T3: persistence and clipboard | Real UI create/rename/edit/comment/settings flows pass offline. Reload and two different per-tab document bindings preserve data; a persistent-profile restart preserves library/settings. Website data/preferences remain isolated in the same profile. Installed fragment preview is read-only with no session binding, strips its fragment, then forks only on **Edit anyway**. Denied document writes show **not saved**, keep editing usable and preserve stored data. Actual Copy succeeds with no extra grant; forced denial displays the existing manual-copy fallback and retains the link. |
| T3: time capsules | First-use local crypto import succeeds with offline drand failures. Chromium debugger script events confirm the packaged crypto URL (request events were insufficient for this trace). All four exact quicknet `/info` paths are attempted. Fixed fixtures reject wrong chain data on the first three endpoints and succeed on api3; actual tlock sealing/decryption and a verified round 992 beacon round-trip the document through api3's `/public/992` path. A forged signature is rejected before plaintext display. No live drand service was contacted. |
| T4: inspectable artifact | ZIP contains exactly the same 12 runtime files as dist, including manifest at archive root. There are no sources, dependencies, profiles, tests, reports, maps or old ZIPs. `unzip -t` passes. Extracting it to a new directory and loading another fresh persistent profile renders the editor. Rebuilding the default package after the override produces a byte-identical ZIP. |

Manifest policy is separate from website meta-CSP: `script-src 'self'`, `object-src 'none'`, existing inline styles, self/data images and self fonts. Connections allow self plus exactly `https://api.drand.sh`, `https://drand.cloudflare.com`, `https://api2.drand.sh`, `https://api3.drand.sh`. `host_permissions` lists each with `/*`, solely for existing drand cross-origin chain/beacon requests. No general API permissions, broad hosts, content scripts, web-accessible resources or sandbox. Official [CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy), [action](https://developer.chrome.com/docs/extensions/reference/api/action), [worker event](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events), [tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs), [cross-origin request](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [Chrome install](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked), [Edge sideload](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading) and [Playwright extension](https://playwright.dev/docs/chrome-extensions) documentation were read during implementation.

### Actual commands and results

All commands used the pinned toolchain. Typecheck, unit tests, builds and browser runs were sequential phases with no KDF/build/browser overlap. Turbo used a task-local cache:

```bash
export PATH=/home/ubuntu/.nvm/versions/node/v22.22.3/bin:$PATH
export TURBO_CACHE_DIR="$PWD/.turbo/cache"
node --version # v22.22.3
bun --version  # 1.4.2
```

| Actual command/probe | Result |
| --- | --- |
| `bun install` | Added extension workspace/dependency ownership; no upgrades to existing resolved packages. Only four new Chrome-related type packages; fflate, lexer, Playwright and other tools reuse existing resolved versions. |
| `bun install --frozen-lockfile` | Passed: 176 installs across 227 packages checked, no changes. |
| `bun run typecheck` | 3/3 tasks passed uncached; 7.589 s. |
| `bun run test` | **683/683 tests in 21 files**: shared **631/631 in 18** plus extension **52/52 in 3**. Turbo 25.42 s; shared suite 25.00 s, extension suite 828 ms. No failures/skips. |
| `bun run build` | Both apps passed uncached, Turbo 7.113 s; extension Vite transformed 168 modules. Website output retains its `/foil/` base and prior `index-DYA07LPc.js`/`index-DMW3df8-.css` names. |
| `bun run build --filter=@foil/extension` | Passed from verified cache; one build task, 24 ms. |
| `bun run --cwd apps/extension package` | Builds/checks and produces the 12-file, 314,621-byte ZIP. Final run Vite 3.00 s. |
| `bun run --cwd apps/extension check`, `unzip -l …`, `unzip -t …` | Paths, policy, dimensions, root entries and all compressed contents passed. |
| `bun apps/extension/artifacts/smoke.ts` | Final exploratory installed-package probe: **13/13 checks passed**, bundled Chromium **153.0.8010.12**, fresh persistent profiles/service workers enabled, normal CSP, offline/route-controlled network. |
| `bun apps/extension/artifacts/watch-probe.ts` | Reader-resource/manifest rebuild and restore passed. The persistent Turbo task was intentionally stopped afterward (its shutdown log reports force-killed task; the probe exits 0). `bun run build` then restored complete default output from cache. |
| `bunx --no-install turbo run dev --filter=@foil/extension --dry=json` (also with a sample VITE env override) | Verified `cache: false`, `persistent: true`, no outputs/port, framework `vite`, and inferred VITE env forwarding. |
| `VITE_FOIL_SHARE_BASE_URL=chrome-extension://invalid/index.html bun run build --filter=@foil/extension` | Expected rejection; wrapper verified diagnostic, nonzero exit and unchanged dist checksums. |
| `VITE_FOIL_SHARE_BASE_URL='https://zhy0216.github.io/foil/?from=extension#old' bun run build --filter=@foil/extension` | Passed uncached; Turbo 7.705 s. |
| `bun apps/extension/artifacts/config-smoke.ts` | Installed override ordinary/password links and HTML metadata passed offline with no page/CSP errors, Chromium 153.0.8010.12. |
| `bun run --cwd apps/extension icons` (twice, sequentially) | Existing-vector render/preview passed; SHA comparison confirms repeat PNG bytes identical at all four sizes. |
| Final `bun run --cwd apps/extension package`, `… check`, `unzip -t …` | Restored default share base. ZIP checksum matches the first default build exactly; all 12 files pass. |
| `git diff --check`, unchanged shared/web-source checks | Passed; no shared-loader/editor/website implementation change. |

### Artifacts and limitations

Actual task worktree root is `/home/ubuntu/.herdr/worktrees/foil/herdr-plan-browser-extension-02-extension-package`. Relative to it:

- Unpacked package: `apps/extension/dist/` (12 files, 912,799 uncompressed bytes).
- ZIP: `apps/extension/artifacts/foil-extension-0.1.0.zip` (314,621 bytes), SHA-256 **`4fa735d11d92f65c75861c0705460375baaee04e722020df43e1267584c9eb72`**.
- Successful installed smoke report/screenshot/downloads: `apps/extension/artifacts/installed-smoke-8GgG8V/`, including `report.json`, `installed-editor.png`, ordinary/password/re-export HTML, persistent profiles and the installed `zip-unpacked/` copy. Override download: `apps/extension/artifacts/config-smoke-W5VzbC/override.html`. Icon preview: `apps/extension/artifacts/icon-preview.png`.
- Exploratory probes remain in ignored `apps/extension/artifacts/{smoke,config-smoke,watch-probe}.ts`. They are available for coordinator inspection before worktree cleanup; these are not committed permanent regression tests. Logs are `/tmp/foil-02-{unit,build,smoke,watch,watch-result,invalid-config,override-build,config-smoke,final-package}.log` and dry-graph JSONs.

Preliminary browser-probe failures were in the harness, not the package: service workers reject dynamic imports (so the built callback was captured via DevTools), settings expose radio roles, the editor toast differs from the standalone reader's status role, the time preset/Decrypt action must be explicit, and UI errors intentionally use stable generic text. Chromium's debugger confirmed crypto loads when generic request/performance traces did not. The final probe retains all acceptance assertions. Its only expected console diagnostics are aborted offline drand requests and one `randomness did not match the signature` from the deliberately forged beacon; there are no unexpected console errors, page errors or CSP violations. The full unit log retains the baseline ReactDOMTestUtils.act deprecation; it was not suppressed.

No blocker remains for task 03. **Native toolbar clicking and manual branded Chrome/Edge unpacked installation were not performed.** Automated extension coverage is bundled Chromium 153.0.8010.12 only, including ordinary/password `file://` recipients; it is not Edge or WebKit coverage. Task 04 retains full installed-extension/cross-host/protection/file browser matrices and CI/audits. The coordinator independently confirmed the 28 website tests on merged 01; task 02 does not claim a new full website browser-suite run. Page-local storage still has the documented clearing/uninstall/capacity limitations and no browser sync. See the app README for build/watch/reload/package/install instructions and the public host setting.
