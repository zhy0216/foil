difficulty: hard
agent: inherit

# Extract the shared Foil application

Read [the plan](../../plan.md) and [queue routing](../README.md). This task has no dependencies. One isolated worktree, one final commit. Keep this refactor independently usable by the website before the extension is introduced.

## T1 · Move the current application into a source-first workspace package

- Work: create `packages/editor` as `@foil/editor`, moving `apps/web/src/App.tsx`, components, hooks, library modules, types, styles, brand assets, standalone reader and colocated tests. Keep the website mount entry, HTML, Vite configuration and browser suite in `apps/web`. Use narrow exports; browser modules must not import Node/build code. Do not copy the application or rewrite editor, persistence, crypto, or file formats.
- Expected files: new `packages/editor/package.json`, `tsconfig.json`, `vitest.config.ts`, browser exports and relocated `src/**`; update `apps/web/src/main.tsx`, `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vitest.config.ts` as appropriate, `apps/web/index.html`, `apps/web/tests/e2e/helpers/html-export.ts`, `bun.lock`, and only necessary root/Turbo metadata.
- Work: preserve Bun workspace conventions and current dependency versions, place dependencies with their consumers, share one React runtime, and ensure root `test` executes relocated tests exactly once. Remove obsolete empty test configuration/scripts rather than hiding no-test failures. Ensure shared source participates in app build cache invalidation without inventing a meaningless build artifact.
- Acceptance: website still mounts the same editor, all 619 baseline tests execute and pass, typecheck and production build pass, no app-to-app runtime import exists, and changing shared source invalidates consuming app builds. Website local storage keys and share/file formats are unchanged.
- Dependencies: none.

## T2 · Add the small host interface and make standalone resources portable

- Work: expose a typed optional public `shareBaseUrl` setting on the shared app; default to existing website origin/path semantics. Expose an optional React host-action slot in editor and read-only headers for a later extension import control. Reuse `ShareModal`'s normalizer/callback design. Website calls must produce the same `/foil/` or root base as before.
- Work: relocate/export the tracked `apps/web/build/standalone.ts` builder under the shared package via a distinct Node-only subpath. Resolve standalone reader/bootstrap inputs from the shared package rather than the calling app root. Keep nested builds in memory and separate per-host emitted resources. Update the runtime loader so relative base URLs are resolved against the document before dynamic import; do not let `./foil-standalone.js` resolve under a hashed chunk's `assets/` directory.
- Expected files: relocated `packages/editor/src/App.tsx`, `components/ReadOnlyDocument.tsx`, `lib/standalone-runtime-loader.ts`, relevant host/resource tests, `packages/editor/build/standalone.ts`, package exports, and `apps/web/vite.config.ts`.
- Acceptance: injected HTTP(S) bases reach both generated links and HTML exports; default website behavior remains intact. No browser-specific extension APIs enter the shared graph. Export from the existing website still lazy-loads its locally emitted `foil-standalone.js`; the reader remains self-contained and all no-editor/no-store/no-external-chunk checks are effective after relocation. Runtime loading works with a document-relative base as well as `/foil/` and `/`.
- Dependencies: T1 within this task; no external todo.

## T3 · Verify website behavior and record the handoff

- Work: repair live source links and command references affected by relocation, including root `README.md`, `CLAUDE.md`, and `docs/brand/README.md`. Do not rewrite archived plans/security reports as though historical source locations were current. Record the new package exports, host props, builder invocation, test commands and loader behavior for 02.
- Expected files: source/config/tests above; root `README.md`, `CLAUDE.md`, `docs/brand/README.md`, and completion notes for this todo.
- Validation: with the pinned toolchain, run root `bun run typecheck`, `bun run test`, and `bun run build` sequentially, then `bun run test:e2e` for the existing website/file suite. Verify the root website variant with `bunx --no-install turbo run build --filter=@foil/web -- --base /` followed by `FOIL_E2E_BASE=/ bun run --cwd apps/web test:e2e --workers=2`. Never build two variants together. Regenerate the root lockfile with Bun when relocating dependencies and confirm `bun install --frozen-lockfile` succeeds.
- Acceptance: all existing protection modes, read-only/fork behavior, real HTML downloads and offline file reading remain green on the website matrix. Fix relocation regressions; preserve meaningful tests and report known baseline act warnings without disguising them. Record exact results and APIs for the next task.
- Dependencies: T1 and T2; no external todo.


