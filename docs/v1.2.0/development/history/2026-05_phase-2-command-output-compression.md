# v1.2.0 Phase 2 -- Command-Output Compression

**Date**: 2026-05-28
**Plan reference**: [docs/v1.2.0/plans/adoption-ecosystem-2026-05.md](../../plans/adoption-ecosystem-2026-05.md) Phase 2
**Source comparison**: [docs/v1.2.0/comparison-ecosystem-2026-05.md](../../comparison-ecosystem-2026-05.md), Source S4 (RTK) and items 25-27 of Section 5
**Status**: Landed; stability gate passed at 27.6% (target: <=50%).

---

## Goal

Ship a Coding-pillar Bash-tool compression layer derived from RTK's per-command heuristics so the local Gemma 4 model sees a filtered / grouped / truncated / deduped view of stdout, while raw output is preserved on disk via tee-on-failure for inspection during retries. The phase's stability gate: a fixed-seed Coding-pillar transcript consumes at most 50% of the bytes it would consume without the compressor.

This phase does NOT vendor RTK, does NOT call RTK's binary, and does NOT add an opt-in telemetry path (Nexus is no-telemetry by construction; see [comparison Section 9.4 N4](../../comparison-ecosystem-2026-05.md#94-items-explicitly-not-recommended-for-adoption-security--policy-reasons)).

---

## Sub-tasks completed

### 2.1 + 2.2 + 2.3 -- CommandCompressor module

New module at [core/observability/CommandCompressor.ts](../../../../core/observability/CommandCompressor.ts).

Public surface:

- `class CommandCompressor` with `compress(command, rawOutput, exitCode): CompressedOutput`, `tee(command, rawOutput): string`, `pruneOldTees(): number`, `commandsLogsDir(): string`
- Pure-function strategies: `filterStrategy`, `groupStrategy`, `truncateStrategy`, `dedupeStrategy` (each `(rawOutput, command) => string`)
- `DEFAULT_REGISTRY` mapping `git` / `grep` / `ls` / `eslint` to filter, `npm` / `pnpm` / `yarn` / `cargo` to group, `pytest` / `vitest` / `jest` to dedupe, `cat` to passthrough
- `classify(command, registry)` with sub-command refinements that route `npm test` / `cargo test` / `npx vitest` to dedupe regardless of first-token registry

