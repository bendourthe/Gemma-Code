# v1.2.0 Phase 7 -- Stabilization, Benchmarks, and Documentation Refresh (2026-05-28)

## Plan reference

[docs/versions/v1/v1.2.0/plans/adoption-ecosystem-2026-05.md](../../plans/adoption-ecosystem-2026-05.md) Phase 7 -- the final phase of the 2026-05 ecosystem-adoption cycle. Source comparison: [docs/versions/v1/v1.2.0/comparison-ecosystem-2026-05.md](../../comparison-ecosystem-2026-05.md) Section 4 cross-source themes (the >=30% token-and-tool-call gates) and Section 7 adoption-plan ordering.

## Goal

Close the v1.2.0 cycle's first adoption track by quantifying the post-adoption impact (token usage, tool-call count, storage size), refreshing the top-level documentation surfaces to reflect Phases 2-6's new code, and consolidating the per-item adoption ledger in `docs/versions/v1/v1.2.0/known-gaps.md`. Stability gate: end-to-end token-usage and storage-size benchmarks published, READ ME / AGENTS.md / ARCHITECTURE.md aligned with the new subsystems, the adoption ledger covers every plan sub-task, no P0 / P1 regressions outstanding.

## Sub-tasks completed

### 7.1 -- End-to-end token-usage benchmark

- **New integration test**: [tests/integration/coding-pillar/phase-7-token-usage.test.ts](../../../../tests/integration/coding-pillar/phase-7-token-usage.test.ts) drives a deterministic 5-step Coding-pillar workload ("Find all callers of `redactSecrets` -> run the test suite -> inspect one failing test -> propose a fix and edit the file -> re-run the test suite"). The post-adoption arm runs through the production `CodeGraphMcpServer + SqliteGraphStore + RepoScanner + CommandCompressor` wiring with no mocks; the pre-adoption arm simulates the grep-shaped path the agent would take against a pre-Phase-1 checkout using the same fixture bytes.
- **Methodology deviation**: the plan asked for a literal `git worktree` replay against a tagged pre-Phase-1 checkout, which would require a stable local-model fixture not available in CI. The deterministic synthesis exercises the same byte-shaping code paths; tracked as known-gaps `7.1.P2.A`.
- **Plan-path deviation**: the plan's literal file path was `tests/benchmarks/coding-pillar-token-usage.ts`, but `.bench.ts` files only run under `vitest bench`, not `vitest run`. The CI-enforceable integration-test convention (mirroring Phase 2.5 + Phase 3.6 + Phase 4.4) wins; tracked as known-gaps `7.x.P3.C`.
- **Published artifact**: [docs/versions/v1/v1.2.0/benchmarks/coding-pillar-token-usage-2026-05-26.md](../../benchmarks/coding-pillar-token-usage-2026-05-26.md). Headline numbers: tokens -93.76% (34,430 -> 2,147 bytes), tool calls -45.45% (11 -> 6).
- **Raw fixtures**: [tests/fixtures/coding-pillar-token-usage-results/2026-05-26/](../../../../tests/fixtures/coding-pillar-token-usage-results/2026-05-26/) (with-adoption.json, without-adoption.json, summary.json).
- **CI gates** (both enforced): token ratio <=70%, tool-call ratio <=70%; both pass with substantial margin.

### 7.2 -- End-to-end storage-size benchmark (extended scope)

- **New integration test**: [tests/integration/memory-tier/phase-7-storage-size-extended.test.ts](../../../../tests/integration/memory-tier/phase-7-storage-size-extended.test.ts) extends the Phase 4.4 dense-only benchmark to the cycle-end aggregate -- `DenseIndex` vs `PrunedDenseIndex` on the same 2k-chunk corpus + `Bm25Index` serialized footprint + `SqliteGraphStore` codegraph DB built from the Phase 3 fixture. Both arms see the same BM25 + codegraph bytes; only the dense tier differs.
- **Published artifact**: [docs/versions/v1/v1.2.0/benchmarks/memory-storage-size-2026-05-26.md](../../benchmarks/memory-storage-size-2026-05-26.md). Headline numbers: dense-only Pruned/Standard 18.68% (matches Phase 4.4 byte-for-byte), combined 20.58%, BM25 51 bytes, codegraph SQLite 73,728 bytes at 2k corpus.
- **Raw fixtures**: [tests/fixtures/memory-storage-extended-results/2026-05-26/summary.json](../../../../tests/fixtures/memory-storage-extended-results/2026-05-26/summary.json).
- **Plan-path deviation**: same as 7.1 -- the plan's `docs/versions/v1/v1.1.0/benchmarks/` path was a typo from the plan-authoring cycle. Published under the active `docs/versions/v1/v1.2.0/benchmarks/` directory; tracked as known-gaps `7.x.P3.B`.
- **CI gate** (enforced): Pruned dense-only ratio <=20% (matches Phase 4.4 stability gate); 18.68% achieved.

### 7.3 -- Documentation refresh

