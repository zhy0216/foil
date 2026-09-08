# Foil browser extension

## Intent

Deliver an installable Foil browser extension in `apps/extension`, preserving the existing local Markdown editor, document library, comments, reading settings, protected share links, and standalone HTML export. The first version targets Chrome and Edge with Manifest V3: clicking the toolbar action opens the packaged full editor in a normal tab. This is a new application in the existing Bun/Turbo workspace, sharing Foil's implementation with the website.

The user requested `$auto-dev make a browser extension of foil in apps/extension`. Browser and presentation were unspecified. A presentation question was sent during inspection; the toolbar/full-tab option is the working assumption unless the user supplies a different preference. The first version also provides an explicit paste-share-link action to move a shared snapshot into the extension's existing read-only/fork flow.

## Repository evidence

- Baseline: local `main`, `d7b51a1`; working tree was clean before planning.
- Root `package.json`, `turbo.json`, `CLAUDE.md`, and `README.md`: Bun workspaces cover `apps/*` and `packages/*`; internal dependencies use `workspace:*`; each app owns its dependencies and scripts. Toolchain pins are Bun 1.4.2 and Node 22.22.3.
- `apps/web/src/App.tsx`: one stateful application, synchronous local persistence, per-tab document binding, initial-fragment import, read-only previews, explicit fork, and an HTML export callback. It currently derives the share website from `window.location.origin + window.location.pathname`.
- `apps/web/src/lib/doc-store.ts`: validated `foil_doc_<id>` records in `localStorage`, `foil_current_id` in `sessionStorage`, and storage-failure handling. `App.tsx` already flushes pending writes on visibility/page lifecycle events.
- `apps/web/src/components/ShareModal.tsx` accepts a website base and HTML-export callback. `lib/html-share-format.ts` rejects non-HTTP(S) share bases. Passing the extension origin would therefore break sharing.
- `apps/web/build/standalone.ts` is a tracked source file, despite `build/` being omitted by some default file searches. It builds two in-memory IIFEs from paths relative to the host root, and emits `foil-standalone.js`. Source relocation must change this root assumption while preserving its dependency checks.
- `apps/web/vite.config.ts` sets `/foil/`, injects website CSP, configures Buffer, and builds standalone resources. The extension needs an independent build and manifest policy.
- `apps/web/src/assets/brand/`, `docs/brand/foil-mark.png`, and `docs/brand/README.md` provide the existing identity. Reuse it for extension icons.
- Existing browser tests live in `apps/web/tests/e2e/`; `helpers/html-export.ts` imports a type from the current web source and must follow its relocation. `.github/actions/verify/action.yml` installs the pinned toolchain and runs typecheck, unit tests, audits, and built browser tests; Pages deploys only `apps/web/dist`.
- Planning baseline: `bun run typecheck` passed; `bun run test` passed all 619 tests in 16 files. Existing React `act` warnings appeared in the Editor and standalone-reader tests. These runs used Bun 1.4.2 and the shell's Node 24.20.0. Pinned Node 22.22.3 is installed at `/home/ubuntu/.nvm/versions/node/v22.22.3/bin/node`; implementation verification should select the pinned toolchain. No planning-stage build/e2e result is claimed.

## Goals and non-goals

Goals:

1. `bun run build --filter=@foil/extension` produces a self-contained unpacked extension in `apps/extension/dist`, plus a documented package command for a ZIP with the manifest at its root.
2. Clicking the toolbar action opens an actual `chrome-extension://…/index.html` editor backed by bundled resources, usable offline for local work and ordinary/password sharing.
3. Website and extension use one maintained editor/codec implementation; existing website behavior and standalone files continue to work.
4. Share links generated in the extension use `https://foil-47v.pages.dev/` by default, including links subsequently generated from exported HTML. Allow a validated build-time website-base override for alternate hosting.
5. Users can paste a Foil share URL or supported fragment, open a read-only extension preview, pass any protection gates, and explicitly fork into the extension library.
6. Verify the installed package under actual extension CSP, with persistent-profile tests and existing website/file regressions.

Non-goals: a sidebar or New Tab replacement; page clipping or selected-text capture; content scripts; accounts, sync, automatic migration of website storage, or a backend; Firefox/Safari packaging; Web Store submission, public deployment, or a repository push. Do not execute the unrelated historical plan queues.

