# Implementation Plan - v0.4.0

**Project**: Gemma Code
**Version**: 0.4.0
**Created**: 2026-04-16
**Goal**: Close every one of the 129 findings from [docs/archive/versions/v0/v0.3.0/review.md](../v0.3.0/review.md) across seven phases, ending with a stabilized v0.4.0 release tag, cleaner architecture, a regression-gated test pipeline, and ~800 LOC of dead-code removed.

## Overview

v0.4.0 is a remediation release driven entirely by the v0.3.0 codebase review (14 P0, 46 P1, 42 P2, 27 P3 = 129 findings). The plan is organized in a hybrid shape: Phase 1 resolves every P0 as a critical hotfix so the release is no longer blocked; Phases 2 through 7 are thematic (Security, Correctness, Performance, Testing, Restructuring, Simplification & Release) and each closes every remaining finding in its domain.

Every sub-task below contains a self-contained **Prompt** that can be pasted into a fresh Claude Code session. Each prompt cites the originating finding by its location in the review, names every file to modify (with `path:line` refs), lists the existing utilities to reuse, spells out acceptance criteria, and states behavior-preservation constraints where applicable. Each phase ends with a **Testing and Stabilization** sub-task that runs the full suite, investigates failures, and iterates until green, plus an **Exit Checklist** that must be satisfied before advancing to the next phase.

Success at v0.4.0 looks like: every finding in the review is resolved or explicitly deferred with an ADR; all P0 and P1 items are closed; `npm run test` + `pytest` + coverage gate + benchmark threshold gate + golden-task regression gate all pass; installer smoke passes on Windows / macOS / Linux; the VSIX is released and published, and a v0.4.0 tag exists with an updated [CHANGELOG.md](../../../../CHANGELOG.md).

## Phases at a Glance

| Phase | Title | Outcome |
|-------|-------|---------|
| 1 | Critical Hotfix (P0 Unblock) | All 14 P0 findings closed; release no longer blocked; `package.json` bumped to 0.4.0 |
| 2 | Security Hardening | 20 non-P0 security findings closed; `npm audit` + `pip audit` wired to CI |
| 3 | Correctness & Code Quality | 24 code-quality findings closed; real bugs eliminated; god-method refactors landed |
| 4 | Performance Optimization | 20 perf findings closed; benchmark thresholds tightened; hot paths instrumented |
| 5 | Testing Pipeline Completeness | 22 testing findings closed; flake eliminated; pyramid rebalanced; 80%+ coverage held |
| 6 | Restructuring (Architecture) | 17 structural recommendations landed; composition root + LLM port + guardrails seam |
| 7 | Simplification & Release | 17 simplification findings closed; ~800 LOC deleted; v0.4.0 tagged and shipped |

---

## Phase 1: Critical Hotfix (P0 Unblock)

**Goal**: Close every one of the 14 P0 findings from the review and make a release no longer blocked.
**Prerequisites**: None.
**Stability Gate**: all 14 P0 findings resolved; `npm run test` passes; `pytest` in `src/backend/` + `tests/golden/` passes; `npm audit --production` and `pip audit` report no critical / high findings; end-to-end manual smoke on Windows, macOS, Linux (open extension, send a chat message, run one tool call, confirm session saved).

### Sub-tasks

#### 1.1 - Sanitize marked output; tighten webview CSP

**Objective**: Eliminate webview XSS by running all model/tool/memory-rendered HTML through DOMPurify and removing CSS-exfiltration vectors from CSP.

**Prompt**:
> Context: Addresses review finding #1 (P0 security) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.2.
> Goal: `marked()` output must be sanitized before reaching any `innerHTML` sink in the webview, and the CSP must explicitly deny the sources currently left implicit.
> Files to modify: `src/utils/MarkdownRenderer.ts:70`, `src/panels/GemmaCodePanel.ts:137,437,501,531` (every injection site that consumes `renderMarkdown`), `src/panels/webview/index.ts:36-37` (CSP meta tag), `src/panels/webview/traceDashboard.ts:13-14` (CSP meta tag), `package.json` (add `isomorphic-dompurify` or `dompurify` as a runtime dependency).
> Acceptance criteria:
> - Every call to `renderMarkdown(...)` passes through DOMPurify sanitization before the HTML reaches the webview.
> - CSP includes explicit `img-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'`.
> - A new unit test `tests/unit/utils/MarkdownRenderer.test.ts` asserts that `<script>`, `<iframe>`, `<a href="javascript:...">`, `<details open ontoggle=...>`, and `<style>` tags in LLM-styled markdown do not survive rendering.
> - `npm run test` passes.
> Constraints:
> - Keep GFM + code-block highlighting + sanitized HTML support - users expect existing rendering to be visually identical for safe input.
> - Do not change public APIs of `MarkdownRenderer`.
> When done, run `/wrap-up-session` to document the change.

---

#### 1.2 - Restrict `run_terminal` cwd to workspace root

**Objective**: Prevent the model from executing commands outside the workspace by applying the same path-traversal guard used by filesystem tools.

**Prompt**:
> Context: Addresses review finding #2 (P0 security) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.2.
> Goal: `run_terminal` must reject any `cwd` parameter whose resolved absolute path is outside the workspace root.
> Files to modify: `src/tools/handlers/terminal.ts:80`.
> Existing utilities to reuse: `resolveWorkspacePath` from `src/tools/handlers/filesystem.ts:39` (extract into `src/tools/handlers/pathGuard.ts` and import in both places).
> Acceptance criteria:
> - `run_terminal` with `cwd: "/"` or `cwd: "C:\\Users\\..."` returns a `failResult` with a clear error message naming the workspace root.
> - `run_terminal` with `cwd: undefined` (default workspace root) and `cwd: "sub/dir"` (workspace-relative) both succeed unchanged.
> - `tests/unit/tools/handlers/terminal.test.ts` gains two new cases: absolute-path-outside-workspace (reject) and workspace-relative-subdirectory (accept).
> - `npm run test` passes.
> Constraints:
> - Preserve the existing blocklist behavior (that is hardened separately in Phase 2).
> - The resolved path check must use `realpath`-style resolution (handle symlinks).
> When done, run `/wrap-up-session`.

---

#### 1.3 - Add AFTER UPDATE FTS5 trigger to ChatHistoryStore

**Objective**: Fix silent FTS5 index corruption when messages are replaced via `INSERT OR REPLACE`.

**Prompt**:
> Context: Addresses review finding #3 (P0 correctness) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.1.
> Goal: `ChatHistoryStore` must keep its FTS5 index synchronized with the `messages` table after every write path, including REPLACE.
> Files to modify: `src/storage/ChatHistoryStore.ts:37-57` (schema + triggers) and `src/storage/ChatHistoryStore.ts:81` (write path).
> Existing utilities to reuse: the trigger pattern in `src/storage/MemoryStore.ts:60-75` and `src/storage/EpisodicMemory.ts:44-64`.
> Acceptance criteria:
> - The FTS5 schema in `ChatHistoryStore` gains a matching `AFTER UPDATE` trigger that deletes + re-inserts the FTS row.
> - Alternatively, the write path uses explicit `UPDATE ... WHERE id = ?` so the existing AFTER DELETE + AFTER INSERT trigger pair fires.
> - A regression test in `tests/unit/storage/ChatHistoryStore.test.ts` asserts that after two successive `saveMessage(id, ...)` calls with different content, a subsequent `searchMessages(newContent)` returns the row and `searchMessages(oldContent)` does not.
> - `npm run test` passes.
> Constraints:
> - Preserve all existing public method signatures.
> - Do not drop the FTS5 table; migrate in place via a schema version check.
> When done, run `/wrap-up-session`.

---

#### 1.4 - Delete dead in-degree loop in TaskDAG.hasCycle

**Objective**: Remove the self-admitted dead loop and make the Kahn's-algorithm edge-direction intent obvious to readers.

**Prompt**:
> Context: Addresses review finding #4 (P0 correctness) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.1.
> Goal: `TaskDAG.hasCycle()` must contain exactly one in-degree seed loop, with a comment clarifying that `dependents[x]` are nodes that depend on `x`.
> Files to modify: `src/orchestration/TaskDAG.ts:199-215`.
> Acceptance criteria:
> - Lines 204-211 (the no-op in-degree loop + "Actually:" comment block) are deleted.
> - Lines 213-215 remain as the sole seed loop, preceded by a one-line comment explaining edge direction.
> - `tests/unit/orchestration/TaskDAG.test.ts` continues to pass unchanged.
> - A new test case exercises `hasCycle()` on a DAG with self-loops and on a valid diamond DAG.
> - `npm run test` passes.
> Constraints: Pure refactor, no behavior change.
> When done, run `/wrap-up-session`.

---

#### 1.5 - Fix GraphQueryEngine path reconstruction

**Objective**: Stop silently dropping intermediate nodes from shortest-path query results.

**Prompt**:
> Context: Addresses review finding #5 (P0 correctness) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.1.
> Goal: `GraphQueryEngine.explainPath` must return all intermediate entities between start and end, not just the two endpoints.
> Files to modify: `src/storage/GraphQueryEngine.ts:301-309`, and `src/storage/GraphMemory.ts` (expose a public `getEntityById(id: string): Entity | null`).
> Existing utilities to reuse: the private `_getEntityById` in `GraphMemory`; promote it to public.
> Acceptance criteria:
> - `_reconstructPath` resolves intermediate nodes via `this._graphMemory.getEntityById(id)` or via a `Map<id, Entity>` populated during BFS - no more `getEntity("", undefined)` fallback.
> - A new test case in `tests/unit/storage/GraphQueryEngine.test.ts` builds a three-hop path A -> B -> C -> D and asserts `explainPath(A, D)` returns all four entities in order.
> - `npm run test` passes.
> Constraints: No change to `GraphQueryEngine` public API.
> When done, run `/wrap-up-session`.

---

#### 1.6 - Add embedding cache and FTS5 candidate filter to MemoryStore.retrieve

**Objective**: Turn the unbounded full-table embedding scan into a bounded candidate search with an in-process vector cache.

**Prompt**:
> Context: Addresses review finding #6 (P0 performance) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.3.
> Goal: `MemoryStore.searchSemantic` (and the analogous path in `EpisodicMemory.searchSemantic`) must scale linearly with the FTS5 candidate set, not with total row count.
> Files to modify: `src/storage/MemoryStore.ts:211-213, 515-534` (deserialize, cosine), `src/storage/EpisodicMemory.ts:136-138, 251-270`.
> Existing utilities to reuse: existing FTS5 query helper in the same file.
> Acceptance criteria:
> - Deserialized vectors are stored as `Float32Array` (not `Float64Array`) in a module-level `Map<id, Float32Array>` cache; the cache is invalidated on `save` / `delete` / `prune`.
> - `searchSemantic` first obtains an FTS5 candidate set (LIMIT N tunable, default 200), then loads only those vectors from cache (or from disk on cache miss) for cosine scoring.
> - The existing `retrieve()` API (keyword + semantic merge) continues to return the same top-K results for a representative fixture (assert via a regression test that adds 50 memories and checks recall@10 matches the pre-change baseline recorded in `tests/fixtures/memory-recall.json`).
> - `tests/benchmarks/memory-recall.bench.ts` shows >= 3x speedup at N=1000.
> - `npm run test` passes.
> Constraints: Preserve observable recall at top-K within +/-1 rank position.
> When done, run `/wrap-up-session`.

---

#### 1.7 - Batch tracer writes; eliminate SELECT in endSpan

**Objective**: Remove the synchronous per-span SQLite round-trip from the extension-host event loop.

**Prompt**:
> Context: Addresses review finding #7 (P0 performance) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.3.
> Goal: `Tracer` must buffer spans in memory and flush in batches inside a single `_db.transaction` call; `endSpan` must not issue a SELECT before UPDATE.
> Files to modify: `src/observability/TraceStore.ts:159-184` (startSpan), `src/observability/TraceStore.ts:201-224` (endSpan), `src/observability/Tracer.ts:78-92`.
> Acceptance criteria:
> - `startSpan` returns a handle that includes `startTime`; `endSpan` uses it directly without reading from disk.
> - A flush-policy (on `process.nextTick`, OR every 32 spans, OR on span `end` where `kind === "session"`) writes all buffered spans in one `_db.transaction`.
> - A new unit test mocks `better-sqlite3` and asserts that 100 `startSpan`/`endSpan` pairs result in <= 5 transactions.
> - `tests/unit/observability/TraceStore.test.ts` gains a test asserting spans remain queryable after buffered flush.
> - `tests/benchmarks/tool-execution.bench.ts` shows >= 3x reduction in tracer-attributable overhead.
> - `npm run test` passes.
> Constraints: Trace queries must return fully-synchronized data after `flush()`; on extension deactivation, `flush()` must run before the DB is closed.
> When done, run `/wrap-up-session`.

---

#### 1.8 - Add end-to-end safety-pipeline integration test

**Objective**: Validate the classifier -> checkpoint -> execute -> rollback path end-to-end.

**Prompt**:
> Context: Addresses review finding #8 (P0 testing) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.4.
> Goal: A new integration test wires a real `AgentLoop` + real `ToolRegistry` + real `ActionClassifier` + mocked `GitSafetyNet` (mocking only `execFile`) and verifies checkpoint is created before a DESTRUCTIVE tool and rollback fires when the tool fails.
> Files to create: `tests/integration/safety/agent-safety-pipeline.test.ts`.
> Existing utilities to reuse: existing mock factories in `tests/unit/tools/AgentLoop.test.ts`; `tests/setup.ts` for VS Code API mocks.
> Acceptance criteria:
> - A test "creates a git checkpoint before a DESTRUCTIVE tool call" passes.
> - A test "rolls back to the checkpoint when a DESTRUCTIVE tool fails" passes.
> - A test "does not create a checkpoint for a REVERSIBLE tool call" passes.
> - `npm run test:integration` passes.
> Constraints: Use `vi.spyOn(childProcess, "execFile")` to simulate git operations; do not actually write to the repo under test.
> When done, run `/wrap-up-session`.

---

#### 1.9 - Add McpToolHandler unit tests

**Objective**: Bring the currently-untested MCP tool-bridge into coverage.

**Prompt**:
> Context: Addresses review finding #9 (P0 testing) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.4.
> Goal: Cover `src/mcp/McpToolHandler.ts` with tests that verify successful invocation, error propagation, timeout behavior, and argument serialization.
> Files to create: `tests/unit/mcp/McpToolHandler.test.ts`.
> Existing utilities to reuse: existing MCP SDK mock pattern from `tests/unit/mcp/McpClient.test.ts:9-20`.
> Acceptance criteria:
> - At least four test cases: successful call returns result; client error propagates; timeout produces `failResult`; arguments serialize to the exact shape MCP expects.
> - Coverage of `McpToolHandler.ts` reaches >= 85% lines.
> - `npm run test` passes.
> Constraints: Mock the MCP SDK at the module boundary, not internal methods.
> When done, run `/wrap-up-session`.

