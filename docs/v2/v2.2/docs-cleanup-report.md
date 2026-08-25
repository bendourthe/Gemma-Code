# Docs Cleanup Audit - v2.2 (Phase 1)

**Date**: 2026-08-22
**Mode**: audit (no files moved)

## Findings

- `docs/v2/v2.2/` created this cycle with the canonical layout: `plans/`, `known-gaps.md`, `development/history/`.
- The duplicate sibling plan `plans/v2.2.0-desktop-usability-and-model-lifecycle.md` (a Grok-generated draft) was reviewed, its strengtheners merged into the authoritative plan, and the file deleted on user instruction before implementation started. No dangling references (the authoritative plan's "Locked product decisions" section cites it as a historical note only).
- No scratch docs were created by Phase 1. No moves proposed.

## Verdict

Clean. No action required.

## v2.2.3 Phase 1 audit

**Date**: 2026-08-22
**Mode**: audit (no files moved)

- The canonical plan remains under `docs/v2/v2.2/plans/` and the phase history is under `docs/v2/v2.2/development/history/`.
- Phase 1 creates no scratch documentation, duplicate plan, orphan directory, or alternate version tree.
- The shared v2.2 known-gaps and devlog files are updated in place; no cleanup move is proposed.

**Verdict**: Clean. No action required.

## v2.2.3 Phase 2 audit

**Date**: 2026-08-22
**Mode**: audit (no files moved)

- Phase 2 changes existing desktop chrome and tests in place; it creates no scratch docs, duplicate component directory, or alternate styling subtree.
- Shared `.nexus-nav-link` and `.nx-icon-btn` rules live with the existing global surface primitives rather than creating a parallel stylesheet.
- The remaining MediaComposer/CodingInput surface duplication is already tracked as DF-14 for the Phase 8 scoped architecture audit.

**Verdict**: Clean for Phase 2. No move proposed.

## v2.2.3 Phase 7 audit

**Date**: 2026-08-22
**Mode**: audit (no files moved)

- Installer changes stay within the existing `scripts/installer/src/nexus_installer/` page, widget, and window boundaries plus the shared registry recommendation matrix.
- Phase 7 creates no duplicate installer page, scratch asset, generated executable, or alternate model-default file.
- The Complete-page Copy override remains local to `_CommandRow`; no global theme fork was introduced.

**Verdict**: Clean for Phase 7. No move proposed.

## v2.2.3 Phase 3 audit

**Date**: 2026-08-23
**Mode**: audit (no files moved)

- Agent-state presentation remains in the existing `desktop/src/components/agentState/` boundary, and media-specific sizing remains scoped to the shared message bubble instead of creating a second renderer.
- Generation error propagation extends the existing `core/generations/` queue and sidecar completion channel; no parallel queue, output cache, or event protocol was introduced.
- Tauri asset access is limited to the existing video output directory. No broad filesystem scope, generated bundle, scratch document, or alternate media directory was added.

**Verdict**: Clean for Phase 3. No move proposed.

## v2.2.3 Phase 4 audit

**Date**: 2026-08-23
**Mode**: audit (no files moved)

- Chat transcript persistence extends the existing explorer message store and async client contract; it does not introduce a parallel transcript database.
- Durable episodic memory reuses the existing `EpisodicMemory` SQLite layer through a sidecar composition adapter. The renderer receives a narrow IPC port rather than a second storage implementation.
- Session replay remains part of the existing chat start request, and retrieved context remains ephemeral. No duplicate session manager, streaming facade, scratch document, or alternate memory directory was added.

**Verdict**: Clean for Phase 4. No move proposed.

## v2.2.3 Phase 5 audit

**Date**: 2026-08-23
**Mode**: audit (no files moved)

- The new `generation.scheduler.snapshot` method exposes the existing Studio `GpuScheduler`; it does not create a second scheduler or occupancy store.
- Renderer occupancy conversion lives in one shared model helper, while the four pages retain their existing submit handlers and dialog primitive.
- Remembered consent is one App-session `Set` passed into page-local hooks. Pending dialog state does not leak across routes, and no persistent settings key or alternate consent database was added.

**Verdict**: Clean for Phase 5. No move proposed.

## v2.2.3 Phase 6 audit

**Date**: 2026-08-23
**Mode**: audit (no files moved)

- Workspace persistence extends the existing renderer persistence helper; it does not add a sidecar settings store or native-dialog dependency.
- Interactive and scheduled headless turns share `headlessRunEnrichment.ts`, while deny enforcement remains at the existing sidecar tool factory. No parallel agent runtime or policy parser was introduced.
- Phase 6 creates one focused scheduler adapter and one prompt-enrichment module under the existing sidecar coding boundary. It creates no scratch docs, alternate Hub catalog, or duplicate workspace directory.

**Verdict**: Clean for Phase 6. No move proposed.

## v2.2.3 Phase 8 repository and documentation audit

**Date**: 2026-08-23
**Mode**: approved proposal, no files moved or deleted

### Documentation inventory

The audit input contained 393 tracked documentation files before this Phase 8 session history was added.

| Category | Count | Disposition |
|---|---:|---|
| Category 1: Temporary or scratch | 0 | None found |
| Category 2: Prior-version archive candidates | 242 | Retained in place; a bulk v1 archive move would create reference churn outside this patch |
| Category 3: Cross-version or externally load-bearing | 85 | Retained; includes 45 v1 files with live external references and 40 cross-cutting docs |
| Category 4: Current-major v2 | 66 | Retained in canonical locations |
| Total | 393 | No move or delete approved |

- No byte-identical duplicate documentation groups were found.
- The v2.2.3 plan, known-gaps ledger, cleanup report, and phase histories already follow the canonical `docs/v2/v2.2/` layout.
- This cleanup report remains Category 4 because it is the current-major audit record.

### Project structure inventory

- The audit examined 2118 tracked non-documentation files.
- Eight byte-identical groups were found; all were intentional sentinels, packaged icon copies, or golden fixture configurations.
- Six empty directories were found; all were generated/cache outputs, test sentinels, or build output roots and none were obsolete tracked structure.
- The dual Chat Explorer interfaces were consolidated into one generic contract.
- Sidebar module routes and labels now derive from the canonical module registry.
- Exact composer structural style objects moved to one shared module; behavior-specific component markup remains separate under DF-14.

### Approval and result

The proposal to make the three scoped architecture changes, update the shell workflow, add the installer parity contract, and perform no file moves or deletions was approved on 2026-08-23. All references remain valid because no path changed.

**Verdict**: Clean and fully triaged for Phase 8. No archive, move, or deletion is warranted in this patch.

## v2.2.5 Phase 6 audit

**Date**: 2026-08-23
**Mode**: audit (no files moved)

- `core/registry/modelAliases.ts` is the canonical id table, not a leftover shim. No second alias module to delete.
- Phase histories for v2.2.5 Phases 1-6 live under `docs/v2/v2.2/development/history/`. Plans for v2.2.6 and v2.2.7 already sit in `plans/` (not started).
- No scratch docs, duplicate catalogs, or empty tracked directories to move this phase.

**Verdict**: Clean. No action required.

## v2.2.7 Phase 1 audit

**Date**: 2026-08-24
**Mode**: audit (no files moved)

- Canonical plan remains `docs/v2/v2.2/plans/v2.2.7-context-meter-and-transcript-chrome.md`.
- New helper `core/registry/contextWindow.ts` is the TypeScript chip formatter, not a stray docs file.
- Session history for this phase lands under `docs/v2/v2.2/development/history/`.
- No scratch docs, duplicate version trees, or empty tracked directories created.

**Verdict**: Clean. No action required.

## v2.2.7 Phase 2 audit

**Date**: 2026-08-24
**Mode**: audit (no files moved)

- Canonical plan remains `docs/v2/v2.2/plans/v2.2.7-context-meter-and-transcript-chrome.md`.
- New helper `core/chat/sessionContextUsage.ts` lives next to existing `core/chat` vision/budget modules.
- Session history for this phase lands under `docs/v2/v2.2/development/history/`.
- No scratch docs, duplicate version trees, or empty tracked directories created.

**Verdict**: Clean. No action required.

## v2.2.7 Phase 3 audit

**Date**: 2026-08-24
**Mode**: audit (no files moved)

- Canonical plan remains `docs/v2/v2.2/plans/v2.2.7-context-meter-and-transcript-chrome.md`.
- New UI lives under `desktop/src/shared/chat/` (`ContextUsageBar`, `ComposerContextRow`).
- Session history for this phase lands under `docs/v2/v2.2/development/history/`.
- No scratch docs, duplicate version trees, or empty tracked directories created.

**Verdict**: Clean. No action required.

## v2.2.7 Phase 4 audit

**Date**: 2026-08-24
**Mode**: audit (no files moved)

- Canonical plan remains `docs/v2/v2.2/plans/v2.2.7-context-meter-and-transcript-chrome.md`.
- New helper `desktop/src/shared/chat/transcriptChrome.ts` sits next to MessageList / MessageBubble.
- Session history for this phase lands under `docs/v2/v2.2/development/history/`.
- No scratch docs, duplicate version trees, or empty tracked directories created.

**Verdict**: Clean. No action required.

## v2.2.7 Phase 5 audit

**Date**: 2026-08-24
**Mode**: apply (one obsolete file deleted)

- Deleted unused `desktop/src/modules/chat/Breadcrumb.tsx` (ChatPage no longer imports it; tests assert the testid is absent).
- Last-phase evidence at `docs/v2/v2.2/development/last-phase-evidence.md`.
- Canonical plan remains `docs/v2/v2.2/plans/v2.2.7-context-meter-and-transcript-chrome.md`.
- No scratch docs, duplicate version trees, or empty tracked directories created.

**Verdict**: Clean after deleting the unused Breadcrumb module.