## Design

### Shared application package

Introduce source-first `packages/editor` (`@foil/editor`). Move the existing app, components, hooks, library modules, types, styles, brand assets, standalone reader, and colocated unit tests from `apps/web/src` into this package. Keep the website's `index.html`, mounting entry, Vite configuration, and browser tests in `apps/web`. This is a relocation and a small host boundary, not an editor or persistence redesign.

Expose narrow package subpaths for the app, needed types/codec constants, styles/brand assets, and the Node-only standalone build helper. Keep Node/build imports outside the browser entry graph. Configure React as a compatible shared/peer dependency and put other runtime/test/build dependencies in the package that uses them. Both apps depend on the package with `workspace:*`; no runtime source imports from one app into another and no copied editor tree. Root tests discover moved tests exactly once. A source-only package need not emit an artificial `dist` just to fit Turbo.

Give the app a small typed host configuration: an optional explicit `shareBaseUrl` with the current website-location behavior as the default, and an optional host action slot for the extension's import control. Wire that slot consistently into editing/read-only headers without pulling extension code into standalone readers. Browser APIs remain in `apps/extension`.

Move `build/standalone.ts` with the reader or expose an equivalent shared helper; resolve reader inputs from the shared package's location, independent of the calling app's root. Each app emits its own local resource module. Keep in-memory builds, lazy runtime loading, Buffer initialization ordering, production JSX, and the existing no-editor/no-document-store/no-external-chunk assertions. Resolve the resource URL against the host document before native dynamic import: a literal `./foil-standalone.js` inside a hashed `assets/` chunk would otherwise resolve under `assets/`. Test the extension page and both website base paths. Do not execute the exported HTML's inline runtime inside a privileged extension page.

### Manifest V3 host and build

Create `apps/extension` as `@foil/extension`, using the existing React/TypeScript/Vite versions and shared TS config. A small Vite manifest/build helper is sufficient; adding a separate extension framework is unnecessary for one page and one worker. Proposed new files include `index.html`, `manifest.json`, `vite.config.ts`, `tsconfig.json`, `src/main.tsx`, `src/background.ts`, and `src/config.ts`. Exact helper names may change if ownership and acceptance stay the same.