Strategy behaviors (matched to the plan's RTK-derived heuristics):

- **filter** -- `git`: drop progress / hint / "On branch" / "Your branch" / "nothing to commit" lines; `grep`: drop bare "Binary file matches" without a path component; `ls`: drop `total N` lines and blanks; `eslint`: drop empty separators; generic fallback: drop blank-only lines
- **group** -- `cargo`: collapse repeated `Compiling <crate>` lines into `Compiling <crate> (xN)`; `npm` / `pnpm` / `yarn`: retain only summary lines mentioning `added` / `removed` / `changed` / `audited` / `packages` / `vulnerabilities` / `deprecated`; generic fallback: collapse identical adjacent lines
- **truncate** -- keep first 200 + last 50 lines, insert `[... N lines elided; see tee at <pending> ...]` separator (the `<pending>` token is patched to the tee path after writing)
- **dedupe** -- collapse runs of identical adjacent lines into `<line> (xN)`

Strategy chaining: when post-primary output still exceeds the 10 KB cap, truncate is applied as a fallback and `strategyApplied` is reported as `truncate`.

Tee semantics ([CommandCompressor.tee](../../../../core/observability/CommandCompressor.ts), Phase 2.3):

- Path: `<nexus-home>/logs/commands/<ISO-stamp>-<slug>-<8-char-hash>.log` (ISO `:` -> `-` for Windows-safe filenames; slug = lowercased first token; hash = first 8 chars of `SHA-256(command)`)
- Always tees on `exitCode !== 0`
- On successful exit, tees only when truncate elided more than `successTeeLineDelta` (default 100) lines
- Best-effort: any write failure is swallowed and `teePath = null` returned so a transient filesystem error never crashes the agent loop
- `pruneOldTees()` removes files whose mtime is older than `teeRetentionDays` (default 14); safe to call at sidecar startup; missing directory returns 0

Acceptance evidence (`tests/unit/core/observability/CommandCompressor.test.ts`, 27 tests): all four strategies have at least one positive case (the strategy fires and reduces output) and one negative case (a command outside the strategy returns unchanged or only minimally compressed); tee writes / reads / Windows-safe filename / 14-day retention prune all covered.

### 2.4 -- Coding-pillar Bash-tool wiring

Modified [src/tools/handlers/terminal.ts](../../../../src/tools/handlers/terminal.ts):

- Replaced `import { compressToolOutput } from "./preToolHook.js"` with `import { CommandCompressor } from "../../../core/observability/CommandCompressor.js"`
- `RunTerminalTool._maybeCompress` now routes through `CommandCompressor.compress` instead of the v0.8.0 legacy hook
- Added dependency-injectable `_compressor: CommandCompressor | undefined` constructor argument so tests can redirect the tee path to a temp directory
- Tool-result JSON gains three new optional fields: `strategyApplied` (omitted on passthrough), `teePath` (set when a tee fired), `footer` (the human-readable hint `[Last command compressed; raw output available at <teePath> if needed.]`)
- Legacy `compressionRatio` field is recomputed from `originalBytes` / `compressedBytes` so downstream consumers that already read it continue to work

The existing `nexus.coding.preToolCompression` setting (with the legacy `gemma-code.preToolCompression` fallback) still gates compression on/off.

The legacy [src/tools/handlers/preToolHook.ts](../../../../src/tools/handlers/preToolHook.ts) module is left in place per the AGENTS.md adjacent-scope rule but has no production callers. Tracked as `2.4.P2.E` in [docs/v1.2.0/known-gaps.md](../../known-gaps.md) for a follow-up cleanup commit.

Acceptance evidence (`tests/integration/coding-pillar/command-compressor-wiring.test.ts`, 4 tests):

1. Synthetic `git status` -> `pytest -q` -> `grep -r foo .` sequence with `child_process.spawn` mocked -- compressed total stays at most 60% of raw total across the sequence
2. Failure-path `pytest -q` emits `teePath` + `footer` and persists the raw output on disk
3. Short successful `echo hi` omits both `teePath` and `strategyApplied` fields
4. Disabling the `nexus.coding.preToolCompression` flag returns raw output unchanged

### 2.5 -- Benchmark + stability gate

New test at `tests/integration/coding-pillar/command-compressor-benchmark.test.ts`. Drives a fixed-seed synthetic Coding-pillar transcript through `CommandCompressor.compress` and asserts the compressed total stays at or below 50% of the raw total.

Reference workload (6 steps representative of "Run the full test suite, then summarize failures"):

1. `git status` -- branch + change summary with 80 modified files
2. `pytest -q` -- 400 + 200 PASSED lines + summary
3. `grep -r needle .` -- 800 match lines
4. `cat tests/unit/test_beta.py` -- 220-line source file (passthrough surface)
5. `cargo build` -- 120 `Compiling crate-N` lines + Finished line
6. `pytest -q tests/unit/test_beta.py` -- failure path (exitCode=1)

Persisted under [tests/fixtures/coding-pillar-benchmark-results/2026-05-26/](../../../../tests/fixtures/coding-pillar-benchmark-results/2026-05-26/):

| File | Raw total (bytes) | Compressed total (bytes) | Ratio |
|---|---|---|---|
| `with-compressor.json` | 76538 | 21121 | 27.6% |
| `without-compressor.json` | 76538 | 76538 | 100% (baseline) |

**Stability gate**: target <=50%; achieved 27.6%. Headroom of 22.4 percentage points.

---

## Test results

| Suite | Tests | Result |
|---|---|---|
| `tests/unit/core/observability/CommandCompressor.test.ts` | 27 | 27 passed |
| `tests/integration/coding-pillar/command-compressor-wiring.test.ts` | 4 | 4 passed |
| `tests/integration/coding-pillar/command-compressor-benchmark.test.ts` | 1 | 1 passed (27.6% ratio) |
| Full suite (`npx vitest run --config configs/vitest.config.ts`) | 3429 | 3424 passed, 5 skipped, 0 failed |

Coverage:

| File | Lines | Branches | Functions |
|---|---|---|---|
| `core/observability/CommandCompressor.ts` | 92.22% | 82.67% | 100% |
| `src/tools/handlers/terminal.ts` | 88.31% (was 57.57%) | 90% | 100% |
| Global | 86.53% | 83.3% | 90.5% |

Other gates:

- `npx tsc -p tsconfig.json --noEmit` -- 0 errors
- `npx eslint src/tools/handlers/terminal.ts --max-warnings=0` -- 0 errors
- `npx eslint src --max-warnings=0` -- 0 errors

---

## CI/CD changes

None required. Existing `npm run test -- --coverage` in [.github/workflows/ci.yml](../../../../.github/workflows/ci.yml) covers the new unit and integration tests by the existing include glob (`tests/unit/**/*.test.ts`, `tests/integration/**/*.test.ts`). Coverage thresholds are unchanged (80% line / 75% branch / 80% function) and continue to pass at global 86.53% / 83.3% / 90.5%.

---

## Deviations

| ID | Description | Disposition |
|---|---|---|
| **D1** | Plan asks for the tee footer to be injected into the next-turn system prompt via `PromptBuilder`. Shipped wiring embeds the footer as a `footer` field inside the `run_terminal` tool-result JSON instead. The model still sees the path on the next reasoning step (the JSON is part of the conversation history feeding the next system prompt), so the tee path is reachable without a PromptBuilder edit. A literal PromptBuilder hook belongs alongside Phase 5's agent-loop policy surface. | Recorded as `2.4.P3.F` in known-gaps.md |
| **D2** | Plan describes adding the new module while keeping the v0.8.0 `preToolHook.ts` available. Did exactly that, but the new wiring means `preToolHook.ts` has no production callers. Per AGENTS.md "no adjacent-scope cleanup" the module + its 6-test unit suite remain in place this phase. | Recorded as `2.4.P2.E` in known-gaps.md |

No other deviations. No `# DEVIATION:` markers landed in code.

---

## Known issues / follow-ups

See [docs/v1.2.0/known-gaps.md](../../known-gaps.md) entries `2.4.P2.E` and `2.4.P3.F` for the two open items above. No P0 / P1 release blockers introduced.

---

## Next steps

- Phase 3 of the adoption track: `core/codegraph/` -- SQLite-backed symbol-and-call-edge graph plus 8-tool internal MCP server. Phase 2's noise reduction will lower the volume of chatter the agent sees when the code-graph scanner runs its Tree-sitter / FTS index step.
- Phase 5 will own the PromptBuilder footer injection (D1 follow-up) when it lands the read-only-exploration sub-agent enforcement and the 13th `session-reflection` hook position.
- Phase 7 (stabilization) owns the deeper README / AGENTS.md / ARCHITECTURE.md refresh that names the new `core/observability/CommandCompressor.ts` surface alongside the code-graph and memory-enhancement modules.