## Completion and handoff · 2026-09-08

Completed only todo 01 on `herdr/plan-browser-extension-01-shared-editor`. The task commit is `refactor(editor): extract shared Foil application` (the commit containing this note; its hash is reported in the completion message). Integration is pending coordinator instruction. The toolbar/full-tab Chrome/Edge MV3 product assumption is unchanged. No extension application was added.

### Package and host APIs for 02

| Import | API / use |
| --- | --- |
| `@foil/editor` | Named `App` and type `AppProps`; mount inside the host's existing React root/StrictMode |
| `@foil/editor/types` | Existing document, comment, selection and settings types, including `DocState` |
| `@foil/editor/share` | `normalizeShareBaseUrl`, `SHARE_LIMITS`, `encodeUrl`, `decodeUrl`; types `ShareOptions`, `DecodeResult`, `TimeCapsuleEnvelope` |
| `@foil/editor/standalone-runtime` | `StandaloneRuntime`, `STANDALONE_IDS`, `STANDALONE_RESOURCE_FILE`, `parseStandaloneRuntime`; a browser-safe, Node-loadable leaf with no app/store imports |
| `@foil/editor/styles/design-tokens.css`, `@foil/editor/styles/styles.css` | Import in that order from each host mount entry |
| `@foil/editor/brand/*.svg` | Existing SVG artwork, including `foil-favicon.svg`; the website entry assigns the imported asset URL to its icon link |
| `@foil/editor/build/standalone` | Node-only conditional export: `standalonePlugin(): Plugin`, `buildStandaloneRuntime(): Promise<StandaloneRuntime>` |

Browser entries are source-first TypeScript for a host bundler. They do not re-export the builder; the browser resolver rejects its Node-only subpath. The shared package has no `build` script or artificial `dist`. Hosts depend on it via `workspace:*`, supply React/React DOM compatible with the existing `^18.3.1` peers, and retain Vite `resolve.dedupe: ['react', 'react-dom']`. The website and package resolve to the same physical React 18.3.1 and React DOM 18.3.1 installations. Dependency ranges, resolved external versions and the root Turbo configuration are unchanged.

`AppProps` has two optional fields:

```tsx
<App
  shareBaseUrl="https://public.example/foil/"
  headerActions={<HostImportControl />}
/>
```

Omitting `shareBaseUrl` preserves `window.location.origin + window.location.pathname`. The existing `ShareModal` normalizer strips query/hash, validates HTTP(S), and passes the same normalized base to URL generation and `exportHtml(state, options, shareBaseUrl)`. An explicitly invalid string retains the modal's existing unavailable-link/export-without-source behavior; a later host that must reject invalid build configuration should validate its setting explicitly. `headerActions?: ReactNode` appears beside Settings/Share in editing and read-only headers, including after a fork. Standalone files do not receive the slot or host-specific APIs.

Register `standalonePlugin()` in each host's Vite config alongside its own React/CSP/Buffer setup (see `apps/web/vite.config.ts`). `buildStandaloneRuntime()` now takes **no host-root argument**: it resolves reader/bootstrap/Buffer inputs from the shared package's `import.meta.url`, builds both IIFEs in memory, and returns script/style strings. Each plugin instance emits its own `foil-standalone.js` into its host output. Development rebuilds resources on demand with production JSX/React branches and the existing separate Buffer bootstrap.

The app runtime loader builds an absolute URL with `new URL(import.meta.env.BASE_URL + 'foil-standalone.js', document.baseURI)` before native dynamic import. `/foil/`, `/` and `./` work; relative imports cannot fall under an `assets/` chunk. Development adds a fresh `?t=` timestamp. An injected public sharing base never replaces this local resource destination.

