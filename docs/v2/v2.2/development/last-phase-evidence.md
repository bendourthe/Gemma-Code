# Last-phase evidence: v2.2.8

**Date**: 2026-08-24
**Plan**: `docs/v2/v2.2/plans/v2.2.8-working-local-studio.md`
**Release handoff**: `/update release` is next, behind confirmation gates (no tag/push/publish in this phase commit). Package.json not bumped in Phase 6 (root remains 2.2.5; desktop 1.5.0).

## Architecture refactor

Deleted unused `desktop/src/modules/coding/panels/SessionListPanel.tsx`. Agents history is `FolderTree` inside `CollapsibleHistoryAside`; the Sessions tab is a pointer to the left pane (`data-testid="sessions-panel"` copy only). Removed the `SessionListPanel` describe from `desktop/tests/panels.test.tsx`. VS Code `src/panels/SessionListPanel.ts` is a different webview and stays. Chatbot remains on `chat.explorer.*`. No empty tracked directories under `desktop/src/modules/coding/panels/` (MemoryPanel and TraceDashboardPanel remain). `core/**` still must not import `modules/**` (dependency-cruiser, unchanged this phase).

## Known-gaps

`docs/v2/v2.2/known-gaps.md` section v2.2.8 closes DF-2 (packaged Explorer observed 2026-08-24). Keeps DF-32 (packaged Hi), DF-33 (Agents folder overlay), DF-34 (packaged Settings vs installer), DF-35 (packaged Hub Active=latest). DF-4, DF-23, DF-24, DF-25, DF-26, DF-27 stay open from earlier cycles. No live GPU this cycle. not_observed != absent.

## CI/CD

`.github/workflows/ci.yml` already has concurrency `cancel-in-progress: true`. Phase 6 comment maps T001-T012 onto existing jobs: cargo test in shell-build (rpc_timeout_for), test:shell (Gemma alias, FolderTree collapse, Models sort, Hub quarantine UI/CLI), test-ts (NexusHubSyncer quarantine), installer-tests (catalog_tab_sort + stale 3.12.0 pack). No new jobs. No live GPU. No live Hub clone. This repo has one Python installer plus Tauri NSIS; there is no `scripts/check_installer_parity.py` (Nexus-Hub dual-installer gate is a silent no-op here). `scripts/check_release_preconditions.py` is absent in this repo (silent no-op).

## Installer parity

Phase 4 golden fixture `tests/fixtures/v2.2.8-catalog-tab-sort.json` dual-asserts installer `collapse_and_sort` and desktop `visibleModelsOnTab`. Pack-time Hub snapshot still refuses stale 3.12.0. Unix snapshot write stays DF-24. Hub apply path is the sidecar `--sync-hub-catalog` / `skills.sync` quarantine apply (Phase 5).

## Goal-vs-codebase

Plan Goal: packaged Windows build can complete local Chatbot/Agents/Image/Video turns without `sidecar response timeout`, Hub Active matches GitHub latest, Settings Models matches installer sort/compact/downloaded, four tabs share Chatbot history chrome plus centered orbs.

Inspected (not the implementing session's memory):

- Timeouts: `rpc_timeout_for("chat.send")` is 600s; `ping` is 15s. Typed inference copy, not `sidecar response timeout`. Packaged Hi is DF-32.
- Gemma Downloaded: `installedProbe` folds `gemma4:12b` to `gemma-4-12b-it-gguf`. Packaged Settings screenshot is DF-34.
- Hub: apply quarantines high-severity skills and still writes Active. Scanner on. Packaged Active=latest is DF-35.
- History: Chatbot, Agents, Images, Videos use FolderTree 280px / 56px. Agents folders overlay-only (DF-33).
- Orbs: Chat/Agents pending `size="bubble"` centered. Image/Video hero. No `thinking-orbs` package.
- Image/Video generate: unit paths exist; live GPU is DF-4.

Misses are recorded as DF-32/33/34/35/4, not silent passes.

## Full-suite testing

Quoted:

- `npm run test:shell` (desktop vitest): Test Files 177 passed (177); Tests 1538 passed (1538).
- `npx vitest run --config configs/vitest.config.ts` (root): Test Files 522 passed | 3 skipped (525); Tests 5484 passed | 12 skipped (5496).
- `cargo test --quiet rpc_timeout` from `desktop/src-tauri`: 3 passed; 15 filtered out.
- desktop `tsc --noEmit`: exit 0.

## Human testing suggestions

Operator field checklist in the v2.2.8 plan: packaged Chatbot Hi, Settings vs installer Models, four-tab pickers, Image/Video generate or typed skip if no GPU, Agents named session, Hub Active=latest with scanner on, rail inset, rounded delete, centered orb. Do not treat this file as a release tag.

## Unsigned installer rebuild

Not rebuilt in Phase 6. `tauri.conf.json` product version remains 2.2.5 (do not bump unless `/update release` confirms). The v2.2.7 unsigned NSIS/MSI under `desktop/src-tauri/target/release/bundle/` can be reused for the field checklist. A fresh unsigned build is an operator step, not a silent pass.
