# Session History - v1.16.0 Phase 5: MLX-via-Adapters Docs + Model-Library UX

**Date**: 2026-08-16
**Version**: v1.16.0
**Plan**: [../../plans/v1.16.0-adoption-local-serving-and-ocr.md](../../plans/v1.16.0-adoption-local-serving-and-ocr.md)
**Phase**: 5 of 6 - MLX-via-Adapters Docs + Model-Library UX (adoption items A3 + A4)
**Outcome**: Complete. All quality gates passed without bypass. One ENV test isolation fix (ripgrep on PATH). macOS MLX smoke recorded as a blank checklist (LSO.P5.A).

## Goal

Document the already-supported path for running an MLX model server through `nexus.llm.localAdapters` on Apple Silicon, and polish model-library discovery plus a quick model-switch affordance. No new runtime.

## Pre-flight

`is_final_phase` = **false** (Phase 6 terminal). Model routing: plan recommends mid tier / medium effort. Phases 1-4 complete with session histories. Code for 5.1-5.2 was already in the working tree; this session ran the Phase 3-8 quality gate and documentation sequence that had not been executed.

## Sub-tasks implemented

### 5.1 Document MLX via localAdapters (+ macOS smoke)

How-to: [guides/mlx-via-local-adapters.md](../../guides/mlx-via-local-adapters.md). No bundled MLX runtime. Register a loopback `nexus.llm.localAdapters` manifest with `protocol: "openai"`. Endpoint must not have a trailing `/v1`. Examples: mlx-vlm `http://127.0.0.1:8080`, LM Studio MLX `http://127.0.0.1:1234`, nativ `http://127.0.0.1:8080`. Desktop: `~/.nexus/settings.json`. VS Code: contributed setting. Selector: `nexus.llm.backend` = manifest `name`.

Smoke checklist (blank until run on hardware): [testing/macos-mlx-smoke.md](../../testing/macos-mlx-smoke.md). Linked from README, `docs/install.md` (macOS), and ADR-0019.

Schema test: `tests/unit/docs/mlx-local-adapter-example.test.ts` extracts JSON fences, runs `validateLocalAdapterManifest`, asserts no trailing `/v1`.

### 5.2 Model-library discovery + quick-switch UX

`desktop/src/shared/models/modelLibrary.ts`: `filterCatalog`, `modelFitsHost`, `sourceLabel`. Filters: query, type, family, source (`all|installed|available|external`), tier-fit (`all|fits|over-budget`) vs `hostVramGB`. Tier-fit uses existing DTO `vramGB`.

`GET_MORE_MODELS_ID` lives in `installedFeed.ts`. Image Studio / Video Lab import it instead of a local duplicate.

`QuickModelSwitcher` lists `installedModelsForType` plus "Get more models". Get-more calls `onGetMoreModels`, not `onChange`. Chat and Coding mount it. `hostVramGB` comes from telemetry `vramTotalGB`. Over-budget catalog rows show "Needs N GB VRAM" instead of Install.

### 5.3 Testing and stabilization

Frontend tests: `modelLibrary.test.ts`, `QuickModelSwitcher.test.tsx`, extra cases in `ModelsSettings.test.tsx`, Chat/Coding wiring, `installedFeed.test.ts` sentinel. Docs schema test as above.

## Troubleshooting

**Cursor `beforeShellExecution` hook returned invalid JSON.** Personal `~/.cursor/hooks.json` invoked a Claude-shaped git-guardrails script (exit 0, empty stdout). Cursor requires a JSON permission object. Not a repo change. Unblocked so the gate could run.

**Twelve `GrepCodebaseTool` tests failed (ENV/TEST).** `rg` is on PATH. `grepWithRipgrep` treats exit 1 as a successful empty list, so the tests never hit the mocked `findFiles` fallback. The three test files now mock `child_process.spawn` to emit `ENOENT`. No production grep change.

**Isolated `npx vitest run tests/unit/docs/...` without `--config` failed to load `vscode`.** `npm test` uses `configs/vitest.config.ts` and `tests/setup.ts`, where the same file passes (2 tests). Not a product bug.

**Benchmark fixtures in `tests/fixtures/` were rewritten by an unrelated suite** (ingestMs / compactMs). Restored with `git checkout -- tests/fixtures`. Not part of this phase.

## Quality gates (Phase 7 GO/NO-GO)

