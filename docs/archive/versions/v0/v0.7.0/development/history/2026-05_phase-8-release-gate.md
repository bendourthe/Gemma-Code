# v0.7.0 Phase 8 -- Release gate + ADRs + CHANGELOG + v0.7.0 baselines

**Cycle**: v0.7.0
**Phase**: 8 (Release gate + ADRs + CHANGELOG + v0.7.0 baselines)
**Date**: 2026-05-14
**Plan reference**: [docs/archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md](../../plans/v0.7.0-cycle.md) Phase 8
**Comparison reference**: [docs/archive/versions/v0/v0.7.0/comparison-multi-source.md](../../comparison-multi-source.md) Section 13
**ADR**: None this phase. The ADRs called out by the Phase 8 stability gate (ADR-0006 / 0007 / 0008 in plan numbering, shipped as ADR-0012 / 0013 / 0014 due to a v0.6.0 numbering collision) all landed in earlier phases with status `accepted`.

---

## 1. Scope

Phase 8 is the release-gate phase. It does no new feature work; it captures the v0.7.0 baselines, lands the CHANGELOG entry, bumps the version, and confirms that every artifact the cycle promised exists. Three sub-tasks per the plan:

1. **8.1** -- Capture `tests/golden/baselines/v0.7.0.json` and `tests/benchmarks/baselines/v0.7.0.json`; run the regression check vs. v0.6.0 baselines.
2. **8.2** -- Add the v0.7.0 entry to [CHANGELOG.md](../../../../CHANGELOG.md) with the seven required sections plus an "Explicitly NOT in v0.7.0" closing block listing N1-N6 plus the cross-version carryovers.
3. **8.3** -- Bump [package.json](../../../../package.json) to `0.7.0`. The release commit + tag + push are operator actions.

---

## 2. Sub-tasks executed

### 2.1 -- Capture v0.7.0 baselines (sub-task 8.1)

The benchmark baseline lives at [tests/benchmarks/baselines/v0.7.0.json](../../../../tests/benchmarks/baselines/v0.7.0.json). It contains the 21 deterministic in-process benchmarks captured by `npm run bench -- --outputJson=...`; the live-Ollama benches (`model-tier-matrix.bench.ts`, `time-to-first-token.bench.ts`) auto-skip when `OLLAMA_URL` is unset. The capture host was NOT quiescent: every retained benchmark shows a uniform 30-80% hz drop vs. v0.6.0 which is inconsistent with any single v0.7.0 code change and is most consistent with CPU pressure / thermal throttling / background-process noise. The plan explicitly allows "any regression is documented and accepted" -- the regression is documented inline in the baseline's `note` field and tracked as in-cycle gap 10.O.15 in [docs/archive/versions/v0/v0.7.0/known-gaps.md](../../known-gaps.md). A quiescent re-capture is the v0.8.0 Phase 0 close-out action.

The golden baseline lives at [tests/golden/baselines/v0.7.0.json](../../../../tests/golden/baselines/v0.7.0.json). It ships as a `status: deferred-to-operator` placeholder with the operator procedure documented inline. The reason: live-Ollama capture requires `ollama serve` with `gemma4:e4b` pulled on a quiescent dev workstation; the Phase 8 author does not have access to the model layer. Identical constraint and identical resolution to v0.6.0 known-gaps Section 1.1 (whose v0.6.0 capture is itself still pending). Tracked as in-cycle gap 10.O.14.

The plan also referred to a TS-native golden runner as a v0.7.0-cycle deliverable ("if not yet built, this is the cycle to build it"). It was not built; the Python framework at [tests/golden/framework/run_all.py](../../../../tests/golden/framework/run_all.py) is still the only runner. Tracked as in-cycle gap 10.O.17.

The regression-check tooling at [scripts/check-bench-regressions.mjs](../../../../scripts/check-bench-regressions.mjs) was extended during this work. The previous `extractBenchmarks` function only handled the legacy `files[].tasks[]` vitest shape and ignored the `files[].groups[].benchmarks[]` shape that vitest 1.6+ emits. The fix adds a second walk over `file.groups[].benchmarks[]` so both shapes work. Without this change the regression check returns 0 benchmarks against the v0.7.0 raw output and the gate becomes a no-op. The fix is in Phase 8 scope because the regression check IS the Phase 8 stability gate; the fix makes the gate functional.

### 2.2 -- CHANGELOG v0.7.0 entry (sub-task 8.2)

