# v0.8.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: in-progress
**Audience**: v0.8.0 phase authors, code reviewer, security reviewer, ops engineer running the live-Ollama capture
**Sibling reviews**: [docs/v0.7.0/known-gaps.md](../v0.7.0/known-gaps.md) (the v0.7.0 carryover catalog that drives v0.8.0); [docs/v0.8.0/plans/v0.8.0-cycle.md](plans/v0.8.0-cycle.md).
**Context**: This is the in-cycle gap log for v0.8.0. It catalogs every item that lands only partially, every pre-existing bug or warning observed but not fixed, every operator-action item that has to land before the cycle is fully closed, and every out-of-scope item explicitly recorded for v0.9.0+. The catalog is appended phase-by-phase. The terminal `Resolved` table and `Summary` are recomputed each pass.

Each entry has a severity tag:

- **P0** -- release-blocker for v0.8.0 (must close)
- **P1** -- should-fix in v0.8.0
- **P2** -- nice-to-have; documented for completeness
- **P3** -- out-of-scope for v0.8.0; explicitly recorded for future planning

Each entry has a category tag:

- **NI** (not implemented) -- a plan sub-task that was skipped
- **DF** (deferred) -- a plan sub-task explicitly deferred to a later phase / cycle
- **BG** (bug) -- a deviation that revealed a real defect
- **MT** (missing tests) -- a coverage shortfall
- **WN** (warning) -- a suppressed lint or runtime warning
- **QG** (quality gate) -- a Phase 7 gate the cycle author bypassed with "Proceed anyway"

---

## 1. Operator-action items that must close v0.8.0

These items require an authorized operator on a quiescent dev workstation (with `ollama serve` and `gemma4:e4b` pulled) or in a fresh worktree. The agent is not authorized to run them autonomously. They are tracked in Section 10 with the matching `10.O.N` row.

### 1.1 Live-Ollama golden + benchmark baseline capture (v0.4.0, v0.6.0, v0.7.0)

**Severity**: P1
**Source**: Plan sub-task 0.2; carried from v0.7.0 known-gaps Section 10.O.14 + 10.O.15
**Files**: `tests/benchmarks/baselines/v0.7.0.json`, `tests/golden/baselines/v0.7.0.json`, `tests/golden/baselines/v0.4.0.json`, `tests/golden/baselines/v0.6.0.json` (if missing)

Procedure documented in `docs/v0.6.0/development/history/phase-08.md` Section 3.1 and Plan sub-task 0.2. Three captures plus optional v0.6.0 re-capture; requires `ollama serve` running with `gemma4:e4b` pulled on a quiescent workstation. Tracked as 10.O.A in Section 10.1.

### 1.2 v0.7.0 post-tag exit verification

**Severity**: P1
**Source**: Plan sub-task 0.6; carried from v0.6.0 operator-action 1.2

Check out the v0.7.0 tag in a fresh worktree; run the full gate (`npm ci && npm run lint && npm run build && npm run test && npm run test:integration && npm run bench && npm run deps:check && npm run catalog:check && npm run perm-tier:check && npm audit --production --audit-level=moderate`); verify GitHub release artifact contains the VSIX; re-run pen-test Attack Path A simulation against the v0.7.0 source. Tracked as 10.O.B in Section 10.1.

### 1.3 `package-lock.json` regeneration with hnswlib-node resolution

**Severity**: P3
**Source**: Plan sub-task 0.10; carried from v0.7.0 known-gaps Section 10.O.13 + 10.O.11

Run `npm install` (NOT `npm ci`) to let the `hnswlib-node@^3.0.0` optionalDependency resolve cleanly; commit the resulting `package-lock.json`. Then on Linux x64 or macOS, run the previously-skipped `runIf(HNSW_AVAILABLE)` tests. Partial cross-platform action; tracked as 10.O.C in Section 10.1.

---

## 2-9. (placeholders for end-of-cycle audit)

These sections mirror `docs/v0.7.0/known-gaps.md` Sections 2-9 and will be populated as the cycle nears Phase 7 close. For the in-cycle log of items surfaced phase-by-phase, see Section 10 below.

- **Section 2**: v0.8.0 plan items deferred to v0.9.0+ (filled at Phase 7 close).
- **Section 3**: Definition-of-Done partial deviations (filled at Phase 7 close).
- **Section 4**: Mutation-testing gaps (filled after Stryker quarterly run, Phase 7).
- **Section 5**: Pre-existing bugs and warnings observed but not fixed.
- **Section 6**: Documented-but-not-implemented items closed in v0.8.0 (audit trail).
- **Section 7**: Out-of-scope items (recorded for v0.9.0+ planning).
- **Section 8**: v0.9.0 plan starter.
- **Section 9**: Severity roll-up (recomputed at Phase 7 close).

---

## 10. v0.8.0 in-cycle gap log

This section is appended phase-by-phase as v0.8.0 lands. Each entry records the source phase, plan reference, category, severity, reason, and suggested next step. Items are moved to `## Resolved` when closed in a later phase, and the `## Summary` at the bottom of the section is recomputed each pass.

**Last updated**: 2026-05-15 (Phase 0 close).

### 10.1 Open Items