---

#### 1.10 - Add SessionListPanel unit tests

**Objective**: Cover the session-list webview provider.

**Prompt**:
> Context: Addresses review finding #10 (P0 testing) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.4.
> Goal: Cover `src/panels/SessionListPanel.ts` with tests mirroring the shape of `tests/unit/panels/GemmaCodePanel.test.ts`.
> Files to create: `tests/unit/panels/SessionListPanel.test.ts`.
> Existing utilities to reuse: `tests/setup.ts` VS Code mocks; `ChatHistoryStore` `:memory:` constructor.
> Acceptance criteria:
> - Tests verify: HTML rendering for empty + populated session lists, click-to-load posts the right message, "New Chat" button posts the right message, session-id HTML-escaping (also gates finding #87 from Phase 2).
> - Coverage >= 80% lines.
> - `npm run test` passes.
> Constraints: Do not instantiate a live VS Code extension host; use mocked `webview.postMessage`.
> When done, run `/wrap-up-session`.

---

#### 1.11 - Wire benchmark threshold gating in nightly.yml

**Objective**: Make performance regressions fail nightly CI instead of silently archiving output.

**Prompt**:
> Context: Addresses review finding #11 (P0 testing) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.4.
> Goal: Each `bench()` block in `tests/benchmarks/*` must have explicit p50 / p99 thresholds; nightly CI must fail on > 20% regression vs. a checked-in baseline.
> Files to modify: `tests/benchmarks/time-to-first-token.bench.ts` and the 7 other bench files; `.github/workflows/nightly.yml:85-107`; create `tests/benchmarks/baselines/v0.3.0.json`.
> Existing utilities to reuse: `detectRegressions` function from `src/observability/GoldenTaskSuite.ts:159`.
> Acceptance criteria:
> - Every `bench()` block has a `.todo` thresholds object (p50, p99) that is checked post-run.
> - A new workflow step runs `node scripts/check-bench-regressions.mjs` which loads the baseline, compares, and exits non-zero on > 20% regression.
> - Baseline is created by running benches once on main and committing the JSON.
> - Nightly runs fail-red when a synthetic +50% regression is introduced, and green when thresholds are met (add a smoke test of the script).
> Constraints: Do not block PR CI on benchmarks; keep them nightly-only.
> When done, run `/wrap-up-session`.

---

#### 1.12 - Wire golden-task live-Ollama CI job

**Objective**: Make the 24 golden tasks run against a live Gemma-4 Ollama and fail on regression vs. baselines.

**Prompt**:
> Context: Addresses review finding #12 (P0 testing) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.4.
> Goal: `.github/workflows/golden-tasks.yml` must execute `tests/golden/framework/task_runner.py` against a live Ollama instance and fail on regression vs. `tests/golden/baselines/v0.3.0-{e2b,e4b}.json`.
> Files to modify: `.github/workflows/golden-tasks.yml:55`; `tests/golden/framework/` (add a `run_all.py` harness if not present).
> Existing utilities to reuse: `framework/task_runner.py`, `framework/evaluator.py`, `framework/regression.py`, `framework/reporter.py`.
> Acceptance criteria:
> - Workflow runs `ollama pull gemma4:e2b`, starts ollama, runs task_runner for all 24 tasks, writes results JSON, diffs against baseline.
> - Fails on any task whose `pass_rate` drops by more than 10% vs baseline, OR whose `time_ms` grows by more than 30%, OR whose `tokens` grow by more than 20%.
> - Matrix includes both `e2b` and `e4b` tiers with their respective baselines.
> - A Markdown regression report is uploaded as an artifact.
> Constraints: Keep the job weekly (Sunday cron) + workflow_dispatch; do not run on every commit.
> When done, run `/wrap-up-session`.

---

#### 1.13 - Record Python backend disposition (ADR-0001) and remove unused backend wiring

**Objective**: End the "dead child process spawned at activation" problem by deleting the orphaned Python backend.

**Prompt**:
> Context: Addresses review finding #13 (P0 restructuring) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.5 (6a P1 / 6b P0). A full restructuring decision was made during plan approval: delete the Python backend because no TS consumer ever reads `baseUrl`.
> Goal: Delete `src/backend/`, remove all BackendManager wiring, and record the decision as ADR-0001.
> Files to create: `docs/adr/0001-python-backend-disposition.md`.
> Files to delete: `src/backend/` (entire tree: `BackendManager.ts`, `src/backend/src/backend/**`, `src/backend/tests/**`, `src/backend/pyproject.toml`, `src/backend/.venv` if present).
> Files to modify: `src/extension.ts:70-92` (remove BackendManager instantiation + start call), `src/config/settings.ts:24-26, 66-68` (remove `useBackend`, `backendPort`, `pythonPath`), `package.json:192-206` (remove backend-related configuration properties), `.github/workflows/ci.yml` (remove `lint-py`, `test-py` jobs for backend), `.github/workflows/nightly.yml` (remove `integration-py` backend jobs), `scripts/installer/pyqt/src/gemma_installer/engine/venv_installer.py` (remove or make no-op).
> Acceptance criteria:
> - `git grep -l "BackendManager"` returns nothing under `src/`.
> - `npm run build` succeeds.
> - `npm run test` passes (any test that imported from backend is updated or removed).
> - The ADR follows MADR format: Title / Status / Context / Decision / Consequences / Alternatives.
> - Release note in `CHANGELOG.md` documents the removal clearly for users who had `useBackend: true`.
> Constraints: Do not remove `scripts/installer/pyqt/` entirely - only the venv-install step. Installer keeps working.
> When done, run `/wrap-up-session`.

---

#### 1.14 - Begin GemmaCodePanel split: extract MemorySubsystem factory

**Objective**: Land the first (lowest-risk) slice of the god-object refactor: a factory that owns the 4-layer memory wiring.

**Prompt**:
> Context: Addresses review finding #14 (P0 restructuring) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.5 (6b P0). Full split completes in Phase 6; this is the smallest-blast-radius first slice.
> Goal: Extract the memory-wiring from `GemmaCodePanel` constructor into `src/storage/MemorySubsystem.ts`.
> Files to modify: `src/panels/GemmaCodePanel.ts` (remove ~90 lines of inline memory wiring around lines 1150-1230), add `src/storage/MemorySubsystem.ts` that constructs `MemoryStore`, `WorkingMemory`, `EpisodicMemory`, `GraphMemory`, `EntityExtractor`, `GraphQueryEngine`, `MemoryConsolidator`, `UnifiedMemoryRetriever`, `EmbeddingClient` in one place and exposes them as read-only fields.
> Acceptance criteria:
> - `GemmaCodePanel` instantiates `new MemorySubsystem({ dbPath, embeddingModel, ollamaUrl })` once and reads layer references from it.
> - All existing tests pass unchanged.
> - The MemorySubsystem factory is independently unit-tested: `tests/unit/storage/MemorySubsystem.test.ts`.
> - `GemmaCodePanel.ts` line count drops by at least 80 lines.
> Constraints: Pure move; no behavior change; no new deps.
> When done, run `/wrap-up-session`.

---

#### 1.15 - Version bump, CHANGELOG update, model-name default alignment

**Objective**: Eliminate the `package.json` / docs version drift identified in review finding 6f P1.

**Prompt**:
> Context: Addresses review finding #50 (P1 restructuring) - promoted into Phase 1 because it is a 10-minute change that unblocks the release tag.
> Goal: `package.json` version = `0.4.0`; `modelName` default matches across manifest and settings; `CHANGELOG.md` has a v0.4.0 section seeded.
> Files to modify: `package.json:5` (`"version": "0.4.0"`), `package.json:93` (confirm `gemma4:e4b` default matches `src/config/settings.ts:51`), `CHANGELOG.md` (add v0.4.0 Unreleased section with a top-level summary).
> Acceptance criteria:
> - `package.json` version is exactly `"0.4.0"`.
> - `gemma-code.modelName` default and `DEFAULT_MODEL` constant in `settings.ts` are identical strings.
> - `CHANGELOG.md` has a `## [0.4.0] - Unreleased` heading with subsections for each phase that will be filled in as phases complete.
> Constraints: Do not tag the release yet - that happens in Phase 7.
> When done, run `/wrap-up-session`.

---

#### 1.16 - Testing and Stabilization

**Objective**: Run every test, resolve every failure, and verify all Phase 1 exit criteria.

**Prompt**:
> Generate and run comprehensive tests for every change made in Phase 1. Run:
> - `npm run lint`
> - `npm run build`
> - `npm run test` (unit + integration, must hit >= 80% line / 75% branch coverage)
> - `cd src/backend && uv run pytest` (only if backend was not deleted in 1.13)
> - `cd tests/golden && pytest -q` (framework tests only, non-live)
> - `npm audit --production` and `pip audit` (in `tests/golden/` venv)
> Fix every failure and iterate until green. If any P0 finding regressed, return to its sub-task, do not advance. Once green, run `/generate-session-history` to document Phase 1.

---

### Phase 1 Exit Checklist

- [ ] All 14 P0 sub-tasks (1.1-1.14) completed
- [ ] Version bump + CHANGELOG seed (1.15) completed
- [ ] `npm run test` green
- [ ] `pytest` green (golden framework)
- [ ] `npm audit --production` clean (no critical/high)
- [ ] `pip audit` clean (no critical/high)
- [ ] Manual smoke test passed on Windows, macOS, Linux
- [ ] Coverage held >= 80% / 75%
- [ ] Benchmark baseline file committed
- [ ] Golden-task baseline files committed
- [ ] ADR-0001 written and reviewed
- [ ] `/generate-session-history` run
- [ ] Ready to advance to Phase 2

---

## Phase 2: Security Hardening

**Goal**: Close every non-P0 security finding (20 items: 6 P1 + 9 P2 + 5 P3) and wire dependency auditing into CI.
**Prerequisites**: Phase 1 complete (marked sanitization and terminal cwd guard already in place).
**Stability Gate**: `security-reviewer` agent re-run reports only P3 or lower; `npm audit --production` and `pip audit` are CI-enforced.

### Sub-tasks

#### 2.1 - Replace hostname-string SSRF check with DNS resolution

**Objective**: Block DNS-rebinding and redirect-based SSRF bypasses in `fetch_page`.

**Prompt**:
> Context: Addresses review finding #22 (P1 security) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.2.
> Goal: `isSsrfBlocked` must resolve hostnames via `dns.lookup({ family: 0 })` and check every resolved IP against private/loopback/link-local ranges; every `fetch` call must use `redirect: "manual"` and re-validate on each redirect.
> Files to modify: `src/tools/handlers/webSearch.ts:32-78, 187`.
> Acceptance criteria:
> - `isSsrfBlocked("http://127.example.com")` (wildcard DNS to loopback) returns `true`.
> - `FetchPageTool` following a redirect to `http://169.254.169.254/` returns `failResult` with a clear error.
> - New test cases in `tests/unit/tools/handlers/webSearch.test.ts` cover: DNS rebinding, link-local, redirect to loopback, IPv6 loopback `::1`.
> - `npm run test` passes.
> Constraints: Do not add a network round-trip for every request; cache DNS results for the lifetime of one request. Preserve happy-path performance.
> When done, run `/wrap-up-session`.

---

#### 2.2 - Add per-session auth + CORS to FastAPI backend (or skip if backend deleted)

**Objective**: If the Python backend is retained (ADR-0001 decision), give it a per-session token and a deny-all CORS policy.

**Prompt**:
> Context: Addresses review finding #23 (P1 security). Only applies if Phase 1 sub-task 1.13 kept the Python backend (alternative path of the ADR). If the backend was deleted, close this sub-task as N/A.
> Goal: FastAPI must require a `X-Gemma-Auth` header whose value matches an environment variable set by the extension at spawn time; CORS must reject all non-null origins.
> Files to modify: `src/backend/src/backend/main.py:28-54`, `src/backend/src/backend/dependencies.py` (add auth dependency), `src/backend/BackendManager.ts` (pass a random token via env).
> Acceptance criteria:
> - Any request without the header returns 401.
> - Any request with non-null `Origin` returns 403.
> - The extension generates a fresh token on every backend start and sends it on every request.
> - `tests/integration/test_auth.py` asserts both behaviors.
> Constraints: The token lifecycle matches the backend process lifecycle; no persistence.
> When done, run `/wrap-up-session`.

---

#### 2.3 - Replace shell blocklist with allowlist + always-confirm

**Objective**: Convert `run_terminal` from "reject a hand-curated blacklist" to "accept only an explicit list of safe commands, confirm everything else."

**Prompt**:
> Context: Addresses review finding #24 (P1 security) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.2.
> Goal: Replace `BLOCKED_PATTERNS` with an `ALLOWED_COMMANDS` allowlist (first word of command + permitted args pattern). Everything not matching the allowlist requires user confirmation regardless of `editMode === "auto"`.
> Files to modify: `src/tools/handlers/terminal.ts:16-47, 80`.
> Acceptance criteria:
> - `ALLOWED_COMMANDS` contains a curated set (starting list: `git`, `npm`, `pnpm`, `yarn`, `node`, `python`, `python3`, `pytest`, `cargo`, `go`, `make`, `ls`, `cat`, `echo`, `pwd`) with per-command argument validators.
> - Any other command in `auto` mode still prompts via `ConfirmationGate`.
> - The old substring blocklist is kept as defense-in-depth inside the fallback path but documented as advisory.
> - `tests/unit/tools/handlers/terminal.test.ts` covers: allowed command runs without prompt; disallowed command prompts in auto mode; previously-bypassable patterns (double spaces, `/bin/rm -rf /`) are caught by the fallback check.
> Constraints: Does not change the P0 cwd fix from 1.2.
> When done, run `/wrap-up-session`.

---

#### 2.4 - Prompt before workspace-local mcp.json; drop env inheritance; Zod schema

**Objective**: Stop opening a hostile repo from silently spawning its MCP binaries with all of the user's secrets.

**Prompt**:
> Context: Addresses review findings #25 and #27 (P1 security) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.2.
> Goal: Loading a workspace-local `.gemma-code/mcp.json` requires explicit user confirmation; spawned MCP subprocesses receive only a whitelisted env; the config file is parsed through a Zod schema.
> Files to modify: `src/mcp/McpManager.ts:131-156` (confirm + schema), `src/mcp/McpClient.ts:52-62` (drop `process.env` inheritance), `package.json` (add `zod` as a runtime dep if not already present).
> Acceptance criteria:
> - On first sight of a workspace-local `.gemma-code/mcp.json`, the user sees a VS Code modal listing the commands + args and must approve or decline.
> - Approved configs are remembered in `context.workspaceState` keyed by workspace folder.
> - Zod schema validates: `name` (1-64 chars), `command` (absolute path OR PATH-resolvable), `args` (string array), `env` (whitelisted keys only), `transport` ("stdio" literal).
> - Subprocesses receive only `PATH`, `HOME`, `USERPROFILE`, `APPDATA` plus any keys explicitly listed in config `env`.
> - Unit tests cover: malformed JSON, schema violation, approved config, declined config, env-whitelist behavior.
> Constraints: Global `~/.gemma-code/mcp.json` is still loaded without confirmation (the user explicitly placed it).
> When done, run `/wrap-up-session`.

---

#### 2.5 - Add fetch timeout, SSRF check, auth-warning to OtlpExporter

**Objective**: Prevent OTLP exporter from being a DoS vector or a credential leak to an attacker-chosen endpoint.

**Prompt**:
> Context: Addresses review finding #26 (P1 security) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.2.
> Goal: `OtlpExporter` must apply the same SSRF check used by webSearch, use `AbortSignal.timeout(10_000)` on the fetch, and warn on startup if `otlpHeaders` includes an `Authorization` entry.
> Files to modify: `src/observability/OtlpExporter.ts:93-113, 196-213`, `src/config/settings.ts:85-86`.
> Existing utilities to reuse: the SSRF check extracted in 2.1 (move to `src/utils/ssrf.ts`).
> Acceptance criteria:
> - `new OtlpExporter({ endpoint: "http://127.0.0.1:11434/..." })` throws / rejects at construction.
> - Fetch timeouts after 10s with a clear error; trace flush does not hang indefinitely.
> - A `console.warn` (routed through the new logger utility from Phase 6) fires when `Authorization` headers are configured.
> - Unit tests for all three behaviors.
> Constraints: Default behavior (disabled OTLP) must remain fully silent.
> When done, run `/wrap-up-session`.

---

#### 2.6 - Add ReDoS defense for GrepCodebaseTool

**Objective**: Eliminate extension-host hangs from catastrophic regex backtracking.

**Prompt**:
> Context: Addresses review finding #75 (P2 security) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.2.
> Goal: User-supplied regex in `grep_codebase` must either use the linear-time `re2` engine or execute under a worker-thread timeout.
> Files to modify: `src/tools/handlers/filesystem.ts:529, 538`, `src/tools/OutputRedirector.ts:77`, `package.json` (add `re2` dep; verify binary availability on all platforms).
> Acceptance criteria:
> - Pattern `(a+)+b` applied to a 10 KB input returns within 100 ms (failing fast) rather than hanging.
> - Patterns with known dangerous constructs are rejected with a clear error.
> - `tests/unit/tools/handlers/filesystem.test.ts` includes a ReDoS test case.
> Constraints: If `re2` binary is not available on a platform, fall back to a 500 ms worker-thread timeout rather than silently using native `RegExp`.
> When done, run `/wrap-up-session`.

---

#### 2.7 - Secret-path denylist for file/grep/list tools

**Objective**: Prevent the model from reading `.env`, private keys, and `~/.aws/` by default.

**Prompt**:
> Context: Addresses review finding #76 (P2 security).
> Goal: `ReadFileTool`, `ListDirectoryTool`, `GrepCodebaseTool` must reject paths matching a denylist by default; users can override per-call via an `allow_secrets: true` flag that triggers a confirmation prompt.
> Files to modify: `src/tools/handlers/filesystem.ts:35-43, 523-550`, and new file `src/tools/handlers/secretPaths.ts`.
> Acceptance criteria:
> - Denylist includes `**/.env*`, `**/id_rsa*`, `**/id_ed25519*`, `**/*.pem`, `**/*.key`, `**/credentials*`, `**/.aws/**`, `**/.ssh/**`, `**/secrets/**`, `**/.gemma-code/mcp.json`.
> - A file matched by the denylist returns a `failResult` unless `allow_secrets === true`.
> - With `allow_secrets === true`, a `ConfirmationGate` prompt is raised regardless of edit mode.
> - Test cases for each category.
> Constraints: The denylist must be overridable in VS Code settings (add `gemma-code.secretPathDenyExtra: string[]`).
> When done, run `/wrap-up-session`.

---

#### 2.8 - HTML-escape attribute contexts in webview templates

**Objective**: Close the defense-in-depth gap where session-id / span-id fields are interpolated unescaped.

**Prompt**:
> Context: Addresses review finding #77 (P2 security).
> Goal: Every attribute-context interpolation in `SessionListPanel` and `traceDashboard` webview uses a dedicated `escapeAttr` helper; prefer `document.createElement` + `setAttribute` / `textContent` over string-concatenated `innerHTML` where practical.
> Files to modify: `src/panels/SessionListPanel.ts:214-216`, `src/panels/webview/traceDashboard.ts:260-267, 288-297, 315-329`.
> Note: Phase 7 deletes the `escapeAttr = escapeHtml` identity alias; during Phase 2 keep or inline it.
> Acceptance criteria:
> - A test injecting an attribute-breaking value (for example an id containing `"><script>`) asserts the rendered HTML remains safe.
> - Coverage of `SessionListPanel` and `traceDashboard` template functions is >= 80%.
> Constraints: No new dependencies; use existing `escapeHtml`.
> When done, run `/wrap-up-session`.

---

#### 2.9 - Escape LIKE wildcards in chat history and graph queries

**Objective**: Eliminate DoS / accidental wildcard expansion from user-provided LIKE parameters.

**Prompt**:
> Context: Addresses review finding #78 (P2 security).
> Goal: `%`, `_`, `\` in LIKE parameters are escaped; the LIKE clause uses `ESCAPE '\\'`.
> Files to modify: `src/storage/ChatHistoryStore.ts:145, 151, 208, 211`, `src/storage/GraphMemory.ts:271-279`.
> Acceptance criteria:
> - `searchSessions("100% cpu")` matches only rows literally containing `100% cpu`.
> - `searchEntities("A_B")` matches only rows with that literal underscore.
> - Unit tests assert both.
> Constraints: No API changes.
> When done, run `/wrap-up-session`.

---

#### 2.10 - Sanitize MCP tool descriptions; validate tool-name regex

**Objective**: Prevent prompt-injection via hostile MCP server metadata.

**Prompt**:
> Context: Addresses review finding #79 (P2 security).
> Goal: Tool descriptions from MCP servers are stripped of HTML and capped at 500 chars; tool names must match `^[a-zA-Z0-9_]{1,64}$`; MCP tool metadata is rendered in a clearly-delimited prompt section.
> Files to modify: `src/mcp/McpClient.ts:71-80`, `src/mcp/McpManager.ts:60-64`, `src/chat/PromptBuilder.ts` (delimit MCP tool block).
> Acceptance criteria:
> - A server returning `<script>alert(1)</script>` description has the tags stripped before registration.
> - A server returning a tool name `../../evil` is rejected.
> - System prompt clearly separates MCP tools under a `## External MCP tools` heading that cannot be confused with built-in tool instructions.
> Constraints: Do not drop legitimate unicode in descriptions.
> When done, run `/wrap-up-session`.

---

#### 2.11 - Validate pythonPath before spawn

**Objective**: Prevent a poisoned `.vscode/settings.json` from spawning an attacker-controlled binary.

**Prompt**:
> Context: Addresses review finding #80 (P2 security).
> Goal: `BackendManager` (if retained) or `pythonPath` consumers must verify the resolved path is absolute and the file exists before spawning; non-default values prompt the user on first use.
> Files to modify: `src/extension.ts:71-77`, `src/backend/BackendManager.ts:59-63` (if backend retained).
> Acceptance criteria:
> - Relative paths are resolved via `which`/`where` equivalent; non-existent paths fail at startup with a clear error.
> - First non-default `pythonPath` value triggers `vscode.window.showWarningMessage` asking the user to confirm.
> Constraints: If backend was deleted in 1.13, mark this sub-task N/A.
> When done, run `/wrap-up-session`.

---

#### 2.12 - Sanitize web_search results; add rate limit

**Objective**: Prevent prompt-injection chains from untrusted search snippets and limit request volume.

**Prompt**:
> Context: Addresses review finding #81 (P2 security).
> Goal: `title` / `snippet` are stripped of HTML and capped at 300 chars each; a per-session sliding-window rate limit (default 10 searches / minute) throttles the tool.
> Files to modify: `src/tools/handlers/webSearch.ts:120-169`.
> Acceptance criteria:
> - A 429 response or local rate-limit exceedance returns `failResult` with the wait time.
> - HTML in titles/snippets is stripped.
> Constraints: Rate-limit counter resets when a new session starts.
> When done, run `/wrap-up-session`.

---

#### 2.13 - Generic HTTPException detail in FastAPI (if backend retained)

**Objective**: Stop leaking stack traces in HTTP error responses.

**Prompt**:
> Context: Addresses review finding #82 (P2 security). N/A if backend deleted.
> Goal: `/models` and other routes return a generic user-facing detail; internal error is logged server-side only.
> Files to modify: `src/backend/src/backend/routers/models.py:19`, other routers that use `str(exc)` directly.
> Acceptance criteria: Response body contains no filesystem paths or module names.
> Constraints: Log at WARNING level with full context for debugging.
> When done, run `/wrap-up-session`.

---

#### 2.14 - Set restrictive SQLite DB permissions

**Objective**: Close file-perm leak on multi-user POSIX systems.

**Prompt**:
> Context: Addresses review finding #121 (P3 security).
> Goal: After opening each SQLite DB (chat history, memory, traces, graph, episodic), set mode `0600` on POSIX; on Windows document the ACL approach in `SECURITY.md`.
> Files to modify: `src/storage/ChatHistoryStore.ts:22-26`, `src/storage/MemoryStore.ts:34-39`, `src/observability/TraceStore.ts` constructor, `src/storage/EpisodicMemory.ts`, `src/storage/GraphMemory.ts`, `SECURITY.md`.
> Acceptance criteria:
> - `stat -c '%a' <db>` returns `600` on Linux after extension activation.
> - `SECURITY.md` has a "File permissions" section.
> Constraints: No effect on Windows (file APIs differ); document instead.
> When done, run `/wrap-up-session`.

---

#### 2.15 - Installer: pin Ollama release, verify checksum + signature

**Objective**: Close the supply-chain gap in the Ollama downloader.

**Prompt**:
> Context: Addresses review finding #122 (P3 security).
> Goal: `OllamaInstaller` fetches a pinned tag (e.g., `v0.3.6`), downloads the corresponding `.sha256`, verifies before executing. On Windows, additionally verify Authenticode via `Get-AuthenticodeSignature`.
> Files to modify: `scripts/installer/pyqt/src/gemma_installer/engine/ollama_installer.py:50-78`.
> Acceptance criteria:
> - Hash mismatch aborts installation.
> - On Windows, unsigned or untrusted-signer aborts installation.
> - Unit tests simulate hash mismatch and Authenticode failure.
> Constraints: Tag must be documented in `scripts/installer/pyqt/VERSIONS.md` (new file) and updated via a documented process.
> When done, run `/wrap-up-session`.

---

#### 2.16 - Installer: replace `curl | sh` with download-verify-execute

**Objective**: Eliminate the classic supply-chain-compromise pattern in the Linux installer path.

**Prompt**:
> Context: Addresses review finding #123 (P3 security).
> Goal: On Linux, download the Ollama install script to a temp file, verify against a pinned sha256, then execute.
> Files to modify: `scripts/installer/pyqt/src/gemma_installer/engine/ollama_installer.py:100-109`.
> Acceptance criteria: Hash-mismatch aborts; successful hash runs the script as before.
> Constraints: Temp file is deleted after execution (success or failure).
> When done, run `/wrap-up-session`.

---

#### 2.17 - Log MemoryStore caught exceptions at debug level

**Objective**: Close the silent-exception blind spot in FTS / cosine code paths.

**Prompt**:
> Context: Addresses review finding #124 (P3 security / observability).
> Goal: Every `try { ... } catch { return [] }` in memory code logs the exception at debug level and distinguishes "empty query" from "SQL error".
> Files to modify: `src/storage/MemoryStore.ts:195-197, 418-421, 546`.
> Existing utilities to reuse: the logger from Phase 6 if already landed; otherwise use `console.debug` with a `TODO: migrate to logger` comment.
> Acceptance criteria: Every silent swallow has a debug log line; tests mock the logger and assert it was called on error.
> Constraints: Default log level (`warning`) still drops these messages; only DEBUG shows them.
> When done, run `/wrap-up-session`.

---

#### 2.18 - Tighten CSP on all webview hosts

**Objective**: Explicitly deny every non-essential source type.

**Prompt**:
> Context: Addresses review finding #125 (P3 security).
> Goal: Both webview hosts include the full explicit CSP directive set.
> Files to modify: `src/panels/webview/index.ts:36-37`, `src/panels/webview/traceDashboard.ts:13-14`.
> Acceptance criteria: CSP includes `img-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'`.
> Constraints: If future features legitimately need an image source, add it explicitly here rather than relaxing the default.
> When done, run `/wrap-up-session`.

---

#### 2.19 - Add npm audit + pip audit to CI

**Objective**: Surface transitive CVEs as early as commit-time.

**Prompt**:
> Context: Addresses review finding (dep audit gap) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.2.
> Goal: `.github/workflows/ci.yml` runs `npm audit --production --audit-level=high` and fails on findings; runs `pip audit` (via a uv-managed tool invocation) against `tests/golden/` venv.
> Files to modify: `.github/workflows/ci.yml` (new `audit-ts` and `audit-py` jobs).
> Acceptance criteria: Fresh clone CI run is green; deliberately inserting a vulnerable dep (test in a branch) turns CI red.
> Constraints: Cache the audit advisory DB between runs.
> When done, run `/wrap-up-session`.

---

#### 2.20 - Testing and Stabilization

**Prompt**:
> Run `npm run test`, `npm run lint`, `npm audit --production`, `pip audit`. Optionally re-spawn the `security-reviewer` agent against the current branch and confirm no new P0 or P1 findings. Fix every failure and iterate until green. Run `/generate-session-history` for Phase 2.

---

### Phase 2 Exit Checklist

- [ ] All 20 sub-tasks completed (2.1-2.19, 2.20 stabilization)
- [ ] Security re-review shows no new P0 / P1
- [ ] `npm audit --production` clean in CI
- [ ] `pip audit` clean in CI
- [ ] `SECURITY.md` updated with file-perm and installer guidance
- [ ] `/generate-session-history` run
- [ ] Ready to advance to Phase 3

---

## Phase 3: Correctness and Code Quality

**Goal**: Close 24 remaining code-quality findings (8 P1 + 10 P2 + 6 P3). Fix genuine bugs, break up god-methods, deduplicate.
**Prerequisites**: Phase 2 complete.
**Stability Gate**: `npm run lint` clean; `npm run test` green; `code-reviewer` agent re-run reports only P3 or lower.

### Sub-tasks

#### 3.1 - Fix GitSafetyNet inverted diff check

**Prompt**:
> Context: Addresses finding #15 (P1 correctness) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.1.
> Goal: `commitAgentChanges` must commit only when there are staged changes (exit code 1 from `git diff --cached --quiet`).
> Files to modify: `src/safety/GitSafetyNet.ts:64-67, 107-110`.
> Acceptance criteria: New integration test calls `commitAgentChanges` twice in a row; exactly one commit is created. Comment reflects correct semantics.
> Constraints: Do not change the `_git` helper's null-on-non-zero behavior - other callers rely on it.
> When done, run `/wrap-up-session`.

---

#### 3.2 - Remove double-confirmation for file-edit tools

**Prompt**:
> Context: Addresses finding #16 (P1 correctness) in `docs/archive/versions/v0/v0.3.0/review.md` section 3.1.
> Goal: File-edit confirmation happens exactly once, in `ToolRegistry.execute`.
> Files to modify: `src/tools/handlers/filesystem.ts:175-192, 248-258, 362-373` (remove per-tool ConfirmationGate calls), `src/tools/ToolRegistry.ts:93-107` (pass `editMode` + diff to the gate).
> Existing utilities to reuse: `ConfirmationGate.request`.
> Acceptance criteria: Single confirmation card per file edit in `ask` mode; existing tests for filesystem tools updated; new test asserts exactly one prompt fires.
> Constraints: Diff preview must still reach the confirmation card.
> When done, run `/wrap-up-session`.

---

#### 3.3 - Remove unregistered tools from catalog

**Prompt**:
> Context: Addresses finding #17 (P1 correctness).
> Goal: Remove `tail_output`, `grep_output`, `get_tool_schema` from `TOOL_CATALOG` since they are not wired. `LazyToolLoader` deletion happens in Phase 7; here we just stop lying to the model.
> Files to modify: `src/tools/ToolCatalog.ts:114-138`.
> Acceptance criteria: System prompt no longer advertises these three tools; existing prompt snapshot tests are updated.
> Constraints: Keep the catalog structure so Phase 7 can cleanly delete the referenced classes.
> When done, run `/wrap-up-session`.

---

#### 3.4 - Wire BudgetMiddleware.recordTurnTokens

**Prompt**:
> Context: Addresses finding #18 (P1 correctness).
> Goal: Session-token budgeting actually fires.
> Files to modify: `src/tools/AgentLoop.ts:167-182, 354` (add `this._budgetMiddleware?.recordTurnTokens(estimateTokens(accumulated))` after streaming completes); `src/tools/BudgetMiddleware.ts:40-54`.
> Acceptance criteria: A new test asserts that after N turns whose accumulated tokens exceed `maxSessionTokens`, `checkPreTurn` returns `{ halt: true }` and `run` exits the loop.
> Constraints: No behavior change when `_budgetMiddleware` is undefined.
> When done, run `/wrap-up-session`.

---

#### 3.5 - Remove BudgetEnforcer AgentLoop branches

**Prompt**:
> Context: Addresses finding #19 (P1 correctness). Full class deletion is in Phase 7; this sub-task cleans up the in-place branches in AgentLoop now so later work is simpler.
> Goal: Remove all `if (this._budgetEnforcer)` branches from AgentLoop and the optional field.
> Files to modify: `src/tools/AgentLoop.ts:14, 35, 54, 79, 185-190, 335, 434`.
> Acceptance criteria: No `_budgetEnforcer` references remain in `AgentLoop.ts`; tests pass.
> Constraints: Preserve `BudgetMiddleware` behavior; do not yet delete `src/safety/BudgetEnforcer.ts` (Phase 7).
> When done, run `/wrap-up-session`.

---

#### 3.6 - Remove ConversationSync try/catch blocks

**Prompt**:
> Context: Addresses finding #20 (P1 correctness). Class deletion is Phase 7.
> Goal: Remove the four try/catch blocks and the optional `_sync` parameter from `ConversationManager` now, so Phase 7 can delete the class cleanly.
> Files to modify: `src/chat/ConversationManager.ts:22, 87-93, 127-133, 164-170, 185-191`.
> Acceptance criteria: `ConversationManager` constructor takes only the two used parameters; no `_sync` references remain; tests pass.
> Constraints: Class file `src/storage/ConversationSync.ts` stays (deleted in Phase 7).
> When done, run `/wrap-up-session`.

---

#### 3.7 - Extract embedding utilities

**Prompt**:
> Context: Addresses finding #51 (P2 CQ) - duplicated cosine/deserialize/sanitizeFts across three files.
> Goal: Create `src/storage/embeddingUtils.ts` exporting `cosineSimilarity`, `deserializeEmbedding`, `serializeEmbedding`, `sanitizeFtsQuery`. Decide consistently whether cosine is `[-1, 1]` or `[0, 1]`.
> Files to modify: `src/storage/MemoryStore.ts:515-534, 537`, `src/storage/EpisodicMemory.ts:251-272`, `src/chat/RelevanceScorer.ts:156-170`, `src/storage/ChatHistoryStore.ts:173`.
> Acceptance criteria: All three classes import from the shared util; one canonical cosine range; new unit test file covers the utility.
> Constraints: Preserve each existing caller's output exactly (may require a thin adapter for the scorer).
> When done, run `/wrap-up-session`.

---

#### 3.8 - Extract FTS5 trigger helper

**Prompt**:
> Context: Addresses finding #52 (P2 CQ).
> Goal: `createFtsTableAndTriggers(db, tableName, contentTable, columns)` in `src/storage/sqliteFts.ts`; all three FTS tables use it.
> Files to modify: `src/storage/MemoryStore.ts:60-75`, `src/storage/EpisodicMemory.ts:44-64`, `src/storage/ChatHistoryStore.ts:46-56`.
> Acceptance criteria: Identical schema produced by each caller; regression test confirms FTS round-trip.
> Constraints: Homogenize trigger sets (all three get INSERT / UPDATE / DELETE).
> When done, run `/wrap-up-session`.

---

#### 3.9 - Extend Gemma4 tool-format grammar for nested JSON

**Prompt**:
> Context: Addresses finding #53 (P2 CQ).
> Goal: `parseToolCall` must accept object and array values: `key:{...}`, `key:[...]`.
> Files to modify: `src/tools/Gemma4ToolFormat.ts:31, 56-84`.
> Acceptance criteria: A tool call with a nested object argument (e.g., MCP tool with `filter: { status: "active" }`) round-trips correctly; existing tests still pass.
> Constraints: If implementation complexity is high, document the limitation prominently in `serializeToolDefinitions` and return to this as a Phase 4 follow-up.
> When done, run `/wrap-up-session`.

---

#### 3.10 - Split AgentLoop.run into smaller methods

**Prompt**:
> Context: Addresses finding #54 (P2 CQ).
> Goal: `AgentLoop.run` is under 80 lines; helper methods `runOneIteration(iter)` and `runToolCall(call, iterSpanId)` encapsulate per-iteration and per-tool logic.
> Files to modify: `src/tools/AgentLoop.ts:127-393`.
> Acceptance criteria: All existing AgentLoop tests pass unchanged; new test cases cover the two helpers in isolation.
> Constraints: Pure refactor; observable behavior identical.
> When done, run `/wrap-up-session`.

---

#### 3.11 - Dedupe _buildBaseInstructions shared blocks

**Prompt**:
> Context: Addresses finding #55 (P2 CQ).
> Goal: `SHARED_TOOL_USE_BLOCK` + `SHARED_PATH_RULE` constants; `_buildBaseInstructions` composes them with an identity line.
> Files to modify: `src/chat/PromptBuilder.ts:176-217`.
> Acceptance criteria: Output for each prompt style is byte-identical to pre-refactor (snapshot test).
> Constraints: Pure refactor.
> When done, run `/wrap-up-session`.

---

#### 3.12 - Extract ComplexityClassifier

**Prompt**:
> Context: Addresses finding #56 (P2 CQ).
> Goal: `Orchestrator.shouldUseOrchestrator` delegates to `ComplexityClassifier.classify(text): { complex: boolean, reason: string }`.
> Files to create: `src/orchestration/ComplexityClassifier.ts`.
> Files to modify: `src/orchestration/Orchestrator.ts:49-77, 223-240`.
> Acceptance criteria: The classifier is injectable; unit tests cover single-line refactor, multi-line complex task, and boundary length cases.
> Constraints: Default behavior matches today's heuristic.
> When done, run `/wrap-up-session`.

---

#### 3.13 - Fix MemoryConsolidator unreachable user_requested branch

**Prompt**:
> Context: Addresses finding #57 (P2 CQ).
> Goal: Remove `"user_requested"` from `WritePolicy` union, OR extend `DetectedPattern` with `provenance.source` and persist when source is user-stated.
> Files to modify: `src/storage/MemoryConsolidator.ts:207-221`.
> Acceptance criteria: Either (a) the enum no longer has a dead value and UI surfaces are updated, or (b) a test covering user-stated provenance asserts persistence happens.
> Constraints: Pick one path; document in the file header.
> When done, run `/wrap-up-session`.

---

#### 3.14 - Harden GrepCodebaseTool regex safety

**Prompt**:
> Context: Addresses finding #58 (P2 CQ). ReDoS is separately addressed in 2.6.
> Goal: Wrap `new RegExp(p.pattern)` in try/catch; expose optional `case_insensitive` flag.
> Files to modify: `src/tools/handlers/filesystem.ts:529`.
> Acceptance criteria: Invalid regex returns `failResult`; `case_insensitive: true` exercises the `i` flag; tests cover both.
> Constraints: No change to happy-path behavior.
> When done, run `/wrap-up-session`.

---

#### 3.15 - Fix EntityExtractor occurrences tracking

**Prompt**:
> Context: Addresses finding #59 (P2 CQ).
> Goal: Entities with multiple occurrences in text retain all `{start, end}` positions; relation extraction filters by position, not `sentence.includes(name)`.
> Files to modify: `src/storage/EntityExtractor.ts:44-54, 167-170`.
> Acceptance criteria: A doc with one occurrence of entity E in sentence S1 no longer produces spurious relations in S2; a doc with multiple occurrences captures all of them.
> Constraints: Persisted entity schema is unchanged; only in-memory representation gains occurrences.
> When done, run `/wrap-up-session`.

---

#### 3.16 - Fix TraceDashboardPanel randomUUID import

**Prompt**:
> Context: Addresses finding #60 (P2 CQ).
> Goal: `import { randomUUID } from "crypto"` and call `randomUUID()` like every other file in the project.
> Files to modify: `src/panels/TraceDashboardPanel.ts:34`.
> Acceptance criteria: ESLint passes; tests pass.
> When done, run `/wrap-up-session`.

---

#### 3.17 - P3 sweep: unused imports, comment fixes, magic numbers

**Prompt**:
> Context: Addresses findings #98, #99, #100, #101, #102, #103 from Phase 3 P3 bucket.
> Goal: Close six P3 code-quality items in one sweep:
> 1. Remove unused `BLOCKED_PATTERNS` import in `src/safety/ActionClassifier.ts:2`.
> 2. Pass `maxTokens` into `AgentLoop` constructor; remove the `limit: 0` sentinel workaround at `src/tools/AgentLoop.ts:395-401`.
> 3. Cache `getSettings()` at class level in `GemmaCodePanel`; invalidate on `workspace.onDidChangeConfiguration` (`src/panels/GemmaCodePanel.ts:1032-1050`).
> 4. Log config-save errors to output channel in `src/panels/GemmaCodePanel.ts:909-910`.
> 5. Hoist graph magic numbers to `src/storage/constants.ts` (from `GraphQueryEngine.ts:11`, `GraphMemory.ts:254`, `filesystem.ts:527`).
> 6. Remove `buildForSubAgent` Tier-2 assumption at `src/chat/PromptBuilder.ts:92` - pass the actual tier's `contextWindow`.
> Acceptance criteria: All six items verified by tests or inspection; no lint errors; no behavior regression.
> Constraints: Each change is pure cleanup.
> When done, run `/wrap-up-session`.

---

#### 3.18 - Fix ConversationManager rebuildSystemPrompt comment

**Prompt**:
> Context: Addresses finding #104 (P3 CQ).
> Goal: Comment at `src/chat/ConversationManager.ts:49-58` matches actual reassign-not-splice behavior, OR behavior is changed to splice (whichever better reflects intent).
> Files to modify: `src/chat/ConversationManager.ts:49-58`.
> Acceptance criteria: Comment and code agree; tests pass.
> Constraints: If changing behavior to splice, assert no regression on test that exercises `rebuildSystemPrompt`.
> When done, run `/wrap-up-session`.

---

#### 3.19 - Delete getRecommendedModel safe-delete-now

**Prompt**:
> Context: From dead-code table. Unused export.
> Goal: Delete `getRecommendedModel` in `src/config/HardwareTier.ts:123-134`.
> Files to modify: `src/config/HardwareTier.ts`.
> Acceptance criteria: `git grep getRecommendedModel` returns nothing.
> When done, run `/wrap-up-session`.

---

#### 3.20 - Tracked-debt comment cleanup

**Prompt**:
> Context: Addresses the "implicit TODO/FIXME" items in the review's Phase 2 audit table.
> Goal: For each of the implicit debt comments, either (a) resolve the underlying issue now (preferred where low effort), or (b) convert to a tracked comment with format `// NOTE(v0.5): <description>` so the next version cycle has a list.
> Files to modify: `src/config/GpuDetector.ts:287`, `src/chat/ContextCompactor.ts:77, 113`, `src/observability/GoldenTaskSuite.ts:53`, `src/storage/UnifiedMemoryRetriever.ts:182, 190`.
> Acceptance criteria: No comment says "Actually:" or contradicts its own code; all remaining debt has a version-tagged note.
> When done, run `/wrap-up-session`.

---

#### 3.21 - Testing and Stabilization

**Prompt**:
> Run `npm run lint`, `npm run test`. Optionally re-spawn the `code-reviewer` agent; no new P0 / P1 should appear. Fix every failure and iterate until green. Run `/generate-session-history` for Phase 3.

---

### Phase 3 Exit Checklist

- [ ] All 20 sub-tasks completed (3.1-3.20, 3.21 stabilization)
- [ ] Code review re-run shows no new P0 / P1 CQ
- [ ] Lint + tests + coverage all green
- [ ] `/generate-session-history` run
- [ ] Ready to advance to Phase 4

---

## Phase 4: Performance Optimization

**Goal**: Close 20 performance findings (9 P1 + 8 P2 + 3 P3 remaining after Phase 1 P0s).
**Prerequisites**: Phase 3 complete.
**Stability Gate**: All benchmarks green; `tests/benchmarks/baselines/v0.3.0.json` is superseded by `v0.4.0.json` with no regression on any metric.

### Sub-tasks

#### 4.1 - Hoist Ollama client out of setInterval

**Prompt**:
> Context: Addresses finding #28 (P1 perf).
> Goal: Client is created once; poller reuses it; backs off to 15-30s once reachable.
> Files to modify: `src/extension.ts:43-60`.
> Acceptance criteria: CPU profile of an 8-hour idle session shows no poller-attributable allocation. Test asserts client is created once across multiple poller ticks.
> Constraints: Keep 5s cadence during the initial reconnect window.
> When done, run `/wrap-up-session`.

---

#### 4.2 - Make getHistory no-clone; O(1) token estimate

**Prompt**:
> Context: Addresses finding #29 (P1 perf).
> Goal: `getHistory(): readonly Message[]` returns `this._messages` cast, not a clone. Maintain `_totalChars` incremented on `_append`/`replaceMessages`; `estimateTokens` uses `_totalChars / 4` (O(1)).
> Files to modify: `src/chat/ConversationManager.ts:111-113, 88-90, 180-184`, `src/chat/CompactionStrategy.ts:16-24` (use the counter).
> Acceptance criteria: Bench shows 100-turn message send has 0 array clones in the send hot path; token-estimation cost is O(1).
> Constraints: `readonly` return type enforced; no external mutation possible.
> When done, run `/wrap-up-session`.

---

#### 4.3 - Rendered-HTML cache in _postHistory

**Prompt**:
> Context: Addresses finding #30 (P1 perf).
> Goal: `renderedHtmlMap` caches per-message HTML keyed by id; cache is invalidated on `replaceMessages` or explicit delete.
> Files to modify: `src/panels/GemmaCodePanel.ts:968-981`.
> Acceptance criteria: Loading a 50-turn session renders each message's markdown exactly once; subsequent `_postHistory` calls are O(1) allocation.
> Constraints: Status-only updates skip `_postHistory` entirely.
> When done, run `/wrap-up-session`.

---

#### 4.4 - Track focused webview; avoid double-post

**Prompt**:
> Context: Addresses finding #31 (P1 perf).
> Goal: Token / streaming messages go to only the focused webview; history events still go to both.
> Files to modify: `src/panels/GemmaCodePanel.ts:1237-1240`, plus view-state tracking in the editor panel factory.
> Acceptance criteria: Streaming 500 tokens to a session with both sidebar + editor panels posts exactly 500 messages (not 1000).
> Constraints: If only one panel is attached, preserves existing behavior.
> When done, run `/wrap-up-session`.

---

#### 4.5 - Memoize tool serialization; splice memory block

**Prompt**:
> Context: Addresses finding #32 (P1 perf).
> Goal: `PromptBuilder._buildToolDeclarations` caches JSON by enabled-tools hash; memory-context updates splice in the memory block only.
> Files to modify: `src/chat/PromptBuilder.ts:232-246`, `src/tools/Gemma4ToolFormat.ts:218-244`, `src/panels/GemmaCodePanel.ts:1116-1139`.
> Acceptance criteria: 30-tool registry re-serializes only when the registry state changes; memory updates do not rebuild the full prompt.
> Constraints: Cache is keyed by a stable hash so changes to the set invalidate properly.
> When done, run `/wrap-up-session`.

---

#### 4.6 - Add LIMIT and FTS5 routing to searchSessions

**Prompt**:
> Context: Addresses finding #33 (P1 perf).
> Goal: `searchSessions` returns <= 100 rows by default and uses the existing `messages_fts` table for content matching.
> Files to modify: `src/storage/ChatHistoryStore.ts:144-163`, `src/storage/MemoryStore.ts:208-212`.
> Acceptance criteria: On a 10k-message DB, `searchSessions("foo")` returns in < 10 ms (bench); previous leading-wildcard LIKE scan is gone.
> Constraints: Preserve ordering by `updated_at DESC`.
> When done, run `/wrap-up-session`.

---

#### 4.7 - Rewrite computeAggregateMetrics with GROUP BY

**Prompt**:
> Context: Addresses finding #34 (P1 perf).
> Goal: Aggregate metrics are computed in a single SQL query with `GROUP BY trace_id`; no per-span JSON.parse in the aggregate path.
> Files to modify: `src/observability/MetricsCollector.ts:86-127`, possibly `src/observability/TraceStore.ts` (add a dedicated aggregate query).
> Acceptance criteria: Dashboard refresh with 100 traces x 100 spans each takes < 50 ms; a regression test uses a synthetic trace store.
> Constraints: Per-span JSON parse still happens on detail-view queries only.
> When done, run `/wrap-up-session`.

---

#### 4.8 - Batch graph BFS queries

**Prompt**:
> Context: Addresses finding #35 (P1 perf).
> Goal: `findRelatedEntities` and `queryByEntity` batch frontier expansion with `WHERE source_id IN (...) OR target_id IN (...)`.
> Files to modify: `src/storage/GraphMemory.ts:232-263`, `src/storage/GraphQueryEngine.ts:253-282, 164-177`.
> Acceptance criteria: BFS at depth 2 from a 50-node frontier issues <= 3 SQL queries total.
> Constraints: Output shape identical to pre-refactor.
> When done, run `/wrap-up-session`.

---

#### 4.9 - Switch ConversationSync to async (or delete - see Phase 7)

**Prompt**:
> Context: Addresses finding #36 (P1 perf). If the class is deleted in Phase 7 (likely), mark this sub-task N/A.
> Goal: If retained, `syncMessage` uses `fs.promises.appendFile` with fire-and-forget; `syncSession` uses async write.
> Files to modify: `src/storage/ConversationSync.ts:19-32` (if class retained).
> Acceptance criteria: No `appendFileSync` / `writeFileSync` in the class.
> Constraints: Errors are logged but do not reject the caller.
> When done, run `/wrap-up-session`.

---

#### 4.10 - Cache estimateTokens per Message

**Prompt**:
> Context: Addresses finding #63 (P2 perf).
> Goal: Each `Message` carries a precomputed `_tokenEstimate` set at construction (or lazily on first read and memoized).
> Files to modify: `src/chat/ConversationManager.ts` (message factory), `src/chat/CompactionStrategy.ts:16-24`.
> Acceptance criteria: Repeated `estimateTokensForMessages(history)` calls are O(N) only the first time; subsequent calls are O(N) array sum.
> Constraints: Token-estimate logic unchanged - same `/4` heuristic.
> When done, run `/wrap-up-session`.

---

#### 4.11 - Explicit highlight.js language registration

**Prompt**:
> Context: Addresses finding #64 (P2 perf).
> Goal: Import `highlight.js/lib/core` + register only `typescript`, `javascript`, `python`, `go`, `rust`, `json`, `bash`, `yaml`.
> Files to modify: `src/utils/MarkdownRenderer.ts:3`, `package.json` (verify side-effects config for tree-shake).
> Acceptance criteria: VSIX size drops by >= 100 KB; existing snippets in the 8 languages still highlight correctly; an unregistered language falls back to plain text with no error.
> Constraints: All 8 listed languages covered by a new `tests/unit/utils/MarkdownRenderer.test.ts` case.
> When done, run `/wrap-up-session`.

---

#### 4.12 - Share single better-sqlite3 connection between MemoryStore and GraphMemory

**Prompt**:
> Context: Addresses finding #65 (P2 perf).
> Goal: Both classes accept a shared `Database` instance; `MemorySubsystem` (from 1.14) opens one connection and passes it to both.
> Files to modify: `src/storage/MemoryStore.ts`, `src/storage/GraphMemory.ts`, `src/storage/MemorySubsystem.ts`.
> Acceptance criteria: Only one file handle is opened for the memory DB; concurrent-write test shows no WAL lock contention.
> Constraints: Migration-safe if an existing two-DB layout is discovered at startup.
> When done, run `/wrap-up-session`.

---

#### 4.13 - Gate FTS5 rebuild on user_version

**Prompt**:
> Context: Addresses finding #66 (P2 perf).
> Goal: `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')` only runs when `user_version` differs from current schema version.
> Files to modify: `src/storage/ChatHistoryStore.ts:60-64` (and analogous in other FTS callers if any).
> Acceptance criteria: Cold start on a 10k-message DB is < 20 ms; re-running on the same DB is a no-op.
> Constraints: Schema version is a new `PRAGMA user_version` value bumped when schema changes.
> When done, run `/wrap-up-session`.

---

#### 4.14 - Batch extractAndSave in pre-compaction hook

**Prompt**:
> Context: Addresses finding #67 (P2 perf).
> Goal: `extractAndSave` collects all extractions, dedups via a single FTS query, embeds via `EmbeddingClient.embedBatch`, bulk-INSERTs in a transaction.
> Files to modify: `src/storage/MemoryStore.ts:316-334`, `src/storage/EmbeddingClient.ts` (verify `embedBatch` exists; if not, add it).
> Acceptance criteria: 30-extraction compaction completes in < 300 ms (bench) vs. ~1.5 s today.
> Constraints: Idempotent - rerunning the same hook yields identical persisted state.
> When done, run `/wrap-up-session`.

---

#### 4.15 - Share single EmbeddingClient instance

**Prompt**:
> Context: Addresses finding #68 (P2 perf).
> Goal: `MemorySubsystem` holds one `EmbeddingClient`; both `MemoryStore` and `EpisodicMemory` use it.
> Files to modify: `src/storage/MemorySubsystem.ts`, `src/storage/MemoryStore.ts`, `src/storage/EpisodicMemory.ts`.
> Acceptance criteria: Only one `/api/tags` availability check per extension session.
> Constraints: Cache invalidated on settings change if embedding model switches.
> When done, run `/wrap-up-session`.

---

#### 4.16 - Fold hasToolCall into parseToolCalls

**Prompt**:
> Context: Addresses finding #69 (P3 perf).
> Goal: `parseToolCalls(text)` returns `{ calls: ToolCall[], hasAny: boolean }`; delete `hasToolCall`.
> Files to modify: `src/tools/Gemma4ToolFormat.ts:44-47, 98-138`, `src/tools/AgentLoop.ts:211, 232`.
> Acceptance criteria: One parse per iteration (vs two); behavior identical.
> Constraints: Tests updated to match new shape.
> When done, run `/wrap-up-session`.

---

#### 4.17 - Opportunistic MemoryStore.retrieve allocation reduction

**Prompt**:
> Context: Addresses finding #70 (P3 perf).
> Goal: Merge keyword + semantic results using a single array with a tag byte; avoid the intermediate Map + spread.
> Files to modify: `src/storage/MemoryStore.ts:250-309`.
> Acceptance criteria: Same top-K output; bench shows reduced GC pressure.
> Constraints: Pure micro-optimization; do not change sort stability.
> When done, run `/wrap-up-session`.

---

#### 4.18 - Reduce _postHistory webview payload

**Prompt**:
> Context: Addresses finding #71 (P3 perf).
> Goal: Send only `{ renderedHtmlMap, messagesMeta: [{id, role, timestamp}] }`; drop the raw content array.
> Files to modify: `src/panels/GemmaCodePanel.ts:976-980`, `src/panels/webview/index.ts` (update the consumer).
> Acceptance criteria: Webview payload for a 50-message session is < 300 KB (down from 500 KB-1 MB).
> Constraints: Webview must still render identically; its rendering path now uses only the HTML map.
> When done, run `/wrap-up-session`.

---

#### 4.19 - Disable retainContextWhenHidden or virtualize

**Prompt**:
> Context: Addresses finding #72 (P3 perf).
> Goal: Set `retainContextWhenHidden: false` on the editor panel; webview rehydrates on re-show via `_postHistory`.
> Files to modify: `src/extension.ts:239`.
> Acceptance criteria: Memory footprint of hidden panel drops to near-zero (profile-verified).
> Constraints: Re-show must repaint within 200 ms on a realistic session.
> When done, run `/wrap-up-session`.

---

#### 4.20 - Address O(N^2) trimToContextLimit and EmergencyTrim

**Prompt**:
> Context: Addresses the P3 "Additional performance notes" items in the review (ConversationManager.trimToContextLimit O(N^2) and CompactionStrategy.EmergencyTrim's recomputed estimate).
> Goal: Replace in-place splice-in-loop with a single splice call using the target index; `EmergencyTrim` uses incremental delta computation on each iteration.
> Files to modify: `src/chat/ConversationManager.ts:232-247`, `src/chat/CompactionStrategy.ts:313-320`.
> Acceptance criteria: Worst-case trim is O(N) not O(N^2); bench shows linear scaling.
> Constraints: Observable output identical.
> When done, run `/wrap-up-session`.

---

#### 4.21 - Testing and Stabilization

**Prompt**:
> Run `npm run test`, `npm run bench`. Record new baselines in `tests/benchmarks/baselines/v0.4.0.json`; update the gating script in 1.11 to prefer v0.4.0 with v0.3.0 as floor. Fix every failure and iterate until green. Run `/generate-session-history` for Phase 4.

---

### Phase 4 Exit Checklist

- [ ] All 20 sub-tasks completed
- [ ] `v0.4.0.json` benchmark baseline committed
- [ ] No regression vs. `v0.3.0.json` on any metric
- [ ] Dashboards show improved P50/P99 on the hot paths named in Phase 1 P0s
- [ ] `/generate-session-history` run
- [ ] Ready to advance to Phase 5

---

## Phase 5: Testing Pipeline Completeness

**Goal**: Close 22 remaining testing findings (9 P1 + 5 P2 + 8 P3/infra).
**Prerequisites**: Phase 4 complete.
**Stability Gate**: Zero sleep-based synchronization primitives remain; 80%+ coverage held; pyramid shifted closer to 70/20/10.

### Sub-tasks

#### 5.1 - Replace sleep-based synchronization across 6 test files

**Prompt**:
> Context: Addresses finding #37 (P1 testing).
> Goal: Replace all `await new Promise((r) => setTimeout(r, N))` synchronization primitives with deterministic waits.
> Files to modify: `tests/unit/skills/SkillLoader.test.ts:149-172, 165`, `tests/unit/observability/OtlpExporter.test.ts:87`, `tests/unit/orchestration/DAGExecutor.test.ts:162`, `tests/unit/panels/GemmaCodePanel.test.ts:175`, `tests/unit/storage/ChatHistoryStore.test.ts:67, 109, 111`.
> Recommended patterns: for fs.watch use `fs.promises.watch` + `AbortController`; for OtlpExporter expose a `whenIdle()` Promise; for clock-ordered rows inject a monotonic clock; for DAGExecutor await a completion event.
> Acceptance criteria: `git grep "setTimeout(r" tests/` returns nothing; tests pass 100 runs in a row (use `vitest --run --retry=0 --repeat=100` locally).
> Constraints: No timing-sensitivity left.
> When done, run `/wrap-up-session`.

---

#### 5.2 - Add gitSafetyNet integration to AgentLoop tests

**Prompt**:
> Context: Addresses finding #38 (P1 testing).
> Goal: A new describe block in `tests/unit/tools/AgentLoop.test.ts` supplies a mock `GitSafetyNet` and asserts checkpoint + rollback are invoked under the expected conditions.
> Files to modify: `tests/unit/tools/AgentLoop.test.ts`.
> Acceptance criteria: Tests cover: REVERSIBLE tool - no checkpoint; DESTRUCTIVE tool - checkpoint created; DESTRUCTIVE tool fails - rollback called; checkpoint creation fails - execution still proceeds with a warning.
> Constraints: Do not use a real git repo; mock `execFile`.
> When done, run `/wrap-up-session`.

---

#### 5.3 - Test Orchestrator.replan memory-save branch

**Prompt**:
> Context: Addresses finding #39 (P1 testing).
> Goal: One test in `Orchestrator.replan.test.ts` provides a mock `MemoryStore` and asserts `save()` is called with `type: "error_resolution"` after a terminal failure.
> Files to modify: `tests/unit/orchestration/Orchestrator.replan.test.ts:140, 203, 247, 317`.
> Acceptance criteria: The new test passes; other tests still green.
> Constraints: Mock-of-a-class pattern matches existing test style.
> When done, run `/wrap-up-session`.

---

#### 5.4 - Introduce typed mock factories

**Prompt**:
> Context: Addresses finding #40 (P1 testing).
> Goal: Replace `as unknown as SomeType` casts with a hand-written typed factory utility (or `vitest-mock-extended`) so interface drift breaks tests at compile time.
> Files to modify: `tests/unit/tools/AgentLoop.test.ts` (10 casts), `tests/unit/orchestration/Orchestrator.test.ts` (5 casts), and any others found via grep.
> Files to create: `tests/helpers/mockFactories.ts`.
> Acceptance criteria: `git grep "as unknown as" tests/` returns at most 2 legitimate instances; the rest use the factory.
> Constraints: No runtime overhead.
> When done, run `/wrap-up-session`.

---

#### 5.5 - Fix trivial-pass assertion

**Prompt**:
> Context: Addresses finding #41 (P1 testing).
> Goal: `tests/unit/orchestration/Orchestrator.test.ts:174` uses a meaningful assertion.
> Files to modify: `tests/unit/orchestration/Orchestrator.test.ts:174`.
> Acceptance criteria: `expect(result.totalTimeMs).toBeGreaterThan(0)` OR assertion on `result.replanCount` / status.
> Constraints: Test still passes; drops zero-accepting assertion.
> When done, run `/wrap-up-session`.

---

#### 5.6 - Add Python /models endpoint test

**Prompt**:
> Context: Addresses finding #42 (P1 testing). N/A if backend deleted.
> Goal: `src/backend/tests/integration/test_models_endpoint.py` mirrors `test_health_endpoint.py` and mocks `OllamaService.list_models`.
> Files to create: `src/backend/tests/integration/test_models_endpoint.py`.
> Acceptance criteria: Test asserts response shape, status code 200, and 503 on OllamaUnavailableError.
> Constraints: Generic error detail (per 2.13) is asserted.
> When done, run `/wrap-up-session`.

---

#### 5.7 - Make full-pipeline.test.ts run real AgentLoop

**Prompt**:
> Context: Addresses finding #43 (P1 testing).
> Goal: `tests/integration/e2e/full-pipeline.test.ts` instantiates `new AgentLoop(mockClient, manager, registry, ...)` and calls `run()`; the prior PromptBuilder + ToolRegistry composition test is renamed or moved.
> Files to modify: `tests/integration/e2e/full-pipeline.test.ts:62-128`.
> Acceptance criteria: Test exercises a full iteration including tool invocation.
> Constraints: OllamaClient is mocked.
> When done, run `/wrap-up-session`.

---

#### 5.8 - Add mocked non-skipping variant of ollama-health

**Prompt**:
> Context: Addresses finding #44 (P1 testing).
> Goal: `tests/integration/ollama-client.test.ts` uses `msw` (Mock Service Worker) to mock the Ollama HTTP surface; runs on every commit.
> Files to create: `tests/integration/ollama-client.test.ts`.
> Files to modify: `tests/integration/ollama-health.test.ts` (keep the live-conditional version, but emit a console notice on skip).
> Acceptance criteria: Mocked variant covers healthy / unhealthy / streaming failure / model-not-found branches.
> Constraints: Neither variant depends on the other.
> When done, run `/wrap-up-session`.

---

#### 5.9 - Regenerate GOLDEN_TASKS from YAML corpus

**Prompt**:
> Context: Addresses finding #45 (P1 testing).
> Goal: `src/observability/GoldenTaskSuite.ts`'s `GOLDEN_TASKS` array reflects the 24 YAML tasks in `tests/golden/tasks/`, OR the hardcoded placeholder array is removed and the TS side reads YAML at runtime.
> Files to modify: `src/observability/GoldenTaskSuite.ts`, `tests/unit/observability/GoldenTaskSuite.test.ts:52-54` (update `.toHaveLength(24)`).
> Acceptance criteria: Test count matches source count; unit test passes.
> Constraints: Recommended approach: generate the array from YAML via a build script in `scripts/generate-golden-tasks.mjs` that runs as a `prebuild` step.
> When done, run `/wrap-up-session`.

---

#### 5.10 - Sweep weak assertions

**Prompt**:
> Context: Addresses finding #73 (P2 testing).
> Goal: 40 occurrences of `toBeDefined` / `toBeTruthy` / `toBeFalsy` across 19 files are tightened to specific assertions.
> Files to modify: discoverable via `git grep -l "toBeDefined\|toBeTruthy\|toBeFalsy" tests/`.
> Acceptance criteria: Only justified survivors remain (pre-specific-assertion null guards are acceptable); a lint rule or test-comment convention is added to prevent regression.
> Constraints: All 889 existing test cases still pass.
> When done, run `/wrap-up-session`.

---

#### 5.11 - Expand extension.test.ts

**Prompt**:
> Context: Addresses finding #74 (P2 testing).
> Goal: `tests/unit/extension.test.ts` asserts: BackendManager is created iff `useBackend` is retained + `true`; Tracer is initialized with the expected store path; MCP starts when `mcpEnabled: true`; `deactivate()` disposes all registered subscriptions.
> Files to modify: `tests/unit/extension.test.ts`.
> Acceptance criteria: Coverage of `src/extension.ts` >= 60% (even though excluded from the threshold, we should know it works).
> Constraints: Do not remove the exclusion from `configs/vitest.config.ts` - keeping exclusion but covering the file is still useful.
> When done, run `/wrap-up-session`.

---

#### 5.12 - Add missing GrepCodebaseTool test cases

**Prompt**:
> Context: Addresses finding (P2 testing).
> Goal: `tests/unit/tools/handlers/filesystem.test.ts::GrepCodebaseTool` covers: ripgrep path (when `spawn` succeeds), regex special chars in pattern, binary-file skip, `max_results` cap, `include`/`exclude` globs, invalid-regex case from 3.14, and ReDoS case from 2.6.
> Files to modify: `tests/unit/tools/handlers/filesystem.test.ts:293-313`.
> Acceptance criteria: At least 7 new cases.
> When done, run `/wrap-up-session`.

---

#### 5.13 - Add a GemmaCodePanel test using real settings.ts

**Prompt**:
> Context: Addresses finding (P2 testing).
> Goal: One test in `tests/unit/panels/GemmaCodePanel.test.ts` uses real `settings.ts` logic (with `setup.ts` vscode mock) instead of mocked `getSettings`.
> Files to modify: `tests/unit/panels/GemmaCodePanel.test.ts:8-38`.
> Acceptance criteria: The new test exercises reading a custom configuration key and asserts the panel behaves correctly.
> Constraints: Existing mock-based tests remain (they are faster).
> When done, run `/wrap-up-session`.

---

#### 5.14 - Improve Windows cleanup in memory-across-sessions test

**Prompt**:
> Context: Addresses finding (P2 testing).
> Goal: `afterEach` retries unlink on `EBUSY`/`EPERM` up to 3 times with a short delay; or use `Database.open(":memory:", { sharedCache: true })` for the test.
> Files to modify: `tests/integration/e2e/memory-across-sessions.test.ts:29-35`.
> Acceptance criteria: CI on Windows no longer leaves `%TEMP%/gemma-e2e-memory-*.db` files.
> When done, run `/wrap-up-session`.

---

#### 5.15 - Add fake-timer Ollama backoff tests

**Prompt**:
> Context: Addresses finding (P2 testing).
> Goal: Cover exponential backoff + max retry count in Ollama streaming.
> Files to modify: `tests/unit/ollama/client.test.ts`.
> Acceptance criteria: Parameterized test verifies backoff times (100 ms, 200 ms, 400 ms or whatever the policy is), jitter bounds, and max-retry exit.
> Constraints: Use `vi.useFakeTimers()`.
> When done, run `/wrap-up-session`.

---

#### 5.16 - Standardize test naming convention

**Prompt**:
> Context: Addresses finding (P3 testing).
> Goal: Pick one convention (drop "should" prefix - closer to Vitest community style) and apply across the suite.
> Files to modify: grep for `"should "` in test files and rewrite.
> Acceptance criteria: Consistent naming; tests still pass.
> Constraints: Pure mechanical rename.
> When done, run `/wrap-up-session`.

---

#### 5.17 - Move or remove legacy NSIS test

**Prompt**:
> Context: Addresses finding (P3 testing).
> Goal: If legacy NSIS installer is no longer shipped (confirmed by v0.3.0 PyQt installer), delete `tests/unit/installer/nsis-logic.test.ps1`; otherwise move to `tests/unit/installer/legacy/`.
> Files to modify / delete: `tests/unit/installer/nsis-logic.test.ps1`.
> Acceptance criteria: Phase 1 CHANGELOG notes the retirement.
> When done, run `/wrap-up-session`.

---

#### 5.18 - Fix tests/golden/.gitignore

**Prompt**:
> Context: Addresses finding (P3 testing).
> Goal: `tests/golden/.gitignore` excludes `.pytest_cache/`, `.ruff_cache/`, `__pycache__/`, `*.pyc`.
> Files to modify: `tests/golden/.gitignore`.
> Acceptance criteria: `git check-ignore tests/golden/.pytest_cache` confirms ignored; `git rm --cached` any already-tracked files and re-commit.
> When done, run `/wrap-up-session`.

---

#### 5.19 - Consolidate installer smoke into tests/smoke/

**Prompt**:
> Context: Addresses finding (P3 testing) and Phase 6 6d/P2 CI dedup.
> Goal: Move per-platform smoke scripts from `tests/integration/installer/` to `tests/smoke/`; drop the nightly `installer-smoke-*` jobs in favor of the weekly `installer-smoke.yml`.
> Files to modify: `tests/integration/installer/*.sh`, `tests/integration/installer/*.ps1`, `.github/workflows/nightly.yml:111-157`, `.github/workflows/installer-smoke.yml`.
> Acceptance criteria: One canonical smoke-test surface.
> Constraints: Verify both scripts really do equivalent work before deleting one.
> When done, run `/wrap-up-session`.

---

#### 5.20 - Extract tests/helpers/factories.ts

**Prompt**:
> Context: Addresses finding (P3 testing).
> Goal: Deduplicate `makeClient` / `makeManager` / `makeConfig` patterns from `AgentLoop.test.ts`, `Orchestrator.test.ts`, `ReflexionEngine.test.ts` into one helper module.
> Files to create: `tests/helpers/factories.ts`.
> Files to modify: the three test files above.
> Acceptance criteria: Drift risk removed; tests still pass.
> When done, run `/wrap-up-session`.

---

#### 5.21 - Add config-change reaction test

**Prompt**:
> Context: Addresses finding (P3 testing).
> Goal: Assert that when `vscode.workspace.onDidChangeConfiguration` fires for a relevant key, the downstream effects (ChatHistoryStore reopens if path changed, Tracer re-initializes, MemoryStore reconfigures) actually happen.
> Files to create: `tests/integration/config-reload.test.ts`.
> Acceptance criteria: For each reactive key documented in `settings.ts`, a test triggers the change event and asserts the reaction.
> Constraints: Only test keys that are actually reactive; document non-reactive ones.
> When done, run `/wrap-up-session`.

---

#### 5.22 - Testing and Stabilization

**Prompt**:
> Run `npm run test`, `pytest`, `npm run bench`. Confirm coverage >= 80% / 75%. Measure current pyramid ratio (unit/integration/e2e) and record in `docs/archive/versions/v0/v0.4.0/test-pyramid.md`. Fix every failure. Run `/generate-session-history` for Phase 5.

---

### Phase 5 Exit Checklist

- [ ] All 22 sub-tasks completed
- [ ] Zero sleep-based waits remain
- [ ] Typed mock factories in use
- [ ] Coverage >= 80% lines / 75% branches
- [ ] Pyramid ratio documented and closer to 70/20/10
- [ ] `/generate-session-history` run
- [ ] Ready to advance to Phase 6

---

## Phase 6: Restructuring (Architecture)

**Goal**: Land 17 structural recommendations. Behavior-preserving where possible; user-visible where documented.
**Prerequisites**: Phase 5 complete.
**Stability Gate**: `architect` agent re-run reports all originally-flagged items as resolved; `npm run test` green.

### Sub-tasks

#### 6.1 - Record ADR-0001 Python backend disposition

**Prompt**:
> Context: Formalizes the Phase 1 1.13 decision.
> Goal: `docs/adr/0001-python-backend-disposition.md` using MADR format documents the rationale for deletion (or retention, whichever was chosen). Update `docs/archive/versions/v0/v0.3.0/architecture.md` to note the change.
> Files to create: `docs/adr/0001-python-backend-disposition.md`, `docs/adr/README.md` (index), `docs/adr/template.md`.
> Acceptance criteria: ADR lists context, decision, consequences, alternatives considered.
> When done, run `/wrap-up-session`.

---

#### 6.2 - Complete GemmaCodePanel split

**Prompt**:
> Context: Addresses finding #14 (P0 restructuring) follow-through; sub-task 1.14 landed only the MemorySubsystem extraction.
> Goal: Extract `GemmaRuntime` (composition root), `ChatController` (agent loop + orchestration mediator), `ChatWebviewHost` (webview provider + message translation). Land as three PRs if possible.
> Files to create: `src/runtime/GemmaRuntime.ts`, `src/chat/ChatController.ts`, `src/panels/ChatWebviewHost.ts`.
> Files to modify: `src/extension.ts` (thin lifecycle adapter), `src/panels/GemmaCodePanel.ts` (deleted or reduced to re-export shim).
> Acceptance criteria: `GemmaCodePanel.ts` either deleted or < 100 lines; `GemmaRuntime` constructor visibly wires every subsystem; all tests pass.
> Constraints: Preserve public shapes for any API external consumers rely on.
> When done, run `/wrap-up-session`.

---

#### 6.3 - Introduce guardrails/ module

**Prompt**:
> Context: Addresses finding #48 (P1 restructuring) and 6b P1.
> Goal: Move `PermissionTiers`, `ActionClassifier`, `LoopDetector`, `GitSafetyNet` into `src/guardrails/`; expose `GuardrailsPipeline` consumed by `ToolRegistry` and `AgentLoop`. Move `BLOCKED_PATTERNS` to `guardrails/policy.ts`. The `safety/` directory is deleted.
> Files to create: `src/guardrails/` (module + barrel).
> Files to modify: `src/tools/handlers/terminal.ts` (import from `guardrails/policy`), `src/tools/ToolRegistry.ts`, `src/tools/AgentLoop.ts`, `src/panels/GemmaCodePanel.ts` (or successor).
> Acceptance criteria: `safety/` no longer exists; `tools/` no longer imports from `safety/`; tests pass.
> Constraints: Pure structural change; no behavior diff.
> When done, run `/wrap-up-session`.

---

#### 6.4 - Introduce src/llm/ port

**Prompt**:
> Context: Addresses finding #46 (P1 restructuring) and 6c P1.
> Goal: `src/llm/types.ts` defines `LLMMessage`, `LLMToolDefinition`, `LLMStreamChunk`. `OllamaClient` maps to/from these; orchestration, planner, reflexion, and sub-agents import only `llm/types`.
> Files to create: `src/llm/types.ts`, `src/llm/OllamaClient.ts` (renames + adaptation of current `src/ollama/client.ts`).
> Files to modify: the 9 files currently importing from `src/ollama/types.js`.
> Acceptance criteria: `git grep "from \"../ollama/types" src/` returns only the driver; orchestration + planners compile against `llm/types`.
> Constraints: Public shapes preserved at the driver layer.
> When done, run `/wrap-up-session`.

---

#### 6.5 - Extract OllamaHttp shared client

**Prompt**:
> Context: Addresses finding #49 (P1 restructuring).
> Goal: `src/llm/OllamaHttp.ts` (or `src/ollama/http.ts` if keeping the old namespace) centralizes fetch-with-timeout, availability check, URL normalization, JSON parsing. `OllamaClient` + `EmbeddingClient` compose over it.
> Files to create: `src/llm/OllamaHttp.ts`.
> Files to modify: `src/llm/OllamaClient.ts` (post-6.4 location), `src/storage/EmbeddingClient.ts:17-50`.
> Acceptance criteria: One place for retries, auth headers, trace-span wrapping.
> Constraints: Behavior identical.
> When done, run `/wrap-up-session`.

---

#### 6.6 - Move GoldenTaskSuite.ts to evaluation/

**Prompt**:
> Context: Addresses finding 6b/P2.
> Goal: `src/observability/GoldenTaskSuite.ts` moves to `src/evaluation/GoldenTaskSuite.ts`.
> Files to modify: the file; any imports.
> Acceptance criteria: `src/observability/` contains only Tracer/TraceStore/MetricsCollector/OtlpExporter.
> When done, run `/wrap-up-session`.

---

#### 6.7 - Inline modes/PlanMode.ts into chat/

**Prompt**:
> Context: Addresses finding 6b/P3.
> Goal: `src/modes/PlanMode.ts` becomes `src/chat/PlanMode.ts`; `src/modes/` is deleted.
> Files to modify: the file; any imports.
> When done, run `/wrap-up-session`.

---

#### 6.8 - Inject Tracer via composition root; remove singleton

**Prompt**:
> Context: Addresses finding 6c/P2.
> Goal: `Tracer.getInstance()` is replaced by constructor injection from `GemmaRuntime`; `Tracer.test.ts` uses real instances rather than `resetInstance`.
> Files to modify: `src/observability/Tracer.ts:12-29`, 5 consuming modules (`OtlpExporter.ts`, `ToolRegistry.ts`, `AgentLoop.ts`, `ContextCompactor.ts`, `SubAgentManager.ts`).
> Acceptance criteria: No `Tracer.getInstance()` call in `src/`; tests parallel-safe.
> Constraints: `Tracer.test.ts` retains the same test cases but uses per-test instances.
> When done, run `/wrap-up-session`.

---

#### 6.9 - Inject settings once at composition root

**Prompt**:
> Context: Addresses finding 6c/P2.
> Goal: `getSettings()` is called exactly once in `GemmaRuntime`; deep modules receive a typed slice.
> Files to modify: `src/chat/ContextCompactor.ts`, `src/chat/RegenerateFromSource.ts`, `src/config/GpuTierConfig.ts` (or its replacement from Phase 7), `src/llm/OllamaClient.ts`, `src/panels/*` (successors).
> Acceptance criteria: `git grep "getSettings()" src/` returns at most one call in `GemmaRuntime`.
> Constraints: Reactivity via `onSettingsChange` (already exists at `src/config/settings.ts:90-98`) is wired at the composition root.
> When done, run `/wrap-up-session`.

---

#### 6.10 - Add src/utils/logger.ts

**Prompt**:
> Context: Addresses cross-cutting "Logging" concern.
> Goal: A single logger module wraps `vscode.OutputChannel`; ESLint rule forbids `console.*` in `src/`.
> Files to create: `src/utils/logger.ts`.
> Files to modify: `eslint.config.mjs` (add `no-console` rule scoped to `src/`).
> Acceptance criteria: No `console.*` in `src/`; all formerly-`console.*` calls route through the logger.
> Constraints: Logger is injectable so tests can assert on it.
> When done, run `/wrap-up-session`.

---

#### 6.11 - Add src/utils/errors.ts

**Prompt**:
> Context: Addresses finding 6d/P2.
> Goal: `formatForUser(err)` and `formatForLog(err)` utilities; replace ad-hoc `err instanceof Error ? err.message : String(err)` patterns.
> Files to create: `src/utils/errors.ts`.
> Files to modify: tool handlers (21+ occurrences), `StreamingPipeline._humanizeError`, extension.ts.
> Acceptance criteria: One consistent error surface for user-facing messages.
> Constraints: `formatForUser` redacts file paths and known secret patterns before display.
> When done, run `/wrap-up-session`.

---

#### 6.12 - Adopt Zod at module boundaries

**Prompt**:
> Context: Addresses cross-cutting "Validation" concern.
> Goal: Add Zod schemas at: Ollama responses (`streamChat`, `listModels`), MCP responses, webview message payloads, persisted JSON in SQLite (entity attributes, trace attributes, memory types).
> Files to modify: `src/llm/OllamaClient.ts`, `src/mcp/McpClient.ts`, `src/panels/webview/messages.ts`, `src/storage/GraphMemory.ts`, `src/observability/TraceStore.ts`.
> Acceptance criteria: Invalid inputs fail with a useful Zod error; existing tests still pass.
> Constraints: Performance-sensitive paths (every span) use pre-compiled schemas.
> When done, run `/wrap-up-session`.

---

#### 6.13 - Create docs/adr/

**Prompt**:
> Context: Addresses finding 6f/P3.
> Goal: `docs/adr/` with MADR template, README (index), and the Python-backend ADR from 6.1.
> Files to create: `docs/adr/README.md`, `docs/adr/template.md`, `docs/adr/0001-python-backend-disposition.md`.
> Acceptance criteria: README links all ADRs and describes the MADR convention.
> When done, run `/wrap-up-session`.

---

#### 6.14 - Add dev-setup scripts + CONTRIBUTING.md + npm run dev

**Prompt**:
> Context: Addresses finding #51 (P1 restructuring).
> Goal: One-command setup for new contributors; `npm run dev` concurrently runs `tsc --watch` (and backend if retained).
> Files to create: `scripts/dev-setup.sh`, `scripts/dev-setup.ps1`, `CONTRIBUTING.md`.
> Files to modify: `package.json` `scripts` (add `dev`), add `concurrently` devDep if needed.
> Acceptance criteria: A fresh clone on each OS can reach a working dev state with one command; the smallest TS-only contributor flow is documented.
> When done, run `/wrap-up-session`.

---

#### 6.15 - Consolidate installer smoke CI (see 5.19)

**Prompt**:
> Context: Addresses finding 6d/P2 and 6f/P2. Shares work with 5.19; close in one PR if convenient.
> Goal: Drop nightly `installer-smoke-*` jobs; rely on weekly `installer-smoke.yml`.
> Files to modify: `.github/workflows/nightly.yml:111-157`.
> Acceptance criteria: One canonical installer-smoke surface; CI runner minutes reduced.
> When done, run `/wrap-up-session`.

---

#### 6.16 - Marked v12 upgrade (or document deferral)

**Prompt**:
> Context: Addresses finding 6e/P3. DOMPurify in 1.1 already mitigates the XSS P0, but marked v12 has built-in sanitizer + Trusted Types support.
> Goal: Upgrade `marked@^4.3.0` -> `marked@^12.x`; adapt the renderer API break; confirm no regressions.
> Files to modify: `package.json`, `src/utils/MarkdownRenderer.ts`.
> Acceptance criteria: Syntax-highlight + link behavior + code-fence rendering unchanged; DOMPurify is still in the chain.
> Constraints: If the API break is too costly, defer and add a `NOTE(v0.5)` comment; document in CHANGELOG.
> When done, run `/wrap-up-session`.

---

#### 6.17 - Testing and Stabilization

**Prompt**:
> Run `npm run test`, `npm run lint`, `npm run build`. Verify the codebase still builds the VSIX. Optionally re-spawn `architect` agent to confirm coverage. Fix every failure. Run `/generate-session-history` for Phase 6.

---

### Phase 6 Exit Checklist

- [ ] All 17 sub-tasks completed
- [ ] `GemmaCodePanel` either deleted or < 100 lines
- [ ] `src/llm/`, `src/guardrails/`, `src/evaluation/`, `src/utils/logger.ts`, `src/utils/errors.ts` exist
- [ ] Zod schemas at boundaries
- [ ] `docs/adr/` populated with ADR-0001
- [ ] `CONTRIBUTING.md` + dev-setup scripts work on three OSes
- [ ] `/generate-session-history` run
- [ ] Ready to advance to Phase 7

---

## Phase 7: Simplification and Release

**Goal**: Close 17 simplification findings (~800 LOC deleted) and ship v0.4.0.
**Prerequisites**: Phase 6 complete.
**Stability Gate**: Full test pipeline green; VSIX builds; installers build on three OSes; CHANGELOG finalized; v0.4.0 tag pushed.

### Sub-tasks

#### 7.1 - Delete BudgetEnforcer

**Prompt**:
> Context: Addresses finding #52 (P1 simplification). AgentLoop branches were already removed in 3.5.
> Goal: Delete `src/safety/BudgetEnforcer.ts` (or `src/guardrails/BudgetEnforcer.ts` post-6.3) and its test.
> Files to delete: the class file + unit test.
> Acceptance criteria: `git grep BudgetEnforcer` returns nothing in `src/`; tests pass.
> When done, run `/wrap-up-session`.

---

#### 7.2 - Delete LazyToolLoader and serializeToolSummary

**Prompt**:
> Context: Addresses finding #53 (P1 simplification).
> Goal: Delete `src/tools/LazyToolLoader.ts`, `serializeToolSummary` in `Gemma4ToolFormat.ts:168-215`, `lazyToolLoading` prop in `PromptBuilder.types.ts:29`, `get_tool_schema` from catalog + permission tiers.
> Files to delete: `src/tools/LazyToolLoader.ts`, `tests/unit/tools/LazyToolLoader.test.ts`.
> Files to modify: `src/tools/Gemma4ToolFormat.ts`, `src/chat/PromptBuilder.ts:236-238`, `src/chat/PromptBuilder.types.ts:29`, `src/tools/ToolCatalog.ts`, `src/guardrails/PermissionTiers.ts`, `src/guardrails/ActionClassifier.ts`.
> Acceptance criteria: `git grep get_tool_schema\|lazyToolLoading\|LazyToolLoader` returns nothing.
> When done, run `/wrap-up-session`.

---

#### 7.3 - Delete ConversationSync

**Prompt**:
> Context: Addresses finding #54 (P2 simplification). Try/catch blocks already removed in 3.6.
> Goal: Delete `src/storage/ConversationSync.ts` and its test.
> Files to delete: both.
> Acceptance criteria: `git grep ConversationSync` returns nothing in `src/`.
> When done, run `/wrap-up-session`.

---

#### 7.4 - Delete RelevanceScorer

**Prompt**:
> Context: Addresses finding #55 (P2 simplification).
> Goal: Delete `src/chat/RelevanceScorer.ts`, its test, and the async relevance branch in `PromptBuilder.build:30-74` (collapse to `_buildCore`).
> Files to delete: the class + test.
> Files to modify: `src/chat/PromptBuilder.ts`, `src/chat/PromptBuilder.types.ts`.
> Acceptance criteria: `PromptBuilder.build` is synchronous (or the sole async call site is legitimately other work); every existing test passes.
> Constraints: The shared cosine util from 3.7 remains.
> When done, run `/wrap-up-session`.

---

#### 7.5 - Unify HardwareTier + GpuTierConfig

**Prompt**:
> Context: Addresses finding #56 (P1 simplification).
> Goal: `HardwareTierConfig` gains `subAgentMaxIterations` and `maxConcurrentSubAgents` (from `GpuTierProfile`); delete `src/config/GpuTierConfig.ts`; update `Orchestrator.ts:11` and `GemmaCodePanel.ts:53, 198-199` (or successors).
> Files to delete: `src/config/GpuTierConfig.ts`.
> Files to modify: `src/config/HardwareTier.ts`, `src/config/HardwareTier.types.ts`, `src/orchestration/Orchestrator.ts`, any consumer.
> Acceptance criteria: One coherent tier model; status-bar tier and orchestrator tier agree.
> Constraints: Preserve each disagreeing default bit-for-bit via migration that honors pre-existing behavior.
> When done, run `/wrap-up-session`.

---

#### 7.6 - Delete inferTierFromModelName

**Prompt**:
> Context: Addresses finding (P2 simplification).
> Goal: Delete the function; VRAM-based `classifyTier` remains the sole tier inference.
> Files to modify: none (function disappears with 7.5).
> Acceptance criteria: No references.
> When done, run `/wrap-up-session`.

---

#### 7.7 - Remove python-multipart (or whole backend)

**Prompt**:
> Context: Addresses finding #58 (P1 simplification). N/A if backend was deleted in 1.13.
> Goal: Remove `python-multipart >= 0.0.9` from `src/backend/pyproject.toml:12`.
> Files to modify: `src/backend/pyproject.toml`.
> Acceptance criteria: Backend tests pass; `pip install` works; dependency tree is smaller.
> When done, run `/wrap-up-session`.

---

#### 7.8 - Remove highlight.min.js webview copy step

**Prompt**:
> Context: Addresses finding #59 (P1 simplification).
> Goal: Delete lines 111-114 from `scripts/build-vsix.ps1`. Verify no `<script src>` in webview references the file.
> Files to modify: `scripts/build-vsix.ps1`.
> Acceptance criteria: VSIX size drops by ~1 MB; webview renders identically.
> When done, run `/wrap-up-session`.

---

#### 7.9 - Disable declaration emit

**Prompt**:
> Context: Addresses finding #60 (P2 simplification).
> Goal: Set `declaration: false`, `declarationMap: false` in `tsconfig.json:16-17`.
> Files to modify: `tsconfig.json`.
> Acceptance criteria: `npm run build` is faster; no `.d.ts` artifacts in `out/`.
> When done, run `/wrap-up-session`.

---

#### 7.10 - Delete memoryAutoSaveInterval setting

**Prompt**:
> Context: Addresses finding #57 (P1 simplification).
> Goal: Remove `gemma-code.memoryAutoSaveInterval` from `package.json:217-223` + `settings.ts:29, 71`.
> Acceptance criteria: Setting is gone; no readers remain.
> When done, run `/wrap-up-session`.

---

#### 7.11 - Wire or delete permissionOverrides

**Prompt**:
> Context: Addresses finding (P1 simplification).
> Goal: Either wire `settings.permissionOverrides` into `ToolRegistry.setConfirmationGate` call at `GemmaCodePanel.ts:324` (or its successor), OR delete the setting entirely.
> Files to modify: either `GemmaCodePanel.ts` / runtime + settings.ts, or just settings.ts + package.json.
> Acceptance criteria: If wired, a test asserts overrides take effect. If deleted, no references remain.
> Constraints: Recommended path: wire it (simple 1-line fix, real feature).
> When done, run `/wrap-up-session`.

---

#### 7.12 - Delete maxSessionTokens / maxSessionMinutes settings

**Prompt**:
> Context: Addresses finding (P1 simplification). Tied to BudgetEnforcer deletion (7.1).
> Goal: Remove `gemma-code.maxSessionTokens`, `gemma-code.maxSessionMinutes` from `package.json:289-298` + `settings.ts:38-39, 80-81`.
> Acceptance criteria: Settings gone.
> When done, run `/wrap-up-session`.

---

#### 7.13 - Collapse gpuTier / gpuTierOverride

**Prompt**:
> Context: Addresses finding #63 (P2 simplification).
> Goal: Keep `gemma-code.gpuTierOverride` only; delete `gemma-code.gpuTier`; migration shim in `settings.ts` reads the legacy key for one release.
> Files to modify: `package.json:319-335`, `src/config/settings.ts:37, 41, 79, 83`, `src/config/HardwareTier.ts` (consumer).
> Acceptance criteria: One user-facing setting; prior users' behavior preserved.
> Constraints: Migration shim is documented with a `// NOTE(v0.5): remove gpuTier fallback` comment.
> When done, run `/wrap-up-session`.

---

#### 7.14 - Simplify parseOtlpHeaders

**Prompt**:
> Context: Addresses finding #72 (P3 simplification).
> Goal: Use `.split`, `.map`, `Object.fromEntries`.
> Files to modify: `src/observability/OtlpExporter.ts:196-213`.
> Acceptance criteria: Same shape; tests pass.
> When done, run `/wrap-up-session`.

---

#### 7.15 - Delete escapeAttr alias

**Prompt**:
> Context: Addresses finding #73 (P3 simplification). Phase 2 sub-task 2.8 may have already done this; if not, remove now.
> Goal: Inline `escapeHtml` at every `escapeAttr` call site; delete the alias.
> Files to modify: `src/utils/MarkdownRenderer.ts:89-91` and any callers.
> When done, run `/wrap-up-session`.

---

#### 7.16 - Relocate GoldenTaskSuite TS helpers

**Prompt**:
> Context: Addresses finding (P3 simplification).
> Goal: Move `validateExpectation`, `detectRegressions` into `tests/helpers/goldenTaskHelpers.ts` if they are only used by tests.
> Files to modify: `src/evaluation/GoldenTaskSuite.ts` (post-6.6), `tests/unit/observability/GoldenTaskSuite.test.ts` (or its new location), imports.
> Acceptance criteria: Shipped extension is smaller; tests still pass.
> Constraints: If any runtime caller is found, leave in place.
> When done, run `/wrap-up-session`.

---

#### 7.17 - Release packaging and tag

**Prompt**:
> Context: Close v0.4.0.
> Goal: Re-run the full test pipeline (Phase 1 gate level); build VSIX via `npm run package`; build installers for Windows / macOS / Linux via `installer-smoke.yml` workflow_dispatch; finalize `CHANGELOG.md` v0.4.0 section with a summary paragraph per phase; create `v0.4.0` git tag; push tag to trigger `release.yml`.
> Files to modify: `CHANGELOG.md`.
> Acceptance criteria: Tagged release; all artifacts uploaded; VSIX installs cleanly on a fresh VS Code; installer runs end-to-end on all three OSes.
> Constraints: Do not publish to VS Code Marketplace unless explicitly requested - hold for user review.
> When done, run `/wrap-up-session` and `/generate-session-history`.

---

#### 7.18 - Testing and Stabilization

**Prompt**:
> Run the complete gate:
> - `npm run lint`
> - `npm run build`
> - `npm run test`
> - `pytest` (if backend retained, or `tests/golden/framework` only)
> - `npm run bench` and compare to `v0.4.0.json` baseline
> - golden-tasks workflow (live) against pinned Ollama
> - installer smoke on three OSes
> - `npm audit --production`, `pip audit`
> Fix every failure; iterate until green. Run `/generate-session-history` for Phase 7 and `/wrap-up-session` for the release.

---

### Phase 7 Exit Checklist

- [ ] All 18 sub-tasks completed (7.1-7.17, 7.18 stabilization)
- [ ] ~800 LOC removed (tracked in CHANGELOG)
- [ ] VSIX + installers built and archived
- [ ] v0.4.0 git tag pushed
- [ ] CHANGELOG finalized
- [ ] All 129 findings closed or deferred with rationale
- [ ] `/generate-session-history` run for Phase 7
- [ ] `/wrap-up-session` run for the release
- [ ] Ready to ship v0.4.0

---

## Coverage Matrix

Finding # references the P0 list in [docs/archive/versions/v0/v0.3.0/review.md](../v0.3.0/review.md) Section 4 (items 1-60) plus the grouped P2/P3 findings from Section 3.

| Review finding | Location in review | Sub-task |
|---|---|---|
| 1 | Marked XSS | 1.1 |
| 2 | Terminal cwd | 1.2 |
| 3 | FTS5 rowid | 1.3 |
| 4 | TaskDAG loop | 1.4 |
| 5 | GraphQueryEngine path | 1.5 |
| 6 | MemoryStore full scan | 1.6 |
| 7 | Tracer sync writes | 1.7 |
| 8 | Safety pipeline test | 1.8 |
| 9 | McpToolHandler tests | 1.9 |
| 10 | SessionListPanel tests | 1.10 |
| 11 | Benchmark gating | 1.11 |
| 12 | Golden-task CI | 1.12 |
| 13 | Python backend | 1.13 |
| 14 | GemmaCodePanel split | 1.14, 6.2 |
| 15 | GitSafetyNet diff | 3.1 |
| 16 | Double confirmation | 3.2 |
| 17 | Unregistered tools | 3.3 |
| 18 | recordTurnTokens | 3.4 |
| 19 | BudgetEnforcer branches | 3.5, 7.1 |
| 20 | ConversationSync try/catch | 3.6, 7.3 |
| 21 | GemmaCodePanel SRP | 6.2 |
| 22 | SSRF DNS | 2.1 |
| 23 | FastAPI auth/CORS | 2.2 |
| 24 | Shell blocklist | 2.3 |
| 25 | MCP spawn env/prompt | 2.4 |
| 26 | OTLP timeout/SSRF | 2.5 |
| 27 | mcp.json schema | 2.4 |
| 28 | Ollama poller alloc | 4.1 |
| 29 | getHistory clone | 4.2 |
| 30 | _postHistory re-render | 4.3 |
| 31 | Double webview post | 4.4 |
| 32 | Prompt rebuild every turn | 4.5 |
| 33 | searchSessions LIKE | 4.6 |
| 34 | computeAggregateMetrics | 4.7 |
| 35 | Graph BFS N+1 | 4.8 |
| 36 | ConversationSync appendFileSync | 4.9 (or 7.3) |
| 37 | Sleep-based tests | 5.1 |
| 38 | gitSafetyNet branch in AgentLoop tests | 5.2 |
| 39 | replan memory path | 5.3 |
| 40 | Typed mocks | 5.4 |
| 41 | Trivial-pass assertion | 5.5 |
| 42 | Python /models test | 5.6 |
| 43 | full-pipeline real loop | 5.7 |
| 44 | Conditional-live visibility | 5.8 |
| 45 | GoldenTaskSuite hardcoded count | 5.9 |
| 46 | ollama/types leakage | 6.4 |
| 47 | Composition root split | 6.2 (follow-through) |
| 48 | Safety/tools cycle | 6.3 |
| 49 | HTTP client dupe | 6.5 |
| 50 | Version drift | 1.15 |
| 51 | Dev setup | 6.14 |
| 52 | BudgetEnforcer deletion | 7.1 |
| 53 | LazyToolLoader deletion | 7.2 |
| 54 | HardwareTier/GpuTierConfig dup | 7.5 |
| 55 | python-multipart unused | 7.7 |
| 56 | highlight.min.js unused | 7.8 |
| 57 | memoryAutoSaveInterval unused | 7.10 |
| 58 | permissionOverrides unwired | 7.11 |
| 59 | maxSessionTokens/Minutes dead | 7.12 |
| 60 | MCP SDK tree-shake verification | (Phase 2 2.19 verify) |
| P2 CQ 51 (cosine dup) | 3.7 |
| P2 CQ 52 (FTS trigger dup) | 3.8 |
| P2 CQ 53 (nested JSON) | 3.9 |
| P2 CQ 54 (AgentLoop.run) | 3.10 |
| P2 CQ 55 (_buildBaseInstructions) | 3.11 |
| P2 CQ 56 (Orchestrator heuristic) | 3.12 |
| P2 CQ 57 (user_requested branch) | 3.13 |
| P2 CQ 58 (Grep regex) | 3.14 |
| P2 CQ 59 (Entity extractor) | 3.15 |
| P2 CQ 60 (randomUUID import) | 3.16 |
| P2 Sec 75 (ReDoS) | 2.6 |
| P2 Sec 76 (secret paths) | 2.7 |
| P2 Sec 77 (HTML-escape attr) | 2.8 |
| P2 Sec 78 (LIKE wildcards) | 2.9 |
| P2 Sec 79 (MCP schema) | 2.10 |
| P2 Sec 80 (pythonPath) | 2.11 |
| P2 Sec 81 (web_search sanitize) | 2.12 |
| P2 Sec 82 (FastAPI detail) | 2.13 |
| P2 Perf 63 (token estimate cache) | 4.10 |
| P2 Perf 64 (highlight.js scope) | 4.11 |
| P2 Perf 65 (graph DB dup) | 4.12 |
| P2 Perf 66 (FTS5 rebuild gate) | 4.13 |
| P2 Perf 67 (extractAndSave batch) | 4.14 |
| P2 Perf 68 (shared EmbeddingClient) | 4.15 |
| P2 Test 73 (weak assertions) | 5.10 |
| P2 Test 74 (extension.test.ts) | 5.11 |
| P2 Test (Grep tests) | 5.12 |
| P2 Test (real settings) | 5.13 |
| P2 Test (Windows cleanup) | 5.14 |
| P2 Test (Ollama backoff) | 5.15 |
| P2 Restructure (GoldenTaskSuite location) | 6.6 |
| P2 Restructure (PyQt5 reconsider) | deferred; tracked comment |
| P2 Restructure (installer smoke dedup) | 5.19, 6.15 |
| P2 Restructure (golden-tasks CI gate) | 1.12 (shared) |
| P2 Restructure (Tracer singleton) | 6.8 |
| P2 Restructure (settings injection) | 6.9 |
| P2 Restructure (error humanization) | 6.11 |
| P2 Simplification (declaration emit) | 7.9 |
| P2 Simplification (nightly.yml dedup) | 5.19 + 6.15 |
| P2 Simplification (gpuTier duplication) | 7.13 |
| P3 CQ 98 (unused import) | 3.17 |
| P3 CQ 99 (token count sentinel) | 3.17 |
| P3 CQ 100 (settings cache) | 3.17 |
| P3 CQ 101 (config-save error logging) | 3.17 |
| P3 CQ 102 (magic numbers) | 3.17 |
| P3 CQ 103 (Tier-2 assumption) | 3.17 |
| P3 CQ 104 (comment mismatch) | 3.18 |
| P3 (getRecommendedModel dead) | 3.19 |
| P3 (implicit TODOs) | 3.20 |
| P3 Sec 121 (SQLite perms) | 2.14 |
| P3 Sec 122 (Ollama installer checksum) | 2.15 |
| P3 Sec 123 (curl \| sh) | 2.16 |
| P3 Sec 124 (silent exceptions) | 2.17 |
| P3 Sec 125 (CSP directives) | 2.18 |
| P3 Perf 69 (stripCodeFences dup) | 4.16 |
| P3 Perf 70 (MemoryStore.retrieve alloc) | 4.17 |
| P3 Perf 71 (_postHistory payload) | 4.18 |
| P3 Perf 72 (retainContextWhenHidden) | 4.19 |
| P3 Perf extra (trim O(N^2)) | 4.20 |
| P3 Test (naming) | 5.16 |
| P3 Test (legacy NSIS) | 5.17 |
| P3 Test (golden caches) | 5.18 |
| P3 Test (integration/smoke boundary) | 5.19 |
| P3 Test (factories drift) | 5.20 |
| P3 Test (config-change reaction) | 5.21 |
| P3 Restructure (marked audit) | 6.16 |
| P3 Restructure (modes/ single file) | 6.7 |
| P3 Restructure (no ADR dir) | 6.13 |
| P3 Restructure (npm audit to CI) | 2.19 |
| P3 Simplification (escapeAttr alias) | 7.15 |
| P3 Simplification (parseOtlpHeaders) | 7.14 |
| P3 Simplification (GoldenTaskSuite helpers) | 7.16 |
| P3 Simplification (test:integration arg) | verification-only, no change |
| P3 Sec (OTLP defense-in-depth extra) | 2.18 (shared with CSP) |
| (Release) CHANGELOG + tag + publish | 7.17 |
| (ADR) Python backend decision | 6.1 (formalizes 1.13) |
| (Process) CI audit tooling | 2.19 |

Every finding from review Section 3 and Section 4 is addressed by at least one sub-task above.

---

## How to Begin

1. Open a new Claude Code session in this repository.
2. Open this file: `docs/archive/versions/v0/v0.4.0/implementation-plan.md`.
3. Copy the `**Prompt**` block from sub-task **1.1** and paste it into the Claude Code chat.
4. Follow the prompt to completion, run `/wrap-up-session` when Claude indicates the sub-task is done, then move to sub-task 1.2.
5. After completing all Phase 1 sub-tasks, verify the Phase 1 Exit Checklist, then proceed to Phase 2.
6. Each phase ends with a **Testing and Stabilization** sub-task that must pass before advancing.

v0.4.0 is ready to ship when every exit checklist is satisfied and `v0.4.0` is tagged.
