difficulty: medium
agent: inherit

# Open pasted Foil share links in the extension

Read [the plan](../../plan.md), [routing](../README.md), and the completed host/package handoffs. Start after `02-extension-package.md` is merged (01 is a transitive dependency). One isolated worktree, one final commit.

## T1 · Parse a bounded share URL without contacting its host

- Work: add a pure extension import helper accepting an absolute HTTP(S) URL or raw `#d=`, `#e=`, `#td=`, `#te=` fragment. Use the shared transport constants and existing encoding/normalization conventions. Extract only the fragment; the supplied URL must never be fetched, followed, or treated as an extension navigation destination. Do not duplicate decoding/crypto logic.
- Work: reject empty, malformed, unsupported-scheme, credential-bearing, unknown/missing-fragment, invalid-base64 or over-limit inputs before expensive decoding. Bound total input length before URL parsing while allowing a normal website base plus the existing 256 KiB fragment budget. Preserve valid legacy padding supported by the codec. Validation errors must not echo document payloads or passwords.
- Expected files: new `apps/extension/src/lib/import-share-link.ts` and focused tests; use the narrow exports created in 01, making a minimal export addition only if needed.
- Acceptance: table-driven cases cover all four schemes, primary/backup/custom HTTP(S) bases, raw fragments, whitespace boundaries, valid legacy padding, unknown/unsafe URL schemes, credentials, malformed encoding and exact size boundaries. Parsing performs no network/clipboard/storage operation. Actual document-schema and cryptographic validation still happens through the shared app's existing decoder.
- Dependencies: `02-extension-package.md` (01 transitively).

## T2 · Add an accessible explicit import action

- Work: add **Open shared link** to the shared app's host-action slot from the extension entry. Implement a compact dialog with a labelled paste field, submit/cancel, helpful inline validation, keyboard focus handling and the existing Foil styling. Input is user-pasted text; do not request clipboard-read or access the active web page.
- Work: after validation, open a new tab at the fixed packaged `chrome.runtime.getURL('index.html')` plus the accepted fragment. Preserve the current tab and any pending edits. The existing app owns read-only rendering, initial fragment stripping, password/time gates, errors/retry/cancellation and explicit **Edit anyway** forking. Do not pre-save imports or create a competing state machine. Handle a failed `tabs.create` operation visibly and leave the user's input available to retry.
- Expected files: new `apps/extension/src/components/OpenSharedLink.tsx` (or equivalent), component tests and small scoped styles; update `apps/extension/src/main.tsx`; consume shared host props without introducing `chrome` into `packages/editor`.
- Acceptance: valid submit requests only a fixed local extension page with the extracted fragment, works from editor/read-only views, and closes or reports errors correctly. Invalid submit/cancel never navigates or mutates documents. The dialog is keyboard usable and restores focus. Component tests cover submit, malformed input, cancellation and API rejection rather than merely snapshotting markup.
- Dependencies: `02-extension-package.md`; T1.

## T3 · Verify the import-to-preview-to-fork handoff

- Work: use the built extension to smoke valid plain/password imports, confirming address-bar fragment removal and read-only behavior before explicit fork. Confirm the original document remains intact, malformed/cancelled imports cannot replace it, and the imported title/Markdown/comments match the shared data after forking. Hand exact selectors/API behavior to 04 for the full browser matrix.
- Expected files: focused parser/component tests and completion notes; extension README text only for the new import control if needed. Leave the full installed-package regression suite to 04.
- Validation: root `bun run typecheck`, `bun run test`, `bun run build` sequentially with the pinned toolchain, plus the targeted installed-extension import smoke. Use deterministic data and no live drand requests. Existing shared codec/gate tests continue to cover all four schemes; 04 adds installed-context protection cases.
- Acceptance: a website snapshot can be deliberately brought into the extension library without visiting its supplied host or synchronizing website storage. Record exact outcomes, available user actions and any environment limitation for 04. No broad browser permissions or new protocol is introduced.
- Dependencies: `02-extension-package.md`; T1/T2.

## Completion and handoff · 2026-09-08