- **[README.md](../../../../README.md) updates**: Project Status section now distinguishes the v1.0.0 / v1.1.0 / v1.2.0 cycles; added a v1.2.0 cycle status table listing all seven phases as Landed; added cross-references to the two new benchmark reports.
- **[AGENTS.md](../../../../AGENTS.md) updates**: Non-Obvious Tooling gained three new subsections -- "Code-graph MCP (v1.2.0 Phase 3)", "MemoryStorageTier policy (v1.2.0 Phase 4)", "Sub-agent intent restrictions (v1.2.0 Phase 5)". Each subsection cites the implementing module path so future readers land on the right file.
- **[ARCHITECTURE.md](../../../../ARCHITECTURE.md) updates**: replaced the ASCII data-flow diagram for the code-graph subsystem with a Mermaid flowchart showing the full path (repo -> walker -> RepoScanner / WatchedRepoScanner -> SqliteGraphStore -> CodeGraphMcpServer -> CodeGraphToolHandler -> Coding pillar agent loop). Added a new "Stabilization and benchmarks (v1.2.0 Phase 7)" subsection summarising both benchmarks and linking to their reports.

### 7.4 -- Known-gaps closure for the adoption set

- **New `## 0. Adoption Ledger (Phase 7.4)` section** in [docs/versions/v1/v1.2.0/known-gaps.md](../../known-gaps.md) maps every plan sub-task (1.1 -> 7.5) to its implementing phase, sub-task ID, and current Resolved / Open status. Tables are grouped by phase; each row cites the closing reference (phase / commit) and any open follow-up codes.
- **Forward reference `1.x.P3.D` resolved**: the Phase 1 placeholder for the adoption ledger is now closed via the new section and listed in `## 2. Resolved` as `1.x.P3.D -- Phase 7.4 adoption ledger populated`.
- **Three new Phase 7 entries** in `## 1. Open Items`: `7.1.P2.A` (deterministic-synthesis methodology), `7.x.P3.B` (benchmark publish-path deviation), `7.x.P3.C` (benchmark file-path deviation). All P2 / P3, all carryforward to v1.3.0 if not closed sooner.
- **Status header** flipped from `live` to `closed` (the cycle's known-gaps file is now stable; only carryforward will edit it).

### 7.5 -- Phase 7 testing and stabilization

- **Lint**: `npm run lint` clean (workspace + root). One pre-existing Phase 6 lint break surfaced in [desktop/src/components/InteractiveArtifact.tsx](../../../../desktop/src/components/InteractiveArtifact.tsx) -- the `eslint-disable-next-line react/no-danger` directive referenced an unconfigured rule, causing eslint's `--report-unused-disable-directives` parity check to fail. Removed the dead directive (the `react/no-danger` rule was never loaded in the desktop config); kept the explanatory comment that documents the sanitiser as the trust boundary.
- **Tests**: `npm run test` -> 3,629 passed, 5 skipped (320 files); `npm --workspace=@nexus/desktop run test` -> 418 / 418 pass; `npm --workspace=@nexus/desktop run typecheck` -> 0 errors. Both new Phase 7 integration tests pass on the first run with substantial margin against their stability gates.
- **dep-cruiser**: clean (no new violations from the two new integration test files).

## Acceptance criteria check

- [x] Token-usage benchmark published with >=30% improvement (-93.76% tokens, -45.45% tool calls)
- [x] Storage-size benchmark published (-81.32% on dense index alone; -79.42% combined)
- [x] README.md, AGENTS.md, ARCHITECTURE.md updated
- [x] `docs/versions/v1/v1.2.0/known-gaps.md` carries the adoption ledger
- [x] All tests passing across all phases; no P0 / P1 regressions
- [x] Final session history covers Phase 7 (this file); Phases 1-6 each have their own under `docs/versions/v1/v1.2.0/development/history/`
- [x] Adoption arc closed

## Deviations from plan

1. **Benchmark publish paths**: the plan literally said `docs/versions/v1/v1.1.0/benchmarks/...`; landed under `docs/versions/v1/v1.2.0/benchmarks/...` to match the active cycle. Tracked as `7.x.P3.B`.
2. **Token-usage script file path**: the plan named `tests/benchmarks/coding-pillar-token-usage.ts`; landed at `tests/integration/coding-pillar/phase-7-token-usage.test.ts` so the stability gate runs under `vitest run` (matching the per-phase convention). Tracked as `7.x.P3.C`.
3. **Deterministic synthesis instead of live worktree replay**: the plan asked for a `git worktree`-based pre/post replay; the deterministic synthesis exercises the same byte-shaping code paths with the production wiring (no mocks). Tracked as `7.1.P2.A`.
4. **Pre-existing Phase 6 lint break fixed in scope**: removed a dead `eslint-disable-next-line react/no-danger` directive in `InteractiveArtifact.tsx` because it was blocking the Phase 7.5 stability gate. The `react/no-danger` rule was never configured in the desktop ESLint config; removing the suppression has no behavioural effect. Documented inline above.

## Cycle exit signals

* **18 adoption items** from the comparison fully mapped in the ledger.
* **Tokens**: -93.76% on the reference workload; **tool calls**: -45.45%.
* **Storage**: -81.32% on the dense index alone (Pruned vs Standard) at 2k chunks; the 100k canonical sweep remains a manual replay artifact per `4.4.P2.L`.
* **No P0 / P1 open items** carry forward; all open items are P2 (12) or P3 (17).
* **Carryforward to v1.3.0**: the 29 open items (26 from Phases 1-6 + 3 from Phase 7) plus the 2 carryforward v1.1.0 items.

## What ships after Phase 7

The v1.2.0 cycle's first adoption track is complete. The next planning surface (likely a v1.2.0 cycle plan covering the remaining work or a v1.3.0 plan ingesting the carryforward items) can pick up the 29 open items in [docs/versions/v1/v1.2.0/known-gaps.md](../../known-gaps.md). The release-readiness workflow (Phase 9 of `/implement-phase`) determines the version-bump and tag preparation.
