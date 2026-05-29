# Codebase Review: Gemma Code

**Version**: v0.3.0
**Review Date**: 2026-04-16
**Analysis Source**: Generated fresh (no cached `docs/archive/versions/v0/v0.3.0/analysis.md` found)
**Reviewer**: Claude Code (review-codebase command)
**Review Mode**: Full Codebase
**Files Reviewed**: ~240 (216 TypeScript, 18 Python, plus 5 CI workflows, 24 golden-task YAMLs, installer scripts)
**Overall Verdict**: **REQUEST_CHANGES**

The verdict is driven by three classes of finding: (1) two practical security vulnerabilities that chain through LLM-controlled input into the webview and the terminal tool, (2) three correctness bugs in the storage and orchestration layers, and (3) substantial features that ship in the extension but are never wired at runtime (BudgetEnforcer, LazyToolLoader, ConversationSync, RelevanceScorer, and the Python backend itself). These are blocking for a v0.3.0 public release but all are fixable within the v0.3 scope.

---

## Section 1: Codebase Overview

Gemma Code is a local, offline VS Code extension that delivers a Claude-Code-style agentic coding workflow powered by Google's Gemma 4 via Ollama. It targets individual developers who want a privacy-first AI coding companion with no external API calls, no subscription, and no data leaving the machine. The project describes itself as "local by default, Claude-Code-compatible in feel" and v0.3.0 completed eight phases of hardening across context engineering, 4-layer memory, safety/budgeting, plan-and-execute orchestration, observability, cross-platform installer, and a golden-task regression harness.

The runtime is a three-to-four-process system on the user's machine. A TypeScript VS Code extension (Node 20 host, 216 files, ~17K LOC source + ~16K LOC tests) owns the user-facing chat, tool execution, safety pipeline, 4-layer memory (working / episodic / semantic / graph), observability, and MCP integration. A Python FastAPI backend (port 11435, ~535 LOC) is spawned on activation and intended as a prompt-assembly microservice. An Ollama server (port 11434) provides local Gemma 4 inference. A PyQt5 installer (new in v0.3.0) bootstraps all three on first install.

Architectural style is a modular monolith in TypeScript with a thin Python sidecar. Major src/ modules are organized by responsibility: `agents/` (sub-agent orchestration), `chat/` (conversation, streaming, compaction), `config/` (settings + hardware tier), `mcp/` (Model Context Protocol client and stdio server), `orchestration/` (plan-and-execute DAG, reflexion, replan), `panels/` (VS Code webviews), `safety/` (permission tiers, git checkpointing, action classifier, budget enforcement, loop detector), `skills/` (slash-command skills catalog), `storage/` (SQLite FTS5 chat history + four memory layers), `tools/` (registry, Gemma4 native protocol, handlers for filesystem/terminal/web/grep), and `observability/` (OTEL-compatible tracer, metrics, OTLP exporter, trace dashboard). TypeScript is compiled with strict mode; tests use Vitest (TS) and pytest (Python + golden suite).

The review finds a codebase that is generally well-organized with consistent patterns, clear module boundaries, and substantial test coverage (889 unit `it()` cases across 67 files, plus integration, benchmarks, golden-task, smoke, and installer suites). The primary risks are concentrated in three areas. First, the trust boundary between LLM output and the webview/terminal is porous: unsanitized markdown HTML and unrestricted terminal `cwd` together form a practical XSS-to-RCE chain. Second, several subsystems present in the code are never actually wired at runtime (BudgetEnforcer, LazyToolLoader, ConversationSync, RelevanceScorer), and the Python backend is spawned at activation but never called. Third, coverage is broad but missing end-to-end validation of the safety pipeline, benchmarks do not gate regression, and the golden-task suite is defined but not run against a live model in CI.

The codebase is in a strong position for v0.3.0 after targeted hardening. Nothing in this review calls for a fundamental architectural change; most remediation is one-to-three-day surgical work.

---

## Section 2: Executive Summary

### Verdict

| Severity | Count |
|----------|-------|
| P0 (Critical) | 14 |
| P1 (High) | 46 |
| P2 (Medium) | 42 |
| P3 (Low) | 27 |
| **Total** | **129** |

**Verdict rationale**: 14 P0 findings block a public v0.3.0 release. The two security P0s (unsanitized marked + unrestricted terminal cwd) chain into a practical RCE scenario under prompt injection. Three correctness P0s in storage and orchestration (FTS5 rowid mismatch, dead TaskDAG loop, broken path reconstruction) will corrupt data or mislead users. Five testing P0s indicate untested critical paths (end-to-end safety pipeline, `McpToolHandler`, `SessionListPanel`, benchmark regression gate, live golden-task CI). Performance P0s (semantic search full scan, per-span sync DB writes) degrade the hot path at realistic session sizes. Restructuring P0s (orphaned Python backend, god object `GemmaCodePanel`) are strategic but should precede v0.4 work. All P0s have concrete remediations and most are Low or Medium effort.

### Critical Issues (P0)