Completed only task 03 on `herdr/plan-browser-extension-03-share-link-import`, starting at integrated task 02 commit `ed3294d4305d89582be9133bc09c4b1434706586`. The single local task commit is `feat(extension): open pasted shared links in a new tab` (the commit containing this note; its hash is reported in the final response). Integration awaits explicit coordinator instruction. Routing remains `agent: inherit`, Codex / `gpt-6-astra` / `xhigh`. Task 04 and the plan's final execution section remain with the coordinator.

### Files and API contract

- Added `apps/extension/src/lib/import-share-link.ts` and its table-driven tests. `parseShareLink(input: string): string` returns only the original supported fragment, with valid legacy padding preserved. `ImportShareLinkError` carries a fixed safe diagnostic. `IMPORT_SHARE_LINK_MAX_CHARS` is **264,192** characters: the existing **2,048** website-address limit plus **262,144** fragment characters, including `#` and its scheme. The raw total, including surrounding whitespace, is checked before trimming or URL parsing. The address portion includes any query; use a raw fragment if the website address is longer.
- Added only two narrow exports to `@foil/editor/share`: existing `SHARE_BASE_URL_MAX_CHARS` and new `validateUrlPayload(payload: unknown): asserts payload is string`. The latter wraps the existing private URL transport inspector. It does no byte decoding, decompression, schema validation or crypto, and preserves the codec's historical omitted-leading-`#` convention; the extension parser itself requires a literal `#`. Existing encoding/decoding functions and constants are unchanged. This avoids duplicating the canonical base64, padding, AES framing and size checks.
- Added `apps/extension/src/components/OpenSharedLink.tsx`, `.css` and `.test.tsx`; `src/main.tsx` mounts `<App shareBaseUrl={shareBaseUrl} headerActions={<OpenSharedLink />} />`. The native `dialog.showModal()` supplies the modal top layer and inert background; the paste field receives initial focus and the trigger receives focus on close. The form has labelled input, associated help/error, an alert, submit/cancel and a pending state that prevents duplicate requests. Cancellation is disabled while the tab API operation is pending. API rejection or synchronous failure leaves the input available and displays a fixed retry message without echoing API details.
- Navigation is exactly `chrome.tabs.create({ url: chrome.runtime.getURL('index.html') + fragment })`. There is no supplied-origin destination, tab lookup/update, clipboard read, document read/write or import persistence. The shared app still owns initial fragment stripping, preview, password/time gates and explicit forking.
- Extended extension Vitest discovery to `.test.tsx`, enabled the already-installed React plugin/deduplication, and declared the existing `jsdom` version as this package's DOM-test dependency. `bun.lock` changes by one workspace dependency line; no resolved package or version changed. Node-based existing extension tests remain Node-based; the component test selects jsdom per file. Its minimal dialog lifecycle shim does not claim native focus trapping coverage.
- Added only the import-control usage section to the extension README. Remaining files are this todo archive and queue status. No shared App/storage/gate implementation, website source/config, HTML implementation, manifest, permissions, worker, build configuration, icons or other plan was changed.

### Per-acceptance evidence

