# v0.9.0 -- Operator-Action Checklist

**Status**: in-progress (every item below is `pending` until the authorized operator runs it and flips the flag to `done`)
**Audience**: the project maintainer (the only authorized operator), code reviewer, release engineer
**Sibling docs**: [docs/v0.8.0/known-gaps.md](../v0.8.0/known-gaps.md) Section 10.1 (the gap log this checklist drains); [docs/v0.9.0/plans/v0.9.0-cycle.md](plans/v0.9.0-cycle.md) sub-task 1.3 (this file's spec); [docs/v0.9.0/known-gaps.md](known-gaps.md) (authored at Phase 8.4 close; cross-links back here for the operator-only items)

This file tracks the v0.8.0 carryover items that **cannot be driven by the agent**. Every entry requires authorized human action -- live Ollama inference on a quiescent dev workstation, a fresh git worktree exit verification, a Stryker mutation run on a non-Windows host, a multi-turn adversarial pen-test session, or publication of a GitHub release tag. The agent's role is limited to keeping this checklist in sync with the v0.8.0 gap log and updating it once an operator has flipped a status flag to `done`.

Each section opens with a single-line status block; the operator updates it after running the procedure and re-commits this file. Sections are ordered by severity (P1 first), then by surface area.

---

## Section 1: Live-Ollama golden + benchmark baseline capture

**Status**: pending
**Tracks**: 10.O.A (v0.8.0 known-gaps Section 10.1), 10.O.BB (v0.8.0 Phase 7)
**Severity**: P1

**Why this is operator-only**: the captures require a live `ollama serve` instance with `gemma4:e4b` pulled on a quiescent workstation (no other GPU/CPU contention) and a non-trivial wall-clock budget per run. The agent is not authorized to drive live inference and cannot block the user's workstation for tens of minutes per capture.

**Procedure**:

1. Confirm Ollama is running: `curl -sf http://127.0.0.1:11434/api/tags | findstr gemma4:e4b` (PowerShell: `Invoke-RestMethod http://127.0.0.1:11434/api/tags | Select-Object -ExpandProperty models | Where-Object name -like 'gemma4*'`). If the model is missing, run `ollama pull gemma4:e4b`.
2. Quiesce the workstation: close other heavy applications, disable background indexers if reasonable.
3. From the repository root, run the benchmark capture:
   - `npm run bench -- --update-baseline`
   - This writes `tests/benchmarks/baselines/v0.9.0.json` (or refreshes existing files).
4. Run the golden capture:
   - `python tests/golden/framework/run_all.py --model gemma4:e4b --output tests/golden/baselines/v0.9.0.json`
   - The golden runner is the canonical Python tool per ADR-0017; do not substitute a TS-native equivalent.
5. Compare against v0.7.0 and v0.6.0 baselines:
   - `node scripts/check-bench-regressions.mjs`
   - Investigate any regression >10% before committing.
6. Document deltas in `docs/v0.9.0/performance-baselines.md` (create if missing). At minimum: token throughput per route, p50/p95 latency for retrieval, rendering benches.

**Acceptance**: both baseline files exist in `tests/benchmarks/baselines/v0.9.0.json` and `tests/golden/baselines/v0.9.0.json`; deltas are documented; no >10% regression remains uninvestigated; flip status above to `done`.

---

## Section 2: v0.8.0 post-tag exit verification

**Status**: pending
**Tracks**: 10.O.B (carries v0.7.0 10.O.B; refits to whichever tag the operator cut per 10.O.DD)
**Severity**: P1

**Why this is operator-only**: requires a clean worktree state (separate from the active dev tree) to avoid contaminating the verification with uncommitted work. The agent should not modify worktree state autonomously.

**Procedure**:

1. From a directory outside the main repo, add a worktree pinned at the v0.8.0 release tag the operator chose (or the deferred `v0.8.0-cycle` tag if the choice in 10.O.DD was option (b)):
   - `git worktree add ../gemma-code-v0.8.0 v0.8.0`
2. Enter the worktree and run the full gate:
   - `cd ../gemma-code-v0.8.0`
   - `npm ci`
   - `npm run lint && npm run build && npm test && npm run test:integration && npm run bench && npm run deps:check && npm run catalog:check && npm run perm-tier:check`
   - `npm audit --production --audit-level=moderate`
3. Verify the GitHub release artifact contains the VSIX:
   - `gh release view v0.8.0 --json assets --jq '.assets[].name'` -- the output must contain a `gemma-code-*.vsix` entry.
4. Re-run pen-test Attack Path A against the v0.8.0 source (see Section 6 below for the procedure).
5. Tear down: `cd ..; git worktree remove gemma-code-v0.8.0`.

**Acceptance**: every gate command exits 0; the release page lists the VSIX; Attack Path A reports no new P0/P1 findings; flip status above to `done`.

---

## Section 3: `package-lock.json` regeneration + cross-platform HNSW tests

**Status**: pending
**Tracks**: 10.O.C (carries v0.7.0 10.O.13 + 10.O.11)
**Severity**: P3

**Why this is operator-only (partial)**: the lockfile regen step (3.1 below) runs locally on Windows, but the cross-platform HNSW test run (3.2) requires Linux x64 or macOS access because `hnswlib-node@^3.0.0` lacks pre-built Windows binaries.

**Procedure**:

1. Locally (Windows or any host):
   - `rm package-lock.json` (or `Remove-Item package-lock.json`)
   - `npm install` -- this is `install`, not `ci`; it must let the optional `hnswlib-node` dependency resolve cleanly.
   - Inspect the new lockfile: it should include `hnswlib-node@^3.0.0` with platform-conditional `optionalDependencies` entries.
   - Commit `package-lock.json` separately so the lockfile bump is auditable.
2. On Linux x64 or macOS (e.g. a CI runner, a remote dev box, or a local Docker container with Node 22):
   - `git fetch && git checkout <branch-with-the-new-lockfile>`
   - `npm ci`
   - `HNSW_AVAILABLE=1 npm test -- tests/unit/storage/MemoryHnswIndex.test.ts`
   - All `runIf(HNSW_AVAILABLE)` tests should now run rather than skip.
3. Document the run host (kernel + arch + glibc) and result in a one-line note under Section 7 of `docs/v0.9.0/performance-baselines.md` for traceability.

**Acceptance**: lockfile committed; HNSW gated tests pass on at least one non-Windows host; flip status above to `done`.

---

## Section 4: `m-series.json` live capture (Apple Silicon)

**Status**: pending
**Tracks**: 10.O.X (v0.8.0 Phase 6 sub-task 6.7)
**Severity**: P1

**Why this is operator-only**: requires Apple Silicon hardware (M1 or later); the dev workstation lacks it.

**Procedure**:

1. On an Apple Silicon machine with Ollama running (`gemma4:e4b` and any other tier-specific models pulled):
   - `git clone https://github.com/bendourthe/Gemma-Code && cd Gemma-Code`
   - `npm ci`
   - `npm run bench -- --m-series`
2. The bench script writes one capture row per detected model into `tests/benchmarks/baselines/m-series.json`. Confirm the file has more than the single `status: deferred-to-operator` placeholder row.
3. Commit the updated `m-series.json` from the Apple Silicon host (or transfer it back to the main dev box for commit).
4. Optional follow-up: refine the `recommendations` block of the same file with any chip-tier guidance learned from the live capture.

**Acceptance**: `tests/benchmarks/baselines/m-series.json` contains at least one non-placeholder capture row; the PyQt installer's macOS post-install path now reads live numbers; flip status above to `done`.

---

## Section 5: Stryker mutation run

**Status**: pending
**Tracks**: 10.O.AA (v0.8.0 Phase 7 sub-task 7.2)
**Severity**: P2

**Why this is operator-only**: `npm run mutate` is a multi-hour pass that forks a Node child per mutant. On Windows the same `MemoryStore.migration.test.ts` teardown segfault (10.O.D / 10.O.N pre-1.1) caused the harness to fork-loop. After v0.9.0 sub-task 1.1 ships (vitest 2.1.9 + shebang-strip + CRLF-tolerant frontmatter parser), Windows should be viable; until then a Linux x64 host is required.

**Procedure**:

1. On a Linux x64 host (or Windows post-1.1):
   - `npm ci`
   - `npm run mutate`
   - Expect the run to take several hours; do not interrupt.
2. Update `docs/v0.9.0/review/mutation-report.md` with the new overall + covered scores; the v0.7.0 baseline (50.64% overall, 58.92% covered) remains the floor.
3. If the score regressed, add targeted regression tests for the top 5 surviving mutants OR document inline rationale per mutant for why it is acceptable.

**Acceptance**: mutation report file authored; score >= v0.7.0 floor or every regression has an inline rationale; flip status above to `done`.

---

## Section 6: Pen-test re-run

**Status**: pending
**Tracks**: 10.O.CC (v0.8.0 Phase 7 sub-task 7.4)
**Severity**: P1

**Why this is operator-only**: walking Attack Paths A / B / C requires multi-turn adversarial sessions against production code. The agent is not authorized to drive multi-turn adversarial conversations against itself.

**Procedure**:

1. Read `docs/v0.6.0/review/penetration-test.md` Section 2 for the three Attack Paths verbatim:
   - **A**: prompt-injection via injected memory file (validates the Phase 2.7 scanner).
   - **B**: tool exfiltration via crafted `<|tool|>` block (validates the Phase 2.4 pass-state gate).
   - **C**: trace replay leakage (validates the Phase 4.1 trace redaction).
2. For each Attack Path:
   - Open a new Gemma Code session against v0.8.0 source (or v0.9.0 once close-ready).
   - Issue the prompts in the order given. Observe whether the relevant guard fires (scanner block, gate refusal, redaction).
   - Record outcome in `docs/v0.9.0/review/penetration-test.md` under one heading per Attack Path.
3. P0/P1 findings (e.g. a guard that fails to fire) block the v0.9.0 release tag; P2/P3 findings are documented and ingested into the v0.10.0 cycle.

**Acceptance**: `docs/v0.9.0/review/penetration-test.md` exists with one section per Attack Path; no unresolved P0/P1 finding; flip status above to `done`.

---

## Section 7: v0.8.0 release publication

**Status**: pending
**Tracks**: 10.O.DD (v0.8.0 Phase 7 sub-task 7.6)
**Severity**: P1

**Why this is operator-only**: VSIX build + tag push + GitHub release create require authorized GitHub credentials and a deliberate release-engineering decision that the agent cannot grant itself.

**Decision matrix**:

| Option | Description | Pick if... |
|---|---|---|
| (a) Skip the explicit `v0.8.0` tag | semantic-release already cut intermediate tags `v0.8.0` through `v0.15.2` across the cycle; treat the post-Phase-7 commit as the next semantic version (currently 0.15.x). | The team is happy with the semantic-release cadence and does not need a cycle-named tag. |
| (b) Cut a parallel `v0.8.0-cycle` tag | tag the post-Phase-7 commit explicitly so the cycle has a named exit point distinct from the per-commit semantic-release tags. | The team wants a single "this is the v0.8.0 cycle close" pointer for downstream consumers (e.g. a release announcement). |

**Procedure (option b -- typical)**:

1. Identify the post-Phase-7 commit SHA (last commit on `main` before any v0.9.0 work landed).
2. `git tag -a v0.8.0-cycle <sha> -m "v0.8.0 cycle close (see docs/v0.8.0/known-gaps.md transferred-to-v0.9.0)"`
3. `git push origin v0.8.0-cycle`
4. Build the VSIX: `npm run build && npx @vscode/vsce package --no-dependencies` -- this writes `gemma-code-<version>.vsix`.
5. `gh release create v0.8.0-cycle gemma-code-*.vsix --title "v0.8.0 cycle close" --notes-file docs/v0.8.0/CHANGELOG-CYCLE.md` (or `--notes` inline if the CHANGELOG-CYCLE file from 10.O.EE was not authored).

**Acceptance**: tag pushed; release page lists the VSIX; release body cross-links the v0.8.0 known-gaps file; flip status above to `done`.

---

## Cross-reference

After every section flips to `done`, append a one-line note to [docs/v0.8.0/known-gaps.md](../v0.8.0/known-gaps.md) Section 10.2 (Resolved) for the matching `10.O.<X>` entry with `Resolved in: v0.9.0 operator-actions Section <N>`, and recompute the Section 10.3 Summary counts.
