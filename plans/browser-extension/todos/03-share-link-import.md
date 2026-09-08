difficulty: medium
agent: inherit

# Open pasted Foil share links in the extension

Read [the plan](../plan.md), [routing](README.md), and the completed host/package handoffs. Start after `02-extension-package.md` is merged (01 is a transitive dependency). One isolated worktree, one final commit.

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