| Acceptance | Observed evidence |
| --- | --- |
| T1: bounded, pure URL/fragment parsing | Tables cover `d/e/td/te`, primary/backup/custom HTTP(S) addresses, queries/subpaths, uppercase HTTP scheme, raw fragments, surrounding whitespace, credentials (including empty/encoded userinfo), unsafe/unknown schemes, malformed URLs/percent escapes, missing fragments and malformed base64. Forbidden network/clipboard/storage/crypto/decompression/atob probes remain untouched. A separate URL spy proves oversized input is rejected before URL parsing. |
| T1: codec conventions and boundaries | Valid canonical unpadded and legacy `=`/`==` payloads are returned unchanged. Wrong padding, alphabet, tail bits, extra fragment/query delimiters and short encrypted framing are rejected through the shared inspector. Exactly 256 KiB works for `#td=`/`#te=`. For `#d=`/`#e=`, the exact cap leaves an impossible base64 length of 1 modulo 4; the largest valid unpadded size is one character below it. One character above the transport cap is rejected for every scheme. The exact 2,048-character address and 264,192-character total pass; one over each fails. A real plain share round-trips and valid base64 for `{}` passes framing but fails the existing document decoder. |
| T2: explicit accessible action | Component cases exercise successful fixed-local submissions for every scheme, invalid/oversized input, cancel/Escape, focus restoration, API rejection/synchronous failures and retry, plus duplicate-submit/pending behavior. Storage spies and source/session sentinels remain unchanged. Installed checks confirm the real control in editor and read-only headers, native modal/inertness, keyboard traversal, Escape, restored focus and a 390×844 layout. Desktop/mobile dialog screenshots were visually inspected. |
| T2: source isolation and failure handling | Actual malformed/unsafe/credential/oversized submissions and valid-input cancellation create no tabs and change neither library. Valid submission uses real Chrome APIs to open a new packaged tab. An actual source edit is dirty before the dialog opens; it remains in the source editor and is saved by the existing debounce/lifecycle. Component API-failure cases retain the exact input and expose only the fixed retry diagnostic. No API replacement is used for successful installed imports. |
| T3: website snapshot → preview → fork | The built website generates plain/password links from deterministic title/Markdown/comments, served entirely from local built bytes at `https://website.fixture.test/foil/`. A custom never-contacted host is pasted into the extension for plain import; a raw encrypted fragment is opened from that read-only preview. Both new extension tabs strip their fragments, have no document session binding or new library record, and show exact Markdown/comments only after applicable gates. Wrong-password retry succeeds through the shared gate. |
| T3: persistence only after explicit fork | Clicking **Edit anyway** on each preview creates a different local ID with exactly the website title, Markdown and full comment objects. Both survive reload as editable documents. The source draft and website library remain unchanged. Cancelling another password gate keeps the source intact; as before, the shared App creates its usual sample document in the new tab when no tab binding exists. |
| T3: policy/regressions | Final installed probe passed **10/10** checks in bundled Chromium **153.0.8010.12**, using a fresh persistent profile, real extension/service worker and normal CSP. All HTTP(S) was intercepted; only six website-fixture requests were fulfilled from disk. Imports ran offline. There were **zero supplied-host/drand/unexpected requests, page/console errors or CSP violations**. Root baseline tests pass. Website main/CSS filenames remain `index-DYA07LPc.js`/`index-DMW3df8-.css`; both hosts' standalone resources retain task 02's SHA-256 `7dbac5572e21a800c27be97e947740d87a280a75205efe11ac6fc5882c458173`. |

### Actual commands and results

Every command used `PATH=/home/ubuntu/.nvm/versions/node/v22.22.3/bin:$PATH`; `node --version` returned `v22.22.3`, `bun --version` returned `1.4.2`. Turbo used `TURBO_CACHE_DIR="$PWD/.turbo/cache"`. Frozen install, root typecheck, full units and root build ran sequentially; browser work began only after they finished. No KDF suite overlapped builds/browser work.

| Command | Result |
| --- | --- |
| `bun install` | Declared extension ownership of existing jsdom; no upgrades, lockfile changes only by one workspace line. |
| `bun run --cwd apps/extension test src/lib/import-share-link.test.ts src/components/OpenSharedLink.test.tsx` | **187/187 new cases**, 2/2 files, 1.22 s. |
| `bun install --frozen-lockfile` | Passed; 176 installs across 227 packages checked, no changes. |
| `bun run typecheck` | **3/3 tasks passed uncached**, 7.252 s. |
| `bun run test` | **870/870**: shared 631 in 18 files, extension 239 in 5 files. Both tasks uncached, 26.246 s overall; no failures/skips. |
| `bun run build` | Both apps passed uncached, 6.888 s overall; extension transforms 171 modules and emits the loadable 12-file package. |
| `bun run --cwd apps/extension check` | Passed, all 12 runtime files/paths/policy checked. |
| `bun apps/extension/artifacts/import-smoke.ts` | Final run **10/10 checks passed**, exit 0; installed Chromium 153.0.8010.12, real website fixture and extension, normal CSP, no live external network. |
| `sha256sum apps/web/dist/foil-standalone.js apps/extension/dist/foil-standalone.js` | Both match the task 02 hash above. |
| `git diff --check`, scoped unchanged-file checks | Passed; website, existing shared tests, manifest/worker and all persisted formats remain unchanged. |

