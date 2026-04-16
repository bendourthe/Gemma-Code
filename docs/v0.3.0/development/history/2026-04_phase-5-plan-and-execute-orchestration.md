# Development Log: Phase 5 -- Plan-and-Execute Orchestration

**Date**: 2026-04-15
**Operator**: Benjamin Dourthe
**Assisted by**: Claude Opus 4.6 (Claude Code)
**Objective**: Replace the flat ReAct-style AgentLoop dispatch for complex tasks with a structured Plan-and-Execute orchestration layer featuring DAG-based planning, GPU-aware execution, Reflexion error recovery, and dynamic replanning.
**Outcome**: All 6 sub-tasks implemented with 82 tests passing, 97.85% statement coverage, zero regressions. The orchestration layer is additive; the existing AgentLoop path is untouched.

---

## 1. Starting State

- **Branch**: `main`
- **Starting commit**: `84432d8` (feat(v0.3.0): implement safety, budgeting and runaway prevention (Phase 4))
- **Environment**: Windows 11 Pro, Node.js 20, TypeScript 5.4, Vitest 1.6.1
- **Prior session reference**: `docs/v0.3.0/development/history/2026-04_phase-4-safety-budgeting-runaway-prevention.md`
- **Plan reference**: `docs/v0.3.0/implementation-plan.md` (lines 1745-2041)

Context: Phase 5 builds on Phase 4's safety infrastructure (loop detection, permission tiers, budget enforcement, git safety net) and Phase 3's episodic memory (used for storing Reflexion analysis). The goal is to add a structured orchestration layer that decomposes complex multi-step requests into dependency-aware task DAGs, executes them with GPU-tier-aware concurrency limits, recovers from failures using the Reflexion pattern, and replans when too many nodes fail.

---

## 2. Chronological Steps

### 2.1 Sub-task 5.1: Task DAG Data Model and PlannerAgent