- The manifest declares a toolbar `action`, a module service worker, package metadata, and raster icon sizes suitable for the toolbar and extension manager. The action has no popup. On each explicit click, the worker creates a new packaged editor tab. No install-time tab opening, tab enumeration, or implicit navigation is required. Chrome documents action behavior and permission-free tab creation in its [action API](https://developer.chrome.com/docs/extensions/reference/api/action) and [tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs).
- Build extension asset URLs relative to the package root (`base: './'`), output a stable worker path matching the manifest, and include all lazy crypto chunks and `foil-standalone.js`. Worker code must not import React, DOM APIs, or local document storage. Register the action listener at module evaluation and handle failed tab creation without leaking data or unhandled rejections.
- Keep `script-src 'self'` and `object-src 'none'`; bundle all executed JS locally. Permit existing inline style behavior, self/data images, and self fonts. Add `connect-src 'self'` plus only the four existing drand origins. Do not weaken policy with inline/eval scripts, remote scripts, a sandbox workaround, or disabled browser security. This design follows [Chrome's extension CSP rules](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy).
- Declare only the four exact existing HTTPS drand hosts in `host_permissions` to preserve time capsules: `api.drand.sh`, `drand.cloudflare.com`, `api2.drand.sh`, and `api3.drand.sh`, each with `/*`. CSP and host permissions serve different purposes; both must cover these requests. See [cross-origin extension requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests). No `<all_urls>`, `tabs`, `activeTab`, `scripting`, history, clipboard-read, downloads, or web-accessible-resource grant is needed for the chosen flows. Use the existing click-triggered clipboard and Blob download APIs and verify them in the package.
- Use build-watch/reload as the documented extension development loop so development does not require remote/HMR code in privileged pages. If an HTTP UI preview is offered, document it as a convenience; actual acceptance loads the extension package. Keep all outputs app-local and Turbo-visible; a watch command is persistent and uncached.
- Reuse the existing Foil mark, deterministically render/resize needed PNG assets, and visually check 16/32/48/128 px on light/dark toolbar backgrounds. Do not redesign or generate a different logo.

### Persistence and website interoperability

Retain Foil's existing synchronous document-store behavior in the extension page for this first version. All document reads/writes happen there; the worker only opens tabs. This preserves validation, lifecycle flushing, storage errors, and per-tab session bindings without a second storage implementation. The extension origin has its own library and settings; it does not read or synchronize the website's storage.

This is an explicit tradeoff: [Chrome recommends extension storage for general extension data](https://developer.chrome.com/docs/extensions/reference/api/storage), while Web Storage is available to extension HTML pages but not workers. Keep this version scoped to the page-local Foil model and document storage clearing/uninstall risk. Do not promise durable backup, unlimited capacity, simultaneous same-document conflict resolution, or browser sync. Test persistence across reload and browser-profile restart, different documents in two tabs, and preservation of unsaved-error handling.

Extension `src/config.ts` resolves the website share base from `VITE_FOIL_SHARE_BASE_URL`, defaulting to `https://foil-47v.pages.dev/`. Validate using the shared HTTP(S) normalizer, preserving the host path and removing search/hash. Fail an explicitly invalid configuration instead of falling back to an extension URL. The website retains its dynamic current-origin/path behavior, including `/foil/` and `/`. HTML file exports carry the same public base, and ordinary/password creation and reading remain offline. Time capsules continue to require verified drand data.

The extension's small **Open shared link** dialog accepts a pasted absolute HTTP(S) URL or a raw `#d=`, `#e=`, `#td=`, or `#te=` fragment. Parsing never fetches or navigates to the supplied origin. Reject unsupported URL schemes, credentials, missing/unknown fragments, invalid encoding, and input exceeding the existing URL transport budget before decoding work. Preserve supported legacy base64 padding. Only the extracted fragment is appended to a fixed `chrome.runtime.getURL('index.html')`, opened in a new tab so the current document remains intact. The existing app handles bounded decoding, password/time gates, fragment stripping, and explicit **Edit anyway** forking. Do not invent another codec or persist imported documents before the user forks them.

## Task breakdown

| Order | Task | Difficulty | Dependencies | Ownership |
| --- | --- | --- | --- | --- |
| 01 | Extract the shared Foil application and build boundary | hard | None | `packages/editor`, existing website entry/build/tests, dependency relocation and affected source links |
| 02 | Build and package the Manifest V3 extension | hard | 01 | Extension package/build/manifest/worker/entry/config/icons and required Turbo/package integration |
| 03 | Add explicit shared-link import | medium | 02 (and 01 transitively) | Extension import parser/dialog, host action integration and focused tests |
| 04 | Verify installed extension, integrate CI, and document usage | hard | 03 (and 01/02 transitively) | Extension Playwright suite, package checks, CI artifacts, root/extension documentation and final regressions |

Execution order is `01 → 02 → 03 → 04`. No tasks should run concurrently in this queue: the app boundary, manifests/lockfile, entry integration, and final tests depend on the preceding implementation. One todo is one isolated worktree and one final implementation commit. Do not manufacture parallelism by importing unfinished modules or editing the same root lockfile concurrently.

## Execution preferences

- `default_agent: codex`, inherited from the initiating Codex host.
- No user-specified model, reasoning effort, or per-task agent override.
- Todos use `agent: inherit`. Resolve models using the shared agent-routing rules: hard = `gpt-6-astra` / `max`; medium = `gpt-6-astra` / `xhigh`.
- Coordinator = Codex / `gpt-6-astra` / `high`. Its setting does not override task difficulty.
- Always pass the routing rules' explicit auto/YOLO startup flag. The installed `codex --help` supports `--dangerously-bypass-approvals-and-sandbox`, `--model`, and TOML `-c` overrides. Local model metadata checked on 2026-09-08 lists `gpt-6-astra` with high/xhigh/max support. Recheck actual execution environment before launching task agents.
- Auto-dev commits only this plan/queue before launching a new Herdr coordinator. The coordinator reads `todos/README.md`, follows the saved routing, and executes only this plan using herdr-finish-plan.

## Validation

Use the repository-pinned Node/Bun versions. Run typecheck and the full unit suite before any build/browser suite, sequentially; the real password KDF tests have a five-second per-test budget. Preserve all 619 existing tests as a baseline rather than replacing them with mocks or skipping them. Fix failures caused by this work; record unrelated baseline warnings honestly.

Repository commands after implementation:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run test:e2e:install --with-deps
bun run test:e2e
bun audit
bun audit --prod
bun run --cwd apps/extension package
```

`package` is a new app-local command to build/check and create a ZIP from the production extension. ZIP contents must be limited to the loadable package, with `manifest.json` at the root; no source tree, test fixtures, dependencies, or temporary user profile. Keep it outside `dist` to prevent recursive inclusion. Any new Turbo task must describe its outputs/cache behavior.

After the default full browser suite, validate the alternate website base sequentially:

```bash
bunx --no-install turbo run build --filter=@foil/web -- --base /
FOIL_E2E_BASE=/ bun run --cwd apps/web test:e2e --workers=2
```

Never rebuild two variants into one `dist` concurrently. Root `test:e2e` should discover both applications; extension cross-host fixtures must use an already-built website and an isolated preview port so they cannot collide with website tests. Declare any cross-package build/environment dependencies in Turbo. Restore/verify the default website artifact before a workflow uploads it.

Use Playwright's bundled Chromium, `launchPersistentContext`, `channel: 'chromium'`, an isolated temporary profile, and extension-loading arguments. Keep service workers enabled for the extension fixture; the website config's `serviceWorkers: 'block'` cannot be reused. The [official extension testing guide](https://playwright.dev/docs/chrome-extensions) documents this setup. Do not claim Chrome/Edge/WebKit extension coverage from a normal HTTP page or mocked `chrome` object.

Acceptance matrix:

- Install the real built manifest; resolve its worker/extension ID; render the packaged page with no CSP violations or page errors. Exercise the launch handler, with a meaningful listener unit test and manual toolbar-click check if native toolbar automation is unavailable.
- Editing, document create/switch/rename/delete, comments, formatting, and settings work. Reload, close/reopen, a persistent-profile restart, and two tabs bound to different documents retain the expected data. Verify actual installed-page offline behavior, including the first HTML export and lazy crypto import with all external network blocked.
- Extension links point to the configured HTTP(S) website, round-trip title/Markdown/comments through ordinary/password/time/combined modes, and open in an independent website recipient context. Assert the generated default public base; use local fixtures/route fulfillment for recipients instead of contacting the public site.
- Actual Copy succeeds on a user click or produces the existing manual-copy fallback on clipboard denial. Actual Export HTML produces a downloaded file whose resource and share-base metadata are correct. Open/re-export ordinary/password files offline in fresh Chromium and WebKit recipient contexts using the existing real `file://` methodology; cover both time modes with deterministic drand fixtures and hidden plaintext until gates pass.
- Import malformed/oversized/unsupported links without network, navigation to the input host, or changes to the current document. Valid imports are read-only and stripped from the extension address bar; wrong-password retry, cancellation, time gates, and explicit fork behave as in the website.
- Intercept all HTTP(S); fulfill only expected local website and fixed drand requests. Never call the public drand network in tests. Keep package CSP enforcement enabled and check packaged paths, permissions, icons, and absence of remote executable code.
- Document manual Chrome and Edge unpacked installation. Report which browsers were actually exercised; automated Chromium coverage alone is not evidence of a manual Edge installation.

## Risks and assumptions

- The toolbar/full-tab Chrome/Edge scope remains an assumption, not an explicit user selection. A later user correction takes precedence and must be reflected in both plan and queue before dependent tasks start.
- Moving the source tree can break nested standalone builds, brand links, test discovery, or lazy module paths. Make 01 independently pass website checks before adding the extension.
- Source-only workspace exports must participate in Turbo cache invalidation even when the shared package has no build output. Verify cache correctness rather than serving stale editor/reader bundles.
- The public share destination comes from the repository's current primary URL. Keep it configurable and preserve the GitHub Pages path when that host is chosen; no host availability guarantee is implied.
- Retaining Web Storage avoids unrelated persistence work but keeps its quota and data-loss characteristics. Tell users to export/share backups and that website/extension libraries are separate.
- Packaged extension CSP and actual download/clipboard behavior need browser verification; an HTTP dev preview cannot establish them. Time capsules require the existing four drand hosts, but plain/password editing and export must not contact them.
- The extension package adds browser tests to a CI workflow currently capped at 15 minutes. Use focused coverage and modest workers; adjust timeout only with observed need and preserve sequential KDF/build scheduling.
- No publication credentials or store metadata are needed to complete the requested local implementation and package. Store submission is outside this execution queue.


## 执行结果

Completed only this queue in dependency order **01 → 02 → 03 → 04**, from clean `main` at `a52c75a7b3a98909e4850ab54e7267bdd295456d`. The accepted working assumption remained the Chrome/Edge Manifest V3 toolbar action opening the full packaged editor in a new tab; no alternative choice arrived. Each implementation used one isolated Herdr worktree, one task commit, review, a rebase performed by the same task session, independent coordinator validation, and local fast-forward integration. No rebase conflicts occurred. Implementation HEAD is `6573c179c2da6a3039517629ae521d48a40f3688`; a separate documentation commit records this execution result.

### Integrated tasks and routing

Saved `default_agent: codex`, each todo’s `agent: inherit` and original difficulty remain intact. All agents were launched through Herdr with explicit `--dangerously-bypass-approvals-and-sandbox`, `--model gpt-6-astra` and the resolved reasoning setting. The coordinator’s `high` was never a task override.

| Todo / archived file | Integrated commit | Actual agent / model / reasoning | Independent coordinator acceptance |
| --- | --- | --- | --- |
| [01-shared-editor.md](todos/done/01-shared-editor.md) · hard | `86d6aaa18b2525a7ab0f147d4ddb1a6fe30ee460` | Codex / gpt-6-astra / max | Frozen install, typecheck, 631 units, website build and 28 Chromium/WebKit browser cases passed. |
| [02-extension-package.md](todos/done/02-extension-package.md) · hard | `ed3294d4305d89582be9133bc09c4b1434706586` | Codex / gpt-6-astra / max | Frozen install, typecheck, 683 units, both builds, package checks and 13 installed Chromium smoke checks passed. |
| [03-share-link-import.md](todos/done/03-share-link-import.md) · medium | `7b195b6c99688c744b5cce21b40e412b3ec92cb1` | Codex / gpt-6-astra / xhigh | Frozen install, typecheck, 870 units, both builds and 10 installed import checks passed. |
| [04-extension-regressions.md](todos/done/04-extension-regressions.md) · hard | `6573c179c2da6a3039517629ae521d48a40f3688` | Codex / gpt-6-astra / max | Frozen install, typecheck, 876 units, both builds, 55 browser cases, both audits and the package command passed. |

All four todo files are archived under `todos/done/`, and the queue records each task as integrated and cleaned. The shared package maintains the website and standalone reader, while extension APIs stay in `apps/extension`. The installed tests exposed and fixed a password-cancellation race: an old asynchronous unlock result can no longer replace the local editor after cancellation or a newer attempt. Four focused units and a real-AES browser regression cover the correction. All 619 original units remain covered; existing website/file test assertions were preserved.

### Final validation

Every final command selected `PATH=/home/ubuntu/.nvm/versions/node/v22.22.3/bin:$PATH`: **Node v22.22.3 / Bun 1.4.2**. Units completed before builds/browsers. The coordinator used a new worktree-local Turbo cache (`.turbo/coordinator-final-cache`) so typecheck, units and initial builds ran uncached. The task’s post-rebase checks also ran uncached. No skip or retry was used in the final local browser runs.

| Coordinator command, sequentially in the rebased task worktree | Actual result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed, 176 installs across 227 packages checked, no changes; 0.01 s. |
| `bun run typecheck` | 3/3 tasks passed, uncached; 7.99 s. |
| `bun run test` | **876/876**: 635 shared tests in 19 files + 241 extension tests in five files; 25.79 s. |
| `bun run build` | Both production apps passed, uncached; 7.46 s. |
| `FOIL_E2E_PORT=4491 FOIL_EXTENSION_E2E_PORT=4492 bun run test:e2e` | **55/55**: 28 website cases + 27 extension/file cases (19 installed Chromium, four Chromium files, four WebKit files); 96.54 s. |
| `npm_config_registry=https://registry.npmjs.org bun audit` | No vulnerabilities among 221 packages; 0.09 s. |
| `npm_config_registry=https://registry.npmjs.org bun audit --prod` | No vulnerabilities among 37 packages; 0.06 s. |
| `bun run --cwd apps/extension package` | Build/check/ZIP passed, 12 runtime files; 7.43 s. |

The task agent additionally passed browser/dependency installation, the full default **55/55** matrix, the separate website `/` build and **28/28** Chromium/WebKit cases, and a configured `/foil/` public share-host run with **5/5** cases covering all four outgoing modes and password HTML delivery/re-export. Exact commands, timings, preliminary failures and their fixes are in the [04 archive](todos/done/04-extension-regressions.md). The `/foil/` default website and default public share destination were restored after variants. Cleanup failure probes and Turbo source/helper/environment invalidation checks passed.

After integration, the coordinator again ran frozen install, root build and the extension package command in the original checkout, all successfully, and verified every ZIP entry byte-for-byte against the final dist. Both hosts’ standalone resources are identical. Known React act/deprecation warnings and Playwright color/server-shutdown diagnostics remain documented; no final functional failure, unexpected HTTP(S), page error or CSP violation was hidden. Dependency versions were not upgraded by task 04.

Automated browsers: **Chromium 153.0.8010.12** for the installed extension; **Chromium and WebKit 26.6** for website and actual `file://` recipients. The toolbar evidence combines listener units with the actual compiled handler invoked through DevTools and real Chrome APIs. **Native toolbar clicking and manual branded Chrome/Edge installation were not performed.** Remote CI was not run; its commands and artifact wiring were validated locally.

### Final local artifacts

These paths are in the original checkout and survive task-worktree cleanup:

- Unpacked extension: `/home/ubuntu/workspace/foil/apps/extension/dist/` — **12 runtime files**, **916,640 uncompressed bytes**. Load this directory through Chrome/Edge Developer mode → Load unpacked.
- ZIP: `/home/ubuntu/workspace/foil/apps/extension/artifacts/foil-extension-0.1.0.zip` — **315,783 bytes**, manifest at archive root; SHA-256 **`b48f479a75b84716fe5b9652c1626cf556397153c402029b7631bc65ba5731d0`**. Its contents exactly match the tested and rebuilt dist.
- Website: `/home/ubuntu/workspace/foil/apps/web/dist/` — restored default `/foil/` asset base. Pages upload configuration remains limited to this directory.
- Shared standalone resource SHA-256: `7dbac5572e21a800c27be97e947740d87a280a75205efe11ac6fc5882c458173`.
- Preserved ignored review evidence: `/home/ubuntu/workspace/foil/apps/extension/artifacts/validation/`. Its README indexes the task’s default/root/configured-share reports and downloads; `coordinator/` contains the independent default reports and `/tmp/foil-coordinator-04-*.log` copies; `final-artifacts.json` records the final byte/hash verification. Earlier task logs remain at `/tmp/foil-coordinator-01-*`, `02-*` and `03-*`; final checkout build logs are `/tmp/foil-final-{install,build,package}.log`.

### Cleanup and remaining scope

All four recorded task workspaces (`w1V`, `w1X`, `w1Y`, `w1Z`), their four worktrees and `herdr/plan-browser-extension-*` branches were removed after safe integration. `git worktree list` now contains only the original Foil checkout. No recorded task resource is retained. Recovery counts were **01: 0, 02: 1, 03: 1, 04: 1**: tasks 02/03 dismissed post-completion model-switch advisories while retaining the required model/effort; task 04 resumed its exact session (`01a0816e-0be1-7462-9c95-3ffb0469de38`) after its original process/pane exited, retaining Codex/max and completing rebase/checks. No model downgrade occurred.

Herdr workspace **`w10`** has a label referring to task 04 but was absent from the coordinator’s creation records. The task’s original session action record contains no Herdr commands or w10 creation. Its creator is unverified; it was left untouched under the skill’s ownership rule. It retains no registered Foil Git worktree or task branch. Unrelated workspaces/plans were not operated on.

No functional blocker or deferred queue task remains. Manual branded-browser/native-toolbar verification is the stated coverage limitation. Store publishing, deployment, remote CI execution, PR creation and push were outside scope and were not performed. Final tracked checkout state is clean after the execution-record commit; generated dist/ZIP/reports remain ignored local artifacts.