The full unit log retains the known `ReactDOMTestUtils.act` deprecation and standalone `ShareModal` act warning; neither was suppressed. The only preliminary browser failures were harness assertions: native browser-chrome focus between dialog controls, whitespace around the existing Share button text, the existing warning-symbol prefix in the password error, and checking the icon-only Rename button instead of the title-bearing Switch document button. These were corrected without changing application code or dropping acceptance assertions. jsdom lacks `showModal`/`close`; only unit tests use the documented shim. Installed checks use the native implementation.

### Exact selectors and behavior for 04

| UI / state | Playwright selector or assertion |
| --- | --- |
| Header action | `getByRole('button', { name: 'Open shared link', exact: true })` in editor/read-only/after-fork headers |
| Native dialog | `getByRole('dialog', { name: 'Open shared link', exact: true })`; `element.matches(':modal')` is true |
| Paste field | `getByRole('textbox', { name: 'Foil share link or fragment', exact: true })`; generated IDs are intentionally not fixed |
| Submit/cancel/error | Scope to dialog: buttons `Open in new tab`, `Cancel`; pending text `Opening…`; `getByRole('alert')` for safe validation/API errors |
| New tab | Register `context.waitForEvent('page')` before submit; await the new page's packaged URL and preview/gate. The fragment is stripped early, so assert final URL equals `chrome.runtime.getURL('index.html')`. |
| Read-only/fork | `.preview`, no `[contenteditable="true"]`, null `sessionStorage.foil_current_id`, unchanged `foil_doc_*` records; button `Edit anyway` creates the local record |
| Password | Heading `This document is encrypted`, `getByLabel('Password', { exact: true })`, button `Unlock`; wrong-password text matches `/Wrong password or corrupt link\./` because its wrapper also includes a warning symbol |
| Content | `.editor .ln` text joined with newlines after stripping ZWSP gives exact Markdown in preview/editor; `.gutter-comments` contains the comment; stored `{ title, md, comments }` is compared exactly after fork |
| Forked title | `getByTitle('Switch document', { exact: true })` contains the title; `Rename document` is an icon button |

Native traversal keeps background document controls inert, including programmatic focus attempts. Chromium may temporarily focus browser chrome (document `activeElement` becomes `body`) between the last/first dialog controls; the next traversal returns to the modal. The smoke permits only that browser step, never a background control. Textarea Enter inserts a newline; Tab reaches Cancel/submit and their standard keyboard activation works. Escape and Cancel close before navigation and return focus. A pending `tabs.create` cannot be undone, so dismissal is disabled until it resolves/rejects. No clipboard-read, tabs, activeTab or new host permission was added; [Chrome's tabs documentation](https://developer.chrome.com/docs/extensions/reference/api/tabs) confirms creating a tab needs no additional permission. Native modal semantics were checked against [MDN's dialog documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog).

### Artifacts and limits

Worktree root: `/home/ubuntu/.herdr/worktrees/foil/herdr-plan-browser-extension-03-share-link-import`.

- Built unpacked extension: `apps/extension/dist/`. This task did not rebuild/claim a new ZIP; task 04 owns final package/CI verification.
- Temporary targeted harness: `apps/extension/artifacts/import-smoke.ts`. Successful report/profile/screenshots: `apps/extension/artifacts/import-smoke-s5PoQC/`, including `report.json`, `import-dialog-desktop.png`, `import-dialog-mobile.png`, `plain-preview.png`, `password-fork.png`. These remain ignored, outside `dist` and outside permanent tests.
- Logs: `/tmp/foil-03-{typecheck,unit,build,smoke}.log`. Portable handoff copies of the harness, successful report/screenshots and logs are in `/tmp/foil-03-handoff/`; copy the harness back to the extension's ignored `artifacts/` directory to retain its relative package/root resolution.
- Only bundled Chromium was exercised. No native toolbar click, branded Chrome/Edge installation, installed time/combined import matrix, full website/file browser suite, audit, CI or publication is claimed here. Existing shared codec/gate tests retain all four schemes; task 04 owns that full browser matrix. Tab-API rejection is covered by component tests, not an artificial failure of the real installed success path.

All task 03 acceptance is complete. No extra agents, rebase, merge, branch switch, push, deployment, publication, PR, stash, worktree deletion or other-plan work was performed. The branch remains available for explicit coordinator integration with exactly one task commit and a clean tracked worktree.
