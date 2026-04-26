# Plan — Agent-Friendly Tools

**Project**: Gemma Code
**Version**: v0.5.0
**Slug**: agent-friendly-tools
**Plan Type**: Feature / Enhancement
**Created**: 2026-04-24
**Source Comparison**: [docs/v0.5.0/comparison/comparison-7-principles-for-agent-friendly-clis.md](../comparison/comparison-7-principles-for-agent-friendly-clis.md)
**Scope Filter**: `all` (P0 + P1 + P2 + P3) — article-format report, Adoption Plan in Section 5
**Hard Constraint**: 100% offline-first single-GPU. No runtime network egress, no cloud APIs. **Do not add a `--non-interactive` flag** — Gemma's tools are non-interactive by construction. **Do not introduce stdin-pipe / `-` aliases** — Gemma's tool inputs are JSON objects, not stdin streams.

**Goal**: Adopt all 8 in-scope items from Trevin Chow's "7 Principles for Agent-Friendly CLIs" so that every tool surface Gemma exposes to Gemma 4 (read_file, grep_codebase, run_terminal, etc.) returns bounded, actionable, paginatable, structured outputs — with a `dry_run` escape hatch on mutating operations and a `get_tool_schema`-driven help discovery layer.

## Overview

This plan adopts the 8 in-scope items from [docs/v0.5.0/comparison/comparison-7-principles-for-agent-friendly-clis.md](../comparison/comparison-7-principles-for-agent-friendly-clis.md), grouped into 4 dependency-ordered phases. Phase 1 is the foundation: every tool output is hard-capped at 64 KB with a truncation hint explaining how to narrow, and `read_file` plus `grep_codebase` accept pagination parameters so the agent can request additional windows on demand. Phase 2 audits and rewrites every error message in `src/tools/handlers/*.ts` so each contains the failing parameter name and a one-line usage hint that teaches the agent how to retry; this is locked in via property-based tests. Phase 3 adds a `dry_run` parameter to `run_terminal` and `delete_file` (which prints what would happen without executing) and a `format=json` parameter to `list_directory` and `grep_codebase` so the agent can opt into a stable structured shape. Phase 4 formalizes the Blocker / Friction / Optimization severity rubric in the docs and documents the existing `get_tool_schema` tool as the in-extension `--help` analog.

The user-visible delta is small: nothing changes for casual chat. The agent sees richer error messages, smaller tool outputs by default, and explicit pagination. The trace dashboard surfaces a new "tool truncations" counter so we can measure how often the cap fires; if it fires constantly on a representative workload, the cap is too tight and Phase 1's stabilization step retunes it. Every change is additive — existing tool callers keep working without touching new parameters.

Success is measured against three artifacts: a property-based error-message test suite (`tests/unit/tools/errors.test.ts`) that asserts every error contains the parameter name + usage hint; integration coverage proving each new parameter works end-to-end (`dry_run` returns a preview without side effects, pagination retrieves the requested window, `format=json` returns parseable JSON); and a 3-task golden micro-eval in `tests/golden/tasks/agent-friendly/` where the agent is *forced* into the truncated path and must use the truncation hint to recover the missing context.

## Phases at a Glance

| Phase | Title | Outcome | Items adopted |
|-------|-------|---------|---------------|
| 1 | Tool-output bounding | 64 KB hard cap on every tool output with a structured truncation hint; `read_file(range_start, range_end)` + `grep_codebase(max_results, next_offset)` paginate | P1-2, P2-3, P2-4 |
| 2 | Error-message actionability | Every error in `src/tools/handlers/*.ts` includes the failing parameter name + a usage hint; locked in by property-based tests | P1-1 |
| 3 | Mutation safety + structured outputs | `dry_run` on `run_terminal` and `delete_file`; `format=json` on `list_directory` and `grep_codebase` | P2-2, P3-1 |
| 4 | Documentation + severity rubric | Blocker / Friction / Optimization rubric documented in `docs/v0.5.0/tool-audit.md`; `get_tool_schema` documented in `ARCHITECTURE.md` | P2-1, P3-2 |

**Explicitly out of scope** (filtered by hard constraint):