### Acceptance evidence

- Moved the application, standalone reader, assets, styles and all 16 baseline test files into `packages/editor`; every baseline test file is byte-identical to the starting commit. All 619 baseline tests still execute once. Twelve focused host/resource tests bring the total to **631 tests in 18 files**; `apps/web` has no empty unit-test script/configuration.
- Existing persistence, settings, crypto, URL codec, HTML data format and reader implementations were moved unchanged. The only edited relocated browser files are `App.tsx`, `ReadOnlyDocument.tsx` and `standalone-runtime-loader.ts`. Storage keys (`foil_doc_<id>`, `foil_current_id`, `foil_settings`, `foil_name`, legacy `foil_theme`) and all four URL/HTML schemes remain unchanged.
- Eight host tests use the real plain codec and HTML assembler to round-trip links/files with default `/foil/` and `/` bases and injected HTTP and HTTPS destinations. They exercise the action slot in editing/read-only headers and after an explicit fork. Four loader tests check actual dynamic-import targets for the three base forms and resource validation.
- `bunx --no-install turbo run build --filter=@foil/web --dry=json` includes the source-only editor as a dependency transit node with all package inputs, including its builder and assets. A temporary comment in shared `App.tsx` changed the website hash from **`184dde05aa9644d2` (HIT)** to **`c4b4fc31d8aedde9` (MISS)**; restoring the exact bytes restored the original hash/HIT. No dummy build or root metadata change was needed.
- The complete existing Chromium/WebKit matrix passed at both website bases: protection gates, wrong-password retries, capsule network fixtures/cancellation, read-only behavior, actual HTML downloads, offline refresh/re-export, hostile content/CSP checks, oversized documents, mobile reading with denied storage, and local website edits/reload. Existing unit tests also retain all four protected-link fork/persistence checks.
- In-memory builder checks succeeded from an unrelated empty directory. Temporary retained imports of `Editor`, `doc-store`, and the host resource loader each triggered the existing forbidden-module assertion. An external JS import triggered the single-script/no-external-chunk assertion; an external CSS import triggered the no-external-resource assertion. No network fetch was needed, no output artifact was written, and all temporary source edits were restored.
- Vite's browser resolver accepts `@foil/editor` and rejects `@foil/editor/build/standalone` with its conditional-export error. Browser source contains no Node/build or app-to-app runtime import and no extension API.
- The development Chromium probe verified mounting, the real shared favicon, no resource load before export, and two successful HTML downloads fetching distinct local `/foil/foil-standalone.js?t=…` URLs. There were no page errors or unexpected external requests.
- Live source/brand links and relocated unit-test commands were repaired in root `README.md`, `CLAUDE.md`, and `docs/brand/README.md`. Historical plans/security documents and the plan's final execution section were left to their original context/coordinator.

### Commands and results

All commands ran in this task worktree with the pinned toolchain. Heavy validation ran sequentially; browser suites used two workers and isolated preview ports. Turbo validation after the initial typecheck used a worktree-local cache:

```bash
export PATH=/home/ubuntu/.nvm/versions/node/v22.22.3/bin:$PATH
export TURBO_CACHE_DIR="$PWD/.turbo/cache"
node --version # v22.22.3
bun --version  # 1.4.2
```

