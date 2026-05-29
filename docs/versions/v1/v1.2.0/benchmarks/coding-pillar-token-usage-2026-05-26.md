# Phase 7.1 -- Coding-Pillar Token-Usage Benchmark (2026-05-26)

**Plan reference**: [adoption-ecosystem-2026-05.md sub-task 7.1](../plans/adoption-ecosystem-2026-05.md)
**Status**: published
**Captured at**: 2026-05-28
**CI gate**: [tests/integration/coding-pillar/phase-7-token-usage.test.ts](../../../../../tests/integration/coding-pillar/phase-7-token-usage.test.ts)
**Raw fixtures**: [tests/fixtures/coding-pillar-token-usage-results/2026-05-26/](../../../../../tests/fixtures/coding-pillar-token-usage-results/2026-05-26/)

## Workload

The benchmark drives a deterministic 5-step Coding-pillar transcript that
exercises the two largest adoption deltas from the 2026-05 ecosystem
adoption track (`CommandCompressor` from Phase 2 + `codegraph_*` MCP
tools from Phase 3):

1. Find all callers of `redactSecrets`.
2. Run the test suite.
3. Inspect one failing test.
4. Propose a fix and edit the file.
5. Re-run the test suite.

The fixture repo is [tests/fixtures/codegraph-benchmark-repo/](../../../../../tests/fixtures/codegraph-benchmark-repo/),
the same one Phase 3.6 used for its 30%-of-tool-calls stability gate.

## Methodology

Two deterministic arms run against the same fixture in one test
invocation:

* **without-adoption**: a simulated pre-Phase-1 path -- one
  `grep_codebase` followed by per-file `read_file` calls plus the
  definition read, raw `pytest -q` output (~24 KB of PASSED lines)
  flowing back to the model, then `inspect + edit + re-run` as common
  steps.
* **with-adoption**: the same workload routed through
  `codegraph_callers + codegraph_context` (step 1 collapses to 2 tool
  calls) and the `CommandCompressor` `dedupe` strategy on the two
  `pytest -q` runs.

Tokens are approximated by UTF-8 byte length. Both arms pay the proxy,
so the absolute number does not matter -- only the delta.

Per the plan's framing, this is a **deterministic synthesis** of the
two largest adoption deltas, not a live agent-loop replay against a
worktree-checked-out pre-Phase-1 tag. A live worktree replay would
require an actual local-model run (multi-minute, GPU-bound) -- the
deterministic synthesis covers the same code paths via the real
`CodeGraphMcpServer + SqliteGraphStore + RepoScanner` wiring (no
mocks) plus the real `CommandCompressor`, so the byte deltas are
production-faithful. The remaining steps (inspect + edit + re-run) are
common to both arms and pass through unchanged. See known-gaps entry
`7.1.P2.A` for the rationale and the manual-replay follow-up.

## Results

| Metric                | Without adoption | With adoption | Ratio (lower is better) |
|-----------------------|------------------|---------------|-------------------------|
| Tool calls            | 11               | 6             | 54.55%                  |
| Tokens (UTF-8 bytes)  | 34,430           | 2,147         | 6.24%                   |

**Headline deltas**

* Tokens: **-93.76%** (from 34,430 to 2,147 bytes)
* Tool calls: **-45.45%** (from 11 to 6)

Both deltas clear the plan's "non-trivial >=30%" gate. The token-side
win is dominated by `CommandCompressor.dedupe` collapsing 599 repeated
`PASSED ...` pytest lines into one line with a `(xN)` suffix; the
tool-call-side win comes from `codegraph_callers + codegraph_context`
replacing the grep + per-caller-read sequence on step 1.

## Stability gates (passed)

| Gate                  | Threshold | Achieved  | Status |
|-----------------------|-----------|-----------|--------|
| Token ratio           | <=70%     | 6.24%     | passed |
| Tool-call ratio       | <=70%     | 54.55%    | passed |

The integration test [phase-7-token-usage.test.ts](../../../../../tests/integration/coding-pillar/phase-7-token-usage.test.ts)
asserts both gates on every CI run; a regression on either delta will
fail the suite.

## What the benchmark does NOT capture

* It does not measure the live local-model wall-clock latency; that is
  driven by the model tier, GPU memory, and Ollama pipeline length and
  is out of scope for this token-usage report.
* It does not exercise the path-scoped skills (Phase 5.2), the
  read-only sub-agent enforcement (Phase 5.1), or the
  session-reflection hook (Phase 5.4) -- those are policy items
  without a token-economy delta on the chosen workload.
* It does not stress the file-watcher abstraction (Phase 6.1) or the
  LSP client (Phase 6.2) -- those are bounded re-partial items whose
  delta is measured by other tests.

## Reproducing

```bash
npx vitest run --config configs/vitest.config.ts \
  tests/integration/coding-pillar/phase-7-token-usage.test.ts
```

The test rewrites the three JSON fixtures
([with-adoption.json](../../../../../tests/fixtures/coding-pillar-token-usage-results/2026-05-26/with-adoption.json),
[without-adoption.json](../../../../../tests/fixtures/coding-pillar-token-usage-results/2026-05-26/without-adoption.json),
[summary.json](../../../../../tests/fixtures/coding-pillar-token-usage-results/2026-05-26/summary.json))
on every invocation; both arms are deterministic, so the numbers above
reproduce byte-for-byte.

## Cross-reference

* Phase 2 component delta: [command-compressor-benchmark.test.ts](../../../../../tests/integration/coding-pillar/command-compressor-benchmark.test.ts) -- 21,121 / 76,538 = 27.6% (compressor in isolation)
* Phase 3 component delta: [codegraph benchmark.test.ts](../../../../../tests/integration/codegraph/benchmark.test.ts) -- 2/7 = 28.57% tool calls (codegraph in isolation)
* Phase 4 storage delta: see [memory-storage-size-2026-05-26.md](memory-storage-size-2026-05-26.md)