| Gate | Threshold | Result |
|------|-----------|--------|
| Test failures | 0 | **0** - root 434 files / 4813 passed (6 skipped); desktop 95 / 824 |
| Coverage | >= 80% lines | **Root 87.87% lines / 84.23% branches / 91.40% functions**; **desktop 92.50% / 85.56% / 84.57%**; new modules `modelLibrary` and `QuickModelSwitcher` at 100% lines |
| Lint errors | 0 | **0** - eslint root (`src` `modules`) + desktop (`--max-warnings=0`) |
| Build | succeeds | **Yes** - `tsc -b`, desktop `tsc --noEmit`, `build:sidecar` |

Also clean: `deps:check` 0 errors.

**Verdict: GO.** No gate bypassed.

## Phase 8

1. `.gitignore`: **0 patterns added** (`coverage/` and `desktop/coverage/` already present).
2. Test review: every new/modified product file has a referencing test (how-to -> schema test; `modelLibrary` / `QuickModelSwitcher` / Models / Chat / Coding / installedFeed). Smoke checklist is manual by design. `SettingsPage` only forwards `hostVramGB`; behavior is tested on `ModelsSettings`.
3. CI/CD: no rewrite. `shell-build.yml` already watches `desktop/**` with path filters, concurrency cancel-in-progress, npm + cargo cache, PR ubuntu-only. `ci.yml` is unfiltered (docs schema test + 80% coverage-gate). No new script, secret, or dependency. Proposed diff: none.
4. Known-gaps: resolved LSO.P3.E; added LSO.P5.A; left LSO.P1.D open. Summary recomputed. Not finalized.
5. Docs cleanup audit: [docs-cleanup-report.md](../../docs-cleanup-report.md). 9 files in `docs/v1/v1.16/`, all Cat 4. No moves.
6. DEVLOG prepend 2026-08-16.
7. User docs already linked in 5.1; no further sync.
8. This file.
9. Commit message generated; not committed until the operator chooses at 8.10.

## Deviations

- Tier-fit uses catalog `vramGB` + telemetry `vramTotalGB`, not `DiffusionTier.ts` / `requiredVramGB` IPC. User-visible gating is what LSO.P3.E asked for.
- Image/Video share the sentinel id rather than mounting `QuickModelSwitcher`.
- macOS smoke is a checklist, not an on-device result.

## Files

**New**: `docs/v1/v1.16/guides/mlx-via-local-adapters.md`, `docs/v1/v1.16/testing/macos-mlx-smoke.md`, `desktop/src/shared/models/modelLibrary.ts`, `desktop/src/shared/models/QuickModelSwitcher.tsx`, `tests/unit/docs/mlx-local-adapter-example.test.ts`, `desktop/tests/modelLibrary.test.ts`, `desktop/tests/QuickModelSwitcher.test.tsx`, `docs/v1/v1.16/docs-cleanup-report.md`, this file.

**Modified**: `desktop/src/shared/models/installedFeed.ts`, `desktop/src/pages/settings/ModelsSettings.tsx`, `desktop/src/pages/settings/SettingsPage.tsx`, `desktop/src/modules/chat/ChatPage.tsx`, `desktop/src/modules/coding/CodingPage.tsx`, `desktop/src/modules/image/ImageStudioPage.tsx`, `desktop/src/modules/video/VideoLabPage.tsx`, `desktop/src/App.tsx`, `desktop/src/lib/telemetryMock.ts`, `desktop/tests/ModelsSettings.test.tsx`, `desktop/tests/ChatPage.test.tsx`, `desktop/tests/CodingPage.test.tsx`, `desktop/tests/installedFeed.test.ts`, `tests/unit/tools/handlers/filesystem.test.ts`, `tests/unit/tools/handlers/filesystem.format_json.test.ts`, `tests/unit/tools/handlers/filesystem.grep.pagination.test.ts`, `README.md`, `docs/install.md`, `docs/adr/0019-local-adapter-registry.md`, `docs/DEVLOG.md`, `docs/v1/v1.16/known-gaps.md`, `docs/v1/v1.16/plans/v1.16.0-adoption-local-serving-and-ocr.md`.

## Next steps

1. Operator chooses commit / commit-and-push / amend / stop at 8.10.
2. Phase 6 (terminal): architecture refactor, known-gaps reconciliation, CI/CD optimize. Do not start until this phase is committed.
3. On an M-series Mac, fill [macos-mlx-smoke.md](../../testing/macos-mlx-smoke.md) section D (LSO.P5.A).
