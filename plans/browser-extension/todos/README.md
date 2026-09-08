# Browser extension task queue

Plan: [../plan.md](../plan.md). Deliver `apps/extension` as a packaged Chrome/Edge Manifest V3 editor sharing the existing Foil runtime, with public website links, HTML export, explicit share-link import, and installed-package browser tests.

Status: 01 is complete in its isolated task branch and awaits coordinator integration; 02–04 are pending. Product assumption: toolbar button opens the full editor in a tab. Honor any later user correction before starting dependent work.

## Execution preferences

default_agent: codex

Source: initiating Codex host. The user supplied no global model/reasoning override or per-task agent preference. Every todo declares `agent: inherit`; the table shows the resolved choices from the shared agent-routing rules. Do not save the coordinator's settings as task defaults.

Coordinator: `codex` / `gpt-6-astra` / `high`. Task mapping: hard → `gpt-6-astra` / `max`; medium → `gpt-6-astra` / `xhigh`. Explicitly pass the auto/YOLO mode required by agent-routing on every coordinator/task launch. Local CLI/model metadata support was checked during planning; verify the execution environment when starting agents.

## Priority

| File | Status | Priority | Difficulty | Agent | Model / Codex reasoning | Description |
| --- | --- | --- | --- | --- | --- | --- |
| [01-shared-editor.md](done/01-shared-editor.md) | Complete; awaiting integration | P1 | hard | codex, inherited default | gpt-6-astra / max | Extract the existing application and standalone builder into a shared workspace package with a small host boundary |
| [02-extension-package.md](02-extension-package.md) | Pending | P1 | hard | codex, inherited default | gpt-6-astra / max | Package the real Manifest V3 editor, action worker, local assets, share-base configuration, icons and ZIP command |
| [03-share-link-import.md](03-share-link-import.md) | Pending | P1 | medium | codex, inherited default | gpt-6-astra / xhigh | Accept a deliberately pasted share link and open the existing read-only/protected/fork workflow in a new extension tab |
| [04-extension-regressions.md](04-extension-regressions.md) | Pending | P1 | hard | codex, inherited default | gpt-6-astra / max | Exercise the installed package, cross-host sharing and files; wire CI and document build/install/privacy behavior |

## 文件

1. [01-shared-editor.md](done/01-shared-editor.md)

   Completed locally; see its archived acceptance and API handoff. Dependencies: none. Owns `packages/editor`, moved source/tests, website entry/build/dependencies, root lockfile changes needed by extraction, and broken source links caused by moves.

2. [02-extension-package.md](02-extension-package.md)

   Depends on `01-shared-editor.md`. Owns `apps/extension` scaffolding, manifest/build/worker/entry/config, icons, package validation and ZIP generation, plus required root task/ignore/lockfile changes.

3. [03-share-link-import.md](03-share-link-import.md)

   Depends on `02-extension-package.md` (and 01 transitively). Owns the extension import parser/dialog and its mounting through the shared host action slot. Keep browser-specific logic in the extension.

4. [04-extension-regressions.md](04-extension-regressions.md)

   Depends on `03-share-link-import.md` (and 01/02 transitively). Owns installed-extension Playwright tests, final package assertions, CI integration/artifacts, root/extension documentation, and final cross-host/file regressions.

Execution: `01 → 02 → 03 → 04`. No safe parallel tasks in this queue: source APIs, app scaffolding, root lockfile and entry integration form a dependency chain. Each task uses a separate worktree and produces one final implementation commit; rebase on the merged dependency before starting. Execute only this queue, not outstanding todos from other plans.

## Handoff contracts

- 01 provides source-first `@foil/editor`, narrow browser/style/type/codec exports, a separate Node-only standalone-build export, a `shareBaseUrl` host option, and an optional header action slot. Record the exact exported APIs and their paths in its completion notes.
- 01 must fix standalone builder source roots and host-document-relative runtime URL resolution. Preserve the standalone reader's lack of editor/library dependencies, all existing storage keys and wire formats, and both website deployment bases.
- 02 supplies a loadable `apps/extension/dist`, a real action worker, an app-local website-base resolver defaulting to `https://foil-47v.pages.dev/`, the standalone resource module and all crypto chunks, test configuration, and a documented `package` command. No HTTP server is required by the production extension.
- 03 parses input without contacting its origin and opens only a fixed extension entry plus a bounded supported fragment. Decoding/gating/forking remain in the shared app. Source documents remain intact when opening or cancelling imports.
- 04 must test the real extension origin with service workers enabled. Use bundled Playwright Chromium and fresh persistent profiles; website and local-file recipient contexts retain their appropriate existing configurations. No live public drand requests or security bypasses.
- Website and extension use separate origin-local libraries; retain existing synchronous Web Storage for page data. No worker storage, content scripts, browser sync, broad host grants, or automatic website-data migration.
- Manifest host grants are limited to the four existing drand HTTPS hosts. Keep locally bundled scripts under strict extension CSP and preserve the existing website/file policies.
- Existing baseline is typecheck + 619 passing unit tests; planning recorded React act warnings and use of shell Node 24.20.0. Use pinned Node 22.22.3/Bun 1.4.2 for final checks; the pinned Node executable is installed locally as recorded in the plan.

## Validation and completion

Each task runs root `bun run typecheck`, then `bun run test`, then `bun run build` sequentially, plus its targeted acceptance checks. Moved tests must execute exactly once. Do not run KDF tests concurrently with builds or other heavy validation. If an environment/fixture fails, diagnose it rather than skipping assertions.

Final task runs root `bun run test:e2e`, dependency audits, and the real extension package command, then the separate website `/` build/e2e variant. Configure cross-package build dependencies and independent website-preview ports for extension recipient tests. Run browser installs with `bun run test:e2e:install --with-deps` when needed. Exact commands and acceptance matrix are in the plan.

Completion notes must record actual APIs, artifacts, tested browsers/toolchain, commands/results, any baseline warning or remaining limitation, and the task commit. Do not publish to a store, deploy a site, push, or claim an untested browser installation. Archive completed todos according to herdr-finish-plan and report the final package location.
