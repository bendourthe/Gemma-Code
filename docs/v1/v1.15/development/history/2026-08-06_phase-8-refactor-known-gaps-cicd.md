# Session History - v1.15.0 Phase 8 (FINAL): refactor + known-gaps + CI/CD + release readiness

**Date**: 2026-08-06
**Plan**: [../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md](../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md)
**Phase**: 8 of 8 (final) - "Architecture Refactor, Known-Gaps Reconciliation, and CI/CD"
**Outcome**: Complete. Release gate GO -- every suite green with zero failures. Handed to `/update release`; nothing auto-tagged or pushed.

## Goal

Close the v1.15.0 cycle: verify the layout, reconcile known gaps (including the carry-forwards and the long-tracked 5.P1.BB), confirm CI/CD covers every change, run the full validation suites, and hand release-readiness to `/update release`.

## What was done (verification + reconciliation; no feature code changed)

### 8.1 - Architecture refactor

- **Detectors clean**: no stray `TODO`/`FIXME`/`XXX`/`HACK`/`DEVIATION` markers, no empty directories, no non-version orphans across every v1.15-touched tree (`desktop/src/modules/{image,video}`, `desktop/src/shared/{chat,models}`, `desktop/sidecar/src/models`, `core/registry/installedProbe.ts`, `src/activation/safeMode.ts`). `check:docs-layout` reports the canonical layout; `check:naming` clean.
- **Orphan triage -> retain, not delete**: the Phase 5/6 chat redesigns left three components with no app mount point. Each was resolved as a deliberate **keep** rather than a deletion, because each is still unit-tested and is the exact asset a documented deferred gap needs:
  - `MaskEditor` -> the deferred inline "paint a mask on an attachment" affordance (IRSC.P5.A)
  - `TimelinePreviewer` -> the deferred frame-accurate clip review (IRSC.P6.A)
  - `GenerationCanvas` -> the richer in-bubble progress visual, if the plain "Generating..." indicator proves too sparse
  Each now carries a "RETAINED, NOT DEAD" header stating why it exists and the condition under which it should be deleted, so a future reader does not mistake it for dead code.
- **Fixture hygiene**: benchmark-fixture timing noise rewritten by the test runs (millisecond deltas in 4 JSON files) was discarded, not committed.

### 8.2 - Known-gaps reconciliation

- Finalized `docs/v1/v1.15/known-gaps.md`: 19 open items across Phases 2-7 (Phase 1 = 0), all non-blocking, plus a carry-forward table reconciling every open v1.13/v1.14 item and a terminal reconciliation block.
- **5.P1.BB RESOLVED**: the v1.0.0 gap "Settings UI is wired to a mock client" is closed by v1.15.0 Phase 4 and marked resolved in `docs/v1/v1.0/known-gaps.md`.
- Noted the cross-version link discovered this cycle: the placeholder HF `sha256` pins (ICR.P1.C / ICR.P2.C) are also the direct cause of the new IRSC.P4.B (in-app HF install fails digest verification), so one pin rotation closes both.

### 8.3 - CI/CD

- Audited all 16 workflows. Every v1.15 surface is covered: `ci.yml` `test-ts` runs the Phase 7 extension activation tests, `ci.yml` `test-installer` (`uv run pytest tests/`) auto-covers the new Phase 3 test files, and `shell-build.yml` covers the desktop work (Phases 1/4/5/6) -- it gained `core/**` in its path filters during Phase 4 when the desktop suite began depending on `core/registry`.
- Optimization state confirmed: `concurrency` cancel-in-progress on every meaningful workflow, dependency caching (npm + pip/uv) in place, and `shell-build.yml` gates the expensive macOS/Windows matrix to push-to-main while PRs run ubuntu-only.
- **No change made**, deliberately: path-filtering the main `ci.yml` correctness gate would risk skipping the full suite on a cross-cutting change, which is the wrong trade even under an Actions budget.

### 8.4 - Testing and stabilization

All suites green, no bypasses:

| Suite | Result |
|---|---|
| Root vitest | 424 files / **4646 passed**, 0 failed (3 files / 6 skipped) |
| Desktop vitest | 77 files / **581 passed**, 0 failed |
| Installer pytest | green (3 pre-existing skips) |
| Build / types | `tsc -b` clean; desktop `tsc --noEmit` clean |
| Lint | root eslint clean; desktop eslint clean; installer ruff clean on all v1.15-touched files |
| Architecture | `check-architecture` 0 errors / 10 pre-existing warnings |
| Catalog guard | `check-catalog.py` OK (38 models) |

Notes:
- The root suite is **better than the v1.14 baseline** (4637 passed + 2 load-induced flakes); this cycle recorded 4646 passed and zero flakes.
- The installer `ruff check src tests` baseline reports 41 findings, all in files v1.15 never touched (cuda/node provisioners and their tests). This is the deferred NHC.P5.A lint baseline that CI already runs `continue-on-error`. Every Phase 2/3 file I changed passes ruff cleanly.
- **Environment**: the local `better-sqlite3` `NODE_MODULE_VERSION` mismatch (135 vs 137) recurred once during Phase 7 exactly as documented in v1.14; `npm rebuild better-sqlite3` repaired it. A local dev-env artifact, not a project defect -- and fittingly the very failure class Phase 7 now hardens the extension against.

## v1.15.0 cycle summary (8 phases, 6 reported issues, all resolved)

1. **Phase 1** (Issue 4) - window controls un-buried (titlebar stacking context) + opens maximized.
2. **Phase 2** (Issue 1) - installer relaunch starts at Welcome; terminal state cleared on acknowledge and by the uninstaller.
3. **Phase 3** (Issue 2) - catalog content-invariant guard (fail-closed build + CI gate) so a stale/regressed catalog cannot ship; clearer gated-token UX; plain-language post-install summary + retry.
4. **Phase 4** (Issue 3) - real `models.*` IPC backed by `NexusModelRegistry`, reconciled against Ollama's `/api/tags` and the installer's weights tree; streaming in-app install; closes 5.P1.BB.
5. **Phase 5** (Issue 5, image) - Image Studio rebuilt as a chat with an attachment composer and intent inference.
6. **Phase 6** (Issue 5, video) - Video Lab rebuilt as a chat on the same scaffold.
7. **Phase 7** (Issue 6) - extension activation made crash-proof, packaging hardened, renamed to "Nexus Code". UX rework (7.4) deferred to its own plan.
8. **Phase 8** - this close-out.

## Release readiness

- **9A (known gaps)**: reconciled; no release-blockers. Remaining items are on-device QA, operator/live-run work (multi-GB downloads), deliberate design choices, or the explicitly deferred 7.4 UX rework.
- **9B (tests + CI)**: every suite green; CI covers all changed surfaces with no unapproved gaps.
- **9C-9E**: handed to `/update release` (version bump, changelog, tag, push behind its own gates). **Nothing auto-tagged or pushed.**
