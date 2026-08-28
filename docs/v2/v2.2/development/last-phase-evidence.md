# Last-Phase Evidence - v2.2.9 Phase 7

**Project**: Nexus AI Studio
**Plan**: [../plans/v2.2.9-field-chrome-catalog-and-generate.md](../plans/v2.2.9-field-chrome-catalog-and-generate.md)
**Date**: 2026-08-27
**Driver**: `/implement in-full` final phase (Phase 7 of 7)

Each section quotes the proving command or scan per the fail-closed last-phase gate.

## Architecture refactor

`npm run cleanup:scan` (2026-08-27):

```
[cleanup-scanner] scanned C:\Users\bdour\Documents\Projects\Development\Nexus-AI at 2026-08-27T15:15:49.882Z
  stale-cache-files:         0
  deleted-path-references:   0
  orphan-memory-rows:        0
  orphan-fts-rows:           0
  dangling-embeddings:       0
Total findings: 0
```

`npm run check:docs-layout`: `check-docs-layout: canonical layout OK (no docs/versions|docs/archive/versions wrappers)`, exit 0.

Deprecated chrome removed by the phases themselves: the always-rendered empty Image/Video `<header>` became render-when-children (Phase 3); the v2.2.7 duplicate under-description chip rows in installer and Settings were replaced by one shared name-row pill grammar with dual-asserted fixtures (Phase 5); `UNKNOWN_TOKEN_MARK` (em dash) left the pending path (Phase 1). Chatbot stays on `chat.explorer.*`. No file moves were needed; no reference repair required.

## Known-gaps reconciliation

Reconciled in `docs/v2/v2.2/known-gaps.md` (2026-08-27, v2.2.9 section added). Disposition summary:

- Closed: DF-32, DF-35 (v2.2.8 Resolved; 2026-08-25 field session), DF-28, DF-31 (v2.2.9 Resolved; same session), BG-55 (stub OR-gate found by the Goal review, fixed, tested).
- Kept with annotation: DF-30 (Context pill observed; 80% CTA not), DF-29, DF-25 (not evidenced), DF-23 (Active=latest observed but clone path undistinguished), DF-34 (screenshots predate the Phase 5 grammar), DF-4 (typed errors change what the operator will see; no PNG/MP4 recorded).
- Kept unchanged: DF-33, DF-24, DF-26, DF-27.
- New: DF-36 (packaged v2.2.9 chrome unproven - field checklist on a rebuilt installer), DF-37 (error kind prose-only on the wire), WN-8 (self-mutating benchmark fixture), WN-9 (5000ms load flakes, WN-2 class), MT-4 (no per-phase coverage percentage), MT-5 (publisher-map parity untested).

Other `docs/**/known-gaps.md` files: `docs/v1/*/known-gaps.md` are closed historical cycles (Status not in-progress); `docs/v2/v2.2/known-gaps.md` is the only in-progress tracker and was reconciled above.

## Living docs architecture

- `docs/README.md`, `DEVLOG.md` (one-line-per-release index; v2.2.9 line lands at `/update release`), `docs/todos.md` (updated 2026-08-27: v2.2.9 in progress, Phases 1-6 landed, Phase 7 underway, new gap ids).
- Per-version tree `docs/v2/v2.2/` carries plans/, development/history/ (7 session-history files for v2.2.9), known-gaps.md.
- `npm run check:docs-layout` passes (quoted above). No `docs/testing/` or `docs/validation/` invented (self-gate respected).

## Git-tree hygiene

`scripts/check_release_preconditions.py` does not exist in this repository; report produced manually (report-only, nothing deleted):

```
git branch -r --merged develop
  origin/develop, origin/main, origin/feat/v1.8.0-installer-phase-6,
  origin/feat/v1.9.0-installer-phase-1, origin/feat/v1.10.0-nexus-hub-consumption,
  origin/feat/v1.11.0-installer-overhaul, origin/feat/v1.13.0-installer-reliability
```

Merged v1.x feature branches remain on the remote (candidates for cleanup; `branch-cleanup.yml` exists as a workflow). Local tree also carries historical v1.x feature branches plus `backup/pre-commitlint-reword`. Report only; no branch was deleted. Working branch `develop`; `v2.2.8` tagged on `main`.

## CI/CD coverage

- `ci.yml`: root vitest (test-ts), desktop vitest via `npm run test:shell` (Node 22 only, minutes-gated), `pytest (runtimes/)` job runs `python -m pytest tests/python -q` with no torch/GPU. All v2.2.9 test files sit inside these existing globs; the v2.2.9 (T014) contract comment was added to ci.yml. No live GPU and no live Hub clone anywhere (grep quoted the standing prohibitions).
- `installer-tests.yml`: path-gated `uv run pytest tests/` covers the new typed_catalog / model-pills / patient-tier / downloaded-first tests.
- Optimization present across workflows: `concurrency` + `cancel-in-progress` and path filters on every active workflow (grep count: 17 workflows, all with hits); expensive OS matrix gated to main pushes (shell-build.yml).
- `npm run check:tampering` after the ci.yml edit: `nexus-check: 0 findings`.
- Installer parity: this repository ships one installer engine (the Windows-first Python `RuntimeProvisioner`; DF-24 records the absent Unix complete-path writer), so the multi-installer parity checker is a no-op by the zero-or-one rule.