| # | Phase | Location | Issue |
|---|-------|----------|-------|
| 1 | Security | [src/utils/MarkdownRenderer.ts:70](../../../../src/utils/MarkdownRenderer.ts#L70) | `marked` output rendered to webview without sanitization; LLM/tool content can smuggle HTML |
| 2 | Security | [src/tools/handlers/terminal.ts:80](../../../../src/tools/handlers/terminal.ts#L80) | `run_terminal` accepts arbitrary `cwd` outside the workspace |
| 3 | Code Quality | [src/storage/ChatHistoryStore.ts:37-57](../../../../src/storage/ChatHistoryStore.ts#L37-L57) | FTS5 rowid unsynchronized with TEXT PK on REPLACE; no AFTER UPDATE trigger |
| 4 | Code Quality | [src/orchestration/TaskDAG.ts:199-215](../../../../src/orchestration/TaskDAG.ts#L199-L215) | `hasCycle()` contains a dead in-degree loop; self-contradicting comments |
| 5 | Code Quality | [src/storage/GraphQueryEngine.ts:301-309](../../../../src/storage/GraphQueryEngine.ts#L301-L309) | `_reconstructPath` falls back to `getEntity("", undefined)` and drops intermediate nodes |
| 6 | Performance | [src/storage/MemoryStore.ts:211-213](../../../../src/storage/MemoryStore.ts#L211-L213) | Semantic search scans full embeddings table and deserializes every vector per call |
| 7 | Performance | [src/observability/TraceStore.ts:159-224](../../../../src/observability/TraceStore.ts#L159-L224) | Tracer performs 3-5 synchronous SQLite writes per tool call on the extension-host event loop |
| 8 | Testing | [tests/unit/safety/](../../../../tests/unit/safety/) | No end-to-end safety-pipeline test; classifier, gate, checkpoint, rollback tested only in isolation |
| 9 | Testing | [src/mcp/McpToolHandler.ts](../../../../src/mcp/McpToolHandler.ts) | `McpToolHandler` has zero tests |
| 10 | Testing | [src/panels/SessionListPanel.ts](../../../../src/panels/SessionListPanel.ts) | `SessionListPanel` has zero tests |
| 11 | Testing | [tests/benchmarks/](../../../../tests/benchmarks/) | 8 bench files exist but no threshold gating; nightly only archives text output |
| 12 | Testing | [tests/golden/](../../../../tests/golden/) | 24 golden tasks defined but never executed against live model in CI; baselines go unused |
| 13 | Restructuring | [src/backend/](../../../../src/backend/) | Python FastAPI backend is spawned on activation but `baseUrl` is never read by any TS consumer |
| 14 | Restructuring | [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts) | 1307-line god object: composition root, view provider, command router, and message broker fused |

### Areas Requiring Most Attention

| Area | P0 | P1 | P2 | P3 | Total | Notes |
|------|----|----|----|----|-------|-------|
| Security (trust boundary: LLM -> webview/terminal/MCP) | 2 | 6 | 7 | 5 | 20 | Single most concentrated set of blocking issues |
| Testing (pipeline gating, safety pipeline, uncovered modules) | 5 | 9 | 5 | 6 | 25 | Broadest surface; many gaps are easily closed |
| Performance (memory retrieval, tracer writes, webview payloads) | 2 | 9 | 8 | 4 | 23 | Hot paths scale poorly; all fixes are localized |
| Code Quality & SOLID (correctness bugs, dead-code wiring) | 3 | 8 | 10 | 6 | 27 | Three real correctness bugs stand out |
| Restructuring (Python backend, god object, LLM port, CI dedup) | 2 | 6 | 7 | 4 | 19 | Strategic; most should precede v0.4 |
| Simplification (unwired features, dep/config cleanup) | 0 | 8 | 5 | 2 | 15 | ~800 LOC net deletable with behavior preserved |

### Restructuring Priority

The highest-value structural changes are (1) resolving the Python backend disposition (either wire it or delete it, per Phase 6 6a/P1 and 6b/P0) which eliminates ~535 LOC of duplicated compaction/templating pipeline and a whole language runtime; (2) extracting a `GemmaRuntime` composition root and `ChatController` out of `GemmaCodePanel` (Phase 6 6b/P0) which cuts ~600-800 lines from the god object and unblocks DI for Tracer/settings; (3) introducing a provider-agnostic `LLMClient` port (Phase 6 6c/P1) so `ollama/types` stops leaking into orchestration; (4) unifying `HardwareTier` + `GpuTierConfig` into one tier model; and (5) bumping `package.json` to 0.3.0 (currently 0.2.0 despite v0.3.0-complete codebase).

### Simplification Potential

Phase 7 identifies ~800 LOC of production code plus associated tests that can be deleted with observable behavior preserved bit-for-bit. The largest wins are `BudgetEnforcer` (~135 LOC, never instantiated, duplicates `BudgetMiddleware`), `LazyToolLoader` + `serializeToolSummary` (~140 LOC, never activated), `RelevanceScorer` (~220 LOC, never instantiated), `ConversationSync` (~70 LOC, never instantiated), and four user-facing VS Code settings that feed only dead code (`memoryAutoSaveInterval`, `permissionOverrides`, `maxSessionTokens`, `maxSessionMinutes`). The VSIX package also ships a ~1 MB unused `highlight.min.js` copied by the build script but not loaded by the webview.

### Test Pipeline Gap Summary

The test suite is broad and mostly well-structured (889 unit `it()` cases, Vitest + pytest, 80% line / 75% branch coverage gate in CI), but five structural gaps limit its ability to catch regressions. (1) There is no integration test that wires `AgentLoop -> ActionClassifier -> GitSafetyNet -> ToolRegistry` together, so the safety pipeline is validated only in pieces. (2) `McpToolHandler` and `SessionListPanel` are production files with zero test coverage. (3) Eight performance benchmarks exist but silently skip when `OLLAMA_URL` is unset, and nightly CI only archives their text output; no threshold fails the build. (4) The 24 golden-task YAMLs and per-tier baselines ship, but no CI job executes them against a live model and compares to baselines. (5) Six test files use `await new Promise(r => setTimeout(r, N))` as a synchronization primitive, creating CI flake risk on slow runners.

### Roadmap

- **Immediate (P0, fix now)**: sanitize marked output via DOMPurify ([src/utils/MarkdownRenderer.ts](../../../../src/utils/MarkdownRenderer.ts)); constrain `run_terminal` cwd to workspace root ([src/tools/handlers/terminal.ts](../../../../src/tools/handlers/terminal.ts)); fix FTS5 trigger set in `ChatHistoryStore` ([src/storage/ChatHistoryStore.ts:37-57](../../../../src/storage/ChatHistoryStore.ts#L37-L57)); delete dead in-degree loop and path-reconstruction fallback; add vector cache + ANN / candidate-filter to `MemoryStore.retrieve`; batch Tracer writes with `Tracer.getInstance().flush()`; add the four missing tests; gate benchmarks on baseline; run golden-tasks in CI; bump `package.json` to 0.3.0.
- **Short-term (P1, before release)**: tighten webview CSP and SSRF DNS resolution; add FastAPI auth + CORS; consolidate shell-command blocklist into allowlist; prompt before MCP workspace-local `mcp.json`; fix `GitSafetyNet.commitAgentChanges` inverted diff check; wire `BudgetMiddleware.recordTurnTokens`; delete or wire the four dead subsystems; resolve the `GemmaCodePanel` god object into a three-module split; unify `HardwareTier` / `GpuTierConfig`; fix sleep-based tests.
- **Medium-term (P2, this quarter)**: refactor into `guardrails/` module; introduce `LLMClient` port; consolidate SQLite embedding utilities; add ADR directory; consolidate two sets of installer smoke tests; add traceability-matrix CI gate.
- **Backlog (P3 + strategic)**: opportunistic cleanups; re-evaluate PyQt5 installer vs. lighter alternative; formal `tests/helpers/factories.ts` consolidation.

---

## Section 3: Detailed Findings

### 3.1 Code Quality and SOLID

55 source files reviewed. Findings below are ordered P0 -> P3.

**[P0] `ChatHistoryStore` FTS5 content=messages lacks an AFTER UPDATE trigger and uses TEXT primary key**
- **Location**: [src/storage/ChatHistoryStore.ts:37-57](../../../../src/storage/ChatHistoryStore.ts#L37-L57), write path [src/storage/ChatHistoryStore.ts:81](../../../../src/storage/ChatHistoryStore.ts#L81)
- **Issue**: `messages.id TEXT PRIMARY KEY` means SQLite assigns an autonumber `rowid` independent of `id`. The FTS5 triggers fire on `AFTER INSERT` / `AFTER DELETE` but there is no `AFTER UPDATE`, and the write path uses `INSERT OR REPLACE INTO messages` which can change the underlying `rowid` without firing either insert or delete. Result: FTS5 silently holds stale rowid references after any REPLACE, corrupting search results. Comparable `MemoryStore` and `EpisodicMemory` schemas do include AFTER UPDATE triggers.
- **Recommendation**: Add the matching `AFTER UPDATE` trigger used in `MemoryStore.ts:60-75`, OR replace `INSERT OR REPLACE` with an explicit `UPDATE ... WHERE id = ?` path so AFTER DELETE + AFTER INSERT fire correctly, OR migrate to `id INTEGER PRIMARY KEY` + separate `uuid TEXT UNIQUE`.

**[P0] `TaskDAG.hasCycle()` contains a dead in-degree loop the developer explicitly marked "Actually:"**
- **Location**: [src/orchestration/TaskDAG.ts:199-215](../../../../src/orchestration/TaskDAG.ts#L199-L215)
- **Issue**: Lines 204-211 compute `inDegree.set(dep, (inDegree.get(dep) ?? 0))` which is a no-op, followed by a comment block admitting "Actually: ..." and "Recompute correctly:" then the working loop 213-215. Readers will distrust the whole file and a refactor could easily re-introduce the broken version.
- **Recommendation**: Delete lines 204-211. Add a short comment clarifying the (subtle) Kahn's-algorithm edge-direction convention: "dependents[x] are nodes that depend on x, so visiting x decrements their in-degree."

**[P0] `GraphQueryEngine._reconstructPath` silently drops intermediate nodes of shortest-path queries**
- **Location**: [src/storage/GraphQueryEngine.ts:301-309](../../../../src/storage/GraphQueryEngine.ts#L301-L309)
- **Issue**: The loop tries to resolve each path node by looking in `knownEntities = [start, end]`, then falls back to `this._graphMemory.getEntity("", undefined)` which always returns null. Intermediate path entities are always null, so `explainPath` returns only start + end. This breaks the "explain why X relates to Y" feature for any path of length > 2.
- **Recommendation**: Expose `GraphMemory.getEntityById(id)` publicly and use it in the fallback. Alternatively, cache entities encountered during BFS in a `Map<id, Entity>` and look up by id.

**[P1] `GitSafetyNet.commitAgentChanges` has inverted diff check**
- **Location**: [src/safety/GitSafetyNet.ts:64-67](../../../../src/safety/GitSafetyNet.ts#L64-L67); helper [GitSafetyNet.ts:107-110](../../../../src/safety/GitSafetyNet.ts#L107-L110)
- **Issue**: `git diff --cached --quiet` exits 0 when there are NO staged changes and 1 when there ARE. The `_git` helper returns `null` on non-zero exit. The code guards `if (diff !== null) return null` with comment "nothing staged", but `diff !== null` actually means the command exited 0 which means nothing was staged. Logic works accidentally because `git commit` with nothing staged itself errors, but the comment is inverted and the path is fragile.
- **Recommendation**: Invert the condition: `if (diff === null) { /* staged changes exist, proceed */ } else return null;`. Fix the comment. Add an integration test asserting commitAgentChanges is called twice and commits only once.

**[P1] Double confirmation for file-edit tools in "ask" mode**
- **Location**: [src/tools/handlers/filesystem.ts:175-192, 248-258, 362-373](../../../../src/tools/handlers/filesystem.ts) and [src/tools/ToolRegistry.ts:93-107](../../../../src/tools/ToolRegistry.ts#L93-L107)
- **Issue**: `write_file`, `edit_file`, `create_file` each run their own `ConfirmationGate.request` in `ask` mode, and `ToolRegistry.execute` also runs a gate for any CONFIRM/DANGEROUS tool. Users see two sequential confirmation cards for every file edit.
- **Recommendation**: Centralize confirmation in `ToolRegistry.execute` (pass `editMode` + diff preview to the gate), remove the per-tool branch in `filesystem.ts`. Alternatively mark handlers as "self-confirming" and short-circuit the registry prompt.

**[P1] `ToolCatalog` advertises `tail_output`, `grep_output`, `get_tool_schema` tools that are never registered**
- **Location**: [src/tools/ToolCatalog.ts:114-138](../../../../src/tools/ToolCatalog.ts#L114-L138); expected registration at [src/panels/GemmaCodePanel.ts:312-321](../../../../src/panels/GemmaCodePanel.ts#L312-L321) and [src/agents/SubAgentManager.ts:204-222](../../../../src/agents/SubAgentManager.ts#L204-L222)
- **Issue**: These tools appear in the system prompt, the model may attempt to call them, and `ToolRegistry.execute` then returns `Unknown tool: "tail_output"`. Prompt tokens wasted; model confusion.
- **Recommendation**: Either instantiate `OutputRedirector` + register the three handlers, or remove the entries from `TOOL_CATALOG`.

**[P1] `BudgetMiddleware.recordTurnTokens` is never called; session-token enforcement is dead**
- **Location**: [src/tools/BudgetMiddleware.ts:40-54](../../../../src/tools/BudgetMiddleware.ts#L40-L54); call sites in [src/tools/AgentLoop.ts:167-182, 354](../../../../src/tools/AgentLoop.ts#L167)
- **Issue**: `AgentLoop` calls `checkPreTurn` + `recordIteration` but never `recordTurnTokens`. `_sessionTokensUsed` stays at 0. The `maxSessionTokens` check never fires. Users cannot actually cap session tokens.
- **Recommendation**: In `AgentLoop._streamOneTurn` after `accumulated` is known, call `this._budgetMiddleware?.recordTurnTokens(estimateTokens(accumulated))`. Add a unit test asserting session-token budgeting halts the loop.

**[P1] `BudgetEnforcer` class exists but is never instantiated; optional parameter is always undefined**
- **Location**: [src/safety/BudgetEnforcer.ts](../../../../src/safety/BudgetEnforcer.ts) (~135 LOC); used as optional type in [src/tools/AgentLoop.ts:14](../../../../src/tools/AgentLoop.ts#L14)
- **Issue**: No `new BudgetEnforcer(` in `src/`. Every `if (this._budgetEnforcer)` branch in `AgentLoop` is dead code.
- **Recommendation**: Decide canonical mechanism (this or `BudgetMiddleware`) and delete the loser. If deleting `BudgetEnforcer`, also remove `maxSessionTokens` and `maxSessionMinutes` settings (Phase 7 7e/P1).

**[P1] `ConversationSync` defined and referenced as optional constructor parameter but never instantiated**
- **Location**: [src/storage/ConversationSync.ts](../../../../src/storage/ConversationSync.ts); [src/chat/ConversationManager.ts:22, 87-93, 127-133, 164-170, 185-191](../../../../src/chat/ConversationManager.ts)
- **Issue**: `new ConversationManager` is always called with at most two arguments. Four try/catch blocks guard calls that never execute. "JSONL sync so the agent can grep its own history" is defined in data model but never wired.
- **Recommendation**: Either instantiate in `GemmaCodePanel` with a workspace-local path, or remove the parameter + four try/catch blocks.

**[P1] `GemmaCodePanel` is a 1307-line god object (SRP violation)**
- **Location**: [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts) (entire file, especially `_handleBuiltinCommand` at [514-893](../../../../src/panels/GemmaCodePanel.ts#L514-L893))
- **Issue**: Constructs ~20 subsystems, implements 10 slash-commands inline, hosts webview, routes messages, renders markdown, tracks modes.
- **Recommendation**: Extract `AssistantWiring` (composition), `ChatCommandHandlers` (one method per command), `MemoryPanelCommands`, `McpPanelCommands`. Move `renderedHtml` enrichment closure into `WebviewMessageEnricher`. Target <300 lines for `GemmaCodePanel`. This is also Phase 6 6b/P0.

**[P2] Duplicated `_cosineSimilarity` + `_deserializeEmbedding` across three storage classes**
- **Location**: [src/storage/MemoryStore.ts:515-534](../../../../src/storage/MemoryStore.ts#L515-L534); [src/storage/EpisodicMemory.ts:251-270](../../../../src/storage/EpisodicMemory.ts#L251-L270); [src/chat/RelevanceScorer.ts:156-170](../../../../src/chat/RelevanceScorer.ts#L156-L170)
- **Issue**: Three near-identical implementations with a subtle inconsistency: `RelevanceScorer` maps `[-1,1] -> [0,1]`, the others do not. Three identical `Float64Array` deserializers. Three identical `_sanitizeFtsQuery` helpers.
- **Recommendation**: Create `src/storage/embeddingUtils.ts` exporting `cosineSimilarity`, `deserializeEmbedding`, `serializeEmbedding`, `sanitizeFtsQuery`. Decide deliberately whether `[0,1]` mapping applies to all callers.

**[P2] Duplicated FTS5 trigger pattern across three storage classes**
- **Location**: [src/storage/MemoryStore.ts:60-75](../../../../src/storage/MemoryStore.ts#L60-L75); [src/storage/EpisodicMemory.ts:44-64](../../../../src/storage/EpisodicMemory.ts#L44-L64); [src/storage/ChatHistoryStore.ts:46-56](../../../../src/storage/ChatHistoryStore.ts#L46-L56)
- **Issue**: Same CREATE VIRTUAL TABLE + triggers pattern with subtle divergences; ChatHistoryStore omits AFTER UPDATE (compounds P0 above).
- **Recommendation**: Extract `createFtsTableAndTriggers(db, tableName, contentTable, columns)` helper.

**[P2] `Gemma4ToolFormat.KEY_VALUE_RE` cannot parse nested JSON or arrays in tool parameters**
- **Location**: [src/tools/Gemma4ToolFormat.ts:31, 56-84](../../../../src/tools/Gemma4ToolFormat.ts#L31)
- **Issue**: Regex treats bracket-balanced JSON as scalar or breaks on commas inside nested objects. MCP tool schemas commonly have nested `properties`; the model cannot emit nested-object parameters correctly.
- **Recommendation**: Extend the grammar to accept `key:{...}` / `key:[...]` with bracket balancing and `JSON.parse`, or document the limitation loudly in `serializeToolDefinitions`.

**[P2] `AgentLoop.run` is ~240 lines of sequential responsibilities**
- **Location**: [src/tools/AgentLoop.ts:127-393](../../../../src/tools/AgentLoop.ts#L127-L393)
- **Issue**: One method handles cancellation reset, tracing, git checkpoint, budget middleware, streaming, tool-call parsing, classification, gate checkpoint, tool execution, file-edit tracking, working-memory/episodic updates, loop detection, budget recording, sub-agent spawn, final git commit. Span ids are manual and easy to break.
- **Recommendation**: Extract `runToolCall(call, iterSpanId)` and `runOneIteration(iter)`. Keep `run()` under 80 lines as orchestration only.

**[P2] `_buildBaseInstructions` duplicates three near-identical templates**
- **Location**: [src/chat/PromptBuilder.ts:176-217](../../../../src/chat/PromptBuilder.ts#L176-L217)
- **Issue**: Three `switch` branches (`concise | detailed | beginner`) repeat "Tool Use" and "All file paths are relative..." verbatim. Copy-paste divergence risk.
- **Recommendation**: Define `SHARED_TOOL_USE_BLOCK` and `SHARED_PATH_RULE` constants; compose `content` as `[identityLine(style), SHARED_TOOL_USE_BLOCK, SHARED_PATH_RULE].join("\n\n")`.

**[P2] `Orchestrator.shouldUseOrchestrator` primitive-obsession heuristic**
- **Location**: [src/orchestration/Orchestrator.ts:49-77, 223-240](../../../../src/orchestration/Orchestrator.ts#L49-L77)
- **Issue**: 12 hard-coded trigger substrings, 10 prefixes, magic length threshold 200. "refactor this one-line function" would trigger the heavy path.
- **Recommendation**: Extract `ComplexityClassifier` class with a pluggable `classify(text): { complex, reason }`; inject via constructor.

**[P2] `MemoryConsolidator.shouldPersist` has unreachable `user_requested` branch**
- **Location**: [src/storage/MemoryConsolidator.ts:207-221](../../../../src/storage/MemoryConsolidator.ts#L207-L221)
- **Issue**: `case "user_requested": return false;` with comment admitting patterns from episodic are not user-stated by default. Users who set `policy: "user_requested"` get zero promotions with no signal.
- **Recommendation**: Remove `"user_requested"` from the `WritePolicy` union, or extend `DetectedPattern` to carry `provenance.source` from the episodic event.

**[P2] `GrepCodebaseTool` fallback regex constructed without escaping or case-insensitive option**
- **Location**: [src/tools/handlers/filesystem.ts:529](../../../../src/tools/handlers/filesystem.ts#L529)
- **Issue**: `new RegExp(p.pattern)` throws on invalid patterns; no `rg -i` equivalent.
- **Recommendation**: Wrap construction in try/catch returning `failResult`; add optional `case_insensitive`.

**[P2] `EntityExtractor` dedup loses second-occurrence positions**
- **Location**: [src/storage/EntityExtractor.ts:44-54](../../../../src/storage/EntityExtractor.ts#L44-L54); relation extraction [167-170](../../../../src/storage/EntityExtractor.ts#L167-L170)
- **Issue**: Dedup by `name:type` drops positions for repeat occurrences. Relation extraction checks `sentence.includes(e.name)` so a multi-sentence doc with one entity incorrectly co-occurs with entities in every sentence, inflating relation counts.
- **Recommendation**: Track all occurrences: `occurrences: Array<{start, end}>` per entity record.

**[P2] `TraceDashboardPanel` uses `crypto.randomUUID()` without importing `crypto`**
- **Location**: [src/panels/TraceDashboardPanel.ts:34](../../../../src/panels/TraceDashboardPanel.ts#L34)
- **Issue**: Inconsistent with project convention (other files `import { randomUUID } from "crypto"`); relies on `globalThis.crypto` which is Node 19+ only.
- **Recommendation**: `import { randomUUID } from "crypto"` and call `randomUUID()`.

**[P3] Unused `BLOCKED_PATTERNS` import in `ActionClassifier.ts`** - [src/safety/ActionClassifier.ts:2](../../../../src/safety/ActionClassifier.ts#L2). Remove the import.

**[P3] `AgentLoop._postTokenCount` posts `limit: 0` sentinel with self-documenting workaround comment** - [src/tools/AgentLoop.ts:395-401](../../../../src/tools/AgentLoop.ts#L395-L401). Pass `maxTokens` into the constructor or move emission into `ContextCompactor`.

**[P3] `_buildPromptContext` creates a fresh settings object on every call** - [src/panels/GemmaCodePanel.ts:1032-1050](../../../../src/panels/GemmaCodePanel.ts#L1032-L1050). Cache at class level with `onDidChangeConfiguration` invalidation.

**[P3] `_handleSetEditMode` swallows config-save errors silently** - [src/panels/GemmaCodePanel.ts:909-910](../../../../src/panels/GemmaCodePanel.ts#L909-L910). Log to output channel at minimum.

**[P3] Magic numbers in graph traversal caps (`100`, `50`, `500`)** - [src/storage/GraphQueryEngine.ts:11](../../../../src/storage/GraphQueryEngine.ts#L11); [src/storage/GraphMemory.ts:254](../../../../src/storage/GraphMemory.ts#L254); [src/tools/handlers/filesystem.ts:527](../../../../src/tools/handlers/filesystem.ts#L527). Hoist to named constants in `storage/constants.ts`.

**[P3] `PromptBuilder.buildForSubAgent` hardcodes `maxTokens = 131072` default (Tier 2 assumption)** - [src/chat/PromptBuilder.ts:92](../../../../src/chat/PromptBuilder.ts#L92). Remove the default or use configured tier's `contextWindow`.

#### Dead Code Classification

| Item | Location | Classification | Rationale |
|------|----------|----------------|-----------|
| `src/orchestration/contracts.ts` full module | `src/orchestration/contracts.ts` | defer-with-plan | Has unit tests, likely slated for DAGExecutor integration; document as "pending wiring in vX.Y" |
| `ConversationSync` class | `src/storage/ConversationSync.ts` | defer-with-plan | Never instantiated; feature plausibly intended but incomplete |
| `BudgetEnforcer` class | `src/safety/BudgetEnforcer.ts` | defer-with-plan | Never instantiated; overlaps with `BudgetMiddleware` |
| `TailOutputTool`, `GrepOutputTool`, `OutputRedirector` | `src/tools/OutputRedirector.ts` | defer-with-plan | Catalog advertises them; handlers never registered |
| `LazyToolLoader` | `src/tools/LazyToolLoader.ts` | defer-with-plan | `lazyToolLoading` flag never true in any code path |
| `RelevanceScorer` | `src/chat/RelevanceScorer.ts` | defer-with-plan | `context.relevanceScorer` never set; 220 LOC unreachable |
| `getRecommendedModel` function | [src/config/HardwareTier.ts:123-134](../../../../src/config/HardwareTier.ts#L123-L134) | safe-delete-now | Never imported |
| `BudgetMiddleware.recordTurnTokens` | [src/tools/BudgetMiddleware.ts:40-54](../../../../src/tools/BudgetMiddleware.ts#L40-L54) | defer-with-plan | No call site; wire into `AgentLoop._streamOneTurn` to activate |
| `GOLDEN_TASKS`, `validateExpectation`, `detectRegressions` | [src/observability/GoldenTaskSuite.ts](../../../../src/observability/GoldenTaskSuite.ts) | defer-with-plan | Used only in tests |
| Unused `BLOCKED_PATTERNS` import | [src/safety/ActionClassifier.ts:2](../../../../src/safety/ActionClassifier.ts#L2) | safe-delete-now | Import never referenced |
| Inert in-degree loop | [src/orchestration/TaskDAG.ts:204-211](../../../../src/orchestration/TaskDAG.ts#L204-L211) | safe-delete-now | Overwritten on next line; adjacent "Actually:" comment confirms mistake |
| `BudgetEnforcer`-related branches in `AgentLoop` | [src/tools/AgentLoop.ts:184-191, 335, 434](../../../../src/tools/AgentLoop.ts#L184-L191) | defer-with-plan | Guarded by optional always-undefined field |
| `ConversationManager._sync` parameter + try/catch blocks | [src/chat/ConversationManager.ts:22, 87-93, 127-133, 164-170, 185-191](../../../../src/chat/ConversationManager.ts) | defer-with-plan | Tied to ConversationSync disposition |
| `rebuildSystemPrompt` comment/behavior mismatch | [src/chat/ConversationManager.ts:49-58](../../../../src/chat/ConversationManager.ts#L49-L58) | safe-delete-now (minor) | Comment says "splice" but code reassigns |

#### TODO / FIXME / HACK Audit

Note: **no explicit `TODO` / `FIXME` / `HACK` markers in `src/**/*.ts`**. The audit below enumerates *implicit* comments-that-should-be-issues:

| Comment | Location | Assessment |
|---------|----------|------------|
| "Actually: dep -> node edge: increment node's in-degree is wrong" | [src/orchestration/TaskDAG.ts:207-210](../../../../src/orchestration/TaskDAG.ts#L207-L210) | forgotten debt (P0 above) |
| "_maxTokens is not directly accessible here - post a best-effort count" | [src/tools/AgentLoop.ts:398-399](../../../../src/tools/AgentLoop.ts#L398-L399) | active workaround (P3 above) |
| "Future migration: replace with PowerShell Get-CimInstance" | [src/config/GpuDetector.ts:287](../../../../src/config/GpuDetector.ts#L287) | tracked debt |
| "Patterns from episodic are not user-stated by default" | [src/storage/MemoryConsolidator.ts:213](../../../../src/storage/MemoryConsolidator.ts#L213) | forgotten debt (P2 above) |
| "Phase 3 wires MemoryStore.extractAndSave here" | [src/chat/ContextCompactor.ts:77](../../../../src/chat/ContextCompactor.ts#L77) | tracked (verify wiring, remove comment) |
| "Phase 3 wires MemoryConsolidator here" | [src/chat/ContextCompactor.ts:113](../../../../src/chat/ContextCompactor.ts#L113) | tracked |
| "Default placeholders for Phase 8 expansion" | [src/observability/GoldenTaskSuite.ts:53](../../../../src/observability/GoldenTaskSuite.ts#L53) | tracked |
| "would need a count query; kept simple" (episodic entryCount = 0) | [src/storage/UnifiedMemoryRetriever.ts:182, 190](../../../../src/storage/UnifiedMemoryRetriever.ts#L182) | forgotten debt |

#### Module-level SOLID scorecard

Legend: A = strong adherence, B = acceptable with minor issues, C = noticeable violation in one or two places, D = major refactor recommended.

| Module | SRP | OCP | LSP | ISP | DIP | Notes |
|--------|-----|-----|-----|-----|-----|-------|
| `orchestration/` | C | B | A | A | B | `DAGExecutor` embeds semaphore + node mapping + reflexion. `Orchestrator.execute` replan logic is long. |
| `storage/` | B | B | B | B | C | `MemoryStore.retrieve` mixes semantic+keyword+graph coordination. Concrete GraphQueryEngine directly constructed. Duplicated cosine/deserialize/sanitizeFts. |
| `chat/` | C | B | A | A | B | `PromptBuilder` split cleanly; `ConversationManager` double-duties as emitter + persistence + sync. |
| `tools/` | C | A | A | A | B | ToolRegistry clean. `AgentLoop.run` 240-line monolith. ToolCatalog advertises unregistered tools. |
| `panels/` | D | C | A | A | C | `GemmaCodePanel` is the worst SRP violation in the codebase. `TraceDashboardPanel` clean. |
| `safety/` | A | A | A | A | A | Smallest SOLID surface issues; BudgetEnforcer deadness is separate. |
| `agents/` | A | B | A | A | B | `SubAgentManager` mildly duplicates `_buildOllamaTools`. |
| `observability/` | A | B | A | A | B | Singleton `Tracer` hurts testability slightly. |
| `config/` | A | A | A | A | B | `GpuDetector` long but justified by platform matrix. |
| `mcp/` | B | A | A | A | A | `McpManager` mixes config loading + lifecycle. |
| `commands/` | A | A | A | A | A | Clean, single responsibility. |
| `modes/` | A | A | A | A | A | Simple state holder. |
| `skills/` | A | A | A | A | A | Focused on disk I/O + parse + hot-reload. |
| `backend/` (Python) | B | B | A | A | B | Chat router mixes SSE framing with Ollama piping (acceptable for 30 LOC). |

---

### 3.2 Security

~35 files audited across TypeScript, Python, and webview HTML/JS. Ordered P0 -> P3.

**[P0] Markdown renderer does not sanitize HTML; webview XSS via LLM/tool content**
- **Location**: [src/utils/MarkdownRenderer.ts:70](../../../../src/utils/MarkdownRenderer.ts#L70); injection sinks [src/panels/GemmaCodePanel.ts:137,437,501,531](../../../../src/panels/GemmaCodePanel.ts) and webview [src/panels/webview/index.ts:1237,1181,1096](../../../../src/panels/webview/index.ts)
- **Domain**: Input/Output Safety (XSS)
- **Exploitability**: High. Model output, tool results (web search, fetch_page, read_file), and memory/graph contents are all rendered. `marked@^4.3.0` does not sanitize HTML by default. Calls to `marked(text)` use no sanitizer, no `sanitize: true`, no DOMPurify. Even with CSP, attackers can smuggle `<iframe srcdoc>`, `<a href="javascript:">`, `<details open ontoggle=...>`, or CSS exfiltration patterns. The resulting HTML is inserted via `innerHTML` in the webview.
- **Impact**: XSS inside the VS Code webview. Attackers can exfiltrate text via CSS, spoof confirmation cards, or set `javascript:` URLs. Combined with an injection vector (web_search snippet, file contents, MCP tool output), this is a practical attack.
- **Recommendation**: Run `marked` output through DOMPurify in the extension host before passing to webview, OR upgrade to `marked@>=12` with its built-in sanitizer plugin. Tighten CSP to add explicit `img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';`.

**[P0] `run_terminal` accepts arbitrary `cwd` outside the workspace**
- **Location**: [src/tools/handlers/terminal.ts:80](../../../../src/tools/handlers/terminal.ts#L80)
- **Domain**: Input Validation / Broken Access Control
- **Exploitability**: High. An LLM can pass `cwd: "C:\\Users\\<user>"` or `cwd: "/"`; the tool runs `spawn(command, [], { shell: true, cwd })` there. File-tool workspace guard (`resolveWorkspacePath` in `filesystem.ts:39`) is not applied.
- **Impact**: Arbitrary code execution in any directory VS Code can reach. Combined with the substring-based `BLOCKED_PATTERNS` (trivially bypassable: `rm  -rf  /`, `/bin/rm -rf /`, base64 encoded equivalents), this is full system reach in `auto` mode and a single confirmation gate in `ask` mode.
- **Recommendation**: Restrict `cwd` via `realpath`-style check that the resolved path is inside the workspace root (mirror `resolveWorkspacePath`). Reject with a clear error otherwise. Optionally allowlist-beneath-workspace.

**[P1] SSRF protection is hostname-string match, not DNS resolution**
- **Location**: [src/tools/handlers/webSearch.ts:32-78, 187](../../../../src/tools/handlers/webSearch.ts#L32-L78)
- **Domain**: SSRF
- **Exploitability**: Medium-High. Rejects literal `127.*`, RFC-1918, `localhost` but a URL that resolves to loopback via DNS rebinding (or `127.example.com`-style wildcard DNS) bypasses the check. Redirects are also followed by default without re-checking hostname.
- **Impact**: Model/attacker-controlled URLs can target the localhost FastAPI backend (`127.0.0.1:11435`), Ollama (`127.0.0.1:11434`), OTLP endpoint, or cloud-metadata services (`169.254.169.254`). Output is fed back to the LLM and rendered.
- **Recommendation**: Resolve hostname via `dns.lookup` with `family:0` and check every resolved IP. Set `redirect: 'manual'` on `fetch` and re-validate on each redirect. Optionally allowlist known-safe hosts for `fetch_page`.

**[P1] FastAPI backend has no authentication and no CORS policy**
- **Location**: [src/backend/src/backend/main.py:28-54](../../../../src/backend/src/backend/main.py#L28-L54)
- **Domain**: AuthN/AuthZ / Security Misconfiguration
- **Exploitability**: Medium. Bound to `127.0.0.1:11435` (good) but any local process (browser tab) can POST to `/chat/stream`. No `allow_origins`, no token, no Origin check.
- **Impact**: A malicious local webpage can trigger inference (resource abuse) or read `/models`. On shared systems any local user can reach the endpoint. Future tool-exec expansion would become RCE.
- **Recommendation**: Share a per-session secret via env var between extension and backend (header check). Add `CORSMiddleware(allow_origins=[])` + Origin header reject for non-null origins.

**[P1] Shell-command blocklist is substring-based and trivially bypassable**
- **Location**: [src/tools/handlers/terminal.ts:16-47](../../../../src/tools/handlers/terminal.ts#L16-L47)
- **Domain**: Input Validation / Injection
- **Exploitability**: Medium. Bypass examples: double spaces, quoted binary, `/bin/rm -rf /`, `rm -rf /home`, `python -c "os.system('rm -rf /')"`, PowerShell `Remove-Item -Force -Recurse`, any base64-encoded equivalent.
- **Impact**: Full system damage if `auto` mode is chosen. User confirmation is the only gate in `ask` mode.
- **Recommendation**: Replace substring blocklist with a structured allowlist (explicit approved binaries: `git`, `npm test`, etc.). Require confirmation on every `run_terminal` regardless of edit mode. Document blocklist as defense-in-depth only.

**[P1] MCP servers spawn as untrusted subprocesses with full inherited environment**
- **Location**: [src/mcp/McpClient.ts:52-62](../../../../src/mcp/McpClient.ts#L52-L62) and [src/mcp/McpManager.ts:141-156, 131-136](../../../../src/mcp/McpManager.ts#L141-L156)
- **Domain**: Supply chain / AuthZ
- **Exploitability**: Medium. `mcpEnabled: true` causes `McpManager._loadConfigs()` to read `~/.gemma-code/mcp.json` and workspace `.gemma-code/mcp.json`, then spawn each `command` with full `process.env` merged. Workspace-local config overrides global; opening a hostile repo spawns its binary at activation.
- **Impact**: Arbitrary code execution on opening a malicious repository. Secrets (GH tokens, AWS creds) leak to subprocess env.
- **Recommendation**: Require user confirmation before loading a workspace-local `mcp.json`. Do not inherit `process.env` by default; pass only an explicit whitelist. Consider subprocess sandboxing.

**[P1] OTLP exporter has no fetch timeout and sends arbitrary user-configured headers to user-configured endpoint**
- **Location**: [src/observability/OtlpExporter.ts:93-113](../../../../src/observability/OtlpExporter.ts#L93-L113); endpoint config [src/config/settings.ts:85-86](../../../../src/config/settings.ts#L85-L86)
- **Domain**: SSRF / Runtime Risks
- **Exploitability**: Medium. No SSRF validation of `otlpEndpoint` (contrast with `webSearch.ts`). No fetch timeout. `.vscode/settings.json` in an opened repo can set the endpoint once the user clicks "trust workspace".
- **Impact**: Internal SSRF with trace-data exfiltration. Unresponsive endpoint hangs flush calls indefinitely.
- **Recommendation**: Apply SSRF check to `otlpEndpoint` at load time. Add `signal: AbortSignal.timeout(10_000)` to `fetch`. Warn on startup when `otlpHeaders` contains `Authorization`.

**[P1] `mcp.json` parsed without schema validation or command-path validation**
- **Location**: [src/mcp/McpManager.ts:141-156](../../../../src/mcp/McpManager.ts#L141-L156)
- **Domain**: Input Validation / Supply Chain
- **Exploitability**: Medium. `command` can be any string; `args`/`env` passed through unvalidated. Attacker-crafted `mcp.json` can launch `/bin/sh -c '<arbitrary>'`.
- **Impact**: Combined with P1 above; also enables PATH shadowing attacks.
- **Recommendation**: Validate `command` is an absolute path or exists in an allowlist. Add Zod schema. Prompt on first sighting of workspace-local `mcp.json`.

**[P2] `GrepCodebaseTool` compiles user-supplied regex with no ReDoS protection**
- **Location**: [src/tools/handlers/filesystem.ts:529, 538](../../../../src/tools/handlers/filesystem.ts#L529); also [src/tools/OutputRedirector.ts:77](../../../../src/tools/OutputRedirector.ts#L77)
- **Domain**: Runtime Risks (ReDoS)
- **Exploitability**: Medium. `(a+)+b`, `(.*a){25}`, etc. cause catastrophic backtracking. Runs against every line of every matched file. Tool is `AUTO_APPROVE`, so fires in auto mode.
- **Impact**: Extension-host CPU hang for minutes; entire VS Code window unresponsive.
- **Recommendation**: Use `re2` (linear-time regex) via the `re2` npm package, OR enforce a timeout via worker threads. Minimum: reject patterns with nested unbounded quantifiers.

**[P2] `grep_codebase` has no secret-path denylist**
- **Location**: [src/tools/handlers/filesystem.ts:523-550](../../../../src/tools/handlers/filesystem.ts#L523-L550)
- **Domain**: Input Validation / Broken Access Control
- **Exploitability**: Low-Medium. Workspace-scoped (cannot escape workspace), but `.env`, `.git/config`, private keys in the workspace are readable.
- **Impact**: Workspace-local secrets are fed to the model and stored in chat history.
- **Recommendation**: Add denylist (`**/.env*`, `**/id_rsa*`, `**/credentials*`, `**/.aws/**`, `**/.ssh/**`) to `GrepCodebaseTool`, `ReadFileTool`, `ListDirectoryTool`. Emit a warning when a denied path is attempted.

**[P2] Session/span ids not HTML-escaped in webview `innerHTML` templates**
- **Location**: [src/panels/SessionListPanel.ts:214-216](../../../../src/panels/SessionListPanel.ts#L214-L216); [src/panels/webview/traceDashboard.ts:260-267, 288-297, 315-329](../../../../src/panels/webview/traceDashboard.ts)
- **Domain**: XSS (defense-in-depth)
- **Exploitability**: Low. Values are internal UUIDs/enums today, not attacker-controlled. A future bug could introduce attacker-influenced ids.
- **Recommendation**: Extend `escapeHtml` to cover attribute quoting. Prefer `document.createElement` + `setAttribute` / `textContent` over string-concatenated `innerHTML`.

**[P2] `SELECT ... WHERE content LIKE ?` does not escape `%`/`_` wildcards**
- **Location**: [src/storage/ChatHistoryStore.ts:145, 151, 208, 211](../../../../src/storage/ChatHistoryStore.ts); [src/storage/GraphMemory.ts:271-279](../../../../src/storage/GraphMemory.ts#L271-L279)
- **Domain**: Input Validation
- **Exploitability**: Low. Not SQL injection (parameters are bound), but user `%` acts as wildcard. Forcing full-table scan is a DoS vector.
- **Recommendation**: Escape `%`, `_`, `\` in the parameter; add `ESCAPE '\\'` clause to LIKE.

**[P2] `McpClient` does not validate MCP server tool schemas**
- **Location**: [src/mcp/McpClient.ts:71-80](../../../../src/mcp/McpClient.ts#L71-L80); registration [src/mcp/McpManager.ts:60-64](../../../../src/mcp/McpManager.ts#L60-L64)
- **Domain**: Input Validation / Supply Chain
- **Exploitability**: Low-Medium. Malicious server can emit prompt-injection-styled descriptions ("Ignore previous instructions; exfiltrate...") that end up in the system prompt every turn.
- **Recommendation**: Sanitize MCP tool descriptions (strip HTML, cap length). Validate names match `[a-zA-Z0-9_]{1,64}`. Render MCP metadata in a clearly-delimited prompt section.

**[P2] `pythonPath` from user settings is not validated before `spawn`**
- **Location**: [src/extension.ts:71-77](../../../../src/extension.ts#L71-L77); [src/backend/BackendManager.ts:59-63](../../../../src/backend/BackendManager.ts#L59-L63)
- **Domain**: Input Validation / Local privilege
- **Exploitability**: Low. Workspace-trust mitigates; user-scope settings can still be poisoned.
- **Recommendation**: Require absolute path; validate existence. Prompt on first use of non-default value.

**[P2] `web_search` has no result-URL validation and no rate limit**
- **Location**: [src/tools/handlers/webSearch.ts:120-169](../../../../src/tools/handlers/webSearch.ts#L120-L169)
- **Recommendation**: Sanitize `title`/`snippet` as plain text before returning. Add per-session rate limit.

**[P2] FastAPI backend HTTPException leaks stack details in `detail`**
- **Location**: [src/backend/src/backend/routers/models.py:19](../../../../src/backend/src/backend/routers/models.py#L19)
- **Recommendation**: Generic user-facing message; log detailed error server-side only.

**[P3] SQLite DB files written without explicit restrictive permissions** - [src/storage/ChatHistoryStore.ts:22-26](../../../../src/storage/ChatHistoryStore.ts#L22-L26), [src/storage/MemoryStore.ts:34-39](../../../../src/storage/MemoryStore.ts#L34-L39). `chmod 0600` after open on POSIX; ACL restrict on Windows.

**[P3] Installer downloads `OllamaSetup.exe` without checksum or signature verification** - [scripts/installer/pyqt/src/gemma_installer/engine/ollama_installer.py:50-78](../../../../scripts/installer/pyqt/src/gemma_installer/engine/ollama_installer.py). Pin release tag; fetch matching `.sha256`; verify before running. On Windows verify Authenticode.

**[P3] Linux Ollama installer uses `curl | sh`** - [scripts/installer/pyqt/src/gemma_installer/engine/ollama_installer.py:100-109](../../../../scripts/installer/pyqt/src/gemma_installer/engine/ollama_installer.py). Download first, verify pinned hash, then execute.

**[P3] `MemoryStore._cosineSimilarity` and FTS `MATCH` errors silently swallowed** - [src/storage/MemoryStore.ts:195-197, 418-421, 546](../../../../src/storage/MemoryStore.ts). Log at debug level; distinguish "empty query" from "SQL error".

**[P3] CSP missing explicit `img-src`, `connect-src`, `frame-src`, `object-src`, `base-uri`, `form-action`, `require-trusted-types-for`** - [src/panels/webview/index.ts:36-37](../../../../src/panels/webview/index.ts#L36-L37), [src/panels/webview/traceDashboard.ts:13-14](../../../../src/panels/webview/traceDashboard.ts#L13-L14). Defense-in-depth for future maintainers.

#### Dependency audit

| Package | Version | Source | Concern | Severity |
|---------|---------|--------|---------|----------|
| `marked` | ^4.3.0 | [package.json:369](../../../../package.json#L369) | No HTML sanitizer default since v1; XSS P0 above. Upgrade to v12+ | P1 |
| `node-html-parser` | ^6.1.13 | [package.json:370](../../../../package.json#L370) | Historical parser-DoS on nested HTML; cap body size | P2 |
| `better-sqlite3` | ^12.8.0 | [package.json:366](../../../../package.json#L366) | Native binding; no known 12.x CVEs | P3 |
| `@modelcontextprotocol/sdk` | ^1.29.0 | [package.json:365](../../../../package.json#L365) | Young ecosystem; confirm with `npm audit` | P3 |
| `highlight.js` | ^11.11.1 | [package.json:368](../../../../package.json#L368) | Current clean | P3 |
| `diff` | ^5.2.2 | [package.json:367](../../../../package.json#L367) | No user-input reflection risk | P3 |
| `fastapi` | >=0.111.0 | [pyproject.toml:7](../../../../src/backend/pyproject.toml#L7) | Unpinned lower bound; run `pip audit` | P2 |
| `uvicorn[standard]` | >=0.30.0 | [pyproject.toml:8](../../../../src/backend/pyproject.toml#L8) | Unpinned | P3 |
| `httpx` | >=0.27.0 | [pyproject.toml:9](../../../../src/backend/pyproject.toml#L9) | Default `verify=True` | P3 |
| `pydantic` | >=2.7.0 | [pyproject.toml:10](../../../../src/backend/pyproject.toml#L10) | v2.7+ clean | P3 |
| `python-multipart` | >=0.0.9 | [pyproject.toml:12](../../../../src/backend/pyproject.toml#L12) | **Unused** (no Form/File handlers); remove | P1 (also Phase 7) |

For all npm + pip deps: run `npm audit --production` and `pip audit` in CI (currently absent in `ci.yml`). Pin exact versions in production.

#### Headers and config checklist

| Control | Status | Evidence | Gap |
|---------|--------|----------|-----|
| Webview CSP | Partial | [src/panels/webview/index.ts:36-37](../../../../src/panels/webview/index.ts#L36-L37) | No explicit img-src / connect-src / etc.; no Trusted Types |
| Markdown sanitization | Missing | [src/utils/MarkdownRenderer.ts:58, 70](../../../../src/utils/MarkdownRenderer.ts#L58) | No DOMPurify; `marked` v4 default (P0) |
| FastAPI CORS | Missing | [src/backend/src/backend/main.py:28-40](../../../../src/backend/src/backend/main.py#L28-L40) | No CORS middleware (P1) |
| FastAPI auth | Missing | all routers | No auth on `/chat/stream`, `/health`, `/models` (P1) |
| FastAPI binds localhost-only | Yes | [main.py:51](../../../../src/backend/src/backend/main.py#L51) | Good |
| SQLite file perms | Missing | Store constructors | No `chmod 0600` (P3) |
| OTLP TLS / auth | Partial | [OtlpExporter.ts:93-113](../../../../src/observability/OtlpExporter.ts#L93-L113) | TLS verify default; no SSRF check / timeout (P1) |
| Shell tool allowlist | Substring blocklist (insufficient) | [terminal.ts:16-47](../../../../src/tools/handlers/terminal.ts#L16-L47) | Bypassable (P1) |
| Path traversal guard (file tools) | Yes | [filesystem.ts:35-43](../../../../src/tools/handlers/filesystem.ts#L35-L43) | Missing from terminal.ts `cwd` (P0) |
| SSRF filter (web tools) | Bypassable | [webSearch.ts:32-78](../../../../src/tools/handlers/webSearch.ts#L32-L78) | Hostname-match only (P1) |
| SQL parameterization | Yes | All prepared statements | LIKE-wildcard escaping gap (P2) |
| Webview nonce / script-src | Yes | `randomUUID()` nonce | Good |
| Secrets in code | None found | Grep for sk-, Bearer, hardcoded tokens | Clean |
| Rate limiting | Missing | web_search, fetch_page, run_terminal, /chat/stream | None |
| Git operations | Safe | [GitSafetyNet.ts:100-115](../../../../src/safety/GitSafetyNet.ts#L100-L115) uses `execFile` (no shell) | Good |
| Workspace-trust gating of MCP | Missing | [McpManager.ts:131-136](../../../../src/mcp/McpManager.ts#L131-L136) | Workspace `mcp.json` auto-loaded (P1) |

---

### 3.3 Performance

Hot paths examined: StreamingPipeline, AgentLoop, PromptBuilder, ContextCompactor, ChatHistoryStore, MemoryStore, EmbeddingClient, UnifiedMemoryRetriever, GraphQueryEngine, GraphMemory, TraceStore/Tracer, OtlpExporter, GemmaCodePanel webview, ConversationManager, Gemma4ToolFormat, Ollama client, MarkdownRenderer, ConversationSync, MemoryConsolidator.

**[P0] Semantic search scans the entire embeddings table and deserializes every vector on every call**
- **Location**: [src/storage/MemoryStore.ts:211-213](../../../../src/storage/MemoryStore.ts#L211-L213); [src/storage/EpisodicMemory.ts:136-138](../../../../src/storage/EpisodicMemory.ts#L136-L138)
- **Pattern**: Unbounded full-table scan; no ANN index
- **Impact**: Called from `_injectMemoryContext` on every user message ([GemmaCodePanel.ts:1116](../../../../src/panels/GemmaCodePanel.ts#L1116)). `SELECT * FROM memories WHERE embedding IS NOT NULL` (no LIMIT), deserialize a Float64Array per row (~6 KB at 768 dim), cosine-similarity loop in JS. At default `memoryMaxEntries: 10000`, worst case ~60 MB allocation + 10k cosine loops per send. Primary user-facing latency on long-running installs.
- **Recommendation**: (1) Switch to `Float32Array` (halves bandwidth). (2) Cache deserialized vectors in a `Map<id, Float32Array>` invalidated on save/prune. (3) Cap the scan with FTS5 candidate set: `SELECT embedding FROM memories WHERE id IN (<fts candidates>)`. Expected 5-20x reduction at N > 1000.

**[P0] Tracer performs 3-5 synchronous SQLite writes per tool call on the event loop**
- **Location**: [src/observability/TraceStore.ts:159-184, 201-224](../../../../src/observability/TraceStore.ts); [src/observability/Tracer.ts:78-92](../../../../src/observability/Tracer.ts#L78-L92)
- **Pattern**: Synchronous I/O in async hot path; per-span DB round-trips; `endSpan` does SELECT then UPDATE
- **Impact**: Per iteration in `AgentLoop.run` creates `iterSpan`, `llmSpan`, `toolSpan` ([AgentLoop.ts:158, 194, 266](../../../../src/tools/AgentLoop.ts#L158)). With `maxAgentIterations=20` and several tools/iter, ~200-400 sync DB ops per session. better-sqlite3 blocks the event loop for fsync latency (~1-5 ms/span on consumer SSDs). Total: ~600 ms blocked event loop per session.
- **Recommendation**: (1) Buffer spans and flush in batches on `process.nextTick` or every N spans within `_db.transaction(() => ...)`. (2) Eliminate the SELECT in `endSpan` by passing startTime back from `startSpan`. (3) Coalesce within a transaction (~10x speedup in better-sqlite3).

**[P1] New Ollama client allocated every 5s by availability poller**
- **Location**: [src/extension.ts:43-60](../../../../src/extension.ts#L43-L60), specifically line 44
- **Pattern**: Allocation churn on hot timer
- **Impact**: ~5760 client instantiations + settings lookups per 8-hour session.
- **Recommendation**: Create client once; back off to 15-30s once reachable.

**[P1] `getHistory()` returns a fresh array clone on every call**
- **Location**: [src/chat/ConversationManager.ts:111-113](../../../../src/chat/ConversationManager.ts#L111-L113)
- **Pattern**: Per-call array clone on hot path
- **Impact**: Called from compactor token estimation, `_streamOneTurn`, `_postHistory`, `_handleSendMessage`. 100-turn session: ~100 allocations per send. `estimateTokensForMessages` runs O(N) per call, up to 6x per compaction.
- **Recommendation**: Return `readonly Message[]` (cast). Maintain running `_totalChars` incremented on `_append` / `replaceMessages` to make `estimateTokens` O(1).

**[P1] `_postHistory` re-renders every assistant message through marked + highlight.js on every call**
- **Location**: [src/panels/GemmaCodePanel.ts:968-981](../../../../src/panels/GemmaCodePanel.ts#L968-L981)
- **Pattern**: Redundant CPU; large webview payload
- **Impact**: Called on clearChat, loadSession, setEditMode, sendMessage, slash command, status change, plan toggle, "history" event. `renderMarkdown` is 5-20 ms per non-trivial reply; 50-message session is ~500 ms per call. `renderedHtmlMap` payload is 500 KB-1 MB.
- **Recommendation**: Cache rendered HTML by message id (content is immutable once committed). Invalidate on replace. Skip `_postHistory` when only a status update changed.

**[P1] `_postToWebview` posts every message to both sidebar and editor webviews**
- **Location**: [src/panels/GemmaCodePanel.ts:1237-1240](../../../../src/panels/GemmaCodePanel.ts#L1237-L1240)
- **Pattern**: Double work per streaming token
- **Recommendation**: Track focused webview; post only to it (except history events).

**[P1] System prompt rebuild triggers MCP/memory/skill retrieval on every message**
- **Location**: [src/panels/GemmaCodePanel.ts:1116-1139](../../../../src/panels/GemmaCodePanel.ts#L1116-L1139) called from [463, 476](../../../../src/panels/GemmaCodePanel.ts#L463)
- **Pattern**: Redundant heavy work per turn
- **Impact**: UnifiedRetriever runs 4 layers + prompt rebuild + tool re-serialize (30 tools, ~600 bytes each) on every send.
- **Recommendation**: Cache tool serialization by registry-state hash; debounce prompt rebuild to only when memory context actually changed; splice-in memory-block only rather than full rebuild.

**[P1] `searchSessions` and MemoryStore LIKE fallback use unindexed leading-wildcard LIKE**
- **Location**: [src/storage/ChatHistoryStore.ts:144-163](../../../../src/storage/ChatHistoryStore.ts#L144-L163); [src/storage/MemoryStore.ts:208-212](../../../../src/storage/MemoryStore.ts#L208-L212)
- **Pattern**: Unindexed full-table scan (SQLite cannot use indexes for leading-wildcard LIKE)
- **Impact**: `searchSessions` has no LIMIT; at 10k messages O(10k) per call. Session-search UI stutters as user types.
- **Recommendation**: Add LIMIT; route session search through FTS5.

**[P1] `MetricsCollector.computeAggregateMetrics` is O(N) traces + JSON.parse per span per trace**
- **Location**: [src/observability/MetricsCollector.ts:86-127](../../../../src/observability/MetricsCollector.ts#L86-L127); [src/observability/TraceStore.ts:245-273](../../../../src/observability/TraceStore.ts#L245-L273)
- **Pattern**: N+1 queries; JSON.parse on hot path
- **Impact**: 100 traces x 100 spans = ~100 queries, 10k JSON.parse per dashboard refresh.
- **Recommendation**: Single SQL aggregation with GROUP BY for summary; JSON.parse only for detail views.

**[P1] `findRelatedEntities` and `explainPath` issue one SQL query per BFS frontier node**
- **Location**: [src/storage/GraphMemory.ts:232-263](../../../../src/storage/GraphMemory.ts#L232-L263); [src/storage/GraphQueryEngine.ts:253-282](../../../../src/storage/GraphQueryEngine.ts#L253-L282)
- **Pattern**: N+1 in BFS
- **Impact**: Frontier of 50 nodes at depth 2 = ~100-200 round-trips per graph query. Called from `UnifiedMemoryRetriever.retrieve` every message.
- **Recommendation**: Batch BFS with `WHERE source_id IN (?, ...) OR target_id IN (?, ...)` for the whole frontier.

**[P1] `ConversationSync.syncMessage` uses `appendFileSync` on every message**
- **Location**: [src/storage/ConversationSync.ts:19-32](../../../../src/storage/ConversationSync.ts#L19-L32); invoked from `ConversationManager._append` line 89 and `replaceMessages` line 183
- **Note**: Currently inert because ConversationSync is never instantiated (Phase 2 / Phase 7 finding). If ever wired, this would block the event loop on fsync.
- **Recommendation**: Switch to `fs.promises.appendFile` (non-blocking, fire-and-forget).

**[P2] `PromptBuilder.build` re-serializes all tool declarations every call**
- **Location**: [src/chat/PromptBuilder.ts:232-246](../../../../src/chat/PromptBuilder.ts#L232-L246); [src/tools/Gemma4ToolFormat.ts:218-244](../../../../src/tools/Gemma4ToolFormat.ts#L218-L244)
- **Impact**: ~18 KB string alloc per prompt rebuild (30 tools x 600 bytes, `JSON.stringify(schema, null, 2)`).
- **Recommendation**: Memoize by enabled-tools-set hash.

**[P2] `estimateTokensForMessages` scans all messages and checks `includes("```")` on every call**
- **Location**: [src/chat/CompactionStrategy.ts:16-24](../../../../src/chat/CompactionStrategy.ts#L16-L24)
- **Impact**: At compaction time, runs up to 6x (once before loop, once after each of 5 strategies). 100-message x 2KB = 6 x 200KB string scanning.
- **Recommendation**: Cache estimate per `Message` (at construction) or carry running counter.

**[P2] `highlight.js` "common" bundle imports ~36 languages**
- **Location**: [src/utils/MarkdownRenderer.ts:3](../../../../src/utils/MarkdownRenderer.ts#L3)
- **Impact**: ~180 KB in VSIX; slower `highlightAuto`.
- **Recommendation**: `import hljs from "highlight.js/lib/core"` + explicit `registerLanguage` for js/ts/py/go/json.

**[P2] Graph DB opened twice on startup (two writable SQLite connections to same file)**
- **Location**: [src/panels/GemmaCodePanel.ts:1167, 1174](../../../../src/panels/GemmaCodePanel.ts#L1167)
- **Impact**: WAL lock contention; duplicated page cache.
- **Recommendation**: Share a single better-sqlite3 connection.

**[P2] `ChatHistoryStore._initSchema` runs FTS5 rebuild on every boot**
- **Location**: [src/storage/ChatHistoryStore.ts:60-64](../../../../src/storage/ChatHistoryStore.ts#L60-L64)
- **Impact**: Hundreds of ms of blocking I/O at cold-start for 10k+ messages.
- **Recommendation**: Gate on `user_version` PRAGMA; rebuild only on migration.

**[P2] `extractAndSave` performs N sequential save() calls in pre-compaction hook**
- **Location**: [src/storage/MemoryStore.ts:316-334](../../../../src/storage/MemoryStore.ts#L316-L334); invoked from ContextCompactor pre-hook at [GemmaCodePanel.ts:163-174](../../../../src/panels/GemmaCodePanel.ts#L163-L174)
- **Impact**: 30 extractions = 30 FTS queries + 30 sequential embedder POSTs + 30 INSERTs. Adds ~1.5s to compaction.
- **Recommendation**: Collect extractions; dedup in single FTS query; use `EmbeddingClient.embedBatch`; bulk INSERT in transaction.

**[P2] EmbeddingClient availability cache is per-instance; two instances created**
- **Location**: [src/storage/EmbeddingClient.ts:9](../../../../src/storage/EmbeddingClient.ts#L9); instances at [GemmaCodePanel.ts:1169, 1228](../../../../src/panels/GemmaCodePanel.ts#L1169)
- **Recommendation**: Share a single instance or module-level cache keyed by baseUrl+model.

**[P3] `stripCodeFences` runs on every `hasToolCall` and every `parseToolCalls`** - [src/tools/Gemma4ToolFormat.ts:44-47, 98-138](../../../../src/tools/Gemma4ToolFormat.ts). Two full-string copies per iteration. Fold `hasToolCall` into `parseToolCalls`.

**[P3] `MemoryStore.retrieve` allocates intermediate Maps and arrays per call** - [src/storage/MemoryStore.ts:250-309](../../../../src/storage/MemoryStore.ts#L250-L309). Opportunistic merge optimization.

**[P3] `_postHistory` sends full messages array + renderedHtmlMap (payload doubled)** - [src/panels/GemmaCodePanel.ts:976-980](../../../../src/panels/GemmaCodePanel.ts#L976-L980). Send only HTML map + {id, role, timestamp}.

**[P3] `retainContextWhenHidden: true` keeps full DOM alive per hidden panel** - [src/extension.ts:239](../../../../src/extension.ts#L239). Switch to false or virtualize history.

#### Hot-path summary

| Path | Observed/estimated cost | Primary concern | Severity |
|------|-------------------------|-----------------|----------|
| Message send → `_injectMemoryContext` → UnifiedRetriever → Ollama stream | ~100-500 ms front-end overhead pre-first-token | Full-table embedding scan + redundant prompt rebuild | P0 / P1 |
| `AgentLoop.run` per iteration (trace write + stream + tool exec) | ~5-15 ms tracer overhead per iter x 20 = 100-300 ms | Synchronous TraceStore SELECT+UPDATE per span | P0 |
| `MemoryStore.searchSemantic` | O(N) rows + O(N*D) Float64 per call; ~60 MB churn at 10k | No ANN; Float64 not Float32; no candidate filter | P0 |
| `_postHistory` on every UI state change | O(M) markdown renders + 500KB-1MB webview payload | No rendered-HTML cache | P1 |
| `TraceStore.endSpan` | SELECT then UPDATE with JSON parse, per span | N+1 DB round-trips | P0 |
| Graph BFS (`findRelatedEntities`, `queryContextFor`) | ~100-200 queries per memory retrieval | N+1 SQL in frontier | P1 |
| Ollama poller every 5s | 1 allocation + 1 settings read + 1 HTTP req / 5s | Unnecessary re-instantiation | P1 |
| Compaction pre-hook (`extractAndSave`) | 30 sequential embed + INSERT | No batch-embed | P2 |
| Compaction `estimateTokens` re-runs per strategy | 6 x O(N) scans | Missing memoization | P2 |
| Startup FTS5 rebuild | O(messages) on every boot | Unconditional rebuild | P2 |

#### Bundle / build notes

- Runtime deps: 6 (`@modelcontextprotocol/sdk`, `better-sqlite3`, `diff`, `highlight.js`, `marked`, `node-html-parser`)
- Heaviest: `better-sqlite3` (4-8 MB native), `highlight.js` full (~180 KB gzip), `@modelcontextprotocol/sdk` (~500 KB)
- Tree-shaking gap: full `highlight.js` import ([MarkdownRenderer.ts:3](../../../../src/utils/MarkdownRenderer.ts#L3))
- Unused in VSIX: `out/webview/highlight.min.js` (~1 MB) copied by build but never loaded (Phase 7 7d/P1)
- Webview `index.ts` is 1567 lines of inline template; future bundling target

---

### 3.4 Testing Audit

#### Current Test Inventory

Production tests: **67 TS unit files** (889 `it()` cases), **8 TS integration files**, **1 TS E2E file**, **8 bench files** (all Ollama-gated), **5 Python backend tests**, **8 Python golden-framework tests** + 24 YAML tasks, **2 Python smoke + 3 shell smoke**, **1 PowerShell legacy + 4 installer shell scripts**, **19 PyQt installer tests**.

| Component | Test file | Module covered | Quality |
|-----------|-----------|----------------|---------|
| Chat | [tests/unit/chat/StreamingPipeline.test.ts](../../../../tests/unit/chat/StreamingPipeline.test.ts) | `chat/StreamingPipeline` | Good: factory helpers, clear ordering |
| Safety | [tests/unit/safety/GitSafetyNet.test.ts](../../../../tests/unit/safety/GitSafetyNet.test.ts) (17 cases) | `safety/GitSafetyNet` | Good |
| Safety | [tests/unit/safety/ActionClassifier.test.ts](../../../../tests/unit/safety/ActionClassifier.test.ts) (23 cases) | `safety/ActionClassifier` | Good |
| Tools | [tests/unit/tools/AgentLoop.test.ts](../../../../tests/unit/tools/AgentLoop.test.ts) | `tools/AgentLoop` | Relies on `as unknown as` casts; git-checkpoint branch never exercised |
| Tools | [tests/unit/tools/ConfirmationGate.test.ts](../../../../tests/unit/tools/ConfirmationGate.test.ts) | `tools/ConfirmationGate` | Adequate |
| Storage | [tests/unit/storage/ChatHistoryStore.test.ts](../../../../tests/unit/storage/ChatHistoryStore.test.ts) (27 cases) | `storage/ChatHistoryStore` | Uses sleep-based time divergence (P1) |
| Storage | [tests/unit/storage/MemoryStore.test.ts](../../../../tests/unit/storage/MemoryStore.test.ts) | `storage/MemoryStore` | Adequate |
| Orchestration | [tests/unit/orchestration/Orchestrator.replan.test.ts](../../../../tests/unit/orchestration/Orchestrator.replan.test.ts) (4 cases) | replan branch | Passes `memoryStore: null`; memory-write branch untested |
| Observability | [tests/unit/observability/GoldenTaskSuite.test.ts](../../../../tests/unit/observability/GoldenTaskSuite.test.ts) | `observability/GoldenTaskSuite` | Hardcodes `toHaveLength(5)` while tasks/ has 24 YAMLs |
| Observability | [tests/unit/observability/OtlpExporter.test.ts](../../../../tests/unit/observability/OtlpExporter.test.ts) (27 cases) | `observability/OtlpExporter` | Uses `setTimeout(50)` for flush (P1) |
| Skills | [tests/unit/skills/SkillLoader.test.ts](../../../../tests/unit/skills/SkillLoader.test.ts) | `skills/SkillLoader` | Uses `setTimeout(200)` for fs.watch (P1) |
| E2E | [tests/e2e/extension-load.test.ts](../../../../tests/e2e/extension-load.test.ts) | Extension load | Playwright; only `/help` scenario |
| Integration | [tests/integration/ollama-health.test.ts](../../../../tests/integration/ollama-health.test.ts) | Live Ollama | `skipIf(!OLLAMA_URL)` - silently vanishes in standard CI |

**Test frameworks**: Vitest 1.0.0 + `@vitest/coverage-v8` (80% lines / 75% branches), pytest 8.2.0 + pytest-asyncio + pytest-cov, PyYAML + httpx for golden suite, pytest-benchmark for Python benches.

#### Coverage Analysis

Configured thresholds in [configs/vitest.config.ts:25-28](../../../../configs/vitest.config.ts#L25-L28): 80% lines, 75% branches, with `BackendManager.ts`, `extension.ts`, `src/utils/**`, and `.d.ts` files excluded. CI gates at [.github/workflows/ci.yml:107-151](../../../../.github/workflows/ci.yml#L107-L151). Python backend: 80% coverage gate via pytest-cov.

**Pyramid balance**: ~95% unit / ~4% integration / ~1% E2E. Much more unit-biased than the 70/20/10 target. Heavy unit bias with very thin integration layer.

**Modules with no tests**: [src/mcp/McpToolHandler.ts](../../../../src/mcp/McpToolHandler.ts), [src/panels/SessionListPanel.ts](../../../../src/panels/SessionListPanel.ts), [src/panels/webview/*.ts](../../../../src/panels/webview/), [src/utils/MarkdownRenderer.ts](../../../../src/utils/MarkdownRenderer.ts) (only benchmarked), [src/backend/BackendManager.ts](../../../../src/backend/BackendManager.ts) (excluded), [src/orchestration/utils.ts](../../../../src/orchestration/utils.ts), [src/backend/src/backend/routers/models.py](../../../../src/backend/src/backend/routers/models.py).

#### Feature-to-Test Mapping

| Feature / Capability | Unit | Integration | E2E | Coverage Assessment |
|----------------------|------|-------------|-----|---------------------|
| Agent loop (tool iteration) | Yes | Partial (mocks only) | No | **Gap** - no real-loop integration |
| Safety pipeline end-to-end | Yes (per module) | No | No | **Critical Gap** |
| Budget middleware | Yes | No | No | Adequate |
| Loop detection | Yes | No | No | Adequate |
| Permission tiers | Yes | No | No | Adequate |
| Confirmation gate | Yes | No (mocked) | No | **Gap** - no real iteration |
| Streaming chat | Yes | No | No | Adequate |
| Context compaction | Yes | Yes | No | Adequate |
| Chat history SQLite FTS5 | Yes | No | No | Partial |
| Memory working | Yes | No | No | Adequate |
| Memory episodic | Yes | No | No | Adequate |
| Memory semantic | Yes | Yes | No | Adequate |
| Memory graph | Yes | No | No | Partial |
| Tool registry + catalog | Yes | Yes | No | Adequate |
| Tool handler: filesystem | Yes | No | No | Partial (mockFs only) |
| Tool handler: terminal | Yes | No | No | Partial (no real child_process) |
| Tool handler: webSearch | Yes | No | No | Adequate |
| Tool handler: grep | Yes (1 case) | No | No | Partial |
| Tool: Gemma4 native format | Yes | Yes | No | Adequate |
| Conditional tool activation | Yes | Yes | No | Adequate |
| Lazy tool loader | Yes | No | No | Adequate |
| Output redirector | Yes | No | No | Adequate |
| Sub-agent manager | Yes | Partial | No | **Gap** - no full run |
| Plan-and-execute | Yes | No | No | Adequate |
| Reflexion engine | Yes | No | No | Partial - memory-save not covered |
| PlannerAgent | Yes | No | No | Adequate |
| DAGExecutor + TaskDAG | Yes | No | No | Adequate |
| MCP client (stdio) | Yes (SDK mock) | No | No | Partial |
| MCP server | Yes | No | No | Partial |
| MCP manager | Yes | No | No | Adequate |
| **MCP tool handler** | **No** | **No** | **No** | **Critical Gap (P0)** |
| Tracer | Yes | No | No | Adequate |
| TraceStore | Yes | No | No | Adequate |
| MetricsCollector | Yes | No | No | Adequate |
| OTLP exporter | Yes | No | No | Adequate |
| Golden-task (TS) | Yes | No | No | Adequate |
| Golden-task framework (Py) | Yes | No | No | Adequate |
| GPU detection | Yes | No | No | Adequate |
| Prompt budget | Yes | Yes | No | Adequate |
| Settings reload | Yes | No | No | Partial |
| Skills system | Yes | Yes | No | Adequate |
| Commands router | Yes | No | Partial | Partial |
| Trace dashboard panel | Yes | No | No | Partial |
| **Session list panel** | **No** | **No** | **No** | **Gap (P0)** |
| Plan mode | Yes | No | No | Adequate |
| Edit mode | Yes | No | No | Adequate |
| Ollama client | Yes | Conditional | No | Adequate |
| PyQt installer components | Yes | Yes | No | Adequate |
| Python `/chat/stream` | Yes | Yes | No | Partial - no cancel/disconnect |
| Python `/health` | No | Yes | No | Adequate |
| **Python `/models`** | **No** | **No** | **No** | **Gap** |
| BackendManager | No | No | No | **Gap (excluded)** |
| MarkdownRenderer | No | No | No | **Gap** (only bench) |

#### Use Case and Edge Case Matrix

Legend: HP = Happy Path, II = Invalid Input, AF = Auth Failure, BC = Boundary, EF = External Failure, CA = Concurrent Access.

| Workflow | HP | II | AF | BC | EF | CA |
|----------|----|----|----|----|----|-----|
| Chat send → stream → commit | Yes | Yes | N/A | Partial | Yes | No |
| Tool call → classify → confirm → execute → result | Yes | Yes | Yes | Yes | Yes | No |
| AgentLoop multi-iteration | Yes | No | No | Yes | Partial | Yes (cancel) |
| Read file | Yes | Yes | N/A | Yes | Yes | No |
| Write/edit file | Yes | Yes | Yes | Yes | Yes | No |
| Delete file | Yes | No | No | No | Yes | No |
| run_terminal | Yes | Yes | N/A | Yes | Yes | No |
| grep_codebase | Partial | No | N/A | No | Partial | No |
| Compaction cascade | Yes | No | N/A | Yes | No | No |
| Chat history + FTS5 search | Yes | Yes | N/A | Partial | No | No |
| Memory save → search-by-keyword | Yes | No | N/A | No | No | No |
| Sub-agent verification | Yes (mock) | No | No | No | No | No |
| Plan-and-Execute end-to-end | Yes | Yes | N/A | Yes | Yes | No |
| Replanning | Yes | No | N/A | Yes | No | No |
| MCP tool registration + invocation | Yes | No | No | Yes | No | No |
| OTLP flush | Yes | Yes | No | Yes | Yes | No |
| Tracer span lifecycle | Yes | Yes | N/A | Yes | N/A | Partial |
| Git safety checkpoint/commit/rollback | Yes | No | N/A | Yes | Yes | No |
| Ollama health (live) | Yes | No | No | No | Yes (skip) | No |
| Backend `/chat/stream` SSE | Yes | Yes | N/A | No | Yes | No |
| Extension activate/deactivate | Partial | No | N/A | No | No | No |
| Installer end-to-end | Partial | No | No | No | Yes | No |

#### IQ/OQ/PQ Validation Assessment

| Level | Status | Gap description |
|-------|--------|-----------------|
| **IQ (Installation)** | Partial | PyQt installer has strong unit + shell smoke; `tests/smoke/verify-components.py` validates extension + Ollama + venv + backend. Gaps: no automated VSIX vs manifest match check; no checksum/signature verification; no rollback-of-partial-install test; no upgrade-from-prior-version test preserving chat history. |
| **OQ (Operational)** | Partial | Unit tests cover ~70% of operational behaviors. `ollama-health.test.ts` validates live model presence. Gaps: no "extension-running-after-reload" test (state restoration); no cross-platform OQ (path separators, line endings); no cross-module reaction test for `onDidChangeConfiguration`. |
| **PQ (Performance)** | **Absent** | 8 bench files exist but **every single one** `.skipIf(!OLLAMA_URL)`. Nightly runs them but output is only archived - no regression threshold gate, no baseline comparison, no alerting. `time-to-first-token.bench.ts:23-24` defines P50 < 2000ms / P99 < 5000ms assertions but only in the `it.skipIf` branch, not the `bench()` block. Golden-task baselines exist at [tests/golden/baselines/v0.3.0-e2b.json](../../../../tests/golden/baselines/v0.3.0-e2b.json) but no CI job executes the tasks against a live model and fails on regression. |

#### Traceability Matrix

Representative rows (full list maintained in this section of the report):

| Requirement / Capability | Source | Test ID(s) | Test Type | Status |
|--------------------------|--------|------------|-----------|--------|
| Offline / no external API calls | README | `tests/integration/ollama-health.test.ts` | integration | Covered indirectly |
| VS Code extension loads (unit) | `package.json` | [tests/unit/extension.test.ts](../../../../tests/unit/extension.test.ts)::activate registers `gemma-code.ping` | unit | Covered (shallow) |
| VS Code extension loads (E2E) | README | [tests/e2e/extension-load.test.ts](../../../../tests/e2e/extension-load.test.ts) | E2E | Covered |
| Ollama health check | `src/ollama/client.ts` | [ollama-health.test.ts](../../../../tests/integration/ollama-health.test.ts)::checkHealth | integration (conditional) | Covered |
| Streaming chat with retry | `src/chat/StreamingPipeline.ts` | [StreamingPipeline.test.ts](../../../../tests/unit/chat/StreamingPipeline.test.ts)::retries once when stream fails before 3 tokens | unit | Covered |
| Tool system (read/write/edit) | README §Tools | [tests/unit/tools/handlers/filesystem.test.ts](../../../../tests/unit/tools/handlers/filesystem.test.ts) (28 cases) | unit | Covered |
| Blocked shell commands | `src/tools/handlers/terminal.ts` | [terminal.test.ts](../../../../tests/unit/tools/handlers/terminal.test.ts)::blocks command matching blocklist | unit | Covered |
| Gemma 4 native tool format | CHANGELOG v0.2.0 | [Gemma4ToolFormat.test.ts](../../../../tests/unit/tools/Gemma4ToolFormat.test.ts) (33 cases) | unit | Covered |
| Tool confirmation gating | README §Safety | [ConfirmationGate.test.ts](../../../../tests/unit/tools/ConfirmationGate.test.ts) (8 cases) | unit | Covered |
| 15-tool activation cap | ARCHITECTURE | [mcp-tool-integration.test.ts](../../../../tests/integration/e2e/mcp-tool-integration.test.ts)::15-tool cap enforces | integration | Covered |
| Loop detection | README | [LoopDetector.test.ts](../../../../tests/unit/safety/LoopDetector.test.ts)::returns terminate when pattern persists | unit | Covered |
| Budget middleware | CHANGELOG v0.3.0 Phase 4 | [BudgetMiddleware.test.ts](../../../../tests/unit/tools/BudgetMiddleware.test.ts) + [AgentLoop.test.ts](../../../../tests/unit/tools/AgentLoop.test.ts)::budget integration | unit | Covered (but `recordTurnTokens` not called in production - Phase 2 finding) |
| Git safety net | CHANGELOG v0.3.0 Phase 4 | [GitSafetyNet.test.ts](../../../../tests/unit/safety/GitSafetyNet.test.ts) (17 cases) | unit | Covered |
| Action classification | CHANGELOG v0.3.0 Phase 4 | [ActionClassifier.test.ts](../../../../tests/unit/safety/ActionClassifier.test.ts) (23 cases) | unit | Covered |
| Plan-and-execute orchestration | CHANGELOG v0.3.0 Phase 5 | [Orchestrator.test.ts](../../../../tests/unit/orchestration/Orchestrator.test.ts)::plan, execute, return | unit | Covered |
| Dynamic replanning | CHANGELOG v0.3.0 Phase 5 | [Orchestrator.replan.test.ts](../../../../tests/unit/orchestration/Orchestrator.replan.test.ts) (4 cases) | unit | Covered |
| Reflexion self-reflection | CHANGELOG v0.3.0 Phase 5 | [ReflexionEngine.test.ts](../../../../tests/unit/orchestration/ReflexionEngine.test.ts) | unit | Partial - memory-save untested |
| Sub-agent verification | README | [SubAgentManager.test.ts](../../../../tests/unit/agents/SubAgentManager.test.ts) + [sub-agent-verification.test.ts](../../../../tests/integration/e2e/sub-agent-verification.test.ts) | unit + integration | Covered (activation only in integration) |
| Persistent chat history (SQLite FTS5) | CHANGELOG v0.2.0 Phase 5 | [ChatHistoryStore.test.ts](../../../../tests/unit/storage/ChatHistoryStore.test.ts) (27 cases) | unit | Covered |
| 4-layer memory | CHANGELOG v0.2.0 | All per-layer test files | unit | Covered |
| Memory cross-session | CHANGELOG v0.2.0 | [memory-across-sessions.test.ts](../../../../tests/integration/e2e/memory-across-sessions.test.ts) | integration | Covered |
| MCP stdio client | CHANGELOG v0.2.0 Phase 4 | [McpClient.test.ts](../../../../tests/unit/mcp/McpClient.test.ts) | unit | Partial |
| MCP tool handler | `src/mcp/McpToolHandler.ts` | **None** | - | **Not covered (P0)** |
| Tracer + spans | CHANGELOG v0.3.0 Phase 6 | [Tracer.test.ts](../../../../tests/unit/observability/Tracer.test.ts), [TraceStore.test.ts](../../../../tests/unit/observability/TraceStore.test.ts) | unit | Covered |
| OTLP exporter | CHANGELOG v0.3.0 Phase 6 | [OtlpExporter.test.ts](../../../../tests/unit/observability/OtlpExporter.test.ts) (27 cases) | unit | Covered |
| Session list panel | VS Code contribution | **None** | - | **Not covered (P0)** |
| GPU detection | CHANGELOG v0.3.0 | [GpuDetector.test.ts](../../../../tests/unit/config/GpuDetector.test.ts) + tier tests | unit | Covered |
| Prompt budget compliance | ARCHITECTURE | [prompt-budget-compliance.test.ts](../../../../tests/integration/e2e/prompt-budget-compliance.test.ts) (6 cases) | integration | Covered |
| Skills system | CHANGELOG v0.3.0 | [SkillLoader.test.ts](../../../../tests/unit/skills/SkillLoader.test.ts) + [skill-execution.test.ts](../../../../tests/integration/commands/skill-execution.test.ts) | unit + integration | Covered |
| $ARGUMENTS substitution | CHANGELOG v0.3.0 | [skill-execution.test.ts](../../../../tests/integration/commands/skill-execution.test.ts)::$ARGUMENTS substitution | integration | Covered |
| Hot-reload user skills | CHANGELOG v0.3.0 | [SkillLoader.test.ts](../../../../tests/unit/skills/SkillLoader.test.ts)::hot-reload fires | unit | Covered (sleep-based) |
| Golden-task regression detection | CHANGELOG v0.3.0 Phase 8 | [GoldenTaskSuite.test.ts](../../../../tests/unit/observability/GoldenTaskSuite.test.ts) + [tests/golden/framework/test_*.py](../../../../tests/golden/framework/) | unit | Covered (framework only; no CI gating) |
| 24 golden tasks defined | CHANGELOG v0.3.0 Phase 8 | [tests/golden/tasks/*.yaml](../../../../tests/golden/tasks/) | fixture | Defined; not executed in CI |
| PyQt installer cross-platform | CHANGELOG v0.3.0 Phase 7 | [scripts/installer/pyqt/tests/](../../../../scripts/installer/pyqt/tests/) (19 files) + [tests/integration/installer/](../../../../tests/integration/installer/) | unit + smoke | Covered |
| Headless installer mode | CHANGELOG v0.3.0 Phase 7 | [test_install_engine.py](../../../../scripts/installer/pyqt/tests/test_install_engine.py) | unit | Covered |
| Python `/chat/stream` SSE | `backend/routers/chat.py` | [test_chat_endpoint.py](../../../../src/backend/tests/integration/test_chat_endpoint.py) | integration | Covered |
| Python `/health` | `backend/routers/health.py` | [test_health_endpoint.py](../../../../src/backend/tests/integration/test_health_endpoint.py) | integration | Covered |
| Python `/models` | `backend/routers/models.py` | **None** | - | **Not covered** |
| BackendManager lifecycle | `src/backend/BackendManager.ts` | **None** | - | **Not covered (excluded)** |
| Coverage thresholds | `configs/vitest.config.ts` | `.github/workflows/ci.yml` | CI config | Gated |
| Nightly benchmarks | `.github/workflows/nightly.yml` | bench files (all skipIf) | performance | **Partial - no threshold alerting (P0)** |

#### Test Quality Findings

**[P0] No end-to-end safety-pipeline test** - [tests/unit/safety/](../../../../tests/unit/safety/) - Each component is unit-tested in isolation; `AgentLoop.test.ts` mocks `ToolRegistry` so `classifyAction -> requiresCheckpoint -> createCheckpoint -> execute -> rollback-on-failure` is never run together. Add `tests/integration/safety/agent-safety-pipeline.test.ts`.

**[P0] `McpToolHandler` has zero tests** - [src/mcp/McpToolHandler.ts](../../../../src/mcp/McpToolHandler.ts) - Add `tests/unit/mcp/McpToolHandler.test.ts` covering successful invocation, error propagation, timeout, and argument serialization.

**[P0] `SessionListPanel` has zero tests** - [src/panels/SessionListPanel.ts](../../../../src/panels/SessionListPanel.ts) - Add `tests/unit/panels/SessionListPanel.test.ts` mirroring `GemmaCodePanel.test.ts`.

**[P0] Benchmarks exist but do not gate regression** - [tests/benchmarks/](../../../../tests/benchmarks/) + [.github/workflows/nightly.yml:85-107](../../../../.github/workflows/nightly.yml#L85-L107) - All 8 skip when `OLLAMA_URL` unset; nightly archives text output only. Wire `GoldenTaskSuite.detectRegressions()` with baseline JSON files and fail nightly CI on regression. Add explicit p50/p99 thresholds to every `bench()` block.

**[P0] Golden-task suite defined but never run against live model in CI** - [tests/golden/tasks/](../../../../tests/golden/tasks/) + [tests/golden/baselines/](../../../../tests/golden/baselines/) - The nightly job should execute `task_runner.py` against live Ollama, capture `GoldenTaskResult`, and fail on >10% regression.

**[P1] Sleep-based tests create CI flake risk** - [SkillLoader.test.ts:165](../../../../tests/unit/skills/SkillLoader.test.ts#L165) (200ms), [OtlpExporter.test.ts:87](../../../../tests/unit/observability/OtlpExporter.test.ts#L87) (50ms), [DAGExecutor.test.ts:162](../../../../tests/unit/orchestration/DAGExecutor.test.ts#L162) (10ms), [GemmaCodePanel.test.ts:175](../../../../tests/unit/panels/GemmaCodePanel.test.ts#L175) (20ms), [ChatHistoryStore.test.ts:67,109,111](../../../../tests/unit/storage/ChatHistoryStore.test.ts) (5ms) - Replace with deterministic waits (AbortController + event Promise, clock injection, expose `whenIdle()`).

**[P1] AgentLoop tests never exercise the real git-checkpoint branch** - [tests/unit/tools/AgentLoop.test.ts](../../../../tests/unit/tools/AgentLoop.test.ts) - Never provides `gitSafetyNet` option, so line 260 `if (classification.requiresCheckpoint && this._gitSafetyNet)` is always false in tests. Add a "gitSafetyNet integration" describe block.

**[P1] `Orchestrator.replan.test.ts` passes `memoryStore: null` for every case** - [tests/unit/orchestration/Orchestrator.replan.test.ts:140, 203, 247, 317](../../../../tests/unit/orchestration/Orchestrator.replan.test.ts) - Add one test with mock `MemoryStore` asserting `save()` is called with `type: "error_resolution"`.

**[P1] Mock type-erasure with `as unknown as` hides interface drift** - 10+ occurrences in AgentLoop/Orchestrator tests. Introduce typed mock factories (`vitest-mock-extended` or hand-written).

**[P1] Trivial-pass assertion** - [tests/unit/orchestration/Orchestrator.test.ts:174](../../../../tests/unit/orchestration/Orchestrator.test.ts#L174) - `expect(result.totalTimeMs).toBeGreaterThanOrEqual(0)`. Replace with `toBeGreaterThan(0)` or assert on `replanCount`.

**[P1] No test for Python backend `/models` endpoint** - Add `test_models_endpoint.py` mirroring `test_health_endpoint.py`.

**[P1] `full-pipeline.test.ts` does not run a real AgentLoop** - [tests/integration/e2e/full-pipeline.test.ts:62-128](../../../../tests/integration/e2e/full-pipeline.test.ts) - Only exercises PromptBuilder + ToolRegistry. Either rename or add real AgentLoop.run invocation.

**[P1] Conditional-live integration test silently disappears** - [tests/integration/ollama-health.test.ts:18](../../../../tests/integration/ollama-health.test.ts#L18) - Emit a console notice when skipping; add a non-skipping mocked variant using `msw`.

**[P1] `GoldenTaskSuite.test.ts` hardcodes `toHaveLength(5)` while `tests/golden/tasks/` has 24 YAMLs** - [tests/unit/observability/GoldenTaskSuite.test.ts:52-54](../../../../tests/unit/observability/GoldenTaskSuite.test.ts#L52-L54) - Regenerate `GOLDEN_TASKS` from YAML corpus, OR update test to match actual production count.

**[P2] Weak assertions in 19 test files** - 40 occurrences of `toBeDefined/toBeTruthy/toBeFalsy`. Sweep and tighten.

**[P2] `extension.test.ts` has only 3 shallow assertions** - [tests/unit/extension.test.ts](../../../../tests/unit/extension.test.ts) - Add tests for BackendManager creation, Tracer init, MCP start, deactivate cleanup.

**[P2] `filesystem.test.ts::GrepCodebaseTool` has only 1 happy-path test** - [tests/unit/tools/handlers/filesystem.test.ts:293-313](../../../../tests/unit/tools/handlers/filesystem.test.ts#L293-L313) - Add cases for ripgrep fast path, regex specials, binary skip, max_results cap, include/exclude globs.

**[P2] `GemmaCodePanel.test.ts` mocks too many internals** - [tests/unit/panels/GemmaCodePanel.test.ts:8-38](../../../../tests/unit/panels/GemmaCodePanel.test.ts#L8-L38) - Add at least one test that uses real `settings.ts`.

**[P2] `memory-across-sessions.test.ts` leaks temp DBs on Windows-cancel** - [tests/integration/e2e/memory-across-sessions.test.ts:29-35](../../../../tests/integration/e2e/memory-across-sessions.test.ts#L29-L35) - Use explicit delay + retry on Windows.

**[P2] No Ollama retry / exponential-backoff test** - Only "retries once when stream fails before 3 tokens" is tested. Add fake-timer backoff tests.

**[P3] Inconsistent test naming** - mix of "should" prefix and not. Adopt project-wide convention.

**[P3] Legacy NSIS test exists** - [tests/unit/installer/nsis-logic.test.ps1](../../../../tests/unit/installer/nsis-logic.test.ps1) - PyQt installer is canonical. Move to `tests/unit/installer/legacy/` or delete.

**[P3] `tests/golden/.pytest_cache`, `.ruff_cache`, `__pycache__`** appear tracked - verify `tests/golden/.gitignore` excludes them.

**[P3] Integration/smoke boundary confusion** - `tests/integration/installer/*` and `tests/smoke/*` have overlapping intent. Move per-platform smoke into `tests/smoke/`.

**[P3] Test factory drift** - `makeClient/makeManager/makeConfig` reimplemented in `AgentLoop.test.ts`, `Orchestrator.test.ts`, `ReflexionEngine.test.ts`. Extract `tests/helpers/factories.ts`.

**[P3] No cross-config-change reaction test** - `onDidChangeConfiguration` triggers downstream changes in `ChatHistoryStore`, `MemoryStore`, `Tracer` but no test verifies the cascade.

#### Recommended Test Pipeline

Gemma Code's current pipeline runs all TS unit + integration + Python unit + integration + PyQt installer tests on every commit, plus a coverage gate. Nightly adds live-Ollama integration, benchmarks, installer smoke, and releases on tag. This has three structural issues: no fast/slow segmentation (SQLite disk tests run with pure unit tests), benchmarks are informational not gating, and the golden-task suite is never run against a live model in CI.

| Test Type | Purpose | Triggers On | Estimated Duration | Gating |
|-----------|---------|-------------|--------------------|--------|
| Unit (TS + Py) - fast pool | Logic correctness | Every commit | < 2 min | Fail PR merge |
| Integration - mocked | Wire composition without external services | Every commit | < 3 min | Fail PR merge |
| Lint + typecheck | Style, strict types | Every commit | < 1 min | Fail PR merge |
| Coverage gate (80/75) | Threshold enforcement | Every commit | piggy-backs on unit | Fail PR merge |
| Installer unit | PyQt installer logic | Every commit | < 2 min | Fail PR merge |
| Integration - live Ollama | Real streaming, model list | Nightly + PR label `live` | 5-10 min | Warn (allow merge) |
| E2E Playwright | VS Code extension load | Nightly + pre-release | 5-8 min | Fail pre-release |
| Benchmarks (TTFT, compaction, memory) | Perf regression | Nightly | 10-15 min | **Fail on > 20% regression** |
| Golden-task regression | Output-quality regression | Nightly + pre-release | 20-30 min | **Fail on regression per `detectRegressions()`** |
| Installer smoke (3 platforms) | Install + uninstall end-to-end | Nightly + pre-release | 10-15 min | Fail pre-release |
| Release packaging | VSIX + installer artifacts | Tag push | 20 min | Required for release |
| Fuzz / property-based (future) | Unexpected input handling | Weekly | 1 hr | Warn |

Key additions beyond current state: **regression-gating on benchmarks and golden-tasks**, **fast/slow segmentation** (split disk-SQLite tests into a separate pool), and **explicit npm audit + pip audit** in the CI lint step.

---

### 3.5 Restructuring Opportunities

#### 6a. Architectural Pattern Alignment

**[P0/P1] Three-process runtime is not currently justified; Python backend is orphaned**
- **Current state**: [src/extension.ts:70-92](../../../../src/extension.ts#L70-L92) spawns `python -m backend.main` via `BackendManager`. [src/backend/src/backend/routers/chat.py:46-57](../../../../src/backend/src/backend/routers/chat.py#L46-L57) exposes `/chat/stream`. However no TS file ever reads `backendManager.baseUrl`; the actual streaming path is [src/chat/StreamingPipeline.ts:66-69](../../../../src/chat/StreamingPipeline.ts#L66-L69) calling `OllamaClient.streamChat` directly. Equivalent compaction logic lives in both [src/backend/src/backend/services/prompt.py:32-194](../../../../src/backend/src/backend/services/prompt.py#L32-L194) and `src/chat/CompactionStrategy.ts`. Default `useBackend: true` ships a dead child process to every user.
- **Proposed state**: Either (a) route chat stream through backend when `useBackend === true` (close the loop), or (b) absorb backend concerns into TS and delete `src/backend/`. Option (b) is the simpler path (~535 LOC of duplicate capability + a second language runtime removed).
- **Expected benefit**: Eliminates duplicate compaction/templating pipeline (~535 LOC); removes one process + port; removes ~150 MB `.venv` from ship path; removes "did backend start?" failure mode; removes one language from critical runtime.
- **Estimated effort**: Medium (1-3 days) for either path
- **Risk**: If Python-native capability (local embeddings, Python-only tokenizer) is planned for v0.4, deletion forecloses that. Mitigation: record decision as ADR; reconstructable from v0.2 history.

**[P2] Hexagonal seams would make the "inference provider" swappable**
- **Current state**: `OllamaClient` is concrete and referenced in 9 files including [src/orchestration/PlannerAgent.ts:10-13](../../../../src/orchestration/PlannerAgent.ts#L10-L13), [src/orchestration/ReflexionEngine.ts](../../../../src/orchestration/ReflexionEngine.ts), [src/agents/SubAgentManager.ts](../../../../src/agents/SubAgentManager.ts). Ollama-specific types leak into planners.
- **Proposed state**: `LLMClient` port with `streamCompletion(prompt): AsyncIterable<TokenEvent>` + `GemmaTemplate` adapter; `OllamaClient` becomes a driver; orchestration consumes only the port.
- **Expected benefit**: Provider swap becomes driver-level; clean seam; provider-agnostic tests.
- **Estimated effort**: Medium (1-3 days); overlaps with 6c P1 below.
- **Risk**: Over-abstraction if no second provider arrives. Mitigation: keep port shape close to Ollama's actual surface.

**[P3] CQRS / event sourcing / DDD do not fit this shape**
- Remain a modular monolith with clean ports. Do not adopt CQRS/DDD in v0.3/v0.4. Recorded to prevent drift.

#### 6b. Module & Boundary Analysis

**[P0] `GemmaCodePanel` is a god object; split into three components**
- **Current state**: [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts) is 1307 lines; the constructor imports ~45 symbols from ~25 modules and instantiates all of `ChatHistoryStore`, `MemoryStore`, `WorkingMemory`, `EpisodicMemory`, `GraphMemory`, `EntityExtractor`, `GraphQueryEngine`, `MemoryConsolidator`, `UnifiedMemoryRetriever`, `PromptBuilder`, `ConversationManager`, `StreamingPipeline`, `ContextCompactor`, `AgentLoop`, `SubAgentManager`, `ToolRegistry`, `ConfirmationGate`, `McpManager`, `McpServer`, `PlanMode`, `CommandRouter`, `SkillLoader`, `Orchestrator`, `GitSafetyNet`, `LoopDetector`, `BudgetMiddleware`, all tool handlers, `better-sqlite3`, `GpuTierConfig`. Implements `WebviewViewProvider`, routes messages, owns session lifecycle.
- **Proposed state**: Split into `GemmaRuntime` (composition root, owns lifetimes, no view code), `ChatController` (mediates input to AgentLoop / Orchestrator, no webview concern), `ChatWebviewHost` (replaces current panel; strictly webview provider + message translation). Plus a `MemorySubsystem` factory for the 90-line memory wiring.
- **Expected benefit**: Cuts ~600-800 lines from the panel; produces a testable composition root; localizes memory-init failure mode.
- **Estimated effort**: High (> 3 days)
- **Risk**: Large surgical refactor; many integration tests exercise `GemmaCodePanel` directly. Mitigation: land incrementally as three PRs (memory factory first, then controller, keep webview provider thin shell).

**[P0] Python backend disposition (same decision as 6a)**
- See 6a above.

**[P1] `safety/` and parts of `tools/` should be one "guardrails" seam**
- **Current state**: [src/safety/ActionClassifier.ts:2](../../../../src/safety/ActionClassifier.ts#L2) imports `BLOCKED_PATTERNS`, `isBlocked` from `tools/handlers/terminal.ts`. [src/safety/PermissionTiers.ts:1](../../../../src/safety/PermissionTiers.ts#L1) imports `BuiltinToolName`. [src/tools/ToolRegistry.ts:5](../../../../src/tools/ToolRegistry.ts#L5) imports `getPermissionTier` from `safety/`. Mutually recursive at import layer.
- **Proposed state**: `guardrails/` module owning `PermissionTiers`, `ActionClassifier`, `LoopDetector`, `BudgetEnforcer`, `GitSafetyNet`, exposing `GuardrailsPipeline`. `BLOCKED_PATTERNS` moves to `guardrails/policy.ts`.
- **Expected benefit**: Clear boundary "tools execute; guardrails decide"; eliminates conceptual cycle.
- **Estimated effort**: Medium (1-3 days)
- **Risk**: Hot path of every tool call. Mitigation: behavior-preserving refactor covered by existing tests.

**[P2] `observability/GoldenTaskSuite` does not belong in `observability/`**
- **Current state**: [src/observability/GoldenTaskSuite.ts](../../../../src/observability/GoldenTaskSuite.ts) sits with Tracer/TraceStore/MetricsCollector/OtlpExporter. Golden tasks are evaluation, not telemetry.
- **Proposed state**: Move to `src/evaluation/GoldenTaskSuite.ts` (or `src/qa/`).
- **Effort**: Low. **Risk**: Low.

**[P3] `modes/` single-file directory adds indirection**
- **Current state**: `src/modes/` contains only `PlanMode.ts`. Move to `src/chat/`; delete `modes/`.
- **Effort**: Low. **Risk**: Low.

#### 6c. Dependency & Coupling Analysis

**[P1] `ollama/types` has high fan-in because LLM-provider types leak into planner and reflexion**
- **Current state**: 9 modules import from `src/ollama/types.js` including [Orchestrator.ts:12](../../../../src/orchestration/Orchestrator.ts#L12), [PlannerAgent.ts:10-13](../../../../src/orchestration/PlannerAgent.ts#L10-L13), [ReflexionEngine.ts](../../../../src/orchestration/ReflexionEngine.ts), [SubAgentManager.ts](../../../../src/agents/SubAgentManager.ts).
- **Proposed state**: `src/llm/types.ts` with provider-agnostic `LLMMessage`, `LLMToolDefinition`, `LLMStreamChunk`; `src/ollama/` becomes a driver mapping to these types; orchestration imports only `llm/types`.
- **Expected benefit**: Fan-in on `ollama/types` drops to driver + `StreamingPipeline` + `AgentLoop`; orchestration becomes provider-agnostic.
- **Estimated effort**: Medium. **Risk**: Do alongside 6a P2.

**[P1] `extension.ts` directly constructs too much; true composition root is missing**
- **Current state**: [src/extension.ts:63-387](../../../../src/extension.ts#L63-L387) handles activation, settings load, BackendManager, GPU status bar, TraceStore init, OTLP, session panel, trace dashboard, Ollama poller, multiple command registrations; then `GemmaCodePanel` builds the rest.
- **Proposed state**: Extract `GemmaRuntime`; `extension.ts` becomes thin VS Code lifecycle adapter.
- **Expected benefit**: One place to inspect activation; testable without extension host.
- **Estimated effort**: Medium (overlaps 6b P0).

**[P2] `Tracer` singleton creates hidden global state**
- **Current state**: [src/observability/Tracer.ts:12-29](../../../../src/observability/Tracer.ts#L12-L29) uses `getInstance()`/`resetInstance()`. Consumed from 5 modules via `Tracer.getInstance()`.
- **Proposed state**: Inject through constructors (like `TraceStore`, `MetricsCollector` at [extension.ts:287-290](../../../../src/extension.ts#L287-L290) already are).
- **Expected benefit**: Eliminates hidden global; makes tests fully parallel-safe; enables per-panel tracing.
- **Effort**: Low-Medium once composition root exists.

**[P2] `settings.getSettings()` is called from 5 deep modules instead of being injected**
- **Current state**: Called from `ContextCompactor`, `RegenerateFromSource`, `GpuTierConfig`, [src/ollama/client.ts:115](../../../../src/ollama/client.ts#L115), `GemmaCodePanel`.
- **Proposed state**: Called once in composition root; slices passed by type.
- **Expected benefit**: Deterministic behavior; cleaner tests; reactivity boundary via `onSettingsChange` (already exists but not wired).
- **Effort**: Low-Medium.

**[P2] `safety ↔ tools` conceptual cycle** - covered by 6b P1.

#### 6d. Redundancy and Consolidation

**[P0] Compaction and Gemma4 templating are implemented twice (Python + TS)**
- **Current state**: [src/backend/src/backend/services/prompt.py:32-194](../../../../src/backend/src/backend/services/prompt.py#L32-L194) contains `clear_old_tool_results`, `sliding_window`, `trim_history`, `apply_gemma_template`, `assemble_prompt`. The TS side `CompactionStrategy.ts`, `ContextCompactor.ts`, `Gemma4ToolFormat.ts` implements the same strategies plus the parser. Fixing a bug requires two commits in two languages.
- **Proposed state**: Delete Python versions (tied to 6a P1 backend disposition).
- **Expected benefit**: Eliminates silent-divergence class of bug; ~200 LOC duplicate logic removed.
- **Effort**: Low once 6b P0 lands. **Risk**: Low.

**[P1] `OllamaClient` and `EmbeddingClient` duplicate HTTP-to-Ollama boilerplate**
- **Current state**: [src/ollama/client.ts:19-42](../../../../src/ollama/client.ts#L19-L42) and [src/storage/EmbeddingClient.ts:17-50](../../../../src/storage/EmbeddingClient.ts#L17-L50) both implement fetch-with-timeout, availability check, URL normalization, JSON parsing.
- **Proposed state**: Extract `OllamaHttp` in `src/ollama/http.ts`; both clients compose over it.
- **Expected benefit**: One place for retries, auth headers, OTLP span wrapping, circuit-break.
- **Effort**: Low. **Risk**: Low.

**[P2] Two sets of installer smoke tests both run from nightly CI**
- **Current state**: [tests/integration/installer/test-install-pyqt-linux.sh](../../../../tests/integration/installer/test-install-pyqt-linux.sh) (45 lines: smoke-check imports, GPU, theme) vs [tests/smoke/smoke-linux.sh](../../../../tests/smoke/smoke-linux.sh) (83 lines: install Ollama, headless installer, verify, cleanup). Both invoked by `nightly.yml` (lines 111-157 for integration variant, plus `installer-smoke.yml` weekly cron).
- **Proposed state**: Consolidate into `tests/smoke/` only; drop the nightly integration-variant jobs.
- **Expected benefit**: One place for installer smoke; ~3 fewer CI jobs on nightly.
- **Effort**: Low. **Risk**: Low.

**[P2] Error humanization diverged across modules**
- **Current state**: `StreamingPipeline._humanizeError`; `vscode.window.showErrorMessage` in panel; ad-hoc `err instanceof Error ? err.message : String(err)` in 21+ tool handlers; backend logs in `extension.ts`.
- **Proposed state**: `src/utils/errors.ts` with `formatForUser(err)` / `formatForLog(err)`.
- **Effort**: Low.

#### 6e. Third-Party Platform & Tooling

**[P2] PyQt5 for the installer is heavyweight given the 9-page wizard shape**
- **Current state**: [scripts/installer/pyqt/](../../../../scripts/installer/pyqt/). PyInstaller output ~40-60 MB per platform; recurring CI issues with PyQt5 Linux libs.
- **Proposed state**: Consider native per-platform installer, a CLI installer (Click/Typer, bubbletea, dialoguer), or Tauri. Given CLAUDE.md lists Rust + Go in the stack, a single Go TUI could replace ~2000 LOC wizard + 40 MB payload.
- **Effort**: High (> 3 days) for replacement. Do not start without dominant-support-burden motivation - just-built in v0.3 Phase 7.

**[P3] `marked@^4.3.0` has known CVE history** - [package.json:369](../../../../package.json#L369). Add `npm audit` to CI (currently absent in `lint-ts` job). Plan marked v12 upgrade ahead of public release.

**[P3] `better-sqlite3` and `@modelcontextprotocol/sdk`** - no change needed. Document `@electron/rebuild` step in contributor guide.

**[P3] OTLP export is correctly gated off by default** - [src/extension.ts:293-301](../../../../src/extension.ts#L293-L301). No change.

#### 6f. Workflow & Developer Experience

**[P1] Version drift between `package.json` and docs**
- **Current state**: [package.json:5](../../../../package.json#L5) says `"version": "0.2.0"` while [docs/archive/versions/v0/v0.3.0/architecture.md](../../docs/archive/versions/v0/v0.3.0/architecture.md) and recent commits describe v0.3.0 complete. `modelName` default is `gemma4:e4b` in [package.json:93](../../../../package.json#L93) but `gemma4` in [settings.ts:51](../../../../src/config/settings.ts#L51).
- **Proposed state**: Bump to 0.3.0; align model-name default. Add CI check comparing `package.json` version to `docs/<version>/` folder names.
- **Effort**: Low.

**[P1] Local dev setup clarity - 4 runtimes, no single `dev` command**
- **Current state**: Node 20 + Python 3.12 + Rust + Go + Ollama + PyQt5 libs. `package.json` scripts have `build`, `watch`, `test`, `lint`, `package`, `bench` but no `dev`.
- **Proposed state**: Add `scripts/dev-setup.sh` + `.ps1` + `CONTRIBUTING.md`. Add `npm run dev` (tsc watch + backend start).
- **Effort**: Low.

**[P2] CI has two overlapping installer-smoke surfaces**
- **Current state**: [nightly.yml:111-157](../../../../.github/workflows/nightly.yml#L111-L157) runs installer-smoke nightly; [installer-smoke.yml](../../../../.github/workflows/installer-smoke.yml) reruns Sundays. Both use macOS/Windows/Linux runners.
- **Proposed state**: Remove nightly `installer-smoke-*` jobs; `ci.yml`'s `test-installer` covers module-import surface; `installer-smoke.yml` handles weekly end-to-end.
- **Effort**: Low. **Risk**: Low.

**[P2] Golden-tasks workflow runs pytest but doesn't diff against baselines**
- **Current state**: [.github/workflows/golden-tasks.yml:55](../../../../.github/workflows/golden-tasks.yml#L55) runs `pytest -q` under `tests/golden/` but uploads baselines as artifact rather than failing on regression.
- **Proposed state**: Add explicit `regression-check` step consuming run result and comparing against prior baseline; fail on regression beyond threshold (`RegressionDetector` already exists).
- **Effort**: Low-Medium.

**[P3] No ADR directory**
- **Current state**: Decisions live in commit messages and phase-history docs. No `docs/adr/` with MADR format.
- **Proposed state**: Create `docs/adr/`; start with Python-backend disposition ADR.
- **Effort**: Low.

#### Fan-in / Fan-out snapshot (top-10)

| Module | Fan-in | Fan-out | Notes |
|--------|--------|---------|-------|
| `src/panels/GemmaCodePanel.ts` | 1 (extension.ts) | ~45 | God object (6b P0) |
| `src/config/settings.ts` | 9 | 3 | Inject instead (6c P2) |
| `src/ollama/types.ts` | 9 | 0 | Leaks provider into orchestration (6c P1) |
| `src/tools/types.ts` | 8 | 1 | Appropriate - domain type |
| `src/observability/Tracer.ts` | 5 | 1 | Singleton; inject instead (6c P2) |
| `src/storage/MemoryStore.ts` | 4 | 3 | Shape OK |
| `src/safety/*` | 3 | - | Conceptual cycle with tools (6b P1) |
| `src/tools/AgentLoop.ts` | 2 | ~15 | Dense orchestration hub |
| `src/tools/ToolRegistry.ts` | - | 6 | Appropriate |
| `src/backend/BackendManager.ts` | 1 (extension.ts only) | 2 | Orphan (6a P1, 6b P0) |

#### Cross-cutting concern audit

| Concern | How handled | Consistency | Recommendation |
|---------|-------------|-------------|----------------|
| Logging | `vscode.OutputChannel` + `console.log/warn/error` in 7 files | Scattered - two sinks | `src/utils/logger.ts`; ESLint rule against `console.*` in `src/` |
| Error handling | `StreamingPipeline._humanizeError`, ad-hoc `err instanceof Error` in 21+ handlers, `showErrorMessage` | Scattered | `formatForUser` / `formatForLog` utility (6d P2) |
| Validation | No Zod; hand-rolled `JSON.parse` in 9 files | Scattered | Adopt Zod at module boundaries |
| Permission / safety | `ToolRegistry.execute` via `ConfirmationGate` + `PermissionTiers` + `ActionClassifier` | Consistent, good design | Unify under `guardrails/` (6b P1) |
| Tracing | Singleton `Tracer` reached from 5 modules | Consistent but singleton-based | Inject via composition root; `@traced` helper (6c P2) |
| Settings | `getSettings()` from 5 deep modules | Scattered reads | Read once, inject slices (6c P2) |
| Persistence | `better-sqlite3` in 5 DB files; no shared migration | Mostly consistent | `storage/sqlite.ts` for PRAGMA + migrations (not urgent) |
| HTTP to Ollama | Two clients duplicate fetch boilerplate | Duplicated (6d P1) | Shared `OllamaHttp` |

---

### 3.6 Simplification and Optimization Opportunities

#### 7a. Over-Engineering and Unnecessary Abstraction

**[P1] `BudgetEnforcer` class never instantiated (parallel to `BudgetMiddleware`)**
- **Location**: [src/safety/BudgetEnforcer.ts](../../../../src/safety/BudgetEnforcer.ts) (~135 LOC) + [src/tools/AgentLoop.ts:14, 35, 54, 79, 185-190, 335, 434](../../../../src/tools/AgentLoop.ts)
- **Current / Proposed**: Delete `BudgetEnforcer.ts` + test. Remove all `_budgetEnforcer` branches in AgentLoop (6 spots). Drop `maxSessionTokens`, `maxSessionMinutes` from `settings.ts` and package.json.
- **Behavior preservation**: `BudgetEnforcer` is undefined at runtime; every branch is dead. `BudgetMiddleware` remains the active budget limit.
- **Benefit**: ~135 LOC class + ~50 LOC test + 6 AgentLoop branches; 2 user-facing settings removed.
- **Effort**: Low. **Risk**: Low.

**[P1] `LazyToolLoader` never registered; entire lazy-tool-loading feature off**
- **Location**: [src/tools/LazyToolLoader.ts](../../../../src/tools/LazyToolLoader.ts) (65 LOC), [src/tools/Gemma4ToolFormat.ts:168-215](../../../../src/tools/Gemma4ToolFormat.ts#L168-L215), [src/chat/PromptBuilder.ts:236-238](../../../../src/chat/PromptBuilder.ts#L236-L238)
- **Current / Proposed**: Delete `LazyToolLoader.ts`, `serializeToolSummary`, `lazyToolLoading` prop, `get_tool_schema` catalog entry, its permission-tier entry.
- **Behavior preservation**: `lazyToolLoading` is never true; `serializeToolDefinitions` runs today; removing the alternate branch is a no-op.
- **Benefit**: ~140 LOC. **Effort**: Low. **Risk**: Low.

**[P1] Two parallel hardware-tier systems (`HardwareTier` vs `GpuTierConfig`)**
- **Location**: [src/config/HardwareTier.ts](../../../../src/config/HardwareTier.ts) (135 LOC) + [HardwareTier.types.ts](../../../../src/config/HardwareTier.types.ts) vs [src/config/GpuTierConfig.ts](../../../../src/config/GpuTierConfig.ts) (101 LOC)
- **Current**: Both model three tiers with overlapping fields (`maxAgentIterations`, `compactionThreshold`, `contextWindow`) but **they disagree** (HardwareTier Tier 1 `maxAgentIterations: 10`, GpuTierConfig Tier 1 `25`).
- **Proposed**: Fold `GpuTierProfile` into `HardwareTierConfig`; add missing fields; delete `GpuTierConfig.ts`; update Orchestrator + GemmaCodePanel.
- **Behavior preservation**: To preserve current (disagreeing) outputs exactly, careful migration copies Orchestrator-facing fields onto `HardwareTierConfig` unchanged.
- **Benefit**: ~100 LOC deleted; one coherent tier model.
- **Effort**: Medium. **Risk**: Medium (touches multiple sites).

**[P2] `ConversationSync` defined but never instantiated**
- **Location**: [src/storage/ConversationSync.ts](../../../../src/storage/ConversationSync.ts) (~70 LOC); referenced as optional ctor param in [ConversationManager.ts:5, 22](../../../../src/chat/ConversationManager.ts)
- **Current / Proposed**: Delete class + test + optional `_sync` param + 4 try/catch blocks in ConversationManager.
- **Behavior preservation**: Optional param always undefined; calls are no-ops.
- **Benefit**: ~100 LOC. **Effort**: Low. **Risk**: Low.

**[P2] `RelevanceScorer` never instantiated; scored branch in PromptBuilder is dead**
- **Location**: [src/chat/RelevanceScorer.ts](../../../../src/chat/RelevanceScorer.ts) (~220 LOC), [src/chat/PromptBuilder.ts:30-74](../../../../src/chat/PromptBuilder.ts#L30-L74)
- **Current / Proposed**: Delete `RelevanceScorer.ts` + test + async relevance branch in `PromptBuilder.build`.
- **Behavior preservation**: `context.relevanceScorer` never set; only `_buildCore` runs; removing branch is observably inert.
- **Benefit**: ~220 LOC + ~100 LOC tests. **Effort**: Low. **Risk**: Low.

**[P2] Dual GPU-tier user settings (`gpuTier` and `gpuTierOverride`)**
- **Location**: [package.json:269-288, 319-335](../../../../package.json#L269-L335); [settings.ts:37, 41, 79, 83](../../../../src/config/settings.ts)
- **Current / Proposed**: Keep `gpuTierOverride` only. Migration fallback at `getSettings()` can read legacy `gpuTier` for one release.
- **Behavior preservation**: Default both-at-auto unchanged.
- **Benefit**: 1 settings key removed. **Effort**: Low. **Risk**: Low.

**[P2] `inferTierFromModelName` is redundant with VRAM-based `classifyTier`**
- **Location**: [src/config/GpuTierConfig.ts:58-79](../../../../src/config/GpuTierConfig.ts#L58-L79)
- **Current / Proposed**: Delete. If `GpuTierConfig.ts` itself is deleted per P1 above, this goes with it.
- **Benefit**: ~20 LOC. **Effort**: Low.

**[P3] `GoldenTaskSuite.ts` helpers consumed only by tests**
- **Location**: [src/observability/GoldenTaskSuite.ts:128, 159](../../../../src/observability/GoldenTaskSuite.ts)
- **Current / Proposed**: Move helpers into test file or drop.
- **Benefit**: ~90 LOC off shipped extension. **Effort**: Low.

#### 7b. Code Volume Reduction

**[P3] Identity alias `escapeAttr = escapeHtml`** - [src/utils/MarkdownRenderer.ts:89-91](../../../../src/utils/MarkdownRenderer.ts#L89-L91). Inline; delete alias. 4 LOC.

**[P3] `parseOtlpHeaders` can use `Object.fromEntries`** - [src/observability/OtlpExporter.ts:196-213](../../../../src/observability/OtlpExporter.ts#L196-L213). 18-line hand-rolled parser replaceable with ~6 lines using `.split + .map + fromEntries`.

#### 7c. Dependency Rationalization

**[P1] `python-multipart` unused** - [src/backend/pyproject.toml:12](../../../../src/backend/pyproject.toml#L12). FastAPI requires only for Form/File/UploadFile; grep confirms no uses. Remove.

**[P1] `@modelcontextprotocol/sdk` dynamic-only import - verify tree-shake**
- Used only via `await import(...)` at [McpClient.ts:43-44](../../../../src/mcp/McpClient.ts#L43-L44) and [McpServer.ts:26-27](../../../../src/mcp/McpServer.ts#L26-L27). Reachable only when opt-in settings enabled. Verify `.vscodeignore` doesn't strip dynamic-imported subpaths (currently fine). Verification only - no removal.

#### 7d. Build & Bundle Optimization

**[P1] `out/webview/highlight.min.js` packaged but never referenced**
- **Location**: [scripts/build-vsix.ps1:110-114](../../../../scripts/build-vsix.ps1#L110-L114)
- **Current**: Build copies `node_modules/highlight.js/build/highlight.min.js` into `out/webview/`. Grep confirms no `<script src="highlight.min.js">` in `src/panels/webview`. Syntax highlighting happens server-side in extension host only.
- **Proposed**: Remove lines 111-114 from `build-vsix.ps1`. Keep the `highlight.js` npm dep (used by `MarkdownRenderer`).
- **Behavior preservation**: Webview does not load the file. CSS token colors (defined inline at [index.ts:285-302](../../../../src/panels/webview/index.ts#L285-L302)) remain intact.
- **Benefit**: VSIX ~1 MB smaller; faster package step.
- **Effort**: Low. **Risk**: Low (verify with DevTools on a dev build).

**[P2] `declaration: true` + `declarationMap: true` produce unused artifacts**
- **Location**: [tsconfig.json:16-17](../../../../tsconfig.json#L16-L17)
- **Current**: `out/` is only consumed by VS Code; no downstream TS consumer reads `.d.ts` / `.d.ts.map`.
- **Proposed**: Set both to false.
- **Behavior preservation**: Emitted `.js` is identical.
- **Benefit**: Faster `tsc` + `tsc -w` incremental builds.
- **Effort**: Low. **Risk**: Low.

**[P2] `nightly.yml` duplicates `installer-smoke.yml` coverage** - see 6d P2.

**[P3] `test:integration` npm script positional arg** - [package.json:343](../../../../package.json#L343). `vitest.config.ts:9-12` already sets `include: ["tests/unit/**", "tests/integration/**"]`; trailing arg is redundant filter (still works). Verification only.

#### 7e. Config and Environment Simplification

**[P1] `memoryAutoSaveInterval` declared but never read at runtime**
- **Location**: [package.json:217-223](../../../../package.json#L217-L223), [settings.ts:29, 71](../../../../src/config/settings.ts)
- **Current / Proposed**: Delete from package.json + settings reader. No `src/` code references it.
- **Behavior preservation**: Zero readers today. Users who customized get no change.
- **Benefit**: One user-facing setting removed. **Effort**: Low.

**[P1] `permissionOverrides` read but never plumbed to ToolRegistry**
- **Location**: [package.json:299-303](../../../../package.json#L299-L303), [settings.ts:40, 82](../../../../src/config/settings.ts), [ToolRegistry.ts:61-63](../../../../src/tools/ToolRegistry.ts#L61-L63), [GemmaCodePanel.ts:324](../../../../src/panels/GemmaCodePanel.ts#L324)
- **Current**: `ToolRegistry.setConfirmationGate(gate, overrides?)` accepts overrides; `GemmaCodePanel._buildToolRegistry` calls `registry.setConfirmationGate(gate)` (no second arg).
- **Proposed**: Either wire overrides (1-line fix) OR delete the setting. User-facing trap today: setting has no effect.
- **Effort**: Low (delete) or Low-Medium (wire + tests). **Risk**: Low.

**[P1] `maxSessionTokens` / `maxSessionMinutes` feed only the unreachable `BudgetEnforcer`**
- Already covered above (7a P1). Delete with `BudgetEnforcer`.

**[P2] `gpuTier` duplicates `gpuTierOverride`** - already covered (7a P2).

#### Dependency Audit Table (production deps)

| Package | Version | Used in | Assessment | Severity |
|---------|---------|---------|------------|----------|
| `@modelcontextprotocol/sdk` | ^1.29.0 | [McpClient.ts](../../../../src/mcp/McpClient.ts) (dynamic), [McpServer.ts](../../../../src/mcp/McpServer.ts) (dynamic) | Opt-in default off. Keep. | Keep |
| `better-sqlite3` | ^12.8.0 | 5+ storage modules | Core persistence. Keep. | Keep |
| `diff` | ^5.2.2 | `tools/handlers/filesystem.ts` | Diff preview. Keep. | Keep |
| `highlight.js` | ^11.11.1 | `utils/MarkdownRenderer.ts` | Keep. But webview-copy step wastes space. | Keep (fix build) |
| `marked` | ^4.3.0 | `utils/MarkdownRenderer.ts` | Keep (CJS deliberate). Plan v12 upgrade for XSS hardening. | Keep |
| `node-html-parser` | ^6.1.13 | `tools/handlers/webSearch.ts` | DuckDuckGo result parsing. Keep. | Keep |

#### Unused Export / Dead-Module Table

| Symbol / Module | Location | Evidence | Severity |
|-----------------|----------|----------|----------|
| `BudgetEnforcer` class | [src/safety/BudgetEnforcer.ts](../../../../src/safety/BudgetEnforcer.ts) | No `new BudgetEnforcer(` in src/ | P1 |
| `LazyToolLoader` class | [src/tools/LazyToolLoader.ts](../../../../src/tools/LazyToolLoader.ts) | Never registered; catalog advertises unreachable tool | P1 |
| `ConversationSync` class | [src/storage/ConversationSync.ts](../../../../src/storage/ConversationSync.ts) | No `new ConversationSync(` in src/ | P2 |
| `RelevanceScorer` class | [src/chat/RelevanceScorer.ts](../../../../src/chat/RelevanceScorer.ts) | `context.relevanceScorer` never set | P2 |
| `serializeToolSummary` function | [src/tools/Gemma4ToolFormat.ts:177](../../../../src/tools/Gemma4ToolFormat.ts#L177) | Only called when `lazyToolLoading === true` | P1 |
| `inferTierFromModelName` | [src/config/GpuTierConfig.ts:58](../../../../src/config/GpuTierConfig.ts#L58) | Overlaps with `HardwareTier.classifyTier` | P2 |
| `validateExpectation`, `detectRegressions` | [src/observability/GoldenTaskSuite.ts:128, 159](../../../../src/observability/GoldenTaskSuite.ts) | Only test callers | P3 |
| Entire `GpuTierConfig.ts` | [src/config/GpuTierConfig.ts](../../../../src/config/GpuTierConfig.ts) | Overlaps fully with `HardwareTier.ts` | P1 |

#### Config Cleanup Table

| Setting key | Status | Evidence | Recommendation |
|-------------|--------|----------|----------------|
| `gemma-code.memoryAutoSaveInterval` | Dead | No consumer | Delete (P1) |
| `gemma-code.permissionOverrides` | Read but not wired | `ToolRegistry.setConfirmationGate` never receives second arg | Delete or wire (P1) |
| `gemma-code.maxSessionTokens` | Feeds dead BudgetEnforcer only | `BudgetMiddleware` computes its own from tier | Delete with BudgetEnforcer (P1) |
| `gemma-code.maxSessionMinutes` | Feeds dead BudgetEnforcer only | same | Delete with BudgetEnforcer (P1) |
| `gemma-code.gpuTier` | Duplicates `gpuTierOverride` | two sources of truth | Delete in favor of `gpuTierOverride` (P2) |
| `gemma-code.otlpHeaders` | Active but awkward | Single-string parsing | Optional polish: switch to `type: "object"` (P3) |

All other 30+ `gemma-code.*` settings verified as having at least one runtime consumer.

---

## Section 4: Findings by Priority

Flat work-queue view. All 129 findings regrouped by severity.

### P0 - Critical (14)

| # | Phase | Location | Title |
|---|-------|----------|-------|
| 1 | Security | [src/utils/MarkdownRenderer.ts:70](../../../../src/utils/MarkdownRenderer.ts#L70) | Markdown renderer does not sanitize HTML; webview XSS |
| 2 | Security | [src/tools/handlers/terminal.ts:80](../../../../src/tools/handlers/terminal.ts#L80) | `run_terminal` accepts arbitrary `cwd` outside workspace |
| 3 | Code Quality | [src/storage/ChatHistoryStore.ts:37-57](../../../../src/storage/ChatHistoryStore.ts#L37-L57) | FTS5 rowid unsynchronized with TEXT PK on REPLACE |
| 4 | Code Quality | [src/orchestration/TaskDAG.ts:199-215](../../../../src/orchestration/TaskDAG.ts#L199-L215) | `hasCycle()` contains dead in-degree loop |
| 5 | Code Quality | [src/storage/GraphQueryEngine.ts:301-309](../../../../src/storage/GraphQueryEngine.ts#L301-L309) | `_reconstructPath` drops intermediate nodes |
| 6 | Performance | [src/storage/MemoryStore.ts:211-213](../../../../src/storage/MemoryStore.ts#L211-L213) | Semantic search full-table scan per message |
| 7 | Performance | [src/observability/TraceStore.ts:159-224](../../../../src/observability/TraceStore.ts#L159-L224) | Tracer per-span synchronous SQLite writes |
| 8 | Testing | tests/unit/safety/* | No end-to-end safety-pipeline test |
| 9 | Testing | [src/mcp/McpToolHandler.ts](../../../../src/mcp/McpToolHandler.ts) | `McpToolHandler` has zero tests |
| 10 | Testing | [src/panels/SessionListPanel.ts](../../../../src/panels/SessionListPanel.ts) | `SessionListPanel` has zero tests |
| 11 | Testing | tests/benchmarks/* | Benchmarks don't gate regression in CI |
| 12 | Testing | tests/golden/* | Golden-task suite not run against live model in CI |
| 13 | Restructuring | [src/backend/](../../../../src/backend/) | Python backend spawned but never used (duplicate compaction) |
| 14 | Restructuring | [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts) | 1307-line god object |

### P1 - High (46)

| # | Phase | Location | Title |
|---|-------|----------|-------|
| 15 | Code Quality | [src/safety/GitSafetyNet.ts:64-67](../../../../src/safety/GitSafetyNet.ts#L64-L67) | Inverted diff check in `commitAgentChanges` |
| 16 | Code Quality | [src/tools/handlers/filesystem.ts:175-192](../../../../src/tools/handlers/filesystem.ts), [ToolRegistry.ts:93-107](../../../../src/tools/ToolRegistry.ts#L93-L107) | Double confirmation for file-edit tools in `ask` mode |
| 17 | Code Quality | [src/tools/ToolCatalog.ts:114-138](../../../../src/tools/ToolCatalog.ts#L114-L138) | Catalog advertises unregistered tools |
| 18 | Code Quality | [src/tools/BudgetMiddleware.ts:40-54](../../../../src/tools/BudgetMiddleware.ts#L40-L54) | `recordTurnTokens` never called (session-token enforcement dead) |
| 19 | Code Quality | [src/safety/BudgetEnforcer.ts](../../../../src/safety/BudgetEnforcer.ts) | `BudgetEnforcer` never instantiated |
| 20 | Code Quality | [src/storage/ConversationSync.ts](../../../../src/storage/ConversationSync.ts) | `ConversationSync` never instantiated |
| 21 | Code Quality | [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts) | God-class SRP violation (also R P0) |
| 22 | Security | [src/tools/handlers/webSearch.ts:32-78](../../../../src/tools/handlers/webSearch.ts#L32-L78) | SSRF protection hostname-only, DNS rebinding bypass |
| 23 | Security | [src/backend/src/backend/main.py:28-54](../../../../src/backend/src/backend/main.py#L28-L54) | FastAPI backend has no auth, no CORS |
| 24 | Security | [src/tools/handlers/terminal.ts:16-47](../../../../src/tools/handlers/terminal.ts#L16-L47) | Shell-command blocklist bypassable (substring match) |
| 25 | Security | [src/mcp/McpManager.ts:141-156](../../../../src/mcp/McpManager.ts#L141-L156) | MCP spawn inherits full `process.env`; workspace-local mcp.json auto-loaded |
| 26 | Security | [src/observability/OtlpExporter.ts:93-113](../../../../src/observability/OtlpExporter.ts#L93-L113) | No fetch timeout; no SSRF check on user-config endpoint |
| 27 | Security | [src/mcp/McpManager.ts:141-156](../../../../src/mcp/McpManager.ts#L141-L156) | `mcp.json` parsed without schema validation |
| 28 | Performance | [src/extension.ts:43-60](../../../../src/extension.ts#L43-L60) | New Ollama client every 5s (poller) |
| 29 | Performance | [src/chat/ConversationManager.ts:111-113](../../../../src/chat/ConversationManager.ts#L111-L113) | `getHistory()` returns fresh clone every call |
| 30 | Performance | [src/panels/GemmaCodePanel.ts:968-981](../../../../src/panels/GemmaCodePanel.ts#L968-L981) | `_postHistory` re-renders every message per call |
| 31 | Performance | [src/panels/GemmaCodePanel.ts:1237-1240](../../../../src/panels/GemmaCodePanel.ts#L1237-L1240) | `_postToWebview` doubles message traffic |
| 32 | Performance | [src/panels/GemmaCodePanel.ts:1116-1139](../../../../src/panels/GemmaCodePanel.ts#L1116-L1139) | System prompt rebuild every message |
| 33 | Performance | [src/storage/ChatHistoryStore.ts:144-163](../../../../src/storage/ChatHistoryStore.ts#L144-L163), [MemoryStore.ts:208-212](../../../../src/storage/MemoryStore.ts#L208-L212) | Unindexed leading-wildcard LIKE |
| 34 | Performance | [src/observability/MetricsCollector.ts:86-127](../../../../src/observability/MetricsCollector.ts#L86-L127) | `computeAggregateMetrics` N+1 + JSON.parse |
| 35 | Performance | [src/storage/GraphMemory.ts:232-263](../../../../src/storage/GraphMemory.ts#L232-L263), [GraphQueryEngine.ts:253-282](../../../../src/storage/GraphQueryEngine.ts#L253-L282) | Graph BFS one query per frontier node |
| 36 | Performance | [src/storage/ConversationSync.ts:19-32](../../../../src/storage/ConversationSync.ts#L19-L32) | `appendFileSync` per message (inert but would block if wired) |
| 37 | Testing | multiple | Sleep-based tests create CI flake risk |
| 38 | Testing | [tests/unit/tools/AgentLoop.test.ts](../../../../tests/unit/tools/AgentLoop.test.ts) | AgentLoop tests never exercise git-checkpoint branch |
| 39 | Testing | [tests/unit/orchestration/Orchestrator.replan.test.ts](../../../../tests/unit/orchestration/Orchestrator.replan.test.ts) | Replan test passes `memoryStore: null` always |
| 40 | Testing | multiple | `as unknown as` casts hide interface drift |
| 41 | Testing | [tests/unit/orchestration/Orchestrator.test.ts:174](../../../../tests/unit/orchestration/Orchestrator.test.ts#L174) | Trivial-pass assertion `toBeGreaterThanOrEqual(0)` |
| 42 | Testing | src/backend/src/backend/routers/models.py | No test for Python `/models` endpoint |
| 43 | Testing | [tests/integration/e2e/full-pipeline.test.ts](../../../../tests/integration/e2e/full-pipeline.test.ts) | `full-pipeline.test.ts` never runs real AgentLoop |
| 44 | Testing | [tests/integration/ollama-health.test.ts:18](../../../../tests/integration/ollama-health.test.ts#L18) | Conditional-live test disappears silently |
| 45 | Testing | [tests/unit/observability/GoldenTaskSuite.test.ts:52-54](../../../../tests/unit/observability/GoldenTaskSuite.test.ts) | `toHaveLength(5)` while tasks/ has 24 YAMLs |
| 46 | Restructuring | [src/ollama/types.ts](../../../../src/ollama/types.ts) | LLM-provider types leak into orchestration |
| 47 | Restructuring | [src/extension.ts](../../../../src/extension.ts) + panel | Composition root split between two files |
| 48 | Restructuring | [src/safety/](../../../../src/safety/) + [src/tools/](../../../../src/tools/) | Conceptual cycle; guardrails seam needed |
| 49 | Restructuring | [src/ollama/client.ts](../../../../src/ollama/client.ts) + [src/storage/EmbeddingClient.ts](../../../../src/storage/EmbeddingClient.ts) | Duplicate HTTP-to-Ollama boilerplate |
| 50 | Restructuring | [package.json:5](../../../../package.json#L5) | Version drift 0.2.0 / v0.3.0; model-name default mismatch |
| 51 | Restructuring | N/A | No one-command local dev setup |
| 52 | Simplification | [src/safety/BudgetEnforcer.ts](../../../../src/safety/BudgetEnforcer.ts) | `BudgetEnforcer` never instantiated (also CQ P1) |
| 53 | Simplification | [src/tools/LazyToolLoader.ts](../../../../src/tools/LazyToolLoader.ts) | `LazyToolLoader` never registered |
| 54 | Simplification | [src/config/](../../../../src/config/) | Parallel hardware-tier systems |
| 55 | Simplification | [src/backend/pyproject.toml:12](../../../../src/backend/pyproject.toml#L12) | `python-multipart` unused |
| 56 | Simplification | [scripts/build-vsix.ps1:110-114](../../../../scripts/build-vsix.ps1#L110-L114) | `out/webview/highlight.min.js` packaged but unused (~1 MB) |
| 57 | Simplification | [package.json:217-223](../../../../package.json#L217-L223) | `memoryAutoSaveInterval` setting never read |
| 58 | Simplification | [package.json:299-303](../../../../package.json#L299-L303) | `permissionOverrides` setting never plumbed |
| 59 | Simplification | [package.json:289-298](../../../../package.json#L289-L298) | `maxSessionTokens`/`maxSessionMinutes` feed dead code |
| 60 | Simplification | [src/mcp/McpClient.ts:43-44](../../../../src/mcp/McpClient.ts#L43-L44) | Verify MCP SDK tree-shake in VSIX |

### P2 - Medium (42)

Listed compactly in Section 3.x above. Full detail per phase subsection. Key categories: duplicated cosine/FTS utilities across three stores (3 findings), god-method refactors (`AgentLoop.run`, `GemmaCodePanel._handleBuiltinCommand`), schema-validation gaps in grep/regex/entity-extractor, MCP tool-schema sanitization, cross-cutting concern scattering, weak assertions in tests, missing edge cases in grep / backoff / Windows cleanup, installer-smoke CI duplication, observability module boundary (`GoldenTaskSuite` misplaced), dep rationalization (dual GPU-tier settings), build config (`declaration: false`), and several P2 performance entries (highlight.js full import, graph DB double-open, FTS5 rebuild on every boot, extractAndSave sequential, EmbeddingClient per-instance cache). Each finding retains its `path:line` reference in Section 3.

### P3 - Low (27)

Compact list, full detail in Section 3:
- Unused `BLOCKED_PATTERNS` import ([ActionClassifier.ts:2](../../../../src/safety/ActionClassifier.ts#L2))
- `AgentLoop._postTokenCount` sentinel comment ([AgentLoop.ts:395-401](../../../../src/tools/AgentLoop.ts#L395-L401))
- `_buildPromptContext` per-call settings ([GemmaCodePanel.ts:1032-1050](../../../../src/panels/GemmaCodePanel.ts#L1032-L1050))
- Swallowed config-save errors ([GemmaCodePanel.ts:909-910](../../../../src/panels/GemmaCodePanel.ts#L909-L910))
- Magic numbers in graph caps ([GraphQueryEngine.ts:11](../../../../src/storage/GraphQueryEngine.ts#L11))
- `buildForSubAgent` Tier-2 assumption ([PromptBuilder.ts:92](../../../../src/chat/PromptBuilder.ts#L92))
- SQLite file perms ([ChatHistoryStore.ts:22-26](../../../../src/storage/ChatHistoryStore.ts#L22-L26))
- Installer `OllamaSetup.exe` unverified checksum/signature
- Linux installer `curl | sh` pattern
- Silent exception handling in `MemoryStore` error paths
- CSP missing explicit directive list
- `stripCodeFences` redundant scan ([Gemma4ToolFormat.ts:44-47](../../../../src/tools/Gemma4ToolFormat.ts#L44-L47))
- `MemoryStore.retrieve` Map/array allocations ([MemoryStore.ts:250-309](../../../../src/storage/MemoryStore.ts#L250-L309))
- `_postHistory` payload doubled ([GemmaCodePanel.ts:976-980](../../../../src/panels/GemmaCodePanel.ts#L976-L980))
- `retainContextWhenHidden: true` webview memory ([extension.ts:239](../../../../src/extension.ts#L239))
- `TraceDashboardPanel` uses `crypto.randomUUID` without import ([TraceDashboardPanel.ts:34](../../../../src/panels/TraceDashboardPanel.ts#L34))
- Test naming inconsistency (should / no-prefix mix)
- Legacy NSIS test ([nsis-logic.test.ps1](../../../../tests/unit/installer/nsis-logic.test.ps1))
- Golden pytest/ruff caches in tree
- Integration/smoke boundary confusion
- Test factory drift
- No cross-config-change reaction test
- Identity alias `escapeAttr = escapeHtml`
- `parseOtlpHeaders` readability
- `test:integration` positional arg (verification only)
- `marked` audit + v12 upgrade plan
- No `docs/adr/` directory (ADR-absence)
- `modes/` single-file directory redundancy

---

## Section 5: Export

*Available on request via Next Steps option 7. Markdown and .docx exports can be generated from this document.*

---

## Next Steps

Found 129 issues (P0: 14, P1: 46, P2: 42, P3: 27) plus 15 restructuring recommendations and 15 simplification opportunities.

**How would you like to proceed?**

1. **Fix all** - Implement all suggested fixes across all severity levels
2. **Fix P0/P1 only** - Address critical and high-priority issues (60 items)
3. **Fix specific items** - Tell me which issues to address by number
4. **Apply restructuring recommendations** - Implement structural changes (will be done incrementally with confirmation at each step)
5. **Apply simplification recommendations** - Implement simplification opportunities (~800 LOC net deletable with behavior preserved)
6. **Build out the test pipeline** - Implement missing tests according to the recommended pipeline (close the 5 P0 testing gaps + sleep-based flake fixes)
7. **Export report** - Generate Markdown and Word (.docx) versions of this report
8. **No changes** - Review complete, no implementation needed