- `--non-interactive` flag on any tool — Gemma's tools are non-interactive by construction; adding a flag is redundant noise
- Stdin / `-` alias support (Principle #6) — Gemma's tool inputs are JSON, not stdin streams
- ANSI/colour-suppression flags — tool outputs already contain no ANSI; not relevant
- Any framework-specific (Click / Cobra / clap / etc.) idiomatic refactors — Gemma uses its own `ToolRegistry` framework
- Severity-rubric CI gates that fail builds — the rubric is comment metadata, not a CI rule (per the report's risk note)

---

## Phase 1: Tool-Output Bounding

**Goal**: Add a uniform 64 KB byte-cap to every tool output via `src/tools/OutputRedirector.ts`, with a structured truncation hint that explains how to narrow; pagination parameters on `read_file` and `grep_codebase`.

**Prerequisites**: None.

**Stability Gate**: Every tool output ≤ 64 KB by default; truncation hint format consistent across handlers; pagination retrieves windows correctly; cap-fire rate observable in metrics; `tests/benchmarks/tool-execution.bench.ts` shows < 5 ms added latency at p99.

### Sub-tasks

#### 1.1 — Universal 64 KB byte-cap with structured truncation hint

**Objective**: Extend `src/tools/OutputRedirector.ts` so every tool output above 64 KB is truncated with a structured hint footer; the cap is configurable per call via a `max_bytes` parameter; observable via `MetricsCollector` events.

**Prompt**:
> You are working on Gemma Code v0.5.0 (TypeScript VS Code extension; offline-first; uses Ollama + Gemma 4). Implement universal output bounding.
>
> Modify `src/tools/OutputRedirector.ts`:
>
> - Add a constant `DEFAULT_MAX_BYTES = 64 * 1024` (64 KB).
> - Modify the existing capture path so when `Buffer.byteLength(output, 'utf8') > maxBytes`, return only the first `maxBytes` bytes plus a structured footer:
>   ```
>   \n=== TRUNCATED at <maxBytes> bytes; total <originalBytes> bytes ===
>   To narrow: use range_start/range_end for read_file, max_results/next_offset for grep_codebase, or pass max_bytes=<larger value> on this tool call.
>   ```
> - Accept a per-call override `maxBytes?: number` (per-tool ceiling cap at 1 MB; reject larger requests with an actionable error).
> - Emit a metric on `MetricsCollector`: `tool_output.truncated` with payload `{ tool, originalBytes, maxBytes }`.
>
> Add an integration point in `src/tools/AgentLoop.ts` so the agent's tool dispatcher passes the call's `max_bytes` parameter (if present in `tool_input`) through to `OutputRedirector`.
>
> Tests:
> - `tests/unit/tools/OutputRedirector.bytecap.test.ts`: 100 KB UTF-8 input is truncated at 64 KB exactly; multi-byte characters at the boundary do not split (use `Buffer.from(...).slice` then validate UTF-8); the footer is appended verbatim; `max_bytes=200_000` returns the full payload; `max_bytes=2_000_000` is rejected with an error message containing the cap.
> - `tests/integration/tool-output-bytecap.test.ts`: a single agent loop turn whose stubbed tool returns a 200 KB string ends with the agent receiving exactly the 64 KB + truncation hint.
>
> Constraints:
> - The cap interacts with Brotli compression (from the parallel token-optimizer-adoption Phase 1). The cap applies to the **uncompressed** output before any compression. Verify by reading both Phase 1 files of `docs/v0.5.0/plans/token-optimizer-adoption.md` and `docs/v0.5.0/plans/agent-friendly-tools.md`.
> - Truncation must happen **before** the output reaches the conversation transcript so the cap holds even if compression is later disabled.
> - Do NOT introduce a `--non-interactive` flag pattern — Gemma's tools are non-interactive by construction.
>
> Acceptance: full Vitest suite green; benchmark p99 within +5 ms; `tests/benchmarks/tool-execution.bench.ts` shows the metric fires.

---

#### 1.2 — `read_file` pagination via `range_start` / `range_end`

**Objective**: Add `range_start` and `range_end` byte-offset parameters to `read_file` so the agent can fetch sub-windows of large files; the truncation hint added in 1.1 references this mechanism.

**Prompt**:
> Gemma Code v0.5.0 agent-friendly-tools adoption — Phase 1 step 2.
>
> Add pagination to `read_file`:
>
> - Modify the `read_file` handler in `src/tools/handlers/filesystem.ts` to accept optional `range_start?: number` and `range_end?: number` byte offsets (inclusive start, exclusive end, like `Buffer.subarray`).
> - Update the tool schema in `src/tools/ToolCatalog.ts` so the agent can see and use these parameters; the description must include a one-line usage example: `read_file(path, range_start=0, range_end=4096)`.
> - Validate: `range_start >= 0`; `range_end > range_start`; `range_end - range_start <= 1_048_576` (1 MB max window). On invalid range, return an actionable error containing the limits.
> - Read only the requested window using `fs.read` with a position+length, not full file read + slice (matters for very large files).
> - When the request returns less than the requested window because of file end, the truncation hint from 1.1 is unnecessary; instead append `\n=== End of file at byte <fileSize> ===`.
> - Honor the existing `pathGuard.ts` and `secretPaths.ts` checks; honor the `full=true` escape hatch added by the parallel token-optimizer-adoption plan (passing `full=true` ignores `range_*` and returns the entire file, subject to the byte-cap from 1.1).
>
> Tests:
> - `tests/unit/tools/handlers/filesystem.read_file.range.test.ts`: range happy path; range past EOF returns short result + EOF marker; invalid range returns actionable error containing both `range_start` and the limit; window of 1 MB is allowed; > 1 MB rejected.
> - `tests/integration/read_file-pagination.test.ts`: agent reads a 200 KB file in three windows of 64 KB; reconstructed content matches the original byte-for-byte.
>
> Constraints:
> - Do NOT change behavior for callers that pass neither `range_start` nor `range_end` (full-file mode remains the default, subject to the byte-cap).
> - Ensure both `read_file` and `read_file(range_start=0)` are equivalent.
> - The pagination cap (1 MB) is independent of the byte-cap (64 KB); the byte-cap then truncates the window if it exceeds 64 KB. This is correct: the agent says "give me bytes 100-200 KB" and gets the first 64 KB of that window with the truncation hint pointing at narrower ranges.
>
> Acceptance: full Vitest suite green; integration test green; `npm run lint` clean.

---

#### 1.3 — `grep_codebase` pagination via `max_results` / `next_offset`

**Objective**: Add `max_results` and `next_offset` parameters to `grep_codebase` so large match sets can be paged; the result includes a `next_offset` marker the agent uses to continue.

**Prompt**:
> Gemma Code v0.5.0 agent-friendly-tools adoption — Phase 1 step 3.
>
> Add pagination to `grep_codebase`:
>
> - Modify the `grep_codebase` handler in `src/tools/handlers/filesystem.ts` to accept optional `max_results?: number` (default 50; max 500) and `next_offset?: string` (opaque cursor used to continue from a prior call).
> - Internally, the cursor is a base64-encoded JSON `{ filePath: string; lineNumber: number; matchIndex: number }` representing the position of the next match to return.
> - Result shape adds a `next_offset` field when more matches remain after the truncation; absent otherwise.
> - The truncation hint from sub-task 1.1 is replaced for grep with a more specific hint when `next_offset` is present: `\n=== Showing <N> of <total>+ matches; pass next_offset='<cursor>' to continue. ===`
> - Update the tool schema in `src/tools/ToolCatalog.ts` to document both parameters and the cursor pattern.
> - Honor the existing 500 ms time budget and ReDoS guard.
>
> Tests:
> - `tests/unit/tools/handlers/filesystem.grep.pagination.test.ts`: paginating 200 matches at `max_results=50` produces 4 windows; the `next_offset` cursor round-trips correctly; an invalid cursor returns an actionable error mentioning the parameter name; `max_results=600` is clamped to 500 with a warning in the result body.
> - `tests/integration/grep-pagination.test.ts`: agent grep that hits 100+ matches and uses `next_offset` to retrieve the second page.
>
> Constraints:
> - The cursor is opaque to the agent; the agent must pass it back verbatim. Document this in the schema description.
> - Total time budget remains 500 ms; if pagination is in flight and time runs out, return what's collected with a `next_offset` marker.
> - Do NOT add a `format` parameter in this sub-task — `format=json` lands in Phase 3.
>
> Acceptance: full Vitest suite green; integration test green; `npm run lint` clean.

---

#### 1.4 — Phase 1 testing and stabilization

**Objective**: Generate and run all Phase 1 tests; tune the byte-cap if it fires too often; iterate until stable.

**Prompt**:
> Generate and run comprehensive tests for Phase 1 of the agent-friendly-tools adoption (`docs/v0.5.0/plans/agent-friendly-tools.md`). Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`. Fix every failure.
> 2. Run `npm run bench -- tests/benchmarks/tool-execution.bench.ts`; assert p99 < +5 ms vs. baseline.
> 3. Cap-fire calibration: run the 24 golden tasks (`python tests/golden/framework/run_all.py`) and read out the `tool_output.truncated` metric per task. If the cap fires on > 30% of tool calls in any single task, the 64 KB default is too tight; analyze the offending outputs and either:
>    - Raise the default to 128 KB (and re-run) OR
>    - Document why the agent should be using pagination instead.
> 4. Manually verify the truncation hint format is consistent across all three handlers (`read_file`, `grep_codebase`, anything else producing > 64 KB).
> 5. After all tests pass, run `/generate-session-history` to document Phase 1.
>
> Do not advance to Phase 2 until every step above is fully verified, including the cap calibration.

---

### Phase 1 Exit Checklist

- [ ] `OutputRedirector.ts` enforces 64 KB default cap; per-call override via `max_bytes` works
- [ ] Truncation hint format is consistent across handlers
- [ ] `read_file(range_start, range_end)` works; 1 MB window cap enforced; EOF marker appears at end
- [ ] `grep_codebase(max_results, next_offset)` works; cursor round-trips
- [ ] `tool_output.truncated` metric fires; observable in `MetricsCollector`
- [ ] Cap-fire rate < 30% on every golden task (or default raised with rationale)
- [ ] No benchmark regression > 5 ms p99
- [ ] Session history generated

---

## Phase 2: Error-Message Actionability

**Goal**: Audit every error message in `src/tools/handlers/*.ts` and rewrite for actionability — every error contains the failing parameter name and a one-line usage hint that teaches the agent how to retry. Locked in by property-based tests.

**Prerequisites**: Phase 1 (truncation-hint format established; new error patterns from `read_file` range validation and `grep_codebase` cursor validation are already actionable).

**Stability Gate**: Every error path returned by handlers in `src/tools/handlers/filesystem.ts`, `terminal.ts`, `webSearch.ts`, `secretPaths.ts`, `pathGuard.ts` contains the relevant parameter name and a usage hint; `tests/unit/tools/errors.test.ts` enforces this property.

### Sub-tasks

#### 2.1 — Audit and rewrite tool-handler error messages

**Objective**: Inventory every `ToolResult` error string; rewrite each to include parameter name + usage hint per the article's Principle 3.

**Prompt**:
> Gemma Code v0.5.0 agent-friendly-tools adoption — Phase 2 step 1.
>
> Audit and rewrite every tool-handler error message:
>
> 1. Inventory every `return { ok: false, error: '...' }` (and equivalent shapes) across:
>    - `src/tools/handlers/filesystem.ts`
>    - `src/tools/handlers/terminal.ts`
>    - `src/tools/handlers/webSearch.ts`
>    - `src/tools/handlers/secretPaths.ts`
>    - `src/tools/handlers/pathGuard.ts`
>    - `src/utils/errors.ts` (review `formatForUser` / `formatForLog` to ensure they preserve the actionable parts).
>
> 2. For each error, ensure the message contains:
>    - The **failing parameter name** (e.g. `path`, `command`, `range_start`, `pattern`, etc.).
>    - A **one-line usage hint** showing the correct invocation pattern (e.g. `Usage: read_file(path=<absolute path inside workspace>)`).
>    - Optionally one concrete example value if the parameter is non-obvious (e.g. `Example: read_file(path='src/extension.ts')`).
>
>    Aim for ONE concrete suggestion per error. The article's example is a single sentence: `"Error: --content is required. Usage: blog-cli publish --content <file>"`. Match that brevity.
>
> 3. Common patterns to apply:
>    - File-not-found: `Error: file not found at path '<path>'. Usage: read_file(path=<absolute path inside workspace>). To list directory contents, use list_directory(path=...).`
>    - Path traversal: `Error: path '<path>' escapes the workspace root. Usage: pass a path inside <workspaceRoot>.`
>    - Secret-path: `Error: path '<path>' is on the secret-path denylist. Usage: pass allow_secrets=true to override (will trigger user confirmation).`
>    - Bad regex: `Error: invalid regex '<pattern>'. Usage: grep_codebase(pattern=<RE2-compatible regex>). Avoid nested quantifiers.`
>    - Disallowed command: `Error: command '<binary>' is outside the allowlist. Usage: pass an allowlisted command (git, npm, pnpm, yarn, node, python, python3, pytest, cargo, go, make, ls, cat, echo, pwd) or run with confirmation.`
>
> 4. Differentiate `formatForUser` (terse, agent-targeted) vs. `formatForLog` (verbose; full path, stack trace, original errno). The agent sees `formatForUser`; the log sees `formatForLog`.
>
> Constraints:
> - Do not over-engineer: aim for one sentence per error.
> - Do not break existing tests that assert on specific phrases. Update those tests to assert on the new properties (parameter name + hint) rather than verbatim strings.
>
> Tests:
> - Sub-task 2.2 covers the property-based assertion suite.
>
> Acceptance: every error path in the listed handlers carries the parameter name + usage hint; manual review against the inventory checklist; `npm run lint` clean.

---

#### 2.2 — Property-based error tests in `errors.test.ts`

**Objective**: Lock the actionable-error property in tests so future error additions cannot regress.

**Prompt**:
> Gemma Code v0.5.0 agent-friendly-tools adoption — Phase 2 step 2.
>
> Create `tests/unit/tools/errors.test.ts`:
>
> Programmatic test that exercises every documented error path of every handler in `src/tools/handlers/` and asserts:
>
> - `result.ok === false`
> - `result.error` is a non-empty string.
> - `result.error` contains at least ONE known parameter name from the handler's schema (read from `src/tools/ToolCatalog.ts`). For schemas with multiple parameters, accept any one of them.
> - `result.error` contains the substring `Usage:` (case-insensitive) — this enforces the usage-hint convention.
>
> Approach:
> - Build a fixture map: handler name → error scenarios → expected parameter substring.
> - For each scenario, call the handler with the failing inputs and assert the three properties above.
> - For handlers with > 5 error scenarios, generate fixtures programmatically from a YAML file at `tests/fixtures/error-scenarios.yaml` rather than inline.
>
> Bonus: add a meta-test that walks `src/tools/handlers/*.ts` source via a simple AST scan (use the TypeScript compiler API already in `devDependencies`) and asserts every `return { ok: false, error: ... }` literal contains the substring `Usage:`. This catches regressions where an engineer adds a new error path without following the convention.
>
> Constraints:
> - The meta-test is allowed to be slow (~2 s); skip in pre-commit lint-staged but include in `npm run test`.
> - Keep `errors.test.ts` deterministic: do not depend on filesystem state or environment.
> - Allow the meta-test to be skipped via `SKIP_ERROR_PROPERTY_TEST=1` for emergency triage.
>
> Acceptance: full Vitest suite green; the meta-test catches an artificial regression introduced by removing `Usage:` from one handler then restored.

---

#### 2.3 — Phase 2 testing and stabilization

**Objective**: Run all Phase 2 tests; verify the error-message rewrite did not break upstream callers; iterate until stable.

**Prompt**:
> Generate and run comprehensive tests for Phase 2 of the agent-friendly-tools adoption. Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`. Fix every failure.
> 2. Run the meta-test from sub-task 2.2 and confirm it passes (catches a deliberately broken error in a fixture branch, then restored).
> 3. Re-run the 24 golden tasks; confirm no regression in success rate. The agent should retry more successfully now because errors are actionable; if any task regressed, identify the cause (likely a test asserting on an old verbatim error string).
> 4. Manual smoke: trigger each error scenario in a Claude Code session and confirm the agent produces a sensible retry on the next turn.
> 5. After all tests pass, run `/generate-session-history` to document Phase 2.
>
> Do not advance to Phase 3 until every step above is fully verified.

---

### Phase 2 Exit Checklist

- [ ] Every error in `src/tools/handlers/*.ts` contains parameter name + `Usage:` hint
- [ ] `tests/unit/tools/errors.test.ts` exists and is green
- [ ] Meta-test catches missing-`Usage:` regressions
- [ ] No regression in 24 golden tasks
- [ ] `formatForUser` / `formatForLog` differentiation preserved
- [ ] Session history generated

---

## Phase 3: Mutation Safety + Structured Outputs

**Goal**: Add `dry_run` parameter to `run_terminal` and `delete_file` (returns a preview without side effects); add `format=json` parameter to `list_directory` and `grep_codebase` (returns parseable JSON for cases where the agent prefers structured access).

**Prerequisites**: Phase 1 (byte-cap, pagination); Phase 2 (actionable errors — extends to the new parameters).

**Stability Gate**: `dry_run` returns a textual preview labelled `=== DRY RUN: no execution occurred ===` for `run_terminal` and the file size + content hash for `delete_file`; `format=json` returns RFC-8259 JSON for `list_directory` and `grep_codebase`; both new flags are documented in `ToolCatalog`.

### Sub-tasks

#### 3.1 — `dry_run` on `run_terminal` and `delete_file`

**Objective**: Add a `dry_run: boolean` parameter to the two most consequential mutation tools so the agent (or user, via `editMode: plan`) can pre-flight-check.

**Prompt**:
> Gemma Code v0.5.0 agent-friendly-tools adoption — Phase 3 step 1.
>
> Add `dry_run` support:
>
> - `src/tools/handlers/terminal.ts` `run_terminal` handler: accept `dry_run?: boolean` (default `false`). When `dry_run === true`:
>   - Parse the command into tokens via the existing logic.
>   - Run all the existing safety checks (allowlist, blocked patterns, path-guard on `cwd`).
>   - Return a `ToolResult` with output:
>     ```
>     === DRY RUN: no execution occurred ===
>     Tokens: ['<token1>', '<token2>', ...]
>     CWD: <resolved cwd>
>     Allowlisted: <true|false>
>     Blocked-pattern match: <yes:<pattern>|no>
>     ```
>   - Do NOT spawn a subprocess. Do NOT capture stdout/stderr. Do NOT simulate exit codes.
>
> - `src/tools/handlers/filesystem.ts` `delete_file` handler: accept `dry_run?: boolean` (default `false`). When `dry_run === true`:
>   - Run all the existing safety checks (path-guard, secret-path).
>   - `stat` the file to capture its size.
>   - Compute a fast SHA-256 of the file content (cap at 1 MB to keep latency bounded; if larger, just return size + first-1MB hash with a note).
>   - Return:
>     ```
>     === DRY RUN: no deletion occurred ===
>     Target: <absolutePath>
>     Size: <bytes>
>     Content SHA-256 (first 1 MB): <hash>
>     ```
>
> Update `src/tools/ToolCatalog.ts` schemas to document `dry_run` for both tools, with a clear note: `When true, the tool returns a preview without performing any side effect. Use this to verify the operation is safe before re-running with dry_run=false.`
>
> Tests:
> - `tests/unit/tools/handlers/terminal.dry_run.test.ts`: dry-run on `git status` returns the token list without spawning a subprocess (verify by mocking `child_process.spawn` and asserting it is not called); dry-run on a blocked pattern returns the dry-run output WITH the blocked-pattern match noted (still no execution); regular execution unchanged when `dry_run` is omitted or `false`.
> - `tests/unit/tools/handlers/filesystem.delete.dry_run.test.ts`: dry-run on a fixture file returns size + SHA without unlinking; the file still exists after the call.
> - `tests/integration/dry-run-end-to-end.test.ts`: agent loop turn that runs `delete_file(dry_run=true)` then `delete_file(dry_run=false)` against the same path; the second call deletes; both calls log to traces.
>
> Constraints:
> - Dry-run output must be structured enough that the agent can parse it; the `=== DRY RUN: ===` marker is the contract.
> - Do NOT simulate exit codes for `run_terminal` dry-run — that creates the risk that the agent reasons about side effects from a fictitious result.
> - Honor the existing tier-2 DANGEROUS classification: even with `dry_run=true`, the existing `ConfirmationGate` / `editMode: plan` discipline still runs. Dry-run is a pre-execution check, not an authorization bypass.
>
> Acceptance: full Vitest suite green; integration test green; `npm run lint` clean.

---

#### 3.2 — `format=json` on `list_directory` and `grep_codebase`

**Objective**: Allow the agent to request structured JSON output from `list_directory` and `grep_codebase` for cases where it prefers parseable access; the default human-readable text output is unchanged.

**Prompt**:
> Gemma Code v0.5.0 agent-friendly-tools adoption — Phase 3 step 2.
>
> Add `format=json` to two tools:
>
> - `src/tools/handlers/filesystem.ts` `list_directory`: accept `format?: 'text' | 'json'` (default `'text'`). When `format === 'json'`:
>   ```json
>   {
>     "path": "<absolute path>",
>     "entries": [
>       { "name": "file.ts", "type": "file", "size_bytes": 1024 },
>       { "name": "src", "type": "directory" }
>     ]
>   }
>   ```
>
> - `src/tools/handlers/filesystem.ts` `grep_codebase`: accept `format?: 'text' | 'json'` (default `'text'`). When `format === 'json'`:
>   ```json
>   {
>     "pattern": "...",
>     "matches": [
>       { "file_path": "src/x.ts", "line_number": 42, "line": "match line content" }
>     ],
>     "next_offset": "<cursor>" // optional, only when paginated
>   }
>   ```
>
> The byte-cap from Phase 1 still applies: if the JSON exceeds 64 KB, truncate at the boundary (must produce parseable JSON — close the array, append the truncation hint as a JSON string in a `_truncation` field):
> ```json
> { "path": "...", "entries": [...partial...], "_truncation": "Showing 234 of 1500 entries; use list_directory with subset paths to narrow." }
> ```
>
> Update `src/tools/ToolCatalog.ts` to document the new `format` parameter on both tools.
>
> Tests:
> - `tests/unit/tools/handlers/filesystem.format_json.test.ts`: JSON shape is RFC-8259 valid; round-trips through `JSON.parse`; truncation produces valid JSON with the `_truncation` field; default `format='text'` is byte-equivalent to the pre-change output.
> - `tests/integration/format-json-end-to-end.test.ts`: agent loop turn that uses `format=json` and the next turn parses the structured result.
>
> Constraints:
> - Output must be parseable JSON in `format=json` mode, including truncation paths. Test parseability explicitly with `JSON.parse`.
> - `format='text'` is the default and must remain byte-equivalent to current output.
> - Do NOT add `format=json` to other tools in this sub-task; `read_file` and `run_terminal` keep their current text shapes (they have natural shapes that are agent-friendly already).
>
> Acceptance: full Vitest suite green; integration test green; `npm run lint` clean.

---

#### 3.3 — Phase 3 testing and stabilization

**Objective**: Run all Phase 3 tests; verify dry-run paths cannot leak side effects; iterate until stable.

**Prompt**:
> Generate and run comprehensive tests for Phase 3 of the agent-friendly-tools adoption. Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`. Fix every failure.
> 2. Adversarial dry-run check: write a test that mocks `child_process.spawn` and `fs.unlinkSync` and asserts they are NEVER called when `dry_run=true`, regardless of inputs (sweep through the handler with property-based fuzzing of inputs).
> 3. JSON parseability check: extend the existing schema-validation suite with a property test that for any `list_directory` and `grep_codebase` input, the `format=json` output is valid JSON.
> 4. Manual smoke: in a Claude Code session, run `delete_file(dry_run=true)` against `package.json` (DO NOT run with `dry_run=false`); confirm the SHA matches `git hash-object package.json` (or the equivalent SHA-256).
> 5. Re-run the 24 golden tasks; confirm no regression.
> 6. After all tests pass, run `/generate-session-history` to document Phase 3.
>
> Do not advance to Phase 4 until every step above is fully verified.

---

### Phase 3 Exit Checklist

- [ ] `run_terminal(dry_run=true)` returns preview without side effects
- [ ] `delete_file(dry_run=true)` returns size + SHA without unlinking
- [ ] Adversarial test confirms `spawn` and `unlink` are NEVER called on dry-run
- [ ] `list_directory(format='json')` returns parseable JSON
- [ ] `grep_codebase(format='json')` returns parseable JSON, including truncated form
- [ ] `format='text'` (default) remains byte-equivalent to pre-change output
- [ ] No regression in 24 golden tasks
- [ ] Session history generated

---

## Phase 4: Documentation + Severity Rubric

**Goal**: Document the Blocker / Friction / Optimization severity rubric in the project's tool-audit notes; document the existing `get_tool_schema` tool as the in-extension `--help` analog in `ARCHITECTURE.md` and `README.md`.

**Prerequisites**: Phases 1–3 (the rubric and help docs reference the new parameters).

**Stability Gate**: `docs/v0.5.0/tool-audit.md` exists with the rubric definitions and an audit table covering every tool; `ARCHITECTURE.md` and `README.md` reference `get_tool_schema` as the help-discovery surface; the 3-task golden micro-eval at `tests/golden/tasks/agent-friendly/` passes (the agent uses the truncation hint to recover).

### Sub-tasks

#### 4.1 — Severity rubric document

**Objective**: Add `docs/v0.5.0/tool-audit.md` with the Blocker / Friction / Optimization labels defined and an audit table covering every tool.

**Prompt**:
> Gemma Code v0.5.0 agent-friendly-tools adoption — Phase 4 step 1.
>
> Create `docs/v0.5.0/tool-audit.md` with sections:
>
> 1. **Severity rubric** (definitions adapted from the source article):
>    - **Blocker**: prevents reliable agent use (hangs, requires intervention, unrecoverable output, returns zero structured information on failure).
>    - **Friction**: works but inefficiently (more retries, wasted tokens, brittle parsing, missing pagination, vague errors).
>    - **Optimization**: functions well but could be faster / cheaper / more reliable (latency tightening, additional structured output modes, clearer help text).
>
> 2. **Audit table** — one row per tool exposed by Gemma:
>
>    | Tool | Severity | Notes | Action |
>    |------|----------|-------|--------|
>    | `read_file` | Optimization | Pagination added in v0.5.0; consider streaming for very large files | Future: streaming on > 1 MB files |
>    | `grep_codebase` | Optimization | Pagination + JSON format added in v0.5.0 | None |
>    | `run_terminal` | Optimization | dry-run added in v0.5.0; allowlist remains conservative | None |
>    | `delete_file` | Optimization | dry-run added in v0.5.0 | None |
>    | `list_directory` | Optimization | JSON format added in v0.5.0 | None |
>    | `web_search` | Friction | No cache yet (P2 in token-optimizer adoption parallel plan) | See [token-optimizer-adoption.md](token-optimizer-adoption.md) Phase 4.1 |
>    | ... | ... | ... | ... |
>
>    Walk through every tool registered in `src/tools/ToolRegistry.ts` and `src/tools/ToolCatalog.ts`; classify each with rationale. Cite file paths.
>
> 3. **Severity is not a CI gate**. The labels are vocabulary for tool-quality discussions and PR descriptions; they do not fail builds.
>
> 4. **References**: link to `docs/v0.5.0/comparison/comparison-7-principles-for-agent-friendly-clis.md` and Trevin Chow's article URL.
>
> Cross-reference from `CONTRIBUTING.md` "Testing" section and from `docs/v0.5.0/test-pyramid.md`.
>
> Constraints:
> - Keep under 1500 words.
> - Cite the actual source files for each tool, not just names.
> - The audit table is a snapshot; date-stamp it `Last reviewed: 2026-04-24`.
>
> Acceptance: file exists; renders correctly on GitHub preview; cross-referenced from `CONTRIBUTING.md`.

---

#### 4.2 — Document `get_tool_schema` as help-discovery surface

**Objective**: Add a "Tool catalogue and help discovery" section to `ARCHITECTURE.md` and a brief mention to `README.md` so future contributors understand `get_tool_schema` is the in-extension analog of `--help`.

**Prompt**:
> Gemma Code v0.5.0 agent-friendly-tools adoption — Phase 4 step 2.
>
> Document `get_tool_schema` as the help-discovery surface:
>
> 1. Add a new section to `ARCHITECTURE.md` titled `## Tool Catalogue and Help Discovery`:
>    - Explain that the agent (Gemma 4) discovers available tools via `src/tools/ToolCatalog.ts`, which produces structured schemas per tool.
>    - Each tool's schema contains: name, description (one-line purpose), parameters (with types and defaults), required-vs-optional, an invocation example.
>    - The agent can call the meta-tool `get_tool_schema(tool_name='<name>')` to retrieve a single tool's full schema; this is the runtime equivalent of `--help` per the article's Principle 5.
>    - Cite file paths.
>
> 2. Add a short paragraph to `README.md` under "Slash commands" noting that the agent itself has access to `get_tool_schema` as its help-discovery mechanism — users do not invoke it directly; the agent uses it to refresh its understanding of any tool when an error suggests it.
>
> 3. Add a one-line note to `CONTRIBUTING.md` "Adding a new tool" section (create the section if it doesn't exist) reminding contributors to:
>    - Update `src/tools/ToolCatalog.ts` with the schema (description, parameters, example).
>    - Document the tool in `docs/v0.5.0/tool-audit.md` (severity row).
>    - Add a usage hint in any error message per Phase 2's convention.
>
> Constraints:
> - Cross-link liberally between `ARCHITECTURE.md`, `README.md`, `CONTRIBUTING.md`, and `docs/v0.5.0/tool-audit.md`.
> - Keep additions concise (under 200 words each).
>
> Acceptance: all three docs updated; cross-references resolve correctly on GitHub preview.

---

#### 4.3 — Truncation-recovery golden micro-eval

**Objective**: Add a 3-task golden micro-eval at `tests/golden/tasks/agent-friendly/` where the agent is forced into the truncated output path and must use the truncation hint or pagination to recover.

**Prompt**:
> Gemma Code v0.5.0 agent-friendly-tools adoption — Phase 4 step 3.
>
> Create three new golden-task YAML files at `tests/golden/tasks/agent-friendly/`:
>
> 1. `truncation-recovery-read.yaml`:
>    - Setup: a 200 KB synthetic file (~20K lines of generated code).
>    - Question: "What does the function on line 17,500 do?"
>    - Acceptance: the agent issues `read_file(path, range_start, range_end)` after observing the truncation hint; the answer references the actual code at line 17,500.
>
> 2. `truncation-recovery-grep.yaml`:
>    - Setup: a fixture repo with > 200 matches for the pattern `TODO`.
>    - Question: "How many TODO comments mention performance?"
>    - Acceptance: the agent uses `grep_codebase(pattern='TODO', max_results=50, next_offset=...)` to page through results.
>
> 3. `dry-run-then-execute.yaml`:
>    - Setup: a fixture file at `target.txt`.
>    - Question: "Delete target.txt safely."
>    - Acceptance: the agent issues `delete_file(path='target.txt', dry_run=true)` first; verifies the size+SHA in the dry-run output looks plausible; then issues `delete_file(path='target.txt')`.
>
> Update `tests/golden/framework/run_all.py` to include the new task category. Add a baseline at `tests/golden/baselines/v0.5.0+agent-friendly.json` with the expected pass/fail.
>
> Constraints:
> - Tasks must be reproducible without network access (use local fixture files).
> - Tasks must complete within the existing per-task time budget.
> - The fixtures themselves must be checked in (or generated deterministically by a setup script in the snapshot).
>
> Tests:
> - Run `python tests/golden/framework/run_all.py --category agent-friendly` and confirm all 3 pass.
>
> Acceptance: 3 task files present; framework recognizes the category; baseline written.

---

#### 4.4 — Phase 4 testing and stabilization (final adoption gate)

**Objective**: Run the full test, lint, golden-task, and benchmark suite; verify all 8 adoption items have shipped; document the final state.

**Prompt**:
> Gemma Code v0.5.0 agent-friendly-tools adoption — Phase 4 (FINAL stabilization).
>
> Generate and run comprehensive verification for the entire adoption:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`. Fix every failure.
> 2. Run `npm run bench`. Confirm no regression > 5 ms p99 on `tool-execution`.
> 3. Run the full golden-task suite, **including the new `agent-friendly` category** (`python tests/golden/framework/run_all.py`). All 3 micro-eval tasks must pass.
> 4. Verify the cap-fire rate < 30% on the existing 24 golden tasks; the 3 new tasks should fire the cap on purpose.
> 5. Manually verify all docs render correctly (`docs/v0.5.0/tool-audit.md`, `ARCHITECTURE.md`, `README.md`, `CONTRIBUTING.md`).
> 6. Confirm all 8 adoption items have shipped:
>    - P1-1 Tool-error audit (Phase 2)
>    - P1-2 Universal byte-cap + truncation hint (Phase 1.1)
>    - P2-1 Severity rubric (Phase 4.1)
>    - P2-2 dry_run parameter (Phase 3.1)
>    - P2-3 read_file pagination (Phase 1.2)
>    - P2-4 grep_codebase pagination (Phase 1.3)
>    - P3-1 format=json (Phase 3.2)
>    - P3-2 get_tool_schema docs (Phase 4.2)
> 7. Update `CHANGELOG.md` with the agent-friendly-tools adoption entry.
> 8. Run `/generate-session-history` to document Phase 4.
> 9. Run `/update-devlog` to capture the final summary.
>
> Do not declare the adoption complete until all 8 items are landed, the 3 new golden tasks pass, no benchmark regression > 5 ms p99, and the CHANGELOG is updated.

---

### Phase 4 Exit Checklist

- [ ] `docs/v0.5.0/tool-audit.md` published with severity rubric + audit table
- [ ] `ARCHITECTURE.md` documents `get_tool_schema` as the help-discovery surface
- [ ] `README.md` mentions `get_tool_schema`
- [ ] `CONTRIBUTING.md` "Adding a new tool" section updated with the three reminders
- [ ] 3 new golden tasks at `tests/golden/tasks/agent-friendly/` pass
- [ ] Baseline written at `tests/golden/baselines/v0.5.0+agent-friendly.json`
- [ ] All 8 adoption items shipped
- [ ] No benchmark regression > 5 ms p99
- [ ] No regression on the existing 24 golden tasks
- [ ] CHANGELOG entry present
- [ ] Session history + devlog updated

---

## Definition of Done (Plan-Level)

The adoption is complete when **all** of the following hold:

1. (a) **Byte-cap + actionable errors**: every tool output ≤ 64 KB by default with a documented narrowing path; every error in `src/tools/handlers/*.ts` contains the failing parameter name + a `Usage:` hint; `tests/unit/tools/errors.test.ts` enforces the property.
2. (b) **Pagination + dry-run + json mode**: `read_file(range_start, range_end)`, `grep_codebase(max_results, next_offset)`, `run_terminal(dry_run)`, `delete_file(dry_run)`, `list_directory(format='json')`, `grep_codebase(format='json')` all work end-to-end with integration coverage.
3. **Truncation-recovery micro-eval**: 3 new golden tasks at `tests/golden/tasks/agent-friendly/` pass — proving the agent can use the truncation hint and pagination to recover.
4. The 8 in-scope adoption items are all landed.
5. No runtime network egress added by any change.
6. `CHANGELOG.md` reflects the agent-friendly-tools adoption.

---

## Out of Scope (Recorded for Future Versions)

- `--non-interactive` flag pattern — Gemma's tools are non-interactive by construction
- Stdin / `-` alias support (Principle #6) — Gemma's tool inputs are JSON
- ANSI / colour-suppression flags
- Framework-specific (Click / Cobra / clap) idiomatic refactors
- Severity-rubric CI gate that fails builds
- Streaming reads for files > 1 MB (a future enhancement noted in the tool-audit table)
- `format=json` on `read_file` and `run_terminal` — those have natural shapes that are already agent-friendly