## Goal-vs-codebase review

Independent review (fresh agents, read-only, inspecting the tree not the session notes) against the plan Goal, clause by clause:

- Chatbot chrome (idle mic/persona, Context/picker split, full-word meta above bubble, caption rotator, selected row, persisted auto-title): LANDED with file:line evidence (ChatPage, ContextUsageBar/ComposerContextRow, MessageBubble/transcriptChrome, captionRotator/AgentStateOrb, FolderTree, titleGenerator/explorer rename).
- Image/Video history + visual meter: LANDED (header render-when-children both pages; StudioHistoryPane Chatbot copy; 12/12 studio rows carry visualTokenBudget; denominatorKind visual; DTO threaded). Note: 11/12 rows keep a pre-existing explicit `contextWindow: null` key - the locked reading is "do not invent an LLM window", and the root test pins `row.contextWindow ?? null` to be null, so LANDED under the intended reading. Built catalog copies (out/, sidecar dist/) are gitignored build artifacts regenerated by the installer rebuild below.
- Generate honesty: LANDED after one fix. The review found `allow_stub()` treated `NEXUS_DIFFUSION_ALLOW_STUB=1` as sufficient outside pytest (an OR-gate) with a test certifying the permissive behavior under a strict name - a genuine Goal miss. Fixed this phase: stub is pytest-only, flag alone refused, test asserts the refusal (BG-55). Typed kinds land at base.py/video_base.py/real_execute.py; resultGuard passes messages through verbatim; the combined string survives only as an envelope-less fallback. Residual: kind is prose-only on the wire (DF-37).
- Catalog identity: LANDED all five sub-clauses (pill order + omission discipline both surfaces, name-row placement in the DOM, Embeddings first both surfaces, Inkling-Small visible + never recommended, downloaded-first Settings vs pure installer order, dual-asserted fixtures). Watch items recorded as MT-5.
- Skills/Hub: LANDED (normalize at both compare sites, Sync-now row first, staged honest status, quarantine explainer, scanner on, one-pair waiver).
- Locks: LANDED (no thinking-orbs dependency; root package.json 2.2.8 and desktop 1.5.0 unbumped; no live-GPU CI job).

No unresolved Goal miss remains: the one MISS (stub gate) was fixed and tested; every PARTIAL is either resolved by the intended reading (contextWindow null keys), regenerated by the rebuild (built catalogs), or recorded as a known-gap (DF-37, MT-5).

## Human/manual testing suggestions

On the rebuilt unsigned Windows installer (DF-36 / plan operator field checklist):

1. Chatbot idle: no "Mic closed", no Persona label; Context bar wide, Gemma 4 12B fits the short picker.
2. Send `Hi`: rail title leaves "New chat" immediately; active row highlighted; "1 input token" + clock above the user text; assistant meta "N tokens (R reasoning + O output)" above the reply.
3. While composing: rotating Thinking/Searching/Working/Solving pill, no clock, no dash; reply replaces the pill.
4. Images/Videos: no empty top bar; history pane titled "Chats"; Context pill fills against the visual budget; attachment-free follow-up still img2imgs the last PNG.
5. Generate on this host: expect a typed message naming CUDA-missing vs weights-missing (the combined-only string is a miss); if CUDA torch and weights are present, expect a PNG (would close DF-4 - record it).
6. Installer Models vs Settings Models side by side: Embeddings tab first on both, identical name-row pills, Inkling-Small present on both, downloaded highlight + actions and downloaded-first order only in Settings.
7. Skills: no 3.21.0-to-v3.21.0 banner; Sync now at top; syncing shows the orb + staged status; Quarantined explains the scanner finding; scanner still on.

## Full-suite testing and stabilization

Final-phase runs (2026-08-27, after the stub-gate fix and ci.yml comment):

- `npm run lint:shell`: 0 errors.
- `python -m pytest tests/python -q`: 261 passed.
- Installer `uv run pytest -q` (scripts/installer): exit 0 (1120 passed, 3 pre-existing opt-in skips) - re-run at the Phase 5 boundary; no installer file changed since.
- `npm run test:shell`: `Test Files  182 passed (182)` / `Tests  1603 passed (1603)`.
- `npm test` (root): `Test Files  522 passed | 3 skipped (525)` / `Tests  5488 passed | 12 skipped (5500)`. (The WN-8 fixture mutation was restored afterward, as recorded.)
- `npm run check:tampering`: 0 findings.