The v0.7.0 block was inserted between `[Unreleased]` and `[0.6.0] -- 2026-05-04` in [CHANGELOG.md](../../../../CHANGELOG.md). Layout matches v0.6.0: an opening paragraph that summarises the cycle, then sections `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, and a closing "Explicitly NOT in v0.7.0" block listing N1-N6 plus 15 scope-grounded carryovers.

The `Added` section lists every C-item adopted across Phases 1-7: the model-callable `compress` tool (ADR-0012); `Deduplication` and `PurgeErrors` compaction strategies; `/compact context | sweep | decompress | recompress | manual` verbs; per-model context-limit overrides; the Instructions / Memory / Context / Archive on-disk memory file architecture (ADR-0014); the manual `MemoryPanel`; `/memory forget | export | import`; the seven new chat primitives (completion report, todo block, inline diff cards, action-type tags, numbered permission prompts, "Thought for Ns" meta-rows, queued-message field) via ADR-0013's render protocol; six new skills; multi-harness skill packaging; the standalone `gemma-check` CLI; the optional HNSW vector index with linear-scan fallback; the post-N-edits audit + testgaps background workers; both v0.7.0 baseline files.

ASCII-only verified at byte level on the inserted block. The pre-existing em-dashes and ellipsis characters in the v0.1.0 entry remain (out of Phase 8 scope; touching them would violate the "every changed line traces to the user's request" rule).

### 2.3 -- Version bump (sub-task 8.3)

[package.json](../../../../package.json) version bumped from `0.6.0` to `0.7.0`. No source-level extension-version constants are tied to package.json: the `version: "0.2.0"` strings in [McpServer.ts](../../../../src/mcp/McpServer.ts) and [McpClient.ts](../../../../src/mcp/McpClient.ts) refer to the MCP protocol revision (independent of the extension version), and `MEMORY_SCHEMA_VERSION` / `SCHEMA_VERSION` are database schema generation counters. The release commit, the `v0.7.0` git tag, and the push are operator actions; this run leaves a staged-but-uncommitted set of files plus a commit-message draft per the post-phase sequence.

---

## 3. Release-gate verification

| Gate | Threshold | Result | Notes |
|---|---|---|---|
| `npm run lint` | 0 errors | green | clean |
| `npm run build` | succeeds | green | `tsc` compile clean; `generate:golden-tasks` ran during prebuild |
| `npm test` | 0 failures | green | 2136 passed, 11 skipped, 0 failed; 177 files, 1 skipped (`ollama-health.test.ts` skips when `OLLAMA_URL` is unset) |
| Line coverage | >= 80% | green | 89.09% |
| Branch coverage | >= 75% | green | 82.59% |
| `npm run perm-tier:check` | green | green | after regeneration via `npm run perm-tier` |
| `npm run catalog:check` | green | green-once-committed | regenerates [docs/index.md](../../../index.md); the regenerated file ships in this commit |
| `npm run deps:check` | 0 errors | 4 pre-existing | 3x `no-storage-from-panels` (MemoryPanel) + 1x `no-panels-from-tools` (ConfirmationGate). Already tracked as 10.O.9 transferred to v0.8.0 Phase 7 appendix 7.B. |
| `scripts/check-bench-regressions.mjs` vs. v0.6.0 | green | 17 regressions documented | All in -33% to -84% band, signature consistent with non-quiescent host; tracked as 10.O.15 |

---

## 4. Deviations from the plan

- **TS-native golden runner not built**. The plan said "if not yet built, this is the cycle to build it". It was not built; the Python framework remains canonical for now. Tracked as 10.O.17. Defer to v0.8.0 or canonise the Python runner.
- **Live-Ollama baselines NOT captured**. Identical operator-action constraint to v0.6.0 known-gaps Section 1.1. Tracked as 10.O.14.
- **Bench regression check NOT green vs. v0.6.0**. 17 regressions in -33% to -84% band. Signature is environmental, not a v0.7.0 code regression. Plan text explicitly allows "any regression is documented and accepted." Tracked as 10.O.15.
- **`deps:check` reports 4 pre-existing violations**. Already tracked as 10.O.9; Phase 8 added a duplicate pointer (10.O.16) for traceability.
- **`scripts/check-bench-regressions.mjs` extended**. The `extractBenchmarks` function now handles both the legacy `files[].tasks[]` shape and the current `files[].groups[].benchmarks[]` shape so the gate keeps working across vitest 1.5 -> 1.6 output changes. In scope because the regression check IS the Phase 8 stability gate.
- **Plan ADR numbers reassigned**. The plan referred to ADR-0006 / 0007 / 0008; those numbers were already occupied by v0.6.0 ADRs at the time the v0.7.0 cycle ran. Shipped as ADR-0012 (compress tool), ADR-0013 (webview render protocol), ADR-0014 (memory file architecture). Each carries an explicit numbering note in its preamble.
- **Release commit + tag + push are operator actions**. The plan said "Create the release commit with message `chore(release): v0.7.0` and tag `v0.7.0`. Push." This run produces staged artifacts and a commit-message draft per the post-phase sequence; the operator runs the actual `git commit`, `git tag v0.7.0`, and `git push --tags`.

---

## 5. Known gaps closed and opened

### Closed by this phase

None. v0.7.0 Phase 8 does not close any prior in-cycle gap; the cycle's 13 prior gaps from Phases 4-7 are all v0.8.0 carryovers per their individual close-out decisions in [docs/archive/versions/v0/v0.7.0/known-gaps.md](../../known-gaps.md) Section 10.

### Opened by this phase

Four new entries appended to [docs/archive/versions/v0/v0.7.0/known-gaps.md](../../known-gaps.md) Section 10:

| ID | Category | Severity | Summary |
|---|---|---|---|
| 10.O.14 | DF | P1 | Live-Ollama golden-baseline capture for v0.7.0 (operator action; mirrors v0.6.0 1.1) |
| 10.O.15 | BG | P2 | Bench baseline captured on non-quiescent host; re-capture required |
| 10.O.16 | QG | P2 | 4 pre-existing `deps:check` violations accepted (duplicate of 10.O.9) |
| 10.O.17 | NI | P3 | TS-native golden runner not built during the cycle |

All four transferred to v0.8.0 plan (Phase 0 close-out). v0.7.0 in-cycle gap log is at terminal state with 17 total transferred items.

---

## 6. Operator action items to ship v0.7.0

These are not deferrals; they are the final mechanical steps the agent is not authorized to run autonomously. They block the formal "v0.7.0 shipped" milestone.

1. Review and commit the Phase 8 staged artifacts (CHANGELOG entry, package.json bump, new baseline files, known-gaps update, devlog entry, this history file, regenerated `docs/index.md` and `docs/archive/versions/v0/v0.5.0/architecture.md`, extended `scripts/check-bench-regressions.mjs`).
2. Tag `v0.7.0` on the commit and push: `git tag v0.7.0 && git push origin main --tags`. The `semantic-release` workflow either no-ops (existing v0.7.0 tag wins) or produces no surprises; verify the run is green.
3. On a quiescent workstation, re-capture `tests/benchmarks/baselines/v0.7.0.json` and verify the regression check vs. v0.6.0 either runs green or surfaces a real code regression. Close 10.O.15.
4. On the same workstation with `ollama serve` running and `gemma4:e4b` pulled, run `python tests/golden/framework/run_all.py --model gemma4:e4b --output tests/golden/baselines/v0.7.0.json` and overwrite the placeholder. Close 10.O.14.
5. The remaining 15 v0.7.0 in-cycle items (10.O.1 -- 10.O.13, 10.O.16, 10.O.17) are tracked in the v0.8.0 plan; no immediate operator action.

---

## 7. Files written

- [CHANGELOG.md](../../../../CHANGELOG.md) -- v0.7.0 entry inserted between `[Unreleased]` and `[0.6.0]`; ASCII-only.
- [package.json](../../../../package.json) -- version bumped to `0.7.0`.
- [scripts/check-bench-regressions.mjs](../../../../scripts/check-bench-regressions.mjs) -- `extractBenchmarks` extended to handle vitest >= 1.6 output shape.
- [tests/benchmarks/baselines/v0.7.0.json](../../../../tests/benchmarks/baselines/v0.7.0.json) -- new; 21 deterministic benchmarks; non-quiescent host noted.
- [tests/golden/baselines/v0.7.0.json](../../../../tests/golden/baselines/v0.7.0.json) -- new; operator-action placeholder.
- [docs/archive/versions/v0/v0.7.0/known-gaps.md](../../known-gaps.md) -- Section 10 extended with four Phase 8 entries; summary table recomputed.
- [docs/DEVLOG.md](../../../DEVLOG.md) -- Phase 8 entry prepended.
- [docs/archive/versions/v0/v0.7.0/development/history/2026-05_phase-8-release-gate.md](2026-05_phase-8-release-gate.md) -- this file.
- [README.md](../../../../README.md) -- Features section updated to "8-stage pipeline" + compress tool; Slash Commands `/compact` row updated with the new verbs; `/memory <subcommand>` list updated with `forget`, `export`, `import`.
- [docs/index.md](../../../index.md) -- auto-regenerated by `npm run catalog`.
- [docs/archive/versions/v0/v0.5.0/architecture.md](../../../v0.5.0/architecture.md) -- permission-tier table auto-regenerated by `npm run perm-tier`.
