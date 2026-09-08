difficulty: hard
agent: inherit

# Extract the shared Foil application

Read [the plan](../plan.md) and [queue routing](README.md). This task has no dependencies. One isolated worktree, one final commit. Keep this refactor independently usable by the website before the extension is introduced.

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