**What happened**: Created the `src/orchestration/` directory and three new files: `TaskDAG.ts` (DAG data model with Kahn's cycle detection), `utils.ts` (multi-strategy JSON extraction from LLM output), and `PlannerAgent.ts` (LLM-based request decomposition into TaskDAG).

Key design decisions:
- Added `markRunning(nodeId)` method not in the original spec. Without it, `getReadyNodes()` returns the same pending nodes every executor iteration, causing double-dispatch in the concurrent execution pattern.
- Used Kahn's algorithm (topological sort) for cycle detection -- O(V+E) time, runs on construction and after `addNode()`.
- JSON extraction uses 3 strategies: direct parse, markdown fence extraction, greedy bracket matching. This handles Gemma 4's inconsistent output formatting across quantization levels.
- PlannerAgent retries once on parse failure, then falls back to a single-node DAG containing the original request. This ensures the orchestrator never blocks on LLM parsing errors.

**Key files created**: `src/orchestration/TaskDAG.ts`, `src/orchestration/utils.ts`, `src/orchestration/PlannerAgent.ts`, `tests/unit/orchestration/TaskDAG.test.ts`, `tests/unit/orchestration/PlannerAgent.test.ts`

**Verification**: 38 tests passing (30 TaskDAG + 8 PlannerAgent), 0 type errors.

---

### 2.2 Sub-task 5.2: DAG Executor with GPU-Aware Scheduling

**What happened**: Created `DAGExecutor.ts` with a local Promise-based Semaphore for concurrency control. The semaphore pattern uses a counter + queue of Promise resolve callbacks, avoiding third-party dependencies. Added `DAGProgressMessage` to `messages.ts`.

Key design decisions:
- Execution loop uses fire-and-forget with `Promise.race()` to react as tasks complete, rather than batch-and-wait which would underutilize GPU concurrency.
- Deadlock detection: breaks when `readyNodes.length === 0 && running.size === 0 && !dag.isComplete()`.
- Node type mapping: research -> research, code -> planning, test -> verification, verify -> verification (reusing existing SubAgentType enum).

**Key files created**: `src/orchestration/DAGExecutor.ts`, `tests/unit/orchestration/DAGExecutor.test.ts`
**Key files modified**: `src/panels/messages.ts` (added DAGProgressMessage to union)

**Verification**: 8 tests passing including parallel execution with controlled delays, 0 type errors.

---

### 2.3 Sub-task 5.3: Reflexion Pattern for Error Recovery

**What happened**: Created `ReflexionEngine.ts` with the full implementation (not just types). This was done earlier than planned because `DAGExecutor.ts` imports the `Reflection` type. The engine generates LLM-based self-reflections on failure, extracts negative constraints via regex, stores them in MemoryStore as `error_resolution` type, and formats accumulated reflections into retry context.

Key design decisions:
- Constraint extraction regex: `/(?:^|\.\s+)((?:Do not|Avoid|Instead|Make sure|Ensure)[^.]+\.)/gi` -- heuristic but sufficient for injecting negative constraints into retry prompts.
- ReflexionEngine is optional in DAGExecutor constructor. When absent, failed nodes retry without reflection context (degraded but functional).
- Integrated into DAGExecutor: stores `Map<string, Reflection[]>` per node ID, generates reflection before `markFailed()`, injects via `memoryContext` on retry.

**Key files created**: `src/orchestration/ReflexionEngine.ts`, `tests/unit/orchestration/ReflexionEngine.test.ts`
**Key files modified**: `src/orchestration/DAGExecutor.ts` (ReflexionEngine integration)

**Verification**: 8 tests passing, 0 type errors.

---

### 2.4 Sub-task 5.6: Structured Output Contracts (reordered before 5.4)

**What happened**: Created typed input/output contracts for each TaskNodeType. Moved this sub-task before 5.4 because the Orchestrator benefits from having typed contracts when mapping TaskNode types to SubAgentConfig.

Key design decisions:
- Validators are lenient (coerce missing fields to defaults) rather than strict. LLM output is imperfect; rejecting on a missing optional field wastes the sub-agent's work.
- `parseSubAgentResponse()` reuses `extractJsonFromLlmOutput()` from utils.ts for consistent JSON extraction.

**Key files created**: `src/orchestration/contracts.ts`, `tests/unit/orchestration/contracts.test.ts`

**Verification**: 17 tests passing, 0 type errors.

---

### 2.5 Sub-task 5.4: Orchestrator Integration and GemmaCodePanel Modification

**What happened**: Created the top-level `Orchestrator` class and made minimal modifications to `GemmaCodePanel.ts`. The Orchestrator activates only when `planMode.active === true` AND the request passes a keyword heuristic. Everything else flows through the existing ReAct loop.

Key design decisions:
- `shouldUseOrchestrator()` is synchronous (pure keyword match), not async as the plan specified. No LLM call needed for a heuristic.
- GemmaCodePanel changes are minimal: 1 import, 1 field, 8 lines of initialization, 4-line dispatch check, and a ~25-line handler method. The existing `_handleSendMessage()` flow is untouched for non-orchestrator paths.
- Added `DAGVisualizationMessage` and `ReplanningMessage` to messages.ts at the same time (for sub-task 5.5).

**Key files created**: `src/orchestration/Orchestrator.ts`, `tests/unit/orchestration/Orchestrator.test.ts`
**Key files modified**: `src/panels/GemmaCodePanel.ts` (import, field, init, dispatch, handler), `src/panels/messages.ts` (DAGVisualizationMessage + ReplanningMessage)

**Verification**: 7 tests passing, 0 type errors.

---

### 2.6 Sub-task 5.5: Dynamic Replanning on Divergence

**What happened**: The replanning logic was already built into the Orchestrator's `execute()` method during 5.4. Created the replan-specific test file to verify threshold detection, max replan limits, and context preservation across replans.

Key design decisions:
- Replan threshold: 30% of non-skipped nodes failed (`_replanThreshold = 0.3`).
- Max replans: 2 (`_maxReplanAttempts = 2`).
- Replanning prompt includes: completed node results, failed node reflections, and instruction to plan only remaining work.

**Key files created**: `tests/unit/orchestration/Orchestrator.replan.test.ts`

**Verification**: 4 tests passing, 0 type errors.

---

### 2.7 Documentation Updates

Updated `docs/DEVLOG.md` (Phase 5 entry), `docs/todos.md` (progress 5/48 -> 30/48, Phases 2-5 marked complete), and `docs/v0.3.0/implementation-plan.md` (Phase 5 exit checklist).

---

## 3. Verification Gate

| Check | Result |
|---|---|
| TypeScript compilation (`tsc --noEmit`) | PASS -- 0 errors |
| ESLint (`eslint src/orchestration/`) | PASS -- 0 errors |
| Orchestration unit tests (82 tests) | PASS -- 82/82 |
| Full non-storage test suite (669 tests) | PASS -- 669/669, 2 skipped (Ollama health) |
| Pre-existing storage tests | FAIL -- 95 failures (better-sqlite3 native module, pre-existing) |
| Statement coverage (orchestration/) | PASS -- 97.85% (threshold: 80%) |
| Branch coverage (orchestration/) | PASS -- 82.9% (threshold: 75%) |

---

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Pre-existing better-sqlite3 native module failures in storage tests | P2 | Pre-existing since Phase 3; not caused by Phase 5 |
| Orchestrator's `shouldUseOrchestrator()` is a simple keyword heuristic | P2 | Sufficient for now; can be upgraded to LLM-based classification in Phase 8 |
| DAG webview visualization not rendered (no client-side code) | P2 | Messages are sent but Phase 6 (webview trace dashboard) will add rendering |

---

## 5. Plan Discrepancies

- **Sub-task 5.6 reordered before 5.4**: Contracts were implemented before the Orchestrator because having typed input/output interfaces in place made the Orchestrator's SubAgentConfig mapping cleaner.
- **`shouldUseOrchestrator()` is synchronous, not `Promise<boolean>`**: The plan specified async but the implementation is a pure keyword heuristic with no LLM call.
- **`markRunning()` added to TaskDAG**: Not in the original plan spec but essential for the DAGExecutor's fire-and-forget concurrency pattern.
- **ReflexionEngine fully implemented during 5.2, not 5.3**: Created with full implementation early because DAGExecutor imports the Reflection type.

---

## 6. Assumptions Made

- **Non-streaming Ollama accumulation pattern is reliable**: Assumed `streamChat()` + for-await chunk accumulation (as used in CompactionStrategy) works correctly for PlannerAgent and ReflexionEngine. If Ollama changes its streaming behavior, both would need updates.
- **Single-threaded JS eliminates race conditions in DAG state**: Assumed `Promise.race` in the executor maintains event loop safety for TaskDAG mutations. This holds as long as no synchronous mutations happen across await boundaries within the same node.
- **Keyword heuristic is sufficient for orchestrator routing**: Assumed users will not trigger the orchestrator path for simple queries. Edge cases (e.g., "explain how to implement auth") could incorrectly trigger orchestration since "implement" is a trigger keyword.

---

## 7. Testing Summary

### Automated Tests
- TaskDAG: 30 passed (construction, validation, cycle detection, state transitions, serialization)
- PlannerAgent: 8 passed (JSON parsing, retry, fallback, cycle rejection, type validation)
- DAGExecutor: 8 passed (sequential/parallel execution, failure propagation, retry, reflexion integration)
- ReflexionEngine: 8 passed (reflection generation, constraint extraction, memory storage, context formatting)
- contracts: 17 passed (serialization, parsing, validation for all 4 task types)
- Orchestrator: 7 passed (heuristic routing, execute flow, fallback DAG)
- Orchestrator.replan: 4 passed (threshold detection, max replans, context preservation)

### Manual Testing Still Needed
- [ ] Enable plan mode in the running extension and send a complex request; verify DAG generation and node execution
- [ ] Test with TIER_1 hardware (6-8 GB VRAM) to confirm sequential execution
- [ ] Test with TIER_3 hardware (24+ GB VRAM) to confirm parallel execution
- [ ] Verify Reflexion improves retry success rate on a real multi-step task
- [ ] Test dynamic replanning by injecting failures into a running DAG

---

## 8. TODO Tracker

### Completed This Session
- [x] 5.1 -- Task DAG data model and PlannerAgent
- [x] 5.2 -- DAG executor with GPU-aware scheduling
- [x] 5.3 -- Reflexion pattern for error recovery
- [x] 5.4 -- Orchestrator integration and AgentLoop refactor
- [x] 5.5 -- Dynamic replanning on divergence
- [x] 5.6 -- Structured output contracts
- [x] 5.T -- Testing and stabilization (82 tests, 97.85% coverage)

### Remaining (Not Started)
- [ ] Phase 6 -- Local Observability & Trace Dashboard
- [ ] Phase 7 -- Cross-Platform PyQt5 Installer
- [ ] Phase 8 -- Golden Task Suite & Integration Stabilization

### Out of Scope (Deferred)
- [ ] LLM-based orchestrator routing (replace keyword heuristic) -- deferred to Phase 8 golden task evaluation
- [ ] DAG webview rendering -- deferred to Phase 6 trace dashboard

---

## 9. Summary and Next Steps

Phase 5 added a complete Plan-and-Execute orchestration layer to Gemma Code. Complex multi-step requests (when plan mode is active) are now decomposed into dependency-aware DAGs, executed with GPU-tier-aware concurrency, and recover from failures using the Reflexion pattern. The implementation is fully additive: the existing ReAct-style AgentLoop is untouched, and the Orchestrator path activates only under specific conditions.

**Next session should**:
1. Implement Phase 6 (Local Observability & Trace Dashboard) -- SQLite trace store, Tracer singleton, MetricsCollector, webview dashboard panel, optional OTLP export
2. Instrument the Orchestrator, DAGExecutor, and ReflexionEngine with trace spans
3. Build the golden task evaluation framework (Phase 6 Sub-task 6.3) for regression testing
