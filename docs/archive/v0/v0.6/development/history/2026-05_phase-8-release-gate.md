# Development Log: v0.6.0 Phase 8 -- Release gate + ADRs + CHANGELOG

**Date**: 2026-05-04
**Operator**: Benjamin Dourthe
**Assisted by**: Claude Opus 4.7 (1M context) via Claude Code
**Objective**: Close the v0.6.0 cycle. Capture release-gate baselines, write ADRs for the material decisions, update the CHANGELOG honestly (including the v0.5.0 `>=40%` claim), generate the v0.6.0 architecture document, fix the two carryovers from Phase 7.7, run the full exit-verification gate, and stage the version bump.
**Outcome**: Phase 8 sub-tasks 8.2 (5 ADRs), 8.3 (analysis + architecture), 8.4 (CHANGELOG), 8.6 partial (CI gates run locally), and the Phase 7.7 carryovers are complete. Sub-tasks 8.1 (live-Ollama baselines) and 8.5 (release tag + push) require a quiescent dev workstation with `ollama serve` running and explicit user authorization respectively; the procedures are documented below for the operator to execute.

---

## 1. Starting State

- **Branch**: `main`
- **Starting commit**: `a1bdfb1` (`feat(v0.6.0): polish + simplification (Phase 7)`)
- **Environment**: Windows 11 Pro 10.0.26200, Node 24, PowerShell + Bash via Git for Windows, Vitest 1.6.1, TypeScript strict + `noUncheckedIndexedAccess`
- **Plan reference**: [docs/archive/versions/v0/v0.6.0/plans/v0.6.0-cycle.md](../../plans/v0.6.0-cycle.md), Phase 8 (sub-tasks 8.1, 8.2, 8.3, 8.4, 8.5, 8.6)
- **Pre-Phase-8 state**: Phases 1-7 shipped. Two Phase 7.7 carryovers were tracked into Phase 8: (a) the lint warning in `src/config/GpuDetector.ts` line 18 (`@typescript-eslint/explicit-function-return-type`) and (b) the broken `tests/benchmarks/context-compaction.bench.ts` import of `createConversationManager`, which no longer exists.

Pre-flight findings flagged before any code change:

- `package.json` version is `0.5.5` (not `0.5.4` as the plan assumed); the bump is `0.5.5 -> 0.6.0`.
- `tests/golden/baselines/v0.4.0.json` does not exist; existing golden baselines are `v0.3.0-{e2b,e4b}` and `v0.5.0+{memory-hygiene,agent-friendly}`. The `git show v0.4.0:tests/golden/baselines/` view confirms no v0.4.0 capture lived under that tag either.
- `tests/benchmarks/baselines/v0.6.0.json` already exists (created mid-cycle); 8.1 overwrites it post-Phase-7.

---

## 2. Chronological Steps

### 2.1 Carryover -- Fix `createConversationManager` import in context-compaction bench

**Plan reference**: Phase 7.7 carryover. The bench failed with `vitest: No "EventEmitter" export is defined on the "vscode" mock` after the import-name fix.

**What happened**:

1. Replaced `const { createConversationManager } = await import("../../src/chat/ConversationManager.js")` with `const { ConversationManager } = await import("../../src/chat/ConversationManager.js")`. The factory function was renamed/removed in an earlier cycle; the class export is the canonical surface.
2. Updated `buildConversation` to `new ConversationManager("")` — empty system prompt, since the bench measures `estimateTokens()` on user / assistant messages only.
3. The bench then surfaced a second issue: `ConversationManager` constructs `new vscode.EventEmitter<...>()` in its initializer, but the bench's inline `vi.mock("vscode", ...)` did not export `EventEmitter`. Added a `StubEventEmitter` class that satisfies the `event` / `fire` / `dispose` shape the manager calls.
4. Re-ran `npx vitest bench --run --config configs/vitest.config.ts tests/benchmarks/context-compaction.bench.ts`. Three throughput rows reported (50 / 100 / 200 messages); the latency gate (`p99 < 500 ms` for 200 messages) passed at 0.0020 ms.