| Actual command | Result |
| --- | --- |
| `bun install --frozen-lockfile` (before relocation) | Passed |
| `bun install`, then `bun install --frozen-lockfile` | Regenerated workspace ownership in the root lockfile; frozen install passed, no external package upgrades |
| `bun install --frozen-lockfile` (final validation sequence) | Passed; 170 installs across 222 packages checked, no changes |
| `bun run typecheck` | Both editor and web passed; final run 7.201 s |
| `bun run test` | 631/631 tests in 18/18 files; final uncached run 24.91 s (Turbo 25.358 s), no failures/skips |
| `bun run build` | Passed; Vite 7.3.6 transformed 166 modules, with the standalone guards active; default build 6.712 s overall |
| `bun run test:e2e:install` | Passed; required Chromium/WebKit installations were already available |
| `FOIL_E2E_PORT=4381 bun run test:e2e --concurrency=1 -- --workers=2` | Default `/foil/`: **28/28 passed**, 1.2 min (Turbo 1 min 19.419 s) |
| `bunx --no-install turbo run build --filter=@foil/web -- --base /` | Passed; 8.902 s overall |
| `FOIL_E2E_BASE=/ FOIL_E2E_PORT=4382 bun run --cwd apps/web test:e2e --workers=2` | Root `/`: **28/28 passed**, 1.2 min |
| `bunx --no-install turbo run build --filter=@foil/web -- --base ./` | Passed; 6.444 s overall |
| `FOIL_E2E_BASE=/ FOIL_E2E_PORT=4383 bun run --cwd apps/web test:e2e tests/e2e/html-export.spec.ts tests/e2e/smoke.spec.ts --grep 'offline file refresh\|opens the built app' --workers=2` | Relative build: **6/6 passed**, 18.8 s; ordinary/password downloads, offline refresh/re-export and website smoke in both browsers |
| `node /tmp/foil-01-builder-check.mjs` | Empty-host-root build and five negative guard probes passed; source restored in `finally` |
| `bun run --cwd apps/web dev --host 127.0.0.1 --port 4384 --strictPort`, then `node /tmp/foil-01-dev-check.mjs` | Development mount/favicon and two lazy downloads passed; server stopped afterward |
| `bun run build` | Restored the default `/foil/` artifact from the verified local cache, hash `184dde05aa9644d2` |
| `FOIL_E2E_PORT=4385 bun run --cwd apps/web test:e2e tests/e2e/smoke.spec.ts --workers=2` | Restored default artifact: **2/2 passed**, 3.3 s |
| `git diff --check` and byte/link checks | Passed; baseline test files and all untouched relocated implementations match the starting commit |

The final website output is `apps/web/dist/`, including its local `foil-standalone.js` (440.40 kB); there is no shared `packages/editor/dist`. Its restored index references `/foil/assets/index-DYA07LPc.js` and `/foil/assets/index-DMW3df8-.css`. Browser output is ignored under `apps/web/test-results` and `apps/web/playwright-report`; separate command logs and temporary probes are in `/tmp/foil-01-*` for this session.

### Diagnosed issues and remaining limitations

The initial build failed with `ERR_MODULE_NOT_FOUND` because Vite externalizes the workspace builder and Node cannot resolve its old extensionless relative import. The builder now imports the pure runtime module through the explicit `@foil/editor/standalone-runtime` package subpath. The full typecheck/unit/build sequence and browser matrices subsequently passed. The website favicon moved to a package asset import so it also works in development.

The first host-test run passed but introduced `act` warnings from `waitFor` advancing fake timers outside React's `act`. Its bounded assertion loop now advances timers inside `act`; the focused rerun and final full suite passed without those new warnings. Existing baseline `ReactDOMTestUtils.act` deprecation and standalone `ShareModal` act warnings remain visible and were not suppressed. Browser logs also contain the existing NO_COLOR/FORCE_COLOR warning and expected preview shutdown exit 143; the enclosing Playwright commands exited 0.

Two preliminary auxiliary development-probe attempts failed in the probe itself: importing named Chromium from a CommonJS module via dynamic import, then treating Vite's data-URL favicon as an HTTP API request. The probe now uses the package's CommonJS interface and validates the favicon through browser fetch for either a local or data URL; all original assertions remain effective and the final probe passed.

No task blockers remain. Actual installed-extension/Chrome/Edge behavior, extension CSP, packaging and import controls belong to 02–04 and have not been claimed here. This branch retains exactly one local task commit and awaits explicit coordinator integration; no rebase, merge, push, deployment, publication or PR was performed.