| ID | Source phase | Plan reference | Category | Severity | Reason | Suggested next step |
|---|---|---|---|---|---|---|
| 10.O.A | Phase 0 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 0.2 + 0.12 | DF | P1 | Live-Ollama golden + benchmark baseline capture (v0.4.0, v0.6.0, v0.7.0) requires `ollama serve` running with `gemma4:e4b` pulled on a quiescent workstation; the agent is not authorized to run live inference. Carries v0.7.0 items 10.O.14 + 10.O.15. | Operator: run the three captures per sub-task 0.2 procedure; document deltas in this file Section 1. |
| 10.O.B | Phase 0 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 0.6 | DF | P1 | v0.7.0 post-tag exit verification requires a fresh worktree (`git worktree add`) and the full gate run; the agent should not modify worktree state autonomously. | Operator: run sub-task 0.6 procedure; document result in this file Section 1. |
| 10.O.C | Phase 0 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 0.10 | DF | P3 | `package-lock.json` regeneration with `hnswlib-node` resolved + cross-platform HNSW test run. The lockfile regen runs locally; the cross-platform test run requires Linux x64 or macOS access. Carries v0.7.0 items 10.O.13 + 10.O.11. | Operator: run `npm install` locally; commit `package-lock.json`; run gated HNSW tests on Linux/macOS host (CI runner counts). |

### 10.2 Resolved

| ID | Source phase | Plan reference | Category | Resolved in | Notes |
|---|---|---|---|---|---|
| 10.O.1 (v0.7.0) | v0.7.0 Phase 4 | docs/v0.7.0/plans/v0.7.0-cycle.md Phase 4 stability gate | NI | v0.8.0 Phase 0.3 | Queued-message-field swap wired in `ChatWebviewHost` from streaming start/end events; new `renderQueuedMessageField` message type emitted by host. Regression test added to `tests/unit/panels/ChatWebviewHost.test.ts`. |
| 10.O.2 (v0.7.0) | v0.7.0 Phase 4 | docs/v0.7.0/plans/v0.7.0-cycle.md Phase 4 stability gate | NI | v0.8.0 Phase 0.4 | `permissionPromptResponse` case added to `ChatMessageRouter` and resolves via `ConfirmationGate.resolvePrompt`. Integration test at `tests/integration/panels/permissionPrompt.test.ts`. |
| 10.O.3 (v0.7.0) | v0.7.0 Phase 4 | docs/v0.7.0/plans/v0.7.0-cycle.md Phase 4 stability gate | NI | v0.8.0 Phase 0.5 | `todos` wiring added to `ChatPanelBootstrap`: `TodoState` constructed and passed to `buildToolRegistry`; `update_todos` tool registered. Regression test at `tests/unit/panels/ChatPanelBootstrap.test.ts`. |
| 10.O.17 (v0.7.0) | v0.7.0 Phase 8 | docs/v0.7.0/plans/v0.7.0-cycle.md sub-task 8.1 | NI | v0.8.0 Phase 0.13 | Python golden runner canonised via ADR-0017; the TS-native rewrite was explicitly rejected as not cost-effective. README + CONTRIBUTING golden-suite sections updated. |
| 10.O.18 (v0.7.0) | v0.7.0 Phase 8 hotfix | docs/v0.7.0/plans/v0.7.0-cycle.md Phase 7 sub-task 7.1 | BG | v0.8.0 Phase 0.8 | HNSW persist/reload bug investigated. Root cause: hnswlib-node `readIndexSync(path, allowReplaceDeleted)` requires the second argument to be `true` to honour the saved labels on reload (third-arg `maxElements` default of 0 is fine; the label-preservation flag is what was missing). Fix lands in `src/storage/MemoryHnswIndex.ts.tryCreate`; `HNSW_RUN_PERSIST` env-gate removed from `tests/unit/storage/MemoryHnswIndex.test.ts`. |
| 10.O.19 (v0.7.0) | v0.7.0 hotfix | docs/v0.7.0/known-gaps.md item 2.1 resolution | BG | v0.8.0 Phase 0.9 | `marked` v12 renderer perf regression mitigated by caching a single configured `marked` instance (rather than reconfiguring per call) and skipping `walkTokens` when the document has no link/code tokens. Renderer benches re-included in the nightly bench gate by removing the `--exclude` rule. Post-fix bench numbers captured in `docs/v0.8.0/performance-baselines.md`. |
| 10.O.12 (v0.7.0) | v0.7.0 Phase 7 | docs/v0.7.0/plans/v0.7.0-cycle.md Phase 7 sub-task 7.2 | MT | v0.8.0 Phase 0.11 | Background-workers E2E integration test landed at `tests/integration/background-workers-end-to-end.test.ts` exercising the AgentLoop -> SubAgentManager -> BackgroundWorkers -> spawn `node bin/gemma-check.mjs --json` path against fixture files. |

### 10.3 Summary (v0.8.0 in-cycle)

| Category | Open | Resolved |
|---|---|---|
| NI (not implemented) | 0 | 4 |
| DF (deferred) | 3 | 0 |
| BG (bug) | 0 | 2 |
| MT (missing tests) | 0 | 1 |
| WN (warning) | 0 | 0 |
| QG (gate bypass) | 0 | 0 |
| **Total** | **3** | **7** |

**Status (Phase 0 close)**: Three open items remain, all operator-action (10.O.A, 10.O.B, 10.O.C) blocked on environment access (live Ollama, fresh worktree, Linux/macOS host). Seven v0.7.0 carryovers resolved by Phase 0 sub-tasks 0.3/0.4/0.5/0.8/0.9/0.11/0.13. The v0.7.0 in-cycle log items 10.O.4-10 are carried in v0.7.0's audit trail and close in their natural target phases (5.10, 5.11, 6.A, 7.1, 7.A-C); they are not duplicated in this log.