**Key file changed**: [tests/benchmarks/context-compaction.bench.ts](../../../../versions/tests/benchmarks/context-compaction.bench.ts).

### 2.2 Carryover -- Fix GpuDetector lint warning

**Plan reference**: Phase 7.7 carryover. `npm run lint` had carried a single warning since v0.5.0.

**What happened**: Added `: void` return type to the `cb` callback at [src/config/GpuDetector.ts:18](../../../../versions/src/config/GpuDetector.ts#L18). One line. `npm run lint` now reports zero errors, zero warnings.

### 2.3 Sub-task 8.2 -- Five ADRs

Wrote ADR-0006 through ADR-0010, modeled on [docs/adr/0005-tool-permission-tiers.md](../../../../versions/v0/adr/0005-tool-permission-tiers.md):

| ADR | Title | Source phase |
|---|---|---|
| [0006](../../../../versions/v0/adr/0006-unified-path-guard.md) | Unified path-guard for filesystem tool handlers | v0.6.0 Phase 1 |
| [0007](../../../../versions/v0/adr/0007-permission-tier-floor.md) | Permission-tier floor for confirmation-class tools | v0.6.0 Phase 1 |
| [0008](../../../../versions/v0/adr/0008-panel-decomposition.md) | Panel decomposition (ChatController + ChatWebviewHost + handlers) | v0.6.0 Phase 6 |
| [0009](../../../../versions/v0/adr/0009-predictive-cache-decision.md) | Delete PredictiveCache (wire-or-delete decision) | v0.6.0 Phase 5 |
| [0010](../../../../versions/v0/adr/0010-threshold-elevation-decision.md) | Per-provenance semantic threshold elevation (heuristic vs. ollama) | v0.6.0 Phase 5 |

Updated [docs/adr/README.md](../../../../versions/v0/adr/README.md) index with five new rows. Updated [docs/archive/versions/v0/v0.5.0/architecture.md](../../../v0.5/architecture.md) Section 11 ADR roll-up table to include the five v0.6.0 ADRs and a pointer at the v0.6.0 architecture doc.

### 2.4 Sub-task 8.4 -- CHANGELOG update

The plan called for resolving the v0.5.0 `>=40%` token-savings claim by either confirming with a measured number from sub-task 2.3 or replacing it with the qualitative-deferred wording. Investigation: the `>=40%` claim never appeared in the v0.5.0 CHANGELOG entry itself; it lives in `docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md` and the Phase 12 history. Added an explicit `### v0.5.0 retrospective note` block at the end of the new `## [0.6.0]` entry that:

1. Acknowledges the claim was a *target*, not a verified shipping number.
2. Documents that `tests/golden/baselines/v0.4.0.json` was never captured.
3. Points at this Phase 8 history doc for the v0.6.0 capture procedure.

Wrote the full `## [0.6.0] -- 2026-05-04` block under `## [Unreleased]` in [CHANGELOG.md](../../../../versions/CHANGELOG.md). Five sections per the plan: `### Added`, `### Changed`, `### Fixed`, `### Removed`, `### Security`. Plus a `### Deferred to v0.7.0+` block listing the Phase 6.5 (filesystem split), Phase 7.5 (`marked` v4->v12), and ADR-0008 (full ownership hoist) deferrals.

### 2.5 Sub-task 8.3 -- Analysis + architecture documents

Wrote [docs/archive/versions/v0/v0.6.0/analysis.md](../../analysis.md) -- a 12-section codebase analysis grounded in the actual import graph (44 cross-directory imports concentrated in `GemmaCodePanel.ts` as the composition root; zero circular dependencies). Section 11 ("Known Complexity and Gotchas") captures the eight non-obvious invariants future contributors need to know.

Wrote [docs/archive/versions/v0/v0.6.0/architecture.md](../../architecture.md) -- a focused v0.6.0 architecture document modeled on the v0.5.0 doc but reflecting the post-cycle deltas. The doc is intentionally tighter than v0.5.0's: where v0.5.0 was a deep technical reference, v0.6.0 highlights what changed (predictive layer removed from the cache stack diagram, true LRU on prune, per-provenance threshold elevation, panel decomposition, zero baseline exceptions). The full ADR roll-up (ten ADRs) sits in Section 11.

### 2.6 Sub-task 8.6 (partial) -- Local CI gate run

Ran the full local exit-verification command set documented in the plan's 8.6 prompt. All gates green:

| Gate | Outcome |
|---|---|
| `npm run lint` | 0 errors, 0 warnings (GpuDetector warning closed in 2.2) |
| `npm run build` (`tsc`) | clean |
| `npm test` | all suites pass |
| `npm run bench` | runs to completion; all 7 bench files green (cache-hit, context-compaction, eviction-strategies, hooks, rendering, skill-loading, tool-execution) |
| `npm run deps:check` | 0 errors, 0 warnings, 121+ modules / 432+ deps |
| `npm run catalog:check` | regenerated; in sync |
| `npm run perm-tier:check` | doc in sync |
| `npm audit --production --audit-level=moderate` | 0 vulnerabilities |

The pre-existing native-cleanup segfault on `better-sqlite3` + Node 24 during process teardown still fires after `npm test` completes its summary -- this is a pre-existing teardown-only race in the SQLite native module; it does not affect test results or exit codes (Phase 7 sub-task 7.7 already fixed the bench to pass `--run` so the bench process exits cleanly with the actual code).

**Re-running the security findings checklist**: pen-test F-001 through F-008 plus F-010, F-011 are all closed in code (per Phases 1, 3, 5; ADR-0006, 0007, 0009, 0010). The closure verification is captured in the per-Phase histories ([Phase 1](2026-04_phase-1-security-chain-closure.md), [Phase 3](2026-04_phase-3-defense-in-depth-ratchets.md), [Phase 5](2026-05_phase-5-doc-code-drift.md)). Attack Path A simulation: the symlink leg refuses ([tests/unit/tools/handlers/filesystem-symlink.test.ts](../../../../versions/tests/unit/tools/handlers/filesystem-symlink.test.ts)) and the auto-approve leg refuses ([tests/integration/permission-overrides-clamp.test.ts](../../../../versions/tests/integration/permission-overrides-clamp.test.ts)).

---

## 3. Sub-tasks awaiting operator action

### 3.1 Sub-task 8.1 -- Live-Ollama baseline capture (deferred)

The plan calls for two artifacts: `tests/golden/baselines/v0.6.0.json` and `tests/benchmarks/baselines/v0.6.0.json`. The benchmark file already exists (regenerated mid-cycle); per the plan it should be regenerated post-Phase-7 to reflect the final shape of the cycle. The golden file does not exist and requires live Ollama.

**Procedure for the operator** (run on a quiescent dev workstation):

```powershell
# Prereq: Ollama running on localhost:11434 with gemma4:e4b pulled.
$env:OLLAMA_URL = "http://localhost:11434"

# 1. Regenerate the v0.6.0 benchmark baseline post-Phase-7.
npm run bench -- --update-baseline tests/benchmarks/baselines/v0.6.0.json

# 2. Run the bench-regression check vs. v0.5.0.
node scripts/check-bench-regressions.mjs `
  --baseline tests/benchmarks/baselines/v0.5.0.json `
  --target   tests/benchmarks/baselines/v0.6.0.json
# Expected: hooks p99 < 50 ms, tool-execution p99 within +5 ms,
# cache-hit and context-compaction p99 within +10%.

# 3. Capture the v0.6.0 golden baseline.
python tests/golden/framework/run_all.py --model gemma4:e4b `
  --output tests/golden/baselines/v0.6.0.json

# 4. Capture the v0.4.0 golden baseline by checking out the v0.4.0 tag
#    in a separate working tree, running the suite there, and copying
#    the result back. The current tree's `tests/golden/framework/` will
#    not exist at v0.4.0; use the e2b/e4b runners that did exist at v0.4.0
#    OR (preferred) run the *current* framework against v0.4.0 source so
#    the comparison is apples-to-apples.
git worktree add ../Gemma-Code-v0.4.0 v0.4.0
cp tests/golden/framework/* ../Gemma-Code-v0.4.0/tests/golden/framework/
pushd ../Gemma-Code-v0.4.0
npm ci
python tests/golden/framework/run_all.py --model gemma4:e4b `
  --output ../Gemma-Code/tests/golden/baselines/v0.4.0.json
popd
git worktree remove ../Gemma-Code-v0.4.0

# 5. Long-arc compare against v0.4.0.
node scripts/check-bench-regressions.mjs `
  --baseline tests/benchmarks/baselines/v0.4.0.json `
  --target   tests/benchmarks/baselines/v0.6.0.json
```

After capture, document the three deltas (v0.5.0 -> v0.6.0 bench, v0.4.0 -> v0.6.0 bench long-arc, v0.4.0 -> v0.6.0 golden long-arc) inline in this file and update the `### v0.5.0 retrospective note` block in CHANGELOG with the measured number.

### 3.2 Sub-task 8.5 -- Version bump and release tag (partially staged)

Per the operator's pre-flight choice (Q2 = B), the agent edits `package.json` and prepares the commit message; the operator runs the commit, tag, and push.

**Operator steps**:

```powershell
# 1. Verify package.json is at 0.6.0 (the agent edits this in Phase 8 close).
git diff package.json

# 2. Confirm the VSIX builds.
npm run package

# 3. Stage and commit.
git add package.json package-lock.json CHANGELOG.md docs/ tests/benchmarks/context-compaction.bench.ts src/config/GpuDetector.ts
git commit -m "chore(release): 0.6.0"

# 4. Tag.
git tag v0.6.0

# 5. Push.
#    semantic-release on main will pick up the new commits, generate any
#    pending CHANGELOG entries from conventional commits, and run its plugin
#    chain (changelog -> npm -> github -> git). Note: the manual ## [0.6.0]
#    block written by 8.4 may be reconciled with the auto-generated entry.
#    Inspect the resulting CHANGELOG before tagging publicly.
git push origin main --tags
```

### 3.3 Sub-task 8.6 (remainder) -- Re-run audit + post-tag verification

Once the v0.6.0 tag exists, on the tagged commit:

```powershell
npm ci
npm run lint
npm run build
npm run test
npm run test:integration
npm run bench
npm run deps:check
npm run catalog:check
npm run perm-tier:check
npm audit --production --audit-level=moderate
```

All must pass with zero errors and zero warnings. Verify the GitHub release artifact contains the VSIX.

---

## 4. Files Created / Modified

**Created**:

- [docs/adr/0006-unified-path-guard.md](../../../../versions/v0/adr/0006-unified-path-guard.md)
- [docs/adr/0007-permission-tier-floor.md](../../../../versions/v0/adr/0007-permission-tier-floor.md)
- [docs/adr/0008-panel-decomposition.md](../../../../versions/v0/adr/0008-panel-decomposition.md)
- [docs/adr/0009-predictive-cache-decision.md](../../../../versions/v0/adr/0009-predictive-cache-decision.md)
- [docs/adr/0010-threshold-elevation-decision.md](../../../../versions/v0/adr/0010-threshold-elevation-decision.md)
- [docs/archive/versions/v0/v0.6.0/analysis.md](../../analysis.md)
- [docs/archive/versions/v0/v0.6.0/architecture.md](../../architecture.md)
- This file ([docs/archive/versions/v0/v0.6.0/development/history/2026-05_phase-8-release-gate.md](2026-05_phase-8-release-gate.md))

**Modified** (significant):

- [src/config/GpuDetector.ts](../../../../versions/src/config/GpuDetector.ts) -- added `: void` return type to `cb` callback (1 line).
- [tests/benchmarks/context-compaction.bench.ts](../../../../versions/tests/benchmarks/context-compaction.bench.ts) -- replaced `createConversationManager` with `new ConversationManager("")`; added `StubEventEmitter` to vscode mock.
- [docs/adr/README.md](../../../../versions/v0/adr/README.md) -- index extended with five new rows.
- [docs/archive/versions/v0/v0.5.0/architecture.md](../../../v0.5/architecture.md) -- Section 11 ADR roll-up table extended with five new rows; cross-link added to v0.6.0 architecture doc.
- [CHANGELOG.md](../../../../versions/CHANGELOG.md) -- new `## [0.6.0] -- 2026-05-04` block; original `## [Unreleased]` content (Phase 6 panel + Phase 5 PredictiveCache + gpuTier removals) folded into the v0.6.0 entry; `### Planned` block preserved under `## [Unreleased]`.
- [package.json](../../../../versions/package.json) -- version bumped from `0.5.5` to `0.6.0` (sub-task 8.5).

---

## 5. Phase 8 Exit Checklist

- [x] Phase 7.7 carryovers fixed (`createConversationManager` bench import; GpuDetector lint warning).
- [x] 5 ADRs written (0006-0010); ADR README index updated; v0.5.0 architecture roll-up extended.
- [x] `docs/archive/versions/v0/v0.6.0/analysis.md` written.
- [x] `docs/archive/versions/v0/v0.6.0/architecture.md` written.
- [x] CHANGELOG `## [0.6.0]` block written; v0.5.0 `>=40%` claim acknowledged via retrospective note.
- [x] Local CI gates green (lint, build, test, bench, deps:check, catalog:check, perm-tier:check, audit moderate).
- [x] `package.json` bumped to `0.6.0`.
- [ ] **Awaiting operator action**: live-Ollama golden + bench baseline capture (sub-task 8.1; procedure in Section 3.1).
- [ ] **Awaiting operator action**: `chore(release): 0.6.0` commit + `git tag v0.6.0` + push (sub-task 8.5; procedure in Section 3.2).
- [ ] **Awaiting operator action**: post-tag exit verification rerun on the tagged commit (sub-task 8.6; procedure in Section 3.3).

---

## 6. Definition of Done -- v0.6.0 status snapshot

Per the plan's "Definition of Done -- v0.6.0":

| Criterion | Status |
|---|---|
| Zero P0 findings post-cycle | **Met**. Attack Path A closed at both legs. |
| Zero P1 findings carried into v0.7.0 | **Met** (see deferral list). |
| `configs/dependency-cruiser.cjs` zero `BASELINE-` annotations | **Met** (Phase 4). |
| `npm run deps:check` zero errors / warnings | **Met**. |
| 12 originally-failing token-estimation assertions pass or rewritten | **Met** (Phase 2). |
| CHANGELOG `>=40%` claim verified or retracted | **Partial** (retrospective note added; quantitative measurement deferred to operator capture per 3.1). |
| `tests/golden/baselines/v0.4.0.json + v0.5.0.json + v0.6.0.json` exist | **Pending**: v0.4.0 + v0.6.0 require operator capture (3.1). v0.5.0 splits into the two existing `v0.5.0+memory-hygiene` and `v0.5.0+agent-friendly` files. |
| `tests/benchmarks/baselines/v0.5.0.json + v0.6.0.json` exist | **Met** (both files exist; v0.6.0 to be regenerated post-Phase-7 per 3.1). |
| `GemmaCodePanel.ts < 400 lines` | **Partial** (935 lines; deferred to v0.7.0 per ADR-0008). |
| `panels/webview/index.ts` decomposed into scaffold/render/messages | **Met** (Phase 6). |
| v0.6.0 release published with VSIX + complete CHANGELOG | **Pending operator action** (3.2, 3.3). |

The operator-action items in Section 3 are the v0.6.0 cycle's exit gate. Once they complete, the cycle is closed.
