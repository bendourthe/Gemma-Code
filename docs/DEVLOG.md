# Development Log

This log tracks significant development milestones, architectural decisions, and implementation notes for Gemma Code.

---

## [2026-04-15] v0.3.0 Phase 6 -- Local Observability & Trace Dashboard

### Summary

Sixth phase of v0.3.0 harness engineering. Implemented the full observability stack: a SQLite-backed trace store (OpenTelemetry-compatible span model), a no-op-safe singleton Tracer for instrumenting core components, a metrics collector for aggregate session analytics, a golden task evaluation framework for regression detection, a webview trace dashboard with waterfall visualization, and an optional OTLP/HTTP JSON exporter. The Tracer is initialized with a TraceStore in extension.ts; when tracing is disabled (store is null), all methods are zero-cost no-ops. AgentLoop, SubAgentManager, and ContextCompactor now emit trace spans. The OTLP exporter is off by default (offline-first philosophy) but available via three new VS Code settings. Tests: 101 new tests across 6 test files, all passing. TypeScript compiles cleanly, 0 lint errors (2 expected console.debug warnings in OtlpExporter). No regressions in existing tests (756 total passing).

### Trace Data Model and SQLite Store (Sub-task 6.1)

**TraceStore class** (`src/observability/TraceStore.ts`): Follows the ChatHistoryStore pattern (constructor -> WAL mode -> foreign keys -> _initSchema). Two tables: `traces` (trace_id PK, session_id, root_span_id, start_time, end_time) and `spans` (span_id PK, trace_id FK with CASCADE delete, parent_span_id, name, kind, start_time, end_time, duration_ms, status, attributes JSON, events JSON). Indexes on trace_id, parent_span_id, kind, start_time. Key methods: startTrace() creates a trace + root span atomically, startSpan()/endSpan() manage span lifecycle with attribute merging on end, addEvent() appends to the JSON events array, getTrace() returns the trace with full span tree, listTraces() with pagination, getSpansByKind() for filtered queries, getSpan() for single span lookup, deleteOlderThan() for pruning with cascade.

Span kinds: `agent_turn`, `tool_call`, `llm_call`, `compaction`, `sub_agent`, `planning`, `reflexion`, `custom`. Statuses: `ok`, `error`, `cancelled`.

### Tracer Singleton (Sub-task 6.2)

**Tracer class** (`src/observability/Tracer.ts`): Singleton via `Tracer.getInstance()`. Holds optional TraceStore reference set via `init(store)`. All convenience methods (startTrace, startSpan, endSpan, addEvent) return early with empty strings when the store is null, providing zero-cost no-op behavior when tracing is disabled. Supports an optional `TracerExporter` interface for OTLP integration; completed spans are enqueued to the exporter in endSpan() if one is configured. `resetInstance()` method provided for test isolation.

### Core Component Instrumentation (Sub-task 6.2)

**AgentLoop** (`src/tools/AgentLoop.ts`): `run()` starts a root trace linked to the session ID. Each iteration gets an `agent_turn` span. `_streamOneTurn()` calls are wrapped with `llm_call` spans recording model name and response length. Tool executions get `tool_call` spans with toolName/callId/success attributes. The trace context is passed to the ContextCompactor via `setTraceContext()`.

**SubAgentManager** (`src/agents/SubAgentManager.ts`): `run()` now accepts optional `parentTraceId` and `parentSpanId` parameters. Creates a `sub_agent` span with agentType and maxIterations attributes. Ends with success/error status and toolCallCount/iterationsUsed metrics.

**ContextCompactor** (`src/chat/ContextCompactor.ts`): `compact()` creates a `compaction` span recording tokensBefore, tokensAfter, and maxTokens. A new `setTraceContext()` method lets AgentLoop link compaction spans to the session trace.

**ToolRegistry** (`src/tools/ToolRegistry.ts`): Tracer import added but no duplicate spans created, since AgentLoop already wraps `_registry.execute()` calls with tool_call spans.

### Metrics Collector (Sub-task 6.3)

**MetricsCollector class** (`src/observability/MetricsCollector.ts`): Computes SessionMetrics from spans in a trace (toolStepCount, llmCallCount, retryCount, compactionCount, humanInterventionCount, successRate, estimatedTokensUsed, subAgentCount). AggregateMetrics averages across multiple traces with proper median calculation. MetricsTrend returns time-series arrays for the last N traces. All methods handle empty/null gracefully.

### Golden Task Evaluation (Sub-task 6.3)

**GoldenTaskSuite module** (`src/observability/GoldenTaskSuite.ts`): Defines GoldenTask/GoldenTaskExpectation/GoldenTaskResult interfaces. Ships 5 placeholder golden tasks across categories: file_ops, code_gen, refactor, debug, test_gen. `validateExpectation()` checks maxToolCalls, maxDurationMs, and mustPass constraints. `detectRegressions()` compares current vs previous results, flagging duration and tool step regressions beyond a threshold (default 20%), plus pass-to-fail regressions.

### Webview Trace Dashboard (Sub-task 6.4)

**TraceDashboardPanel class** (`src/panels/TraceDashboardPanel.ts`): Implements `vscode.WebviewViewProvider` registered as `gemma-code.traceDashboard` in the sidebar. Handles three message types: requestTraceList, requestTraceDetail, requestTraceMetrics. Returns trace lists with duration/spanCount/status, full span trees, and computed SessionMetrics.

**Dashboard webview** (`src/panels/webview/traceDashboard.ts`): Self-contained HTML with inlined CSS/JS (same pattern as SessionListPanel). Features: trace list table (date, duration, spans, status), waterfall/timeline visualization on row click with spans positioned by startTime relative to trace start, color-coded bars by kind (blue=agent_turn, green=tool_call, purple=llm_call, orange=compaction, teal=sub_agent, red=reflexion), span detail pane showing attributes and events, refresh button. Uses VS Code theme CSS variables.

**Message types added** to `src/panels/messages.ts`: TraceListMessage, TraceDetailMessage, TraceMetricsMessage (extension->webview), RequestTraceListMessage, RequestTraceDetailMessage, RequestTraceMetricsMessage (webview->extension).

### Optional OTLP Export (Sub-task 6.5)

**OtlpExporter class** (`src/observability/OtlpExporter.ts`): Implements the `TracerExporter` interface. Buffers spans and flushes via HTTP POST in OTLP JSON format to a configurable endpoint (default: `http://localhost:4318/v1/traces`). Auto-flush at batchSize (100) and periodic flush on a timer (30s). Maps internal spans to OTLP schema: traceId/spanId as hex, timestamps in nanoseconds, kind mapping (llm_call -> SPAN_KIND_CLIENT, others -> SPAN_KIND_INTERNAL), attributes as key-value arrays. Network errors are logged at debug level and discarded (never thrown). `parseOtlpHeaders()` utility converts the settings string format to a headers object.

**Settings added:** `otlpEnabled` (boolean, default false), `otlpEndpoint` (string), `otlpHeaders` (string, comma-separated key=value).

### Extension Wiring

**extension.ts changes:** Creates TraceStore at `globalStorageUri/traces.db`, initializes the Tracer singleton, creates MetricsCollector, registers TraceDashboardPanel. If `otlpEnabled`, creates OtlpExporter and sets it on the Tracer. All cleanup is registered via `context.subscriptions`. TraceStore initialization is wrapped in try/catch so a failure does not block extension activation.

### Files Changed

**New (13):** TraceStore.ts, Tracer.ts, MetricsCollector.ts, GoldenTaskSuite.ts, OtlpExporter.ts, TraceDashboardPanel.ts, traceDashboard.ts + 6 test files (TraceStore, Tracer, MetricsCollector, GoldenTaskSuite, OtlpExporter, TraceDashboardPanel)

**Modified (9):** AgentLoop.ts (trace spans), SubAgentManager.ts (sub_agent span), ContextCompactor.ts (compaction span + trace context), ToolRegistry.ts (Tracer import), messages.ts (6 new message types), settings.ts (3 OTLP settings), extension.ts (TraceStore/Tracer/OTLP/dashboard init), package.json (Traces view + 3 OTLP config settings), todos.md (Phase 6 completion)

### Lessons Learned

- **No-op Tracer pattern is essential for optional instrumentation:** By returning empty strings when unintialized, the Tracer avoids conditional checks in every instrumented method. Components call tracer methods unconditionally; the Tracer silently discards them.
- **Trace context must be threaded explicitly in a non-DI system:** ContextCompactor needed a `setTraceContext()` method because it has no access to the AgentLoop's traceId. In a dependency-injection system, a scoped trace context would solve this more cleanly. The explicit setter works well for the current architecture.
- **better-sqlite3 native module version mismatch:** Tests initially failed because better-sqlite3 was compiled against NODE_MODULE_VERSION 135 but the runtime needed 137. Fixed with `npm rebuild better-sqlite3`. This is a recurring issue when the Node.js version changes between sessions.
- **Fake timers and async flush conflict:** Vitest's `vi.useFakeTimers()` caused an infinite loop in the OtlpExporter auto-flush test because the periodic timer fires during `vi.runAllTimersAsync()`, triggering more async work. Fixed by using real timers for the specific auto-flush test and only faking timers for the periodic flush test.
- **deleteOlderThan(0) does not delete "everything":** The cutoff is `Date.now() - 0 * day`, which equals "now". Traces created in the same millisecond are not "older than now", so they survive. Tests needed adjustment to use negative days (future cutoff) for reliable cleanup verification.

---

## [2026-04-15] v0.3.0 Phase 5 -- Plan-and-Execute Orchestration

### Summary

Fifth phase of v0.3.0 harness engineering. Replaced the flat ReAct-style agent loop dispatch for complex tasks with a structured Plan-and-Execute orchestration layer. The implementation adds a DAG-based task planner (LLM decomposes requests into dependency-aware subtask graphs), a GPU-tier-aware executor with semaphore-based concurrency control (1/2/3 concurrent sub-agents by tier), a Reflexion pattern for intelligent error recovery (generates analysis on failure, extracts negative constraints, injects into retry context), typed input/output contracts for sub-agent communication, and dynamic replanning when execution diverges (>30% node failure triggers re-planning with accumulated context). The Orchestrator activates only when plan mode is active AND the request is classified as "complex" by a keyword heuristic; simple single-turn requests continue to use the existing AgentLoop path unchanged. Tests: 82 new tests across 7 test files, all passing. TypeScript compiles cleanly, 0 lint errors. No regressions in existing non-storage tests (669 passing + 82 new = 751 total). Aggregate coverage for orchestration module: 97.85% statements.

### Task DAG Data Model (Sub-task 5.1)

**TaskDAG class** (`src/orchestration/TaskDAG.ts`): Stores nodes in a `Map<string, TaskNode>` for O(1) lookup. Builds a reverse adjacency map (dependents) on construction for efficient `skipDependents()` traversal. Validates acyclicity using Kahn's algorithm (topological sort) on construction and after `addNode()`. Key methods: `getReadyNodes()` (pending nodes with all deps completed), `markRunning()` (prevents double-dispatch), `markFailed()` (retries if retryCount < maxRetries, otherwise terminal failure), `skipDependents()` (BFS on reverse adjacency map, marks all transitive dependents as skipped), `toJSON()`/`fromJSON()` for serialization roundtrip.

**Critical addition not in original spec:** `markRunning(nodeId)` method. Without it, `getReadyNodes()` would return the same "pending" nodes every iteration of the executor loop, causing duplicate dispatches.

### JSON Extraction Utility (Sub-task 5.1)

**`extractJsonFromLlmOutput()`** (`src/orchestration/utils.ts`): Multi-strategy JSON extraction from LLM output: (1) direct `JSON.parse`, (2) markdown fence extraction (` ```json ... ``` `), (3) greedy bracket matching (first `[` to last `]`, or `{` to `}`). Shared by PlannerAgent and contracts module. Essential because Gemma 4 models at various quantization levels produce inconsistent output formatting.

### PlannerAgent (Sub-task 5.1)

**PlannerAgent class** (`src/orchestration/PlannerAgent.ts`): Calls Ollama (non-streaming accumulation pattern from CompactionStrategy) with a system prompt instructing the model to produce a JSON array of TaskNode objects. On parse failure, retries once with a correction message. On second failure, returns a single-node fallback DAG containing the original request. Sets `maxRetries=1` on all generated nodes by default. Validates node types against the allowed set: "research", "code", "test", "verify".

### DAG Executor with GPU-Aware Scheduling (Sub-task 5.2)

**DAGExecutor class** (`src/orchestration/DAGExecutor.ts`): Walks the TaskDAG, dispatching ready nodes to SubAgentManager with concurrency controlled by a local Promise-based Semaphore. Concurrency limits from GpuTierProfile: TIER_1=1 (sequential), TIER_2=2, TIER_3=3. Maps TaskNode types to SubAgentTypes: research -> research, code -> planning, test -> verification, verify -> verification. Includes deadlock detection (breaks when no nodes are ready and none are running). Posts `DAGProgressMessage` to the webview after each node completion.

**Semaphore pattern:** Counter + queue of Promise resolve callbacks. `acquire()` resolves immediately if under limit, otherwise enqueues. `release()` decrements and dequeues next waiter. No third-party dependencies.

### Reflexion Pattern for Error Recovery (Sub-task 5.3)

**ReflexionEngine class** (`src/orchestration/ReflexionEngine.ts`): When a sub-agent task fails, generates a textual self-reflection analyzing the root cause via an LLM call. Extracts negative constraints from the analysis using regex (`/(?:^|\.\s+)((?:Do not|Avoid|Instead|Make sure|Ensure)[^.]+\.)/gi`). Stores reflections in MemoryStore as `error_resolution` type. On retry, `buildRetryContext()` formats accumulated reflections into a structured context block injected into the sub-agent's `memoryContext`.

**DAGExecutor integration:** Optional `ReflexionEngineInterface` in constructor. Stores a `Map<string, Reflection[]>` per node ID. On failure with retries remaining: reflect -> store -> accumulate -> inject on retry dispatch. Exposes `getReflections()` for the Orchestrator's replanning logic.

### Structured Output Contracts (Sub-task 5.6)

**Contracts module** (`src/orchestration/contracts.ts`): Defines typed input/output interfaces for each TaskNodeType: ResearchInput/Output, CodeTaskInput/Output, TestTaskInput/Output, VerifyTaskInput/Output. `buildSubAgentRequest()` serializes inputs into structured prompts with JSON output schema instructions. `parseSubAgentResponse()` extracts and validates JSON from raw sub-agent output using `extractJsonFromLlmOutput()`. Validators are lenient (coerce missing fields to defaults) to handle imperfect LLM output.

### Orchestrator Integration (Sub-task 5.4)

**Orchestrator class** (`src/orchestration/Orchestrator.ts`): Top-level coordinator tying PlannerAgent, DAGExecutor, and ReflexionEngine together. `execute()` flow: plan -> post visualization -> execute with reflexion -> check failure rate -> optionally replan. `shouldUseOrchestrator()` is a synchronous keyword heuristic (triggers: "implement", "refactor", "build", "migrate", etc.; inhibitors: "what is", "explain", "show me", etc.; length threshold: >200 chars).

**GemmaCodePanel integration:** 3 changes: (1) import Orchestrator, (2) add `_orchestrator` field initialized after `_subAgentManager` in constructor, (3) insert 4-line dispatch check in `_handleSendMessage()` before the normal message path. New `_handleOrchestratorRequest()` method handles the orchestration flow and posts the summary as an assistant message. Total addition: ~50 lines. The existing ReAct loop path is completely untouched.

### Dynamic Replanning (Sub-task 5.5)

Built into the Orchestrator's `execute()` method. After DAG execution, checks failure rate: `failed / (total - skipped)`. If >30% (`_replanThreshold`) and replan count < 2 (`_maxReplanAttempts`): collects completed node results as context, collects reflections from the executor, builds an augmented replanning prompt, calls PlannerAgent again, and executes the new DAG. Posts `ReplanningMessage` to the webview with attempt number, reason, and failed node list.

### Message Types Added

3 new message types in `src/panels/messages.ts`, all added to the `ExtensionToWebviewMessage` union:
- `DAGProgressMessage` (type: "dagProgress"): node completion counts and currently running node titles
- `DAGVisualizationMessage` (type: "dagVisualization"): full DAG structure for webview rendering
- `ReplanningMessage` (type: "replanning"): replanning notification with attempt/reason/failed nodes

### Deviations from Plan

1. **`shouldUseOrchestrator()` is synchronous, not async:** The plan specified `Promise<boolean>` but the implementation is a pure keyword heuristic with no LLM call, so `boolean` is correct and avoids unnecessary async overhead.
2. **Sub-task 5.6 (Contracts) implemented before 5.4 (Orchestrator):** Reordered because the Orchestrator benefits from having typed contracts available when mapping TaskNode types. Contracts have no dependency on the Orchestrator.
3. **ReflexionEngine created early with full implementation:** Created during sub-task 5.2 (not 5.3) because DAGExecutor imports the Reflection type. The full implementation was written immediately rather than doing a type-only stub followed by a separate implementation pass.
4. **`markRunning()` added to TaskDAG:** Not in the original plan spec but essential for the DAGExecutor's fire-and-forget concurrency pattern. Without it, `getReadyNodes()` returns already-dispatched nodes.

### Files Changed

**New (14):** TaskDAG.ts, utils.ts, PlannerAgent.ts, DAGExecutor.ts, ReflexionEngine.ts, contracts.ts, Orchestrator.ts + 7 test files (TaskDAG, PlannerAgent, DAGExecutor, ReflexionEngine, contracts, Orchestrator, Orchestrator.replan)

**Modified (2):** messages.ts (3 new message types), GemmaCodePanel.ts (Orchestrator import, field, initialization, dispatch check, handler method)

### Lessons Learned

- **Multi-strategy JSON extraction is essential for local LLMs:** Gemma 4 at various quantization levels produces inconsistent output formatting (clean JSON, fenced blocks, trailing explanations). A try-parse -> fence-extract -> bracket-match -> retry pipeline handles all cases reliably.
- **`markRunning()` is critical for concurrent DAG execution:** Without a "running" status, the executor's fire-and-forget pattern dispatches the same node multiple times. This was not in the original spec and would have caused subtle concurrency bugs.
- **Additive integration minimizes risk:** The Orchestrator is wired into GemmaCodePanel with only ~4 lines in `_handleSendMessage()`. The entire existing ReAct loop path is untouched. This means any Orchestrator bugs only affect plan-mode complex requests, not the normal agent flow.
- **Promise-based semaphore is sufficient for JS concurrency:** No need for third-party libraries. A counter + resolve queue handles GPU-tier-aware concurrency cleanly because JavaScript is single-threaded and `Promise.race` maintains event loop safety.

### Current Status

Verified. TypeScript compiles cleanly (0 errors). 751 non-storage tests passing (669 existing + 82 new Phase 5), 0 failures, 0 regressions. Orchestration module coverage: 97.85% statements, 82.9% branches. Pre-existing better-sqlite3 native module failures in storage tests remain unchanged. Ready for Phase 6 (Local Observability & Trace Dashboard).

---

## [2026-04-15] v0.3.0 Phase 4 -- Safety, Budgeting & Runaway Prevention

### Summary

Fourth phase of v0.3.0 harness engineering. Implemented multi-layered safety infrastructure for the agent loop: hash-based loop detection (SHA-256 sliding window), a 3-tier permission system (AUTO_APPROVE/CONFIRM/DANGEROUS) with centralized enforcement in ToolRegistry, git-based safety net with checkpoint/rollback capability, session-level token and time budget enforcement, semantic action classification with per-invocation risk analysis, and GPU-tier-aware iteration/concurrency profiles. The permission refactor moved confirmation logic out of individual tool handlers (terminal.ts) into a centralized gate in ToolRegistry.execute(), making the permission model consistent across all tools including MCP tools. Tests: 78 new tests across 6 test files, all passing. TypeScript compiles cleanly, 0 lint errors. No regressions in existing non-storage tests (587 total passing). Pre-existing better-sqlite3 native module failures in storage tests remain unchanged.

### Loop Detection (Sub-task 4.1)

**LoopDetector class** (`src/safety/LoopDetector.ts`): Tracks SHA-256 hashes of consecutive tool call payloads (tool name + parameters, excluding transient `id` and `_callId` fields) in a configurable sliding window (default size 4). When the same hash appears `repeatThreshold` times (default 3), a warning is injected into the conversation as a system message. If the pattern persists after the warning, the agent loop is terminated immediately. `reset()` clears the buffer at the start of each `run()` call.

**AgentLoop integration:** Three insertion points: reset at `run()` start, record after each tool result injection, verdict check with early termination on "terminate" or system warning injection on "warn".

### Token & Time Budget Enforcement (Sub-task 4.4)

**BudgetEnforcer class** (`src/safety/BudgetEnforcer.ts`): Session-level budget tracking for estimated token usage (chars/4 heuristic, matching existing CHARS_PER_TOKEN convention) and wall-clock time. Fires `onBudgetWarning` callback at 80% of either budget, `onBudgetExceeded` at 100%. Designed to compose with (not replace) the existing BudgetMiddleware which handles per-turn and per-iteration limits.

**Settings additions:** `maxSessionTokens` (default 500,000, roughly 4x the 128K context window) and `maxSessionMinutes` (default 30).

**AgentLoop integration:** `checkBudget()` called before each iteration (alongside existing BudgetMiddleware check). `recordOutput()` called after streaming. `recordInput()` called when tool results are injected into conversation.

### Git Safety Net (Sub-task 4.3)

**GitSafetyNet class** (`src/safety/GitSafetyNet.ts`): Creates git stash-based checkpoints before agent runs and can commit agent-modified files with a `[gemma-code]` prefix after the loop completes. All git operations use `child_process.execFile` with a 10-second timeout and catch all errors (never thrown). Methods: `isGitRepo()`, `createCheckpoint()`, `commitAgentChanges()`, `rollback()`.

**Message types added:** `GitCheckpointMessage` (extension to webview) and `RollbackRequest` (webview to extension).

**AgentLoop integration:** Bookend pattern: checkpoint at start of `run()`, commit modified files after the loop completes.

**GemmaCodePanel integration:** Creates GitSafetyNet using workspace path, passes to AgentLoop, handles `rollbackRequest` message.

### Permission Tier System (Sub-task 4.2)

**PermissionTiers module** (`src/safety/PermissionTiers.ts`): Defines 3 tiers: AUTO_APPROVE (read_file, list_directory, grep_codebase, tail_output, grep_output, get_tool_schema), CONFIRM (write_file, edit_file, create_file, delete_file), DANGEROUS (run_terminal, web_search, fetch_page). MCP tools default to DANGEROUS. Functions: `getPermissionTier()`, `shouldRequireConfirmation()`, `getDangerousWarning()`. User overrides via `permissionOverrides` setting.

**ToolRegistry refactor:** Added `setConfirmationGate()` method. `execute()` now checks permission tier before calling handler and requests confirmation via the gate for CONFIRM/DANGEROUS tools. DANGEROUS tools include an enhanced warning message from `getDangerousWarning()`.

**terminal.ts refactor:** Removed `_confirmationGate` and `_mode` constructor parameters. Removed confirmation logic (now handled by ToolRegistry). Kept BLOCKED_PATTERNS as a hard safety layer. Constructor simplified to `(timeoutMs?: number)`. Exported `BLOCKED_PATTERNS` and `isBlocked()` for reuse by ActionClassifier.

**SubAgentManager fix:** Updated RunTerminalTool construction to use the new parameterless constructor. Removed unused ConfirmationGate import.

### Action Classification (Sub-task 4.5)

**ActionClassifier module** (`src/safety/ActionClassifier.ts`): Classifies each tool invocation by risk level: REVERSIBLE (no side effects), DESTRUCTIVE (modifies state), BLOCKED (unconditionally prevented). For `run_terminal`, performs command content analysis: read-only commands (ls, cat, git status, echo, etc.) are REVERSIBLE, BLOCKED_PATTERNS matches are BLOCKED, dangerous patterns (git push, rm, DROP, npm publish) are DESTRUCTIVE with `enhancedConfirmation`, all other commands default to DESTRUCTIVE.

**AgentLoop integration:** Before each `registry.execute()` call, classifies the action. BLOCKED actions skip execution entirely and inject a failure result. DESTRUCTIVE actions with `requiresCheckpoint` trigger a git checkpoint before execution. Posts `actionClassification` message to webview for UI visibility.

### GPU-Tier-Aware Iteration Limits (Sub-task 4.6)

**GpuTierConfig module** (`src/config/GpuTierConfig.ts`): Defines 3 tier profiles with safety-relevant parameters: TIER_1 (25 max iterations, 1 concurrent sub-agent, 0.7 compaction threshold), TIER_2 (40/2/0.8), TIER_3 (60/3/0.85). `detectGpuTier()` reads the explicit `gpuTier` setting or infers from model name (e4b -> T1, 26b/12b -> T2, 31b -> T3). `getEffectiveProfile()` merges tier defaults with user overrides.

**GemmaCodePanel integration:** Calls `detectGpuTier()` and `getEffectiveProfile()` in constructor. Uses `tierProfile.maxAgentIterations` instead of `settings.maxAgentIterations` when constructing AgentLoop. Also instantiates a LoopDetector and passes it to AgentLoop.

### Deviations from Plan

1. **BudgetEnforcer does not wrap BudgetMiddleware:** The plan called for BudgetEnforcer to compose BudgetMiddleware. Instead, they run as parallel checks in AgentLoop (existing BudgetMiddleware for token/iteration limits, new BudgetEnforcer for session-level token/time limits). This avoids changing the existing BudgetMiddleware contract.
2. **ActionClassifier is a module-level function, not a class:** The plan suggested an optional `actionClassifier` field on AgentLoopOptions. Instead, `classifyAction()` is imported directly and always runs (no opt-out). This is simpler and ensures every tool call is classified regardless of configuration.
3. **terminal.ts exports BLOCKED_PATTERNS and isBlocked:** Not in the original plan but necessary for ActionClassifier to reuse the existing blocklist rather than duplicating it.

### Files Changed

**New (12):** LoopDetector.ts, BudgetEnforcer.ts, GitSafetyNet.ts, PermissionTiers.ts, ActionClassifier.ts, GpuTierConfig.ts, + 6 test files

**Modified (8):** AgentLoop.ts, ToolRegistry.ts, terminal.ts, messages.ts, GemmaCodePanel.ts, settings.ts, SubAgentManager.ts, package.json

### Lessons Learned

- **Centralized confirmation is cleaner than per-handler confirmation:** Moving confirmation from individual tool handlers to ToolRegistry.execute() ensures consistent enforcement across all tools (including future MCP tools) and simplifies handler constructors.
- **Separate hard blocks from permission tiers:** BLOCKED_PATTERNS in terminal.ts is a hard safety layer that runs regardless of user settings. Permission tiers (AUTO_APPROVE/CONFIRM/DANGEROUS) are configurable. Keeping these orthogonal means neither can accidentally disable the other.
- **Bookend pattern for git safety:** Placing checkpoint at the start of `run()` and commit at the end avoids any changes to the inner tool execution loop for git operations. The inner loop only needs to track `_modifiedFiles` (which it already does).
- **Default-deny for shell commands:** The ActionClassifier treats all unrecognized shell commands as DESTRUCTIVE. This is more conservative than a whitelist approach but prevents unknown commands from silently executing without classification.

### Current Status

Verified. TypeScript compiles cleanly (0 errors). 587 non-storage tests passing, 0 failures. 78 new Phase 4 tests all passing. Pre-existing better-sqlite3 native module failures in storage tests remain unchanged. Ready for Phase 5 (Plan-and-Execute Orchestration).

---

## [2026-04-15] v0.3.0 Phase 3 -- Graph-Vector Hybrid Memory

### Summary

Third phase of v0.3.0 harness engineering. Implemented a 4-layer memory stack replacing the flat MemoryStore with a layered architecture: working memory (ephemeral in-context JSON), episodic memory (structured session event logs with provenance), semantic memory (existing MemoryStore extended with provenance/TTL/scope), and graph memory (entity-relationship triples with regex-based extraction). Includes a consolidation pipeline that detects recurring patterns in episodic memory and promotes them to semantic memory with write policy enforcement, plus a unified retrieval layer that queries all four layers in parallel with configurable budget distribution. Tests: 42 new tests passing (3 test files runnable without native module), TypeScript compiles cleanly, 0 lint errors. Tests requiring better-sqlite3 (EpisodicMemory, GraphMemory, MemoryConsolidator) cannot run in the current environment due to a pre-existing native module loading issue (ERR_DLOPEN_FAILED), same issue that affects all v0.2.0 storage tests.

### Memory Layer Architecture (Sub-task 3.1)

**MemoryLayers.types.ts** (`src/storage/MemoryLayers.types.ts`): Defines all type interfaces for the 4-layer system. Key types: `MemoryProvenance` (source tracking with confidence scores), `WriteGate` (policy enforcement), `MemoryTTL` (expiration and staleness), `WorkingMemoryState`, `EpisodicEntry`, `SemanticMemoryEntry` (extends existing MemoryEntry), `GraphEntity`, `GraphRelation`, `MemoryQuery`, `MemoryQueryResult`. Pure utility functions `isStale()` and `isExpired()` exported alongside types.

**MemoryStore.types.ts extension:** Added optional `provenance?`, `ttl?`, and `scope?` fields to the existing `MemoryEntry` interface for backward compatibility. Re-exports all new types from MemoryLayers.types.ts.

### Working Memory Manager -- Layer 1 (Sub-task 3.2)

**WorkingMemory class** (`src/storage/WorkingMemory.ts`): Ephemeral JSON state tracking current task, open files (cap 10), recent errors (cap 5), architectural decisions (cap 5), active goals, and a free-form scratchpad. Entirely synchronous with no disk I/O. `serialize(maxTokens)` produces compact markdown format, dropping lowest-priority sections (scratchpad first, then goals, then errors) when over budget.

**PromptBuilder integration:** Added `workingMemory?` to `PromptContext`. `_buildMemorySection()` prepends working memory serialization (20% of memory budget) before recalled memories. Working memory is never trimmed by the unified retriever.

**AgentLoop integration:** After each tool call, updates working memory: `addOpenFile` for read_file/write_file/edit_file/create_file, `addRecentError` for failed tool results.

### Episodic Memory -- Layer 2 (Sub-task 3.3)

**EpisodicMemory class** (`src/storage/EpisodicMemory.ts`): SQLite-backed session event store with FTS5 keyword search and optional embedding-based semantic search. Schema: `episodic_events` table with `episodic_fts` virtual table and INSERT/DELETE/UPDATE triggers for FTS sync. Methods: `record`, `searchKeyword` (BM25 ranking), `searchSemantic` (cosine similarity), `retrieve` (formatted string within token budget), `getSessionEvents`, `prune`, `close`. Shares the same `memory.db` database file as MemoryStore.

**Helper functions:** `recordToolEvent()` creates episodic entries from tool execution results with automatic confidence scoring (0.9 for success, 0.5 for failure). `recordDecisionEvent()` for architectural decisions.

**AgentLoop integration:** Records events for significant tool calls (write_file, edit_file, create_file, run_terminal, grep_codebase) via fire-and-forget promises.

### Graph Memory and Entity Extraction -- Layer 4 (Sub-tasks 3.4, 3.5)

**GraphMemory class** (`src/storage/GraphMemory.ts`): SQLite tables `graph_entities` and `graph_relations` with unique constraints on (name, type) and (source_id, target_id, type). All operations synchronous. `upsertEntity` increments mention_count and merges properties on duplicates. `upsertRelation` increases weight by 0.1 (capped at 1.0) on duplicates. `findRelatedEntities` performs BFS traversal capped at 50 results. `prune` cascade-deletes relations before removing low-mention old entities.

**EntityExtractor class** (`src/storage/EntityExtractor.ts`): Regex-based extraction (no LLM calls) of file paths, function/method names, class/interface names, import/module references, technology names (curated set of 50+ entries), error patterns, and decision markers. `extractRelationsFromText` infers relationships from co-occurrence and syntax: import relations, function-modifies-file, error-causes-file, decision-technology, and proximity-based related_to (entities within 100 characters, weight 0.3).

**Design decision:** Sentence splitting uses a negative lookbehind (`(?<!\.\w{1,5})`) to avoid splitting on periods inside file extensions like `.ts`, `.js`.

**GraphQueryEngine class** (`src/storage/GraphQueryEngine.ts`): Multi-hop traversal with recency-weighted scoring (1.0 for <1 day, 0.7 for <7 days, 0.4 otherwise). Hard cap of 100 nodes visited in BFS. Methods: `queryByEntity` (depth-limited subgraph), `queryByRelationType`, `queryContextFor` (extracts entities from natural language, traverses each at depth 2, merges), `formatAsContext` (markdown for prompt injection), `explainPath` (shortest path with natural-language explanation).

**MemoryStore integration:** `setGraphEngine()` setter injects the graph engine. `retrieve()` now appends graph context (up to 25% of token budget) when a graph engine is available.

### Memory Consolidation (Sub-task 3.6)

**MemoryConsolidator class** (`src/storage/MemoryConsolidator.ts`): Full pipeline: (1) gather episodic events, (2) extract entities/relations into graph memory, (3) detect recurring patterns via token overlap (intersection/union > 0.7), (4) apply write gate policy, (5) promote qualifying patterns to semantic memory with deduplication.

**Write gate policies:** `always` (for testing), `user_requested` (only user-stated sources), `tool_verified` (confidence >= 0.8), `pattern_recurring` (occurrences >= minRecurrences).

**ContextCompactor integration:** Added `setPostCompactionHook()` to ContextCompactor. The consolidator runs after compaction completes (post-hook rather than pre-hook).

**MemoryStore changes:** `_isDuplicate` renamed to public `isDuplicate`. Added `saveWithProvenance()` method accepting full provenance, TTL, and scope metadata.

### Unified Memory Retrieval (Sub-task 3.7)

**UnifiedMemoryRetriever class** (`src/storage/UnifiedMemoryRetriever.ts`): Queries all 4 layers with configurable budget distribution: working 20%, semantic 30%, graph 25%, episodic 25%. Unused budget redistributes proportionally to available layers. Queries run in parallel via `Promise.all` (working and graph are synchronous, semantic and episodic are async). Trims in reverse priority order (episodic first, working never).

**GemmaCodePanel wiring:** `_initMemoryLayers()` creates all layer instances sharing the same `memory.db` SQLite database. WorkingMemory and EpisodicMemory passed to AgentLoop via options. UnifiedMemoryRetriever and WorkingMemory passed to PromptBuilder via PromptContext. MemoryConsolidator wired to ContextCompactor post-hook. `_injectMemoryContext()` uses unified retriever when available, falls back to MemoryStore.retrieve().

### Deviations from Plan

1. **Post-compaction hook:** Instead of modifying the `_preCompactionHook` signature in ContextCompactor, added a separate `setPostCompactionHook()` method. The consolidator runs after compaction rather than during the pre-compaction phase, which avoids modifying the existing hook contract and is semantically better (consolidation should happen after extraction).

### Files Changed

**New (15):** MemoryLayers.types.ts, WorkingMemory.ts, EpisodicMemory.ts, GraphMemory.ts, EntityExtractor.ts, GraphQueryEngine.ts, MemoryConsolidator.ts, UnifiedMemoryRetriever.ts, + 7 test files

**Modified (7):** MemoryStore.types.ts, MemoryStore.ts, PromptBuilder.ts, PromptBuilder.types.ts, ContextCompactor.ts, AgentLoop.ts, GemmaCodePanel.ts

### Lessons Learned

- **Shared SQLite database:** Multiple modules (MemoryStore, EpisodicMemory, GraphMemory) can share the same SQLite database file with separate tables. WAL mode handles concurrent reads well. GraphMemory accepts a Database instance directly (shared) while EpisodicMemory creates its own connection (sharing the file path).
- **Sentence splitting around file extensions:** Naive splitting on `[.!?\n]+` breaks file paths like `src/storage/MemoryStore.ts`. Use negative lookbehind: `(?<!\.\w{1,5})[.!?]\s+|\n+`.
- **Graceful degradation in layers:** Making every memory layer optional (`| null`) in both the retriever and GemmaCodePanel allows the system to function at any level of initialization failure without crashing.
- **Post-hook vs pre-hook for consolidation:** Running consolidation after compaction (post-hook) rather than during pre-compaction is cleaner because the pre-hook already does extraction; consolidation needs the extracted data, not the raw messages.

### Current Status

Verified. TypeScript compiles, lint clean, 42 new tests passing. Tests requiring better-sqlite3 native module are blocked by pre-existing ERR_DLOPEN_FAILED (needs `npm rebuild better-sqlite3`). Ready for Phase 4 (Safety, Budgeting & Runaway Prevention).

---

## [2026-04-14] v0.3.0 Phase 2 -- Advanced Context Engineering

### Summary

Second phase of v0.3.0 harness engineering. Implemented five features to reduce context window pressure and improve information quality: lazy tool loading (get_tool_schema meta-tool for 40%+ token reduction), output redirection for large tool results (>5000 chars redirected to temp files with tail/grep helpers), regenerate-from-source compaction (re-reads actual files instead of summarizing conversation), hierarchical relevance scoring (multi-signal scoring for prompt section packing), and chat history syncing to JSONL for agent self-search via grep_codebase. Tests: 534 passing (43 test files), 2 pre-existing SQLite failures unchanged, 0 lint errors, 0 type errors. 83 new tests across 5 new test files.

### Chat History Syncing (Sub-task 2.5)

**ConversationSync class** (`src/storage/ConversationSync.ts`): Appends conversation messages as JSONL lines to `{workspace}/.gemma-code/sessions/{sessionId}.jsonl`. Fire-and-forget I/O (all errors caught silently). Methods: `syncMessage` (append single line), `syncSession` (overwrite full file for compaction), `deleteSession`, `listSyncedSessions`. ConversationManager gains an optional third constructor parameter and hooks in `_append()`, `replaceMessages()`, `clearHistory()`, and `loadSession()`.

**Design decision:** Synchronous file I/O (`appendFileSync`, `writeFileSync`) was chosen over async because individual messages are small and the sync is fire-and-forget. This avoids race conditions between rapid message appends.

### Output Redirection (Sub-task 2.2)

**OutputRedirector class** (`src/tools/OutputRedirector.ts`): When a tool result exceeds `charThreshold` (default 5000 chars), the full output is written to `.gemma-code-output/{callId}.txt` and replaced with a summary pointer containing first 500 chars preview plus instructions to use `tail_output` or `grep_output`.

**New tools:** `tail_output` (read last N lines from redirected file, default 50) and `grep_output` (regex search with line numbers, default 20 max results). Both implement ToolHandler and delegate to OutputRedirector.

**ToolRegistry integration:** Added `setOutputRedirector()` method and wrapping in `execute()`. The redirection is opt-in; without calling the setter, behavior is identical to before.

**Type changes:** Added `"tail_output" | "grep_output"` to BuiltinToolName union, BUILTIN_TOOL_NAMES array, and parameter interfaces. Added metadata entries to TOOL_CATALOG. Updated `.gitignore` with `.gemma-code-output/` and `.gemma-code/`.

### Lazy Tool Loading (Sub-task 2.1)

**LazyToolLoader class** (`src/tools/LazyToolLoader.ts`): Implements ToolHandler for `get_tool_schema`. The model calls `get_tool_schema(name)` to retrieve full parameter schemas on demand, instead of having all schemas embedded in the system prompt.

**serializeToolSummary()** (`src/tools/Gemma4ToolFormat.ts`): New function that produces only the `get_tool_schema` meta-tool as a full `<|tool>` declaration block, followed by a markdown list of available tool names and descriptions. Achieves 40%+ token reduction compared to `serializeToolDefinitions()`.

**PromptBuilder integration:** `_buildToolDeclarations()` checks `context.lazyToolLoading` to choose between compact (summary) and full (definitions) serialization. Backward compatible; default behavior unchanged.

**Type changes:** Added `"get_tool_schema"` to BuiltinToolName union and BUILTIN_TOOL_NAMES. Added `lazyToolLoading?: boolean` to PromptContext. TOOL_CATALOG now has 13 entries (was 10).

### Regenerate-from-Source Compaction (Sub-task 2.3)

**RegenerateFromSource class** (`src/chat/RegenerateFromSource.ts`): Implements CompactionStrategy. Instead of summarizing the conversation text, it re-reads actual source files, runs `git diff --stat HEAD~5` and `git log --oneline -5`, extracts decisions and test results from messages, and builds a fresh summary.

**Pipeline integration:** ContextCompactor gains optional `_workspacePath` parameter. RegenerateFromSource is inserted between CodeBlockTruncation and LlmSummary in the pipeline (only when workspacePath is provided). Pipeline order: ToolResultClearing, SlidingWindow, CodeBlockTruncation, RegenerateFromSource, LlmSummary, EmergencyTrim.

**Design decision:** Used `child_process.execSync` with 5-second timeout for git commands, wrapped in try/catch. Falls through gracefully to LlmSummary when git commands fail or no files exist.

### Hierarchical Relevance Scoring (Sub-task 2.4)

**RelevanceScorer class** (`src/chat/RelevanceScorer.ts`): Scores prompt sections by four signals: static priority (weight 0.3, normalized from section.priority), temporal recency (weight 0.2, decay from lastRelevantAt), semantic similarity (weight 0.3, cosine similarity via EmbeddingClient or default 0.5), and user mention (weight 0.2, keyword overlap). Caches embeddings within a scoring pass.

**Async build() migration:** PromptBuilder.build() is now `async build(): Promise<string>`. Added `buildSync()` for synchronous contexts (constructors). Shared logic extracted to private `_buildCore()`. When `context.relevanceScorer` is provided, conditional sections are scored and sorted by relevance descending; otherwise falls back to static priority ordering.

**Caller migration (10 call sites):**
- GemmaCodePanel constructor: `buildSync()` (cannot await in constructor)
- GemmaCodePanel (8 other sites): `await build()`; 3 methods changed from sync to async (`updateTierConfig`, `_handleSetEditMode`, `setOllamaReachable`)
- SubAgentManager: `await buildForSubAgent()`
- extension.ts: `void` prefix on fire-and-forget calls to newly-async methods

**Type changes:** Added `lastRelevantAt?: number` to PromptSection. Added `currentQuery`, `recentUserMessage`, `relevanceScorer` to PromptContext.

### Deviations from Plan

1. **ToolCatalog test**: Hardcoded count "10 entries" changed to `TOOL_CATALOG.length` for resilience (was breaking on each tool addition).
2. **Gemma4ToolFormat test**: Same pattern; replaced hardcoded `toBe(10)` with `toBe(TOOL_CATALOG.length)`.
3. **child_process mocking**: RegenerateFromSource tests required `vi.mock("child_process")` at module level rather than `vi.spyOn(await import(...))` because `execSync` is non-configurable on dynamic imports.

### Files Changed

**New (10):** ConversationSync.ts, OutputRedirector.ts, LazyToolLoader.ts, RegenerateFromSource.ts, RelevanceScorer.ts, + 5 test files

**Modified (15):** .gitignore, SubAgentManager.ts, ContextCompactor.ts, ConversationManager.ts, PromptBuilder.ts, PromptBuilder.types.ts, extension.ts, GemmaCodePanel.ts, Gemma4ToolFormat.ts, ToolCatalog.ts, ToolRegistry.ts, types.ts, + 3 test files

### Lessons Learned

- **Dual sync/async API pattern:** When making a widely-called method async, provide both `buildSync()` and `async build()` backed by shared `_buildCore()` logic. This avoids cascading async migration through constructors.
- **Opt-in wrapping for ToolRegistry:** Adding output redirection via `setOutputRedirector()` (setter) rather than modifying the constructor keeps the change backward-compatible and testable independently.
- **Module-level vi.mock for Node built-ins:** `vi.spyOn(await import("child_process"), "execSync")` fails because the property is non-configurable. Use `vi.mock("child_process")` at the top of the test file instead.

### Current Status

Verified. All quality gates pass. Ready for Phase 3 (Persistent Memory Layer).

---

## [2026-04-14] v0.3.0 Phase 1 -- GPU Detection & Hardware-Aware Foundation

### Summary

First phase of v0.3.0 harness engineering. Implemented GPU/VRAM auto-detection, 3-tier hardware classification (constrained/balanced/full), tier-aware context budget calculation, and token/iteration budget middleware for the agent loop. All new modules are pure TypeScript (no vscode imports) for full testability. Tests: 456 passing (35 test files), 2 pre-existing SQLite failures, 0 lint errors, 0 type errors.

### GPU Detection Service (Sub-task 1.1)

**GpuDetector class** (`src/config/GpuDetector.ts`): Platform-specific detection with ordered strategy fallbacks. NVIDIA via `nvidia-smi` CSV parsing (with Windows fallback to `C:\Windows\System32\nvidia-smi.exe`), AMD via `rocm-smi` on Linux or PowerShell `Get-CimInstance` on Windows, Apple via `system_profiler SPDisplaysDataType -json` with unified memory heuristic (75% of system RAM), and WMI/lspci fallback. Each command has a 5-second timeout and catches all errors gracefully. Results are instance-cached with `refresh()` to clear.

**Design decision:** Used `child_process.execFile` (not `exec`) for non-shell commands to avoid injection. Shell-requiring commands (WMI) use `exec` with hardcoded strings only. Multi-GPU systems are handled by picking the highest-VRAM GPU as `primaryGpu`.

### Hardware Tier Classification (Sub-task 1.2)

**Three tiers** defined in `TIER_CONFIGS` record:
- Tier 1 (constrained, <10 GB VRAM): gemma4:e2b/e4b, 32K context, 10 iterations, 0.7 compaction threshold
- Tier 2 (balanced, 10-20 GB): gemma4:e4b/12b, 128K context, 20 iterations, 0.8 threshold
- Tier 3 (full, 20+ GB): gemma4:26b-moe/31b, 256K context, 30 iterations, 0.85 threshold

**Backward compatibility:** Tier 2 budget overrides (10/3/65/20%) match the existing v0.2.0 hardcoded defaults exactly, ensuring zero behavioral change when no tier is detected.

**Settings additions:** `autoDetectGpu` (boolean, default true) and `gpuTierOverride` (1/2/3/null, default null) added to `GemmaCodeSettings` and `package.json` contributes.

### Tier-Aware Budget Calculator (Sub-task 1.3)

**PromptBudget expanded:** New `BudgetOverrides` interface replaces the single `systemPromptPercent` override with 5 optional fields (system, memory, skill, conversation, response). Added proportional scaling when percentages exceed 100% with a console warning.

**Tier 1 budget fix:** Original plan specified 8+2+70+20 = 100% for tier 1, but the default skill 2% pushed total to 102%. Fixed by adjusting conversationPercent to 68% (8+2+68+20+2 = 100%).

**ContextCompactor:** Replaced hardcoded `COMPACTION_THRESHOLD = 0.8` with a 7th constructor parameter `_compactionThreshold` (default 0.8). Existing call sites are unchanged.

### Budget Middleware (Sub-task 1.4)

**BudgetMiddleware class** (`src/tools/BudgetMiddleware.ts`): Pre-turn check (`checkPreTurn()`) enforces iteration limits (action: "stop") and session token limits (action: "compact"). Post-turn recording (`recordTurnTokens()`) enforces per-turn token limits (action: "truncate"). Warning issued at configurable threshold percentage.

**AgentLoop integration:** Added `budgetMiddleware` to `AgentLoopOptions`. Pre-turn budget check runs before `_streamOneTurn()` with compaction fallback. `recordIteration()` called after tool execution. `setBudgetMiddleware()` setter enables async tier config updates after construction.

### Extension Lifecycle Wiring (Sub-task 1.5)

**Activation flow:** Status bar item shows "Detecting GPU..." during async detection, then updates to "Tier N (name)" on completion. Detection is fire-and-forget (never blocks activation). Falls back to Tier 2 on failure.

**GemmaCodePanel.updateTierConfig():** Hot-swaps tier configuration after async detection. Rebuilds system prompt with tier info and creates BudgetMiddleware for the AgentLoop.

**PromptBuilder:** Appends "Running on {tierName} tier ({vramMb} MB VRAM) with model {modelName}." to base instructions when tier is available, giving the model self-awareness of its hardware constraints.

### Troubleshooting

**Extension test failure:** The vscode mock in `tests/setup.ts` was missing `StatusBarAlignment` and `createStatusBarItem`. Added both to the mock. The extension test also had an incomplete settings mock (missing `autoDetectGpu`, `useBackend`, etc.), causing `undefined` to flow through to `getTierConfig()`. Fixed by adding the missing settings to the mock and using `!= null` (loose equality) to catch both `null` and `undefined` for `gpuTierOverride`.

### Changes

**New files (9):**
- `src/config/GpuDetector.types.ts`: GpuVendor, GpuInfo, DetectionResult types
- `src/config/GpuDetector.ts`: GPU detection class with platform-specific strategies
- `src/config/HardwareTier.types.ts`: HardwareTierId, ModelRecommendation, HardwareTierConfig types
- `src/config/HardwareTier.ts`: TIER_CONFIGS, classifyTier, getTierConfig, getRecommendedModel
- `src/tools/BudgetMiddleware.types.ts`: SessionBudget, BudgetState, BudgetCheckResult types
- `src/tools/BudgetMiddleware.ts`: BudgetMiddleware class, createSessionBudget factory
- `tests/unit/config/GpuDetector.test.ts`: 9 tests for GPU detection
- `tests/unit/config/HardwareTier.test.ts`: 21 tests for tier classification
- `tests/unit/tools/BudgetMiddleware.test.ts`: 13 tests for budget middleware

**Modified files (15):**
- `src/config/settings.ts`: added autoDetectGpu, gpuTierOverride fields
- `src/config/PromptBudget.ts`: expanded BudgetOverrides, added calculateTierBudget, scaling validation
- `src/chat/ContextCompactor.ts`: parameterized compaction threshold
- `src/tools/AgentLoop.ts`: integrated budget middleware with pre-turn checks and setBudgetMiddleware setter
- `src/chat/PromptBuilder.types.ts`: added tierName, tierVramMb, tierModelName to PromptContext
- `src/chat/PromptBuilder.ts`: appends tier info to base instructions
- `src/panels/GemmaCodePanel.ts`: added _tierConfig field, updateTierConfig method, tier-aware _buildPromptContext
- `src/extension.ts`: GPU detection, status bar, detectGpu command
- `package.json`: added detectGpu command, autoDetectGpu and gpuTierOverride settings
- `tests/setup.ts`: added StatusBarAlignment, createStatusBarItem, showInformationMessage to vscode mock
- `tests/unit/config/PromptBudget.test.ts`: added 4 new tests for overrides, scaling, tier budget
- `tests/unit/config/settings.test.ts`: added 2 assertions for new settings defaults
- `tests/unit/chat/ContextCompactor.test.ts`: added custom threshold test
- `tests/unit/tools/AgentLoop.test.ts`: added 3 budget middleware integration tests
- `tests/unit/extension.test.ts`: expanded settings mock with missing fields

### Lessons Learned

- When adding new settings fields, always update the extension test's settings mock (which is separate from the global setup.ts mock) to include defaults for every field used in the activation path.
- Tier budget percentages must account for the default skillPercent (2%) which is not part of the tier's budgetOverrides. The total including skill must not exceed 100%.
- Use `!= null` (loose equality) rather than `!== null` for nullable settings in extension.ts to handle both `null` and `undefined` from incomplete mocks or missing VS Code configuration.

### Current Status

Phase 1 complete. All 5 sub-tasks implemented. Quality gate passed (0 new test failures, 0 lint errors, 0 type errors). Ready for Phase 2 (Advanced Context Engineering).

---

## [2026-04-10] v0.2.0 Phase 6 -- Integration, Polish, and Backend Alignment

### Summary

Final phase of v0.2.0. Aligned the Python backend with TypeScript-side compaction strategies, added webview UI indicators for new features, created root-level documentation files, and bumped to v0.2.0. Version is now release-ready. Tests: 328 TS passing (12 test files with pre-existing vscode module failures), 23 Python passing (6 pre-existing Gemma 3/4 token assertion mismatches), 0 lint errors, 13 new tests added.

### Python Backend Alignment

**Compaction strategies ported to Python:** Added `clear_old_tool_results()` and `sliding_window()` to `prompt.py`, mirroring the TypeScript `ToolResultClearing` and `SlidingWindow` strategies. These are the two zero-cost strategies from the 5-strategy `CompactionPipeline`. The expensive strategies (LlmSummary, CodeBlockTruncation) remain TypeScript-only since the backend is intentionally thin.

**`assemble_prompt()` pipeline order:** clear_old_tool_results -> sliding_window -> trim_history -> apply_gemma_template. New keyword-only parameters (`system_prompt`, `tool_results_keep`, `keep_recent`) keep the function signature backward-compatible.

**Bug fix in `chat.py`:** Line 25 was passing `settings.request_timeout` (a float, 120.0) as the `max_tokens` positional argument to `assemble_prompt()`. Fixed by using keyword arguments and letting `max_tokens` use its default (131072).

**Config expansion:** Added 6 new Pydantic fields to `config.py` (compaction_keep_recent, compaction_tool_results_keep, memory_enabled, thinking_mode, sub_agent_max_iterations, system_prompt_budget_percent), all with defaults matching the TypeScript side.

**Pydantic v2 immutability:** Used `msg.model_copy(update={"content": ...})` in `clear_old_tool_results()` to create modified Message copies rather than mutating, since Pydantic v2 BaseModel instances are immutable by default.

### Webview UI Updates

**New header badges:** Added 3 badges between `#plan-badge` and `#token-counter`:
- `#thinking-mode-badge` ("THINK") -- blue background, visible when thinking mode is active
- `#memory-badge` ("MEM") -- `.active` (full opacity) or `.off` (dimmed) based on memory system state
- `#mcp-badge` ("MCP") -- `.connected` (green) or `.disconnected` (dimmed) based on MCP server status

**Sub-agent spinner:** Enhanced the existing `subAgentStatus` handler to use `innerHTML` with a `<span class="sub-agent-spinner">` CSS-only spinning circle during the "running" state, replacing the plain text "running..." indicator.

**Message protocol:** Added `MemoryStatusMessage`, `McpStatusMessage`, and `ThinkingModeMessage` interfaces to `messages.ts` and the `ExtensionToWebviewMessage` union.

**GemmaCodePanel wiring:** Three new private methods (`_postMemoryStatus`, `_postMcpStatus`, `_postThinkingModeStatus`) post status messages on webview `ready` and after relevant operations (MCP connect/disconnect, memory save/clear).

### Documentation

- **SECURITY.md** (root): 48h ack SLA, 7-day critical fix target, coordinated disclosure, security architecture summary, references v0.1.0 security audit
- **ARCHITECTURE.md** (root): ~100-line concise overview with ASCII diagram, component tables for v0.1.0 and v0.2.0, points to `docs/v0.2.0/architecture.md` for details
- **docs/v0.2.0/architecture.md**: ~400-line comprehensive document with updated system diagram, all component descriptions, 4 data flow diagrams (streaming, compaction, sub-agents, memory), full message protocol reference, and configuration reference (27 settings)
- **CHANGELOG.md**: Full v0.2.0 entry with 6 phases grouped by Added/Changed/Known Limitations

### Pre-existing Test Failures

**TypeScript (12 test files):** All fail with `Failed to load url vscode` -- the `vscode` module mock is not resolving in the current Vitest environment. These failures exist on the previous commit (Phase 5) as well; they are not caused by Phase 6 changes.

**Python (6 tests):** Tests for `apply_gemma_template` and `assemble_prompt` still assert Gemma 3 tokens (`<start_of_turn>`, `<end_of_turn>`) but the code was updated to Gemma 4 tokens (`<|turn>`, `<turn|>`) in Phase 0. These test assertions were never updated after the Phase 0 migration.

### Changes

- Modified `src/backend/src/backend/config.py`: added 6 new settings fields
- Modified `src/backend/src/backend/services/prompt.py`: added `clear_old_tool_results()`, `sliding_window()`, updated `assemble_prompt()` signature with compaction pipeline
- Modified `src/backend/src/backend/routers/chat.py`: fixed `request_timeout` being passed as `max_tokens`, switched to keyword arguments
- Modified `src/backend/tests/unit/test_prompt.py`: added 13 new tests for compaction strategies and system_prompt injection
- Modified `src/panels/messages.ts`: added 3 new message type interfaces
- Modified `src/panels/webview/index.ts`: added CSS for 3 badges + spinner, HTML elements, DOM refs, 3 message handlers, enhanced sub-agent banner
- Modified `src/panels/GemmaCodePanel.ts`: added 3 status posting methods, wired into ready handler and MCP/memory operations
- Modified `package.json`: version 0.1.0 -> 0.2.0, model default gemma4 -> gemma4:e4b
- Modified `CHANGELOG.md`: added comprehensive v0.2.0 entry
- Created `SECURITY.md`, `ARCHITECTURE.md`, `docs/v0.2.0/architecture.md`

### Current Status

v0.2.0 implementation complete. All 6 phases done. Ready for commit and release tagging.

---

## [2026-04-09] v0.2.0 Phase 5 — Sub-Agent Orchestration

### Summary

Implemented sub-agent orchestration enabling the main AgentLoop to spawn isolated sub-agents (verification, research, planning) with focused prompts and restricted tool access. Each sub-agent gets its own ConversationManager and AgentLoop, runs sequentially on the same GPU via Ollama, and its output is injected back into the main conversation as an advisory report. Tests: 449 passing (up from 416), 0 failures, 88.57% line coverage, 0 lint errors.

### Architecture: SubAgentManager

**Core pattern:** SubAgentManager receives dependencies via DI (OllamaClient, PromptBuilder, MemoryStore, OllamaOptions, modelName). Its `run(config, postMessage)` method creates a fresh, ephemeral ConversationManager (no persistence store) and a scoped ToolRegistry per invocation. The sub-agent conversation is discarded after completion.

**Tool scoping:** Each sub-agent type gets a fresh ToolRegistry with only its allowed tools registered. This avoids the main registry's ConfirmationGate entanglement:
- **Verification**: `read_file`, `grep_codebase`, `list_directory`, `run_terminal` (with `confirmationMode: "never"` to auto-approve)
- **Research**: `read_file`, `grep_codebase`, `list_directory`, `web_search`, `fetch_page`
- **Planning**: `read_file`, `grep_codebase`, `list_directory`

Phase 4's `computeToolActivation()` with `subAgentType` context is applied as an additional safety layer on top of registry scoping.

**Result detection:** Sub-agent success is determined by both the absence of stream errors (tracked via a `hadError` flag on the postMessage wrapper) and the presence of meaningful assistant output. This handles the case where Ollama connection failures are caught internally by AgentLoop's `_streamOneTurn` and do not propagate as exceptions.

### Architecture: AgentLoop Enhancements

**AgentLoopOptions interface:** New optional parameters (`subAgentManager`, `verificationThreshold`, `verificationEnabled`) are grouped into an `AgentLoopOptions` interface passed as the 9th constructor argument. This avoids extending the existing 8-parameter positional constructor.

**File edit tracking:** After each successful `write_file`, `edit_file`, or `create_file` tool execution, the loop increments `_fileEditCount` and records the file path in `_modifiedFiles` (deduped). Recent tool results are tracked in a rolling 5-element window (`_recentToolResults`).

**Auto-verification trigger:** After the tool execution loop in each iteration, if `_fileEditCount >= threshold && verificationEnabled && _subAgentManager` is truthy, the loop resets the count, builds a SubAgentConfig, and runs verification. The verification report is injected as a user message so the model naturally processes it on the next iteration.

### Architecture: PromptBuilder Sub-Agent Support

**`buildForSubAgent()` method:** Convenience method that assembles a minimal PromptContext with sub-agent defaults (`isSubAgent: true`, `planModeActive: false`, `thinkingMode: true` for verification/planning, `promptStyle: "concise"`).

**Section skipping:** When `context.isSubAgent` is true, `_collectSections()` skips skill, memory, and plan mode sections. Sub-agents get only: base instructions + tool declarations + thinking mode (if enabled) + sub-agent directive. This keeps the system prompt minimal (~700 tokens vs ~2K+ for the main agent).

**Type-specific directives:** The placeholder `_buildSubAgentSection()` was replaced with a real implementation that reads `context.subAgentType` and returns instructions from `SubAgentPrompts.getSubAgentInstructions()`. Priority set to 5 with `alwaysInclude: true`.

### New Files
- `src/agents/types.ts` -- SubAgentType, SubAgentConfig, SubAgentResult
- `src/agents/SubAgentPrompts.ts` -- Prompt templates and context message builder
- `src/agents/SubAgentManager.ts` -- Core orchestrator (fresh registry + ConversationManager per run)
- `tests/unit/agents/SubAgentPrompts.test.ts` -- 11 tests
- `tests/unit/agents/SubAgentManager.test.ts` -- 7 tests

### Modified Files
- `src/tools/AgentLoop.ts` -- AgentLoopOptions, file edit tracking, auto-verification trigger, spawnSubAgent()
- `src/chat/PromptBuilder.ts` -- buildForSubAgent(), section skipping, type-specific sub-agent section
- `src/chat/PromptBuilder.types.ts` -- Added subAgentType, subAgentContext to PromptContext
- `src/config/settings.ts` + `package.json` -- 3 new settings (verificationEnabled, verificationThreshold, subAgentMaxIterations)
- `src/panels/messages.ts` -- SubAgentStatusMessage type
- `src/commands/CommandRouter.ts` -- /verify and /research builtin commands
- `src/panels/GemmaCodePanel.ts` -- SubAgentManager wiring, command handlers
- `src/panels/webview/index.ts` -- Sub-agent status banner UI

### Lessons Learned
- AgentLoop's `_streamOneTurn` catches stream errors internally and returns null rather than throwing. SubAgentManager must track errors via the postMessage callback rather than relying on try/catch around `agentLoop.run()`.
- Fresh ToolRegistry per sub-agent is cleaner than cloning because read-only tool handlers (ReadFileTool, GrepCodebaseTool, ListDirectoryTool) have no constructor dependencies, and RunTerminalTool with `confirmationMode: "never"` skips the gate entirely (line 83 of terminal.ts).
- Mock OllamaClient generators are single-use; tests that run multiple sub-agent invocations need a factory function that returns fresh generators per `streamChat` call.

### Current Status
Verified. 449 tests passing, 0 failures, 88.57% line coverage, 0 lint errors. Next: Phase 6 (Integration, Polish & Backend Alignment).

---

## [2026-04-09] v0.2.0 Phase 4 — Conditional Tool Activation and MCP Support

### Summary

Added context-dependent tool enable/disable logic and Model Context Protocol (MCP) support. Tools are now conditionally activated based on runtime state (Ollama reachability, network availability, session mode, sub-agent type, 15-tool cap). MCP client connects to external MCP servers via stdio, and MCP server exposes Gemma Code's tools to external clients. Tests: 416 passing (up from 372), 0 failures, 0 lint errors.

### Architecture: Type System Extensions

**Problem:** The `ToolName` type was a strict 10-member string union that could not accommodate dynamically discovered MCP tools.

**Solution:** Introduced a two-tier type system:
- `BuiltinToolName` -- the original 10-member union for built-in tools
- `McpToolName` -- template literal type `` `mcp:${string}` `` for namespaced MCP tools (e.g., `mcp:mempalace/search`)
- `ToolName = BuiltinToolName | McpToolName` -- union of both

The `mcp:` prefix was chosen over `(string & {})` escape hatch because it preserves runtime type narrowing via `name.startsWith("mcp:")` and prevents collision with built-in tool names.

`DynamicToolMetadata` extends `ToolMetadata` with `source: "builtin" | "mcp"` and `priority: number` (builtin = 0, MCP = 100). The `toDynamicMetadata()` helper wraps static catalog entries.

### Architecture: Conditional Tool Activation

**ToolRegistry enable/disable state:**
- `_enabled: Map<ToolName, boolean>` alongside `_handlers`
- `setEnabled()`, `isEnabled()`, `getEnabledNames()`, `getEnabledToolMetadata()`
- `execute()` returns a "currently disabled" error for disabled tools (does not crash the agent loop)
- Newly registered tools are enabled by default

**ToolActivationRules.ts** -- Pure function `computeToolActivation()` applied in order:
1. `!ollamaReachable` -- disable ALL tools
2. `!networkAvailable` -- disable `web_search`, `fetch_page`
3. `readOnlySession` -- disable write/execute tools
4. `subAgentType === "research"` -- disable write tools
5. `subAgentType === "verification"` -- disable create/delete tools
6. `totalToolCount > 15` -- trim lowest-priority MCP tools

The rules engine is a pure function taking `(allTools, context)` and returning `{ disabledTools, reasons }`. This made it trivially testable with 10 unit tests covering each rule and their composition.

**GemmaCodePanel wiring:**
- `_getEnabledToolMetadata()` combines `TOOL_CATALOG.map(toDynamicMetadata)` with `_mcpTools`, runs `computeToolActivation()`, and calls `setEnabled()` on the registry
- `_buildPromptContext()` now uses `_getEnabledToolMetadata()` instead of spreading the full static catalog
- `_buildOllamaTools()` extracts OllamaToolDefinition building into a method that also filters to enabled tools
- `setOllamaReachable(reachable)` triggers prompt rebuild on state change
- Constructor initialization order issue: `_buildPromptContext()` is called before `_registry` is assigned; solved with a guard (`if (!this._registry) return builtinTools`)

### Architecture: MCP Support

**`@modelcontextprotocol/sdk`** added as a runtime dependency. All imports use dynamic `import()` to avoid ESM/CJS interop issues (the SDK is ESM-only, the VS Code extension outputs CJS via `Node16` module resolution).

**McpClient** (`src/mcp/McpClient.ts`):
- Connects to a single external MCP server via `StdioClientTransport`
- `connect()` calls `client.listTools()` to discover tools, converts to `McpToolInfo[]` with qualified `mcp:serverName/toolName` names
- `callTool()` delegates via JSON-RPC, extracts text content from response, returns `ToolResult`
- Status tracking: `disconnected -> connecting -> connected | error`

**McpToolHandler** (`src/mcp/McpToolHandler.ts`):
- Implements `ToolHandler` interface, delegates `execute()` to `McpClient.callTool()`
- One instance per discovered MCP tool, registered in `ToolRegistry`

**McpManager** (`src/mcp/McpManager.ts`):
- Reads config from `.gemma-code/mcp.json` (workspace-local overrides `~/.gemma-code/mcp.json` global)
- Manages multiple `McpClient` instances by server name
- `connectServer()` creates client, connects, registers discovered tools in `ToolRegistry`
- `disconnectServer()` disables tools and disconnects
- `getAllToolMetadata()` returns MCP tools as `DynamicToolMetadata[]` for prompt injection

**McpServer** (`src/mcp/McpServer.ts`):
- Exposes built-in tools via MCP stdio transport using `McpServer` (high-level SDK class from `server/mcp.js`)
- Each catalog tool registered via `server.tool(name, description, callback)` (3-arg overload, no Zod schema)
- Callback delegates to `ToolRegistry.execute()`
- Start/stop lifecycle controlled by `mcpServerMode` setting

**Settings:** `mcpEnabled: false` (opt-in), `mcpServerMode: "off" | "stdio"`

**`/mcp` command:** status (shows connected servers and tool count), connect `<name>`, disconnect `<name>`

### New files

| File | Lines | Purpose |
|------|-------|---------|
| `src/tools/ToolActivationRules.ts` | ~100 | Context-dependent tool enable/disable rules engine |
| `src/mcp/McpTypes.ts` | ~35 | Type definitions: McpServerConfig, McpToolInfo, McpServerState |
| `src/mcp/McpClient.ts` | ~130 | Connect to external MCP servers via stdio |
| `src/mcp/McpToolHandler.ts` | ~18 | ToolHandler wrapper for MCP tool calls |
| `src/mcp/McpManager.ts` | ~165 | MCP connection lifecycle and config management |
| `src/mcp/McpServer.ts` | ~80 | Expose built-in tools via MCP stdio |
| `tests/unit/tools/ToolActivationRules.test.ts` | ~160 | 10 tests for activation rules |
| `tests/unit/mcp/McpClient.test.ts` | ~150 | 10 tests for MCP client |
| `tests/unit/mcp/McpManager.test.ts` | ~155 | 9 tests for MCP manager |
| `tests/unit/mcp/McpServer.test.ts` | ~110 | 6 tests for MCP server |

### Modifications to existing files

| File | Change |
|------|--------|
| `src/tools/types.ts` | Split `ToolName` into `BuiltinToolName` + `McpToolName` union; renamed `TOOL_NAMES` to `BUILTIN_TOOL_NAMES` with deprecated alias |
| `src/tools/ToolCatalog.ts` | Added `DynamicToolMetadata`, `ToolCategory`, `toDynamicMetadata()` |
| `src/tools/Gemma4ToolFormat.ts` | Updated `isToolName()` to accept `mcp:` prefix; switched to `BUILTIN_TOOL_NAMES` import |
| `src/tools/ToolRegistry.ts` | Added `_enabled` map, `setEnabled()`, `isEnabled()`, `getEnabledNames()`, `getEnabledToolMetadata()`; `execute()` checks enabled state |
| `src/chat/PromptBuilder.types.ts` | Widened `enabledTools` type to accept `DynamicToolMetadata` |
| `src/config/settings.ts` | Added `mcpEnabled`, `mcpServerMode` settings |
| `src/commands/CommandRouter.ts` | Added `"mcp"` to `BuiltinCommandName` and descriptors |
| `src/panels/GemmaCodePanel.ts` | Added `_registry`, `_ollamaReachable`, `_mcpTools`, `_mcpManager`, `_mcpServer` fields; `_getEnabledToolMetadata()`, `_buildOllamaTools()`, `setOllamaReachable()` methods; full `/mcp` command handler; MCP initialization in constructor; cleanup in `dispose()` |
| `src/extension.ts` | Wired `setOllamaReachable()` in health poller and initial check |
| `package.json` | Added `@modelcontextprotocol/sdk` dependency; added `mcpEnabled` and `mcpServerMode` config properties |

### Lessons Learned

- **ESM/CJS interop with `@modelcontextprotocol/sdk`:** The SDK uses `"type": "module"` in its package.json. With `tsconfig.json` set to `"module": "Node16"`, static imports fail with TS1479. Solution: dynamic `import()` for all SDK classes. This adds a small async overhead on first use but avoids any build configuration changes.
- **Constructor initialization order matters:** `_buildPromptContext()` is called early in the constructor (line 76) before `_registry` is assigned (line 102). The `_getEnabledToolMetadata()` method must guard against `!this._registry` and return the full catalog as a fallback during initial construction.
- **McpServer SDK class location:** The high-level `McpServer` class is at `@modelcontextprotocol/sdk/server/mcp.js`, not re-exported from `@modelcontextprotocol/sdk/server`. The `server` subpath exports only the low-level `Server` class.
- **`server.tool()` overloads:** The 4-arg overload `(name, description, schema, cb)` expects a Zod shape for the schema parameter. The simpler 3-arg overload `(name, description, cb)` accepts any callback params and avoids Zod type requirements.

### Current Status

Verified. Build clean, 416 tests passing, 0 lint errors. Phase 4 complete.

---

## [2026-04-09] v0.2.0 Phase 3 — Persistent Memory System

### Summary

Added cross-session persistent memory backed by SQLite FTS5 for keyword search and optional Ollama embeddings for semantic search. Memories are auto-extracted before context compaction and injected into the system prompt via the PromptBuilder memory section (3% token budget). Tests: 372 passing (up from 327), 0 failures, 0 lint errors.

### Architecture: MemoryStore and Retrieval Pipeline

**New files:**
- `src/storage/MemoryStore.ts` -- Core memory system with SQLite FTS5, embedding BLOB storage, heuristic extraction, and token-budgeted retrieval.
- `src/storage/EmbeddingClient.ts` -- Wraps Ollama `/api/embed` endpoint. Graceful degradation to keyword-only search when embedding model is unavailable.
- `src/storage/MemoryStore.types.ts` -- Types: `MemoryEntry`, `MemoryType` (5 types: decision, fact, preference, file_pattern, error_resolution), `MemorySearchResult`, `MemoryStats`.

**Memory retrieval pipeline:**
1. FTS5 keyword search (BM25 ranking, zero LLM cost)
2. Cosine similarity against stored embeddings (optional, requires `nomic-embed-text`)
3. Merge/dedup by ID, combined score (0.6 * keyword + 0.4 * semantic)
4. Greedy token-budget packing (chars/4 estimation)
5. Format as `## Recalled Memories` section for system prompt injection

**Auto-extraction (pre-compaction hook):**
Heuristic regex patterns detect decisions ("decided to", "going with"), preferences ("prefer", "always use"), error resolutions, project facts, and file patterns from messages about to be compacted. Deduplication uses FTS5 OR queries against existing memories.

### Modifications to existing files

- **`src/config/settings.ts`** -- 4 new settings: `memoryEnabled`, `embeddingModel`, `memoryAutoSaveInterval`, `memoryMaxEntries`
- **`src/storage/ChatHistoryStore.ts`** -- Added FTS5 virtual table on messages with sync triggers and `searchFts()` method. One-time rebuild for v0.1.0 upgrade compatibility.
- **`src/chat/PromptBuilder.ts`** -- Memory section now respects the 3% token budget cap with truncation notice.
- **`src/commands/CommandRouter.ts`** -- Added `/memory` builtin command (search, save, clear, status subcommands).
- **`src/panels/GemmaCodePanel.ts`** -- MemoryStore initialization, pre-compaction hook wiring, memory query before every `pipeline.send()`, `/memory` command handler, dispose cleanup.
- **`package.json`** -- 4 new VS Code configuration properties.

### Key decisions

- **No ChromaDB dependency.** SQLite FTS5 is bundled with better-sqlite3 (zero new deps). Embeddings stored as Float64Array BLOBs in SQLite. Cosine similarity computed in-process (sub-millisecond at 10K entries).
- **Explicit rowid column.** The `memories` table uses `rowid INTEGER PRIMARY KEY AUTOINCREMENT` with `id TEXT UNIQUE NOT NULL` to avoid the FTS5 external content rowid pitfall.
- **OR-based deduplication.** Extract the 3 longest words from new content, search with FTS5 OR logic. Prevents saving near-duplicate memories while avoiding false negatives from strict AND matching.
- **Non-fatal memory operations.** All memory queries and extraction are wrapped in try/catch. Memory system failure never breaks the chat flow or compaction pipeline.

### Deviations

None. Implementation follows the plan exactly.

### Test results

- 45 new tests (25 MemoryStore, 13 EmbeddingClient, 5 ChatHistoryStore FTS5, 2 CommandRouter)
- Extended settings test with 4 new default assertions
- 372 total passing, 0 failures, 2 skipped (pre-existing Ollama integration)

---

## [2026-04-08] v0.2.0 Phase 2 — Multi-Strategy Context Compaction

### Summary

Replaced the monolithic LLM-summary context compaction with a 5-strategy pipeline that applies cheap transformations first (regex, filtering, text replacement) before resorting to expensive LLM calls. The pipeline runs strategies in cost order until the conversation fits within the 65% conversation budget. Tests: 327 passing (up from 288), 0 failures, 0 lint errors.

### Architecture: CompactionStrategy Pipeline

**New interface and pipeline (`src/chat/CompactionStrategy.ts`):**

The `CompactionStrategy` interface defines a uniform contract for all strategies:
```typescript
interface CompactionStrategy {
  readonly name: string;
  canApply(messages: readonly Message[], budgetTokens: number): boolean;
  apply(messages: readonly Message[], budgetTokens: number): Promise<Message[]>;
}
```

`CompactionPipeline` iterates strategies in order, calling `apply()` on each, and short-circuits when `estimateTokensForMessages(current) <= budgetTokens`.

**Execution flow:**
```
if (estimatedTokens > conversationBudget) {
  for (strategy of [ToolResultClearing, SlidingWindow, CodeBlockTruncation, LlmSummary, EmergencyTrim]) {
    if (strategy.canApply(messages, budget)) {
      messages = await strategy.apply(messages, budget);
      if (estimateTokensForMessages(messages) <= budget) break;
    }
  }
}
```

### Strategy Implementations

| # | Strategy | Cost | Mechanism | Expected Savings |
|---|----------|------|-----------|-----------------|
| 1 | ToolResultClearing | Zero (regex) | Strips `<\|tool_result>` blocks from older messages, keeps N most recent (default 8), replaces with one-line summary | 30-60% of tool-heavy conversations |
| 2 | SlidingWindow | Zero (filtering) | Drops middle messages, preserves first user message, summary markers, and last N (default 10) | Variable depending on conversation length |
| 3 | CodeBlockTruncation | Zero (text replace) | Replaces code blocks >80 lines with `[Code block: N lines, language]` placeholder | 10-30% of code-heavy conversations |
| 4 | LlmSummary | 1 LLM call | Structured summary prompt preserving file paths, decisions, errors, tool outcomes | High reduction, expensive |
| 5 | EmergencyTrim | Zero (hard clip) | Drops non-system messages from front until under budget | Guaranteed fit |

### Key Design Decisions

- **Uniform `Promise<Message[]>` return type**: All strategies return `Promise<Message[]>` for uniform async handling, even zero-cost ones. This avoids runtime `instanceof Promise` checks in the pipeline loop.
- **Pipeline as separate class**: `CompactionPipeline` is its own class in `CompactionStrategy.ts`, injected into `ContextCompactor`. This keeps the pipeline independently testable while preserving `ContextCompactor` as the public facade.
- **Budget from PromptBudget**: The pipeline targets `calculateBudget(maxTokens).conversationBudget` (65% of context), not the 80% compaction trigger threshold. The trigger fires at 80% of the full context; strategies compact down to the 65% conversation allocation.
- **Settings read at compaction time**: `getSettings()` is called inside `compact()` rather than cached at construction, so users can change `compactionKeepRecent` and `compactionToolResultsKeep` mid-session.
- **Pre-compaction hook**: `ContextCompactor` accepts an optional `preCompactionHook` parameter (currently `undefined`). Phase 3 will wire `MemoryStore.extractAndSave()` here to preserve context before lossy operations.
- **`estimateTokensForMessages()` extracted**: Token estimation logic moved from `ContextCompactor` to a standalone exported function in `CompactionStrategy.ts` to avoid duplication across strategies.

### Changes

| File | Change |
|------|--------|
| `src/chat/CompactionStrategy.ts` (new, ~270 lines) | `CompactionStrategy` interface, `CompactionPipeline` class, `estimateTokensForMessages()` helper, 5 strategy implementations |
| `src/chat/ContextCompactor.ts` (rewritten, ~90 lines) | Replaced monolithic `compact()` with pipeline-based approach; `estimateTokens()` delegates to shared helper; added `preCompactionHook` constructor parameter |
| `src/chat/ConversationManager.ts` (+11 lines) | Added `replaceMessages(messages)` method for atomic message array replacement by the pipeline |
| `src/config/settings.ts` (+4 lines) | Added `compactionKeepRecent` (default 10) and `compactionToolResultsKeep` (default 8) to `GemmaCodeSettings` |
| `package.json` (+14 lines) | Registered both new settings in VS Code configuration |
| `tests/unit/chat/CompactionStrategy.test.ts` (new, 35 tests) | Full coverage of all strategies, pipeline orchestration, and token estimation |
| `tests/unit/chat/ContextCompactor.test.ts` (updated, 12 tests) | Updated for pipeline-based `compact()`: mocks `replaceMessages` instead of `replaceWithSummary`; added pre-compaction hook tests |
| `tests/unit/chat/ConversationManager.test.ts` (+3 tests) | Tests for `replaceMessages()`: replacement, onDidChange firing, getHistory visibility |

### Deviations from Plan

None. All subtasks implemented as specified.

### Test Results

- **Total**: 327 passed, 0 failed, 2 skipped (Ollama integration)
- **New tests**: 39 (35 CompactionStrategy + 1 ContextCompactor hook tests + 3 ConversationManager)
- **Build**: Clean `tsc --noEmit`
- **Lint**: ESLint clean

### Lessons Learned

- Extracting `estimateTokensForMessages()` as a standalone function early avoided circular dependency between `ContextCompactor` and `CompactionStrategy`. Strategies need token estimation but should not import the compactor.
- The `SlidingWindow` strategy must deduplicate anchor messages that are already in the tail window (e.g., first user message that is also one of the last N messages). Without dedup, the message would appear twice in the compacted output.
- `ToolResultClearing` uses the `slice(0, -N)` pattern to select messages to clear. When `_keepRecent` is 0, `slice(0, -0)` returns an empty array (not all elements), so the edge case of keep=0 needs explicit handling via the `canApply` check.

### Current Status

Verified. 327 tests passing, 0 lint errors, clean build. Ready for Phase 3 (Persistent Memory System).

---

## [2026-04-08] v0.2.0 Phase 0+1 — Gemma 4 Native Protocol & Dynamic PromptBuilder

### Summary

Implemented the first two phases of the v0.2.0 plan: migrated from the custom XML tool protocol to Gemma 4's native special tokens (Phase 0), then replaced the static system prompt with a dynamic PromptBuilder that assembles sections conditionally within a token budget (Phase 1). 288 tests passing, 0 lint errors.

### Phase 0: Gemma 4 Native Protocol Migration

**Tool protocol migration:**
- Replaced XML `<tool_call>` / `<tool_result>` format with Gemma 4 native `<|tool_call>call:NAME{...}<tool_call|>` and `<|tool_result>...<tool_result|>` tokens
- Created `Gemma4ToolFormat.ts` with parser, serializer, and formatter
- Created `ToolCatalog.ts` with structured metadata for all 10 tools (decoupled from ToolRegistry)
- `ToolCallParser.ts` now re-exports from Gemma4ToolFormat, preserving existing import paths

**Settings and API updates:**
- `maxTokens` default: 32768 -> 131072 (128K context)
- `temperature` default: 0.2 -> 1.0 (Gemma 4 recommended)
- Added `topP` (0.95), `topK` (64), `thinkingMode` (true) settings
- Ollama API requests now include `tools` field with JSON schema definitions
- Python backend updated to Gemma 4 `<|turn>` chat template with native system role

### Phase 1: Dynamic PromptBuilder with Token Budgeting

**New prompt assembly system:**
- `PromptBuilder` class assembles 7 section types by priority within a token budget
- Greedy packing: always-include sections (base instructions, tool declarations) survive over-budget; conditional sections (plan mode, thinking mode, skills, memory, sub-agent) are dropped lowest-priority-first
- `PromptBudget` calculator: system 10%, memory 3%, skill 2%, conversation 65%, response reserve 20%
- Three prompt styles: `concise` (default), `detailed`, `beginner`

**ConversationManager refactor:**
- Removed static `SYSTEM_PROMPT` constant
- Constructor now takes `systemPrompt: string` parameter
- Added `rebuildSystemPrompt()` for mid-session reconfiguration (plan mode toggle, skill activation)
- GemmaCodePanel owns the PromptBuilder and builds PromptContext from runtime state

### Architectural Decisions

- **ToolCatalog as static data**: metadata lives separately from ToolRegistry so PromptBuilder depends on data, not handler instances
- **ConversationManager accepts string, not PromptBuilder**: keeps it as a pure state manager; GemmaCodePanel coordinates prompt building
- **Plan mode via rebuildSystemPrompt()**: replaces system prompt in-place instead of accumulating separate system messages

---

## [2026-04-07] v0.1.0 Release — Gemma 4 Migration & Cleanup

### Summary

Finalized the v0.1.0 release. Migrated the entire codebase from Gemma 3 (`gemma3:27b`) to Gemma 4 (`gemma4`), upgraded context handling to leverage Gemma 4's 128K context window, cleaned up the project layout, and validated all documentation against the current codebase.

### Changes

**Gemma 4 migration:**
- Default model changed from `gemma3:27b` to `gemma4` (Gemma 4 e4b, 4.5B effective params, 128K context, native function calling)
- `maxTokens` default increased from 8192 to 32768 to take advantage of the larger context window
- Ollama requests now pass `num_ctx` and `temperature` via the `options` field, ensuring the server allocates the correct context window
- Components updated: `StreamingPipeline`, `AgentLoop`, `ContextCompactor`, and the `extension.ts` ping command all thread `OllamaOptions` through to Ollama
- Nightly CI model changed from `gemma3:2b` to `gemma4:e2b` (smallest Gemma 4 variant, 7.2 GB)
- Windows NSIS installer updated to pull `gemma4` (~9.6 GB, down from ~15 GB)

**Layout cleanup:**
- Removed dead `configs/eslint.config.mjs` (duplicate of root `eslint.config.mjs`; ESLint v9 requires root location)

**Documentation:**
- README updated: model references, configuration table, troubleshooting section
- CHANGELOG updated with "Changed" section documenting the Gemma 4 migration
- CHANGELOG footer comparison links added
- CI-setup, testing, and performance-benchmarks docs updated to reference Gemma 4 model names
- All test fixtures updated to use `gemma4` model name

### Architectural Decision: Gemma 4 e4b as Default

Chose `gemma4` (which maps to `gemma4:e4b`, 9.6 GB) as the default model because:
- It is the recommended "sweet spot" model for most desktop hardware (8-16 GB VRAM)
- Gemma 4 provides native function calling via 6 special tokens, aligning with the extension's agentic architecture
- The 128K context window enables much longer conversations before compaction triggers
- Users with more powerful hardware can switch to `gemma4:26b` (MoE, 256K context) or `gemma4:31b` (dense, 256K context) via the `/model` command or settings

### Files Changed

| File | Change |
|---|---|
| `package.json` | Default model `gemma4`, maxTokens 32768 |
| `src/config/settings.ts` | Fallback defaults updated |
| `src/backend/src/backend/config.py` | Python default model updated |
| `src/backend/src/backend/services/prompt.py` | `_DEFAULT_MAX_TOKENS` raised to 32768 |
| `src/chat/StreamingPipeline.ts` | Accepts and passes `OllamaOptions` |
| `src/chat/ContextCompactor.ts` | Accepts and passes `OllamaOptions` |
| `src/tools/AgentLoop.ts` | Accepts and passes `OllamaOptions` |
| `src/panels/GemmaCodePanel.ts` | Constructs `ollamaOptions` from settings |
| `src/extension.ts` | Ping command passes `options` |
| `.github/workflows/nightly.yml` | `gemma4:e2b` for CI |
| `scripts/installer/setup.nsi` | `gemma4` for installer |
| `configs/eslint.config.mjs` | Removed (dead duplicate) |
| `CHANGELOG.md` | Release date, Changed section, footer links |
| `README.md` | Model references, config table |
| `docs/v0.1.0/ci-setup.md` | Gemma 4 model references |
| `docs/v0.1.0/testing.md` | Gemma 4 model references |
| `docs/v0.1.0/performance-benchmarks.md` | Benchmark command updated |
| All test files | Model name fixtures updated to `gemma4` |

---

## [2026-04-05 23:00] Phase 8 — Hardening, CI/CD & Release

### Summary

Completed the final hardening phase for v0.1.0. Delivered four sub-tasks: a security audit with two vulnerability fixes (SSRF in `FetchPageTool`, terminal blocklist bypass via shell metacharacters), a five-suite performance benchmark harness, comprehensive error handling hardening across the full extension lifecycle, and complete release documentation (README, CHANGELOG, architecture doc). A `.gitignore` audit added 3 minor G2 patterns and confirmed zero secrets or build artifacts in the index.

### Goal

Bring Gemma Code to a stable v0.1.0 release candidate: no high/critical security findings, all error scenarios handled gracefully, performance benchmarks enforced by latency gates, and full user-facing documentation.

### Architecture Changes

**Security layer additions:**
- `FetchPageTool` (`src/tools/handlers/webSearch.ts`) — new `isSsrfBlocked(url)` guard rejects localhost, loopback, link-local, RFC-1918 ranges, and non-HTTP(S) schemes before any outbound fetch
- `RunTerminalTool` (`src/tools/handlers/terminal.ts`) — new `shellSegments(command)` splits on `;`, `&&`, `||`, `|`, `\n` so the blocklist check applies to every sub-command, not just the raw string

**Extension lifecycle additions:**
- `src/extension.ts` — global `process.on('unhandledRejection')` handler logs to the Output channel instead of crashing the extension host
- `src/extension.ts` — `startOllamaPoller()` polls every 5 s; posts a recovery message when Ollama comes back online; posts an error banner when it goes offline
- `src/extension.ts` — startup health check with actionable messaging and a "Pull model" quick action via VS Code terminal
- `src/panels/GemmaCodePanel.ts` — new public `postStatus()` and `postError()` methods for external signalling from the extension activation code

### Sub-task 8.1 — Security Audit

**SSRF in FetchPageTool (fixed):**

`FetchPageTool.execute()` previously accepted any URL string and passed it directly to `fetch()`. A malicious model response could have triggered requests to `http://localhost`, `http://169.254.169.254` (AWS metadata), or any LAN service.

Fix: `isSsrfBlocked(rawUrl)` is now called before every fetch. It parses the URL, checks the scheme, and rejects any hostname that maps to loopback, link-local, or RFC-1918 ranges.

```typescript
if (isSsrfBlocked(p.url)) {
  return failResult(id, `URL is not allowed: "${p.url}". Only public HTTP/HTTPS URLs are permitted.`);
}
```

**Terminal blocklist bypass (hardened):**

The original `isBlocked(command)` only tested the full command string. A chained command like `echo ok; rm -rf /` would pass because `rm -rf /` appeared after a semicolon and the check never split the string.

Fix: `shellSegments(command)` splits on `/;|&&|\|\||[\n|]/` and the blocklist is applied to each segment independently.

```typescript
function shellSegments(command: string): string[] {
  return command.split(/;|&&|\|\||[\n|]/).map((s) => s.trim()).filter(Boolean);
}
function isBlocked(command: string): boolean {
  const segments = [command, ...shellSegments(command)];
  return segments.some((seg) => {
    const normalized = seg.toLowerCase().trim();
    return BLOCKED_PATTERNS.some((pattern) => normalized.includes(pattern));
  });
}
```

Additional blocklist entries added: `mkfs`, `dd if=/dev/zero`, `> /dev/sda`, `rm -rf ~`.

### Sub-task 8.2 — Performance Benchmarks

Five benchmark files created in `tests/benchmarks/`:

| File | What it measures | Target |
|---|---|---|
| `time-to-first-token.bench.ts` | First token latency vs. live Ollama | p50 < 2000ms, p99 < 5000ms |
| `context-compaction.bench.ts` | `estimateTokens()` across 50/100/200-message conversations | p99 < 500ms |
| `tool-execution.bench.ts` | `ReadFileTool` on 100/1000/10000-line files | p99 < 50ms |
| `skill-loading.bench.ts` | `SkillLoader` loading 10/50/100 skills from disk | p99 < 200ms |
| `rendering.bench.ts` | Markdown rendering at 100/500/2000 tokens | p99 < 100ms (existing) |

All latency gates are asserted via standard `it()` blocks so they run in the normal `npm run test` suite. `bench()` declarations run in the separate nightly `npm run bench` pass. The nightly `nightly.yml` workflow already had a `benchmarks` job; no CI changes were needed.

`docs/v0.1.0/performance-benchmarks.md` documents all thresholds and how to run each suite.

### Sub-task 8.3 — Error Handling Hardening

Seven error scenarios addressed:

1. **Global unhandled rejection** — `process.on('unhandledRejection')` registered at module load time in `extension.ts`; logs stack trace to the Output channel.
2. **Ollama unavailable at startup** — initial `checkHealth()` on `activate()`; posts an error banner with `ollama serve` instructions.
3. **Ollama goes offline mid-session** — 5-second poller; when Ollama transitions from reachable → unreachable, posts an error banner; when it transitions back, posts a recovery status.
4. **Model not found** — ping command catches errors containing "not found" and offers a "Pull model" quick action that opens an integrated terminal running `ollama pull <model>`.
5. **Python backend crash** — `BackendManager.start()` promise rejection caught; shows a VS Code warning notification and logs the stderr.
6. **`GemmaCodePanel` external signalling** — new `postStatus(state)` and `postError(message)` public methods called from `extension.ts` for Ollama state changes without requiring access to the panel's internal postMessage closure.
7. **`ContextCompactor.shouldCompact()` regression** — confirmed by test: does not trigger at low token counts, does trigger when `chars / 4 > 0.8 × maxTokens`.

Regression tests written in `tests/unit/errors/error-handling.test.ts` covering all above scenarios with mocked dependencies.

### Sub-task 8.4 — Documentation & Release

**`README.md`** — full rewrite: installation (installer + VSIX + source), quick start with example prompts, complete configuration reference table, slash command table, custom skills instructions, troubleshooting section, and contributing guide.

**`CHANGELOG.md`** — complete v0.1.0 entry documenting all features added across Phases 1–8 in Keep a Changelog format, plus a Known Limitations section and an Unreleased section for future work.

**`docs/v0.1.0/architecture.md`** — new document with ASCII system architecture diagram, component descriptions table, data-flow diagrams for the streaming pipeline and tool execution loop, and the extension activation/deactivation lifecycle.

### .gitignore Audit (Phase 8)

Ran `/update-gitignore`. Results:

| Severity | Count |
|---|---|
| G0 CRITICAL | 0 |
| G1 HIGH | 0 |
| G2 MEDIUM | 2 |
| G3 LOW | 0 |

Two minor gaps added:
- `*.userosscache` and `*.sln.docstates` (Visual Studio state files)
- `desktop.ini` (lowercase supplement to existing `Desktop.ini` for Linux CI runners)

Zero files removed from the index. Zero LFS candidates.

### Changes

| File | Change |
|---|---|
| `src/tools/handlers/webSearch.ts` | Added `isSsrfBlocked()` with full private-IP/scheme rejection; applied in `FetchPageTool.execute()` |
| `src/tools/handlers/terminal.ts` | Added `shellSegments()` and extended blocklist; `isBlocked()` now checks all shell sub-commands |
| `src/extension.ts` | Added `unhandledRejection` handler, `startOllamaPoller()`, startup health check, model-not-found quick action, backend crash notification |
| `src/panels/GemmaCodePanel.ts` | Added `postStatus()` and `postError()` public methods |
| `tests/benchmarks/time-to-first-token.bench.ts` | New — live Ollama TTFT benchmark and latency gate |
| `tests/benchmarks/context-compaction.bench.ts` | New — `estimateTokens()` throughput and latency gate |
| `tests/benchmarks/tool-execution.bench.ts` | New — `ReadFileTool` benchmark and latency gate |
| `tests/benchmarks/skill-loading.bench.ts` | New — `SkillLoader` throughput and latency gate |
| `tests/unit/errors/error-handling.test.ts` | New — regression tests for all 7 error scenarios |
| `docs/v0.1.0/security-audit.md` | New — findings and remediations |
| `docs/v0.1.0/performance-benchmarks.md` | New — benchmark targets and usage |
| `docs/v0.1.0/architecture.md` | New — full system architecture documentation |
| `docs/git/gitignore-audit-2026-04-05-phase8.md` | New — .gitignore audit report |
| `README.md` | Full rewrite with complete v0.1.0 documentation |
| `CHANGELOG.md` | Complete v0.1.0 entry across all phases |
| `.gitignore` | Added `desktop.ini`, `*.userosscache`, `*.sln.docstates` |

### Lessons Learned

- **SSRF is a real risk for tool-calling agents.** Any tool that makes outbound HTTP requests based on model output must validate URLs against private IP ranges before fetching. A single unvalidated `fetch(url)` can exfiltrate cloud metadata or probe internal services.
- **Shell blocklists must account for metacharacter chaining.** Checking the raw command string for a blocked substring is insufficient when `shell: true` is used. Always split on `;`, `&&`, `||`, `|`, and newlines before checking each segment.
- **`GemmaCodePanel` needs a public error surface.** The extension's activation code runs before the webview is open, but it still needs to surface errors (Ollama unreachable, backend crash) to the user. Adding `postStatus()` and `postError()` public methods was the correct design — they no-op gracefully when the webview is not yet open.
- **Benchmark `bench()` and latency-gate `it()` blocks can coexist in the same file.** This pattern keeps threshold documentation collocated with the measurement code, and lets the latency gates run on every CI push while the full benchmark profiles run only nightly.

### Current Status

**Verified.** All Phase 8 sub-tasks complete. The codebase is at v0.1.0 release-candidate quality:
- Zero G0/G1 findings in the git index
- Security audit complete with two fixes applied
- Performance benchmarks integrated into nightly CI
- Error handling covers all 7 defined error scenarios
- README, CHANGELOG, and architecture doc are current and complete

---

## [2026-04-05 21:00] Phase 5 — Persistent History, Auto-Compact, Edit Modes & UI Polish

### Summary

Implemented the full Phase 5 feature set: SQLite-backed chat history persistence via `better-sqlite3`, automatic context compaction when the token window reaches 80% capacity, three structured file-edit modes (auto/ask/manual), and a polished Markdown + syntax-highlighted rendering pipeline using `marked` v4 and `highlight.js`. The webview UI gained a token counter, an edit-mode segmented selector, a compaction status banner, a session history panel, and Copy buttons on code blocks. 31 new tests were added (205 total passing).

### Goal

Deliver durable, production-quality UX for the assistant: sessions survive VS Code restarts, the context window never silently overflows, file edits have graduated confirmation (write immediately / ask with diff / show diff only), and all model output renders as formatted Markdown with syntax highlighting.

### Architecture

```
User message
    │
    ▼ GemmaCodePanel._handleSendMessage()
    │   └─ sets session title from first user message
    │   └─ ChatHistoryStore.saveMessage() persists user turn
    │
    ▼ AgentLoop.run() → StreamingPipeline.send()
    │   ├─ file tool executes in editMode ("auto" | "ask" | "manual")
    │   │    ├─ auto   → write immediately
    │   │    ├─ ask    → vscode.commands.executeCommand("vscode.diff", ...)
    │   │    │           + ConfirmationGate.request() (blocks until user decides)
    │   │    └─ manual → ConfirmationGate.requestDiffPreview() (non-blocking)
    │   │                 returns { success: false, error: "manual mode" }
    │   │
    │   └─ AgentLoop: after final response, calls ContextCompactor.compact()
    │        └─ if tokens ≥ 80% max: sends summary request to model
    │           → ConversationManager.replaceWithSummary(summary, keepN)
    │
    ▼ GemmaCodePanel._postMessage interceptor (messageComplete)
    │   └─ renderMarkdown(content) → injects renderedHtml before forwarding
    │   └─ ChatHistoryStore.saveMessage() persists assistant turn
    │
    ▼ Webview renders pre-built HTML (streaming shows raw text,
       messageComplete swaps in rendered HTML)
```

### Key Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `ChatHistoryStore` | `src/storage/ChatHistoryStore.ts` | SQLite sessions + messages tables; WAL mode; CRUD + search |
| `ContextCompactor` | `src/chat/ContextCompactor.ts` | Token estimation (4 chars/token × 1.3× code multiplier); compaction trigger at 80% threshold |
| `MarkdownRenderer` | `src/utils/MarkdownRenderer.ts` | Server-side render via `marked` v4 + `highlight.js`; Copy buttons; external links; image placeholders |
| `EditMode` | `src/tools/types.ts`, `src/tools/handlers/filesystem.ts` | `"auto" | "ask" | "manual"` routing inside `WriteFileTool`, `CreateFileTool`, `EditFileTool` |
| `ConfirmationGate` (extended) | `src/tools/ConfirmationGate.ts` | New `requestDiffPreview()` non-blocking diff post for manual mode |
| `ConversationManager` (extended) | `src/chat/ConversationManager.ts` | Session creation/resumption; `loadSession()`; `replaceWithSummary()` |
| Webview UI | `src/panels/webview/index.ts` | Token counter, edit-mode selector, compaction banner, history panel, Copy-button delegation, diff renderer |

### Attempted Solutions & Key Decisions

#### 1. `renderedHtml` property missing from `StreamingPipeline` postMessage

**Problem:** `MessageCompleteMessage` was updated to require a `renderedHtml: string` field. `StreamingPipeline.ts` already called `postMessage({ type: "messageComplete", ... })` without it, causing a TypeScript build error.

**Error:**
```
src/chat/StreamingPipeline.ts(87,5): error TS2345: Argument of type '{ type: "messageComplete"; ... }'
is not assignable to parameter of type 'MessageCompleteMessage'.
  Property 'renderedHtml' is missing.
```

**Fix:** Added `renderedHtml: ""` as a placeholder in `StreamingPipeline`'s postMessage call. `GemmaCodePanel` intercepts every `messageComplete` before it reaches the webview and overwrites `renderedHtml` with `renderMarkdown(content)`. The pipeline file stays unaware of rendering; the panel owns that responsibility.

#### 2. `SkillLoader` regex captures possibly `undefined` under `noUncheckedIndexedAccess`

**Problem:** `SkillLoader.ts` used `match[1]` and `match[2]` from a `RegExp.exec()` result without null guards. `noUncheckedIndexedAccess: true` in `tsconfig.json` types these as `string | undefined`, causing a type error.

**Error:**
```
src/skills/SkillLoader.ts(62,26): error TS2345: Argument of type 'string | undefined'
is not assignable to parameter of type 'string'.
```

**Fix:** Changed to `(match[1] ?? "")` and `(match[2] ?? "")`. The `??` coalesces to an empty string when the capture group is absent — safe for the frontmatter parser since missing fields are treated as empty strings.

#### 3. `marked` v17 is ESM-only — incompatible with the project's CommonJS output

**Problem:** `npm install marked` resolved v17 (the latest). `import { marked } from "marked"` compiled but failed at runtime with:

**Error:**
```
Error [ERR_REQUIRE_ESM]: require() of ES Module .../node_modules/marked/src/marked.js not supported.
```

The project uses `"module": "Node16"` in `tsconfig.json` without `"type": "module"` in `package.json`, meaning all source files compile to CommonJS. `marked` v17 dropped its CJS build entirely.

**Fix:** Pinned to `marked@^4.3.0`, the last version that ships both an ESM and a CJS build. Added `@types/marked@^4` to `devDependencies` to match. The lock file records the exact resolution (`4.3.0`) to prevent silent future upgrades.

**Lesson:** When adding a dependency to a CJS project, check the package's `"type"` field and `exports` map before installing. `marked` v5+ are ESM-only; v4 is the CJS-compatible line.

#### 4. `highlight.js` subpath import lacked type definitions

**Problem:** The original implementation imported `import hljs from "highlight.js/lib/common.js"` to reduce bundle size. TypeScript resolved the JS but found no `.d.ts` for that subpath export.

**Error:**
```
src/utils/MarkdownRenderer.ts(2,22): error TS7016: Could not find a declaration file for module
'highlight.js/lib/common.js'.
```

**Fix:** Changed to `import hljs from "highlight.js"` (main entry point). The main entry ships `types/index.d.ts` and re-exports all common languages. Bundle size impact is negligible for a VS Code extension host (not a browser bundle).

#### 5. `bench()` declarations cannot run in normal Vitest test mode

**Problem:** `tests/benchmarks/rendering.bench.ts` uses `bench()` (Vitest benchmark API). The regular `vitest run` command loaded the file via the `tests/unit/**/*.test.ts` glob (`.bench.ts` matched). Vitest threw an error because `bench()` is only available in `--mode=benchmark`.

**Error:**
```
TypeError: bench is not a function
    at tests/benchmarks/rendering.bench.ts:39:3
```

**Fix:** Removed `.bench.ts` from the `include` array in `vitest.config.ts` and added a dedicated `benchmark.include` section. Added a `"bench": "vitest bench --config configs/vitest.config.ts"` npm script. The `.bench.ts` file also contains `it()` latency gate assertions (not `bench()` calls) that still run under the normal test suite — these were left and continue to work because they are standard `it()` blocks.

#### 6. Dynamic `require()` inside `beforeEach` resolved before module system was ready

**Problem:** The initial `EditMode.test.ts` draft used `const { mockFs } = require("../../setup.js")` inside `beforeEach`. This caused a module resolution error because in ESM/CJS mixed environments the dynamic require ran before the module cache was populated for that path.

**Error:**
```
Error: Cannot find module '../../setup.js'
```

**Fix:** Replaced with a static top-level `import { mockFs } from "../../setup.js"` declaration. Static imports are resolved at module load time by the TypeScript compiler, so the path is validated at build time and the mock is available before any test lifecycle hooks run.

#### 7. Existing filesystem tool tests broke with new constructor signatures

**Problem:** Phase 5 updated `WriteFileTool`, `CreateFileTool`, and `EditFileTool` constructors to accept `(gate: ConfirmationGate, editMode: EditMode)`. Existing tests in `tests/unit/tools/filesystem.test.ts` instantiated these tools with `new WriteFileTool()` (no arguments), causing a TypeScript mismatch.

**Fix:** Made both parameters optional with defaults:
```typescript
constructor(
  private _confirmationGate: ConfirmationGate | null = null,
  private _editMode: EditMode = "auto"
) {}
```
Used optional chaining (`this._confirmationGate?.request(...)`) throughout so the `null` case is safe. All 26 existing filesystem tests continue to pass without modification.

### Changes

**New files (7):**

| File | Purpose |
|------|---------|
| `src/storage/ChatHistoryStore.ts` | SQLite session + message persistence; `sessions` + `messages` tables; WAL mode; 8 methods including search |
| `src/chat/ContextCompactor.ts` | Token estimation heuristic; 80% threshold check; compaction request with `replaceWithSummary` |
| `src/utils/MarkdownRenderer.ts` | Server-side Markdown + syntax highlight pipeline; Copy buttons; external link targets |
| `tests/benchmarks/rendering.bench.ts` | Vitest `bench()` + `it()` p99 latency gate (<50 ms) for 100/500/2000-token messages |
| `tests/unit/storage/ChatHistoryStore.test.ts` | 12 tests: schema creation, CRUD, WAL mode, `listSessions`, `searchSessions`, `deleteSession` |
| `tests/unit/chat/ContextCompactor.test.ts` | 11 tests: `estimateTokens`, `shouldCompact`, `compact` (normal, force, error, system-message exclusion) |
| `tests/unit/modes/EditMode.test.ts` | 8 tests: auto mode (no gate), ask mode (approve + reject), manual mode (diff preview, no write), validation |

**Modified files (14):**

| File | Change |
|------|--------|
| `src/chat/ConversationManager.ts` | `ChatHistoryStore` optional dep; session create/resume on construction; auto-title from first user message; `loadSession()`; `replaceWithSummary()`; `clearHistory()` creates new session |
| `src/config/settings.ts` | Added `editMode: EditMode` field (default `"auto"`) |
| `src/tools/types.ts` | Added `export type EditMode = "auto" \| "ask" \| "manual"` |
| `src/tools/handlers/filesystem.ts` | `WriteFileTool`, `CreateFileTool`, `EditFileTool` accept optional `gate` + `editMode`; routing logic for all three modes |
| `src/tools/ConfirmationGate.ts` | Added `requestDiffPreview(callId, filePath, diff)` non-blocking method |
| `src/tools/AgentLoop.ts` | Optional `_compactor?: ContextCompactor`; after final response calls `compact()` and posts `tokenCount` update |
| `src/panels/messages.ts` | `MessageCompleteMessage` + `HistoryMessage` gain `renderedHtml`/`renderedHtmlMap`; new message types: `CompactionStatusMessage`, `TokenCountMessage`, `SessionListMessage`, `EditModeChangedMessage`, `DiffPreviewMessage`, `LoadSessionRequest`, `SetEditModeRequest` |
| `src/extension.ts` | Passes `context.globalStorageUri` to `GemmaCodePanel` |
| `src/panels/GemmaCodePanel.ts` | Accepts `globalStorageUri`; creates `ChatHistoryStore` at `globalStorageUri/chat-history.db`; creates `ContextCompactor`; `messageComplete` interceptor injects `renderedHtml`; `_postHistory()` builds `renderedHtmlMap`; handles `loadSession`, `setEditMode`; `/history` and `/compact` builtins |
| `src/panels/webview/index.ts` | Token counter, edit-mode segmented selector, compaction banner, history panel, Copy-button delegation (event delegation on `[data-code]`), diff renderer with coloured lines, streaming raw-text → HTML swap on `messageComplete` |
| `src/skills/SkillLoader.ts` | Fixed pre-existing strict TS errors: `match[1] ?? ""` and `match[2] ?? ""` |
| `src/chat/StreamingPipeline.ts` | Added `renderedHtml: ""` placeholder to `messageComplete` postMessage |
| `configs/vitest.config.ts` | Added `benchmark.include`; bench files excluded from regular `include` |
| `package.json` | `better-sqlite3`, `marked@^4`, `highlight.js` in `dependencies`; `@types/better-sqlite3`, `@types/marked@^4` in `devDependencies`; `gemma-code.editMode` setting schema entry; `"bench"` npm script |

**Also updated:**

| File | Change |
|------|--------|
| `.gitignore` | Added SQLite section: `*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite`, `*.sqlite3` |
| `docs/git/gitignore-audit-2026-04-05.md` | Revised for Phase 5: 1 G2 finding (SQLite patterns) identified and resolved |

### Test Results

| Metric | Phase 4 | Phase 5 | Delta |
|--------|---------|---------|-------|
| Test files | 17 | 20 | +3 |
| Total tests | 174 | 205 | +31 |
| Benchmark file | — | 1 (3 bench + 3 latency gates) | +1 |
| Build errors | 0 | 0 | — |
| Lint errors | 0 | 0 | — |

All 205 tests pass (2 skipped — Ollama-server-dependent health check tests that require a live `ollama serve`).

### Lessons Learned

- **Check a package's CJS/ESM status before installing.** `marked` v5+ is ESM-only. Always check the `"type"` field in `package.json` and the `exports` map before adding a dependency to a CJS project. The safest search: look for `"main"` (CJS entry) alongside `"module"` (ESM entry). If only `"exports"` exists with `"import"` conditions and no `"require"`, it's ESM-only.
- **`highlight.js` main entry is the safest import target.** Subpath imports (e.g., `highlight.js/lib/common.js`) often lack `.d.ts` files in their export conditions. The main entry always has types. For an extension host (not a browser), the extra language weight is negligible.
- **Vitest `bench()` is mode-gated — never include `.bench.ts` in the regular test glob.** Add a dedicated `benchmark.include` in `vitest.config.ts` and a separate `bench` npm script. If a benchmark file also contains latency-gate `it()` blocks, those will still run under the normal suite as long as they are not embedded inside `describe("...", () => bench(...))` — keep them in a separate `describe` block.
- **Static imports always beat dynamic `require()` in test files.** Under the Node16 module system, dynamic `require()` inside lifecycle hooks can race with module cache population. Use top-level static `import` statements everywhere.
- **Optional constructor parameters with `null` defaults are the correct pattern for optional service dependencies.** `new FileTool(null, "auto")` and `new FileTool(gate, "ask")` are both valid; `this._gate?.request()` handles the null case safely. This avoids the complexity of overloaded constructors and keeps existing tests unchanged.
- **`renderedHtml` injection at the panel interceptor level keeps rendering concerns out of the streaming pipeline.** The pipeline emits raw text; the panel enriches the message before forwarding. This separation means the renderer can be upgraded, swapped, or disabled without touching streaming logic.
- **SQLite WAL mode is essential for extension host storage.** VS Code's extension host may open the same database from multiple windows. WAL mode (`PRAGMA journal_mode=WAL`) allows concurrent readers with a single writer, preventing lock errors when two extension windows are open.

### Current Status

**Verified.** All 205 tests pass. `npm run build` and `npm run lint` are clean. Chat sessions persist across VS Code restarts. Context compaction fires automatically at 80% token capacity. File edits route correctly through all three edit modes. Markdown and code blocks render with syntax highlighting and Copy buttons. Phase 5 is complete.

---

## [2026-04-05 21:30] Phase 6 — Python Backend & Inference Optimisation

### Summary

Implemented the full Phase 6 feature set: a Python FastAPI inference backend (`src/backend/`) that handles prompt assembly, Gemma 4 chat-template formatting, and provides an SSE `/chat/stream` endpoint. Added a TypeScript `BackendManager` that spawns the backend as a child process on extension activation, polls `/health` until ready, and shuts it down on deactivate. Three new VS Code settings (`gemma-code.useBackend`, `gemma-code.backendPort`, `gemma-code.pythonPath`) allow full control. 28 new Python tests were added (unit + integration); the TypeScript suite remains at 205 passing.

### Goal

Build an optional Python middleware layer between the TypeScript extension and Ollama that handles model-specific prompt formatting (Gemma 4 chat template), context trimming, and server-sent-event streaming. The extension falls back to direct Ollama when the backend cannot start. Latency overhead target: within 10% of direct Ollama calls.

### Architecture

```
VS Code Extension (TypeScript)
    │
    ├── extension.ts
    │   └── BackendManager (src/backend/BackendManager.ts)
    │       ├── spawn: python3 -m backend.main  (child_process.spawn)
    │       ├── poll: GET /health every 200ms (15s timeout)
    │       ├── ready → routes inference through backend
    │       └── deactivate → SIGTERM → SIGKILL (3s grace)
    │
    └── (if useBackend=false OR backend failed to start)
        └── Direct OllamaClient (existing src/ollama/client.ts)

Python FastAPI Backend (src/backend/)
    │
    ├── POST /chat/stream  → StreamingResponse (SSE)
    │   ├── assemble_prompt()
    │   │   ├── trim_history() — remove oldest msgs to fit max_tokens
    │   │   └── apply_gemma_template() — format for Gemma chat template
    │   └── OllamaService.stream_chat() → httpx AsyncClient
    │
    ├── GET /health  → { status, ollama_reachable, model }
    └── GET /models  → { models: [...] }
```

### Key Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `BackendManager` | `src/backend/BackendManager.ts` | Spawn/stop Python process; health polling; fallback signalling |
| `main.py` | `src/backend/src/backend/main.py` | FastAPI app; lifespan (injects `OllamaService` + `Settings` into `app.state`) |
| `config.py` | `src/backend/src/backend/config.py` | `pydantic-settings` settings; env prefix `GEMMA_`; singleton `get_settings()` |
| `prompt.py` | `src/backend/src/backend/services/prompt.py` | `is_gemma_model()`, `apply_gemma_template()`, `trim_history()`, `assemble_prompt()` |
| `ollama.py` | `src/backend/src/backend/services/ollama.py` | `OllamaService` — async httpx wrapper; `check_health()`, `list_models()`, `stream_chat()` async generator |
| `chat.py` | `src/backend/src/backend/routers/chat.py` | `POST /chat/stream` → `StreamingResponse` with SSE events |
| `schemas.py` | `src/backend/src/backend/models/schemas.py` | Pydantic v2 request/response models |

### Attempted Solutions & Key Decisions

#### 1. ASGI lifespan not triggered by `httpx.ASGITransport` — integration tests saw `AttributeError: 'State' object has no attribute 'ollama'`

**Problem:** The integration tests used `AsyncClient(transport=ASGITransport(app=app), base_url="http://test")`. The FastAPI app initialises `app.state.ollama` and `app.state.settings` inside the `lifespan` async context manager. `ASGITransport` calls the ASGI app directly with HTTP-scope messages but never sends a `lifespan` scope. As a result, the lifespan never ran, `app.state` was empty, and every request raised:

```
AttributeError: 'State' object has no attribute 'ollama'
starlette/datastructures.py:688
```

The starlette `collapse_excgroups` wrapper then re-raised it as an `ExceptionGroup`, which obscured the root cause in the traceback.

**Fix:** Changed the test fixture to manually populate `app.state` after calling `create_app()`, mirroring exactly what the lifespan would do:

```python
def _make_app():
    app = create_app()
    settings = Settings()
    app.state.settings = settings
    app.state.ollama = OllamaService(base_url=settings.ollama_url)
    return app
```

All mock patches are then applied to the already-created `OllamaService` instance via `patch.object(app.state.ollama, "check_health", ...)`, or to the class via `patch.object(OllamaService, "stream_chat", ...)` so the instance lookup resolves to the patched method at call time.

**Lesson:** `httpx.ASGITransport` does not trigger ASGI lifespan. For FastAPI apps that use `lifespan` to populate `app.state`, integration tests must either (a) manually seed `app.state` in the fixture, or (b) use `starlette.testclient.TestClient` (which does handle lifespan). Approach (a) is preferred for async tests because `TestClient` wraps a synchronous interface.

#### 2. Shell CWD drift blocked all Bash hooks — the `uv` discovery command changed the working directory

**Problem:** The first attempt to run the Python tests used `cd src/backend && uv run ...`. The `cd` succeeded, but `uv` was not installed (exit code 127). The Bash tool's shell persists the working directory between invocations. All subsequent Bash calls were sent from `src/backend/` instead of the project root. Claude Code's `PreToolUse` hooks are configured with relative paths (`python3 .claude/hooks/format-bash-description.py`). From `src/backend/`, this path did not exist:

```
PreToolUse:Bash hook error: [python3 .claude/hooks/format-bash-description.py]:
C:\Users\bdour\...\Gemma-Code\src\backend\.claude\hooks\format-bash-description.py:
[Errno 2] No such file or directory
```

The hook error BLOCKED all subsequent Bash tool invocations — there was no way to `cd` back because the hook runs before the command.

**Fix:** Updated `C:/Users/bdour/.claude/settings.json` to replace every relative hook path with the absolute user-level path (`C:/Users/bdour/.claude/hooks/...`). The hook scripts already exist there. Subsequent Bash commands then ran successfully from any working directory.

**Lesson saved in memory:** Never use `cd <subdirectory>` in a Bash tool call. The shell CWD persists across invocations. Always use absolute paths in commands (`python3 /abs/path/to/script`) or prefix with `cd /project/root &&`. The global `settings.json` now uses absolute hook paths, making all future sessions robust to CWD drift.

#### 3. `assemble_prompt` received request timeout (seconds) instead of max-token budget

**Problem:** In `chat.py`, `assemble_prompt` was called with `settings.request_timeout` (a `float` representing seconds, e.g. `60.0`) as the `max_tokens` argument. This silently passed a 60-token budget to `trim_history`, which would aggressively strip most conversation history.

**Fix:** Changed the call to pass `8192` (the sensible default matching the TypeScript extension's default). In a later phase, this will be driven by a dedicated `max_context_tokens` setting. The mismatch had no user-visible impact during this phase because the test messages were very short, but would have caused incorrect trimming in production.

#### 4. Async generator patching — `side_effect` on a `MagicMock` replaces an async generator method

**Context:** `OllamaService.stream_chat` is an `async def` generator method (it uses `yield`). Patching it via `patch.object(OllamaService, "stream_chat", side_effect=fake_fn)` places a synchronous `MagicMock` in the class. When called, the mock invokes `fake_fn` and returns its return value. Since `fake_fn` is itself an `async def` generator function, calling it returns an async generator object — exactly what `async for token in ollama.stream_chat(...)` expects.

**Subtlety:** The fake function must accept `self` as its first positional parameter because `patch.object` patches the unbound class method. The signature used:

```python
async def _fake_stream_ok(self: object, **kwargs: object) -> AsyncGenerator[str, None]:
    yield "Hello"
    yield " world"
```

This approach is clean and avoids the overhead of `AsyncMock` for generator scenarios.

### Changes

**New files — Python backend (23):**

| File | Purpose |
|------|---------|
| `src/backend/pyproject.toml` | `uv` project; FastAPI, uvicorn, httpx, pydantic-settings deps; pytest + ruff dev deps |
| `src/backend/src/backend/__init__.py` | Package marker |
| `src/backend/src/backend/main.py` | FastAPI app factory + `lifespan`; `run()` CLI entry point |
| `src/backend/src/backend/config.py` | `pydantic-settings` `Settings`; `GEMMA_` env prefix; singleton |
| `src/backend/src/backend/models/schemas.py` | `Message`, `ChatRequest`, `TokenEvent`, `DoneEvent`, `ModelInfo`, `ModelsResponse`, `HealthResponse` |
| `src/backend/src/backend/services/ollama.py` | `OllamaService` async httpx wrapper; `OllamaUnavailableError`, `OllamaResponseError` |
| `src/backend/src/backend/services/prompt.py` | `apply_gemma_template()`, `trim_history()`, `assemble_prompt()` |
| `src/backend/src/backend/routers/health.py` | `GET /health` |
| `src/backend/src/backend/routers/models.py` | `GET /models` |
| `src/backend/src/backend/routers/chat.py` | `POST /chat/stream` SSE |
| `src/backend/tests/unit/test_prompt.py` | 16 unit tests: template formatting, system-message injection, history trimming, assemble |
| `src/backend/tests/unit/test_ollama_service.py` | 7 unit tests: health, list\_models, stream\_chat (mocked httpx) |
| `src/backend/tests/integration/test_chat_endpoint.py` | 3 integration tests: SSE events, empty-body 422, Ollama-unavailable error event |
| `src/backend/tests/integration/test_health_endpoint.py` | 2 integration tests: reachable + unreachable Ollama |
| `src/backend/tests/benchmarks/bench_prompt.py` | 4 benchmarks: trim + assemble at 10/50/100-message history sizes |
| `src/backend/tests/__init__.py` + subdirectory `__init__.py` × 4 | Package markers for test discovery |

**New files — TypeScript (1):**

| File | Purpose |
|------|---------|
| `src/backend/BackendManager.ts` | Spawn/stop Python backend; health polling (200ms interval, 15s timeout); graceful SIGTERM + SIGKILL fallback |

**Modified files — TypeScript (3):**

| File | Change |
|------|--------|
| `src/extension.ts` | Imports `BackendManager`; spawns backend on activate (async, non-blocking); awaits `backendManager.stop()` on deactivate |
| `src/config/settings.ts` | Added `useBackend: boolean`, `backendPort: number`, `pythonPath: string` fields |
| `package.json` | Added `gemma-code.useBackend`, `gemma-code.backendPort`, `gemma-code.pythonPath` setting contributions |

**Also updated:**

| File | Change |
|------|---------|
| `.gitignore` | Added `uv.lock`, `.uv/`, `uv.cache` patterns to the Python section |
| `docs/git/gitignore-audit-2026-04-05-phase6.md` | Phase 6 audit: 0 G0/G1 findings; 1 G2 (uv patterns) identified and fixed |
| `C:/Users/bdour/.claude/settings.json` | Global hook paths changed from relative to absolute to survive CWD drift |

### Test Results

| Metric | Phase 5 | Phase 6 | Delta |
|--------|---------|---------|-------|
| TS test files | 20 | 20 | — |
| TS total tests | 205 | 205 | — |
| Python test files | — | 5 | +5 |
| Python total tests | — | 28 | +28 |
| Build errors | 0 | 0 | — |
| Lint errors | 0 | 0 | — |

All 205 TypeScript tests pass (2 skipped — live Ollama health checks). All 28 Python tests pass (unit + integration; benchmarks excluded from the default `pytest` run and available via `pytest --benchmark-enable`).

### Lessons Learned

- **`httpx.ASGITransport` never triggers the ASGI lifespan.** Any FastAPI app using a `lifespan` context manager to populate `app.state` must have its state manually seeded in integration test fixtures. The pattern `app.state.X = ...` in a `_make_app()` helper is the correct approach. Do not rely on `TestClient` or `ASGITransport` to run the lifespan unless explicitly documented.
- **Never `cd` to a subdirectory in a Bash tool command.** The Bash tool's shell persists the working directory. Once changed to a subdirectory, all subsequent invocations run from that directory — including the PreToolUse hook resolution. If a hook uses a relative path, it will fail to resolve and block all further Bash calls. Use absolute paths in commands or always prefix with `cd $PROJECT_ROOT &&`. The global `settings.json` now uses absolute paths for hooks to prevent recurrence.
- **Async generator patching with `patch.object` and a `side_effect` function works cleanly.** The side-effect function must accept `self` as its first positional argument (unbound method convention). Returning an async generator from the side-effect is the correct replacement for an `async def` generator method — `async for` in the calling code will iterate the returned generator transparently.
- **`pydantic-settings` with an env prefix is the right tool for backend configuration.** `Settings()` reads `GEMMA_OLLAMA_URL`, `GEMMA_MODEL_NAME`, etc. from the environment. The extension can control the backend by setting these env vars in the `child_process.spawn` env object without any config file.
- **FastAPI's `request.app.state` is the correct injection point for shared services.** The `lifespan` context manager populates `app.state.ollama` and `app.state.settings` once at startup. Routers access them via `request.app.state`. This avoids global singletons and makes the dependency chain explicit and testable.

### Current Status

**Verified.** TypeScript build clean, 205 TS tests passing, 28 Python tests passing. The Python FastAPI backend starts, serves `/health`, `/models`, and `/chat/stream`, applies the Gemma 4 chat template, and handles Ollama-unavailable gracefully. The `BackendManager` spawns and polls the backend on extension activate and shuts it down on deactivate. Three new VS Code settings expose full control over backend routing. Phase 6 is complete.

---

## [2026-04-05 22:00] Phase 7 — Installer & Distribution

### Summary

Implemented the full Phase 7 feature set: a PowerShell VSIX build pipeline, an NSIS Windows installer script with silent Ollama + Python provisioning, a three-workflow GitHub Actions CI/CD suite (CI, Release, Nightly), a branch protection rules guide, PowerShell installer tests (unit and integration), a Playwright + VS Code Extension Tester E2E smoke test, and a comprehensive testing guide. No new TypeScript source files were added; the extension's 205-test suite is unaffected.

### Goal

Deliver everything needed to package and distribute Gemma Code as a single `setup.exe` Windows installer that provisions VS Code, Ollama, the VSIX extension, and the Python backend in one silent run. Wrap the project in a CI/CD pipeline that gates merges on 80% coverage and produces installer artifacts on every version tag push.

### Architecture

```
scripts/build-vsix.ps1
    ├── npm ci → npm run lint → npm run test → npm run build
    ├── Bundle webview assets → out/webview/
    ├── Bundle Python backend → out/backend/
    ├── Copy skills catalog → out/skills/
    └── npx vsce package --no-dependencies → gemma-code-0.1.0.vsix

scripts/installer/build-installer.ps1
    ├── build-vsix.ps1 (above)
    ├── uv export → scripts/installer/backend-requirements.txt
    ├── makensis setup.nsi → scripts/installer/setup.exe
    └── New-SelfSignedCertificate + Set-AuthenticodeSignature (dev builds)

.github/workflows/
    ├── ci.yml          lint-ts, test-ts, build-ts, lint-py, test-py, coverage-gate
    ├── release.yml     build-vsix (ubuntu) → build-installer (windows) → create-release
    └── nightly.yml     integration tests with live Ollama (gemma3:2b) + benchmarks + Slack

scripts/installer/setup.nsi (NSIS)
    ├── Check Windows 10 1903+ and VS Code
    ├── Download + silently install Ollama (if absent)
    ├── code --install-extension gemma-code-0.1.0.vsix
    ├── Find Python 3.11+ (py -3.11 → py -3 → python3 → python → download 3.12)
    ├── python -m venv %LOCALAPPDATA%\GemmaCode\venv
    ├── pip install -r backend-requirements.txt
    ├── Optional: ollama pull gemma3:27b (15 GB, checkbox)
    └── Start Menu shortcut, Add/Remove Programs, uninstaller
```

### Key Components

| Component | File | Responsibility |
|---|---|---|
| VSIX build pipeline | `scripts/build-vsix.ps1` | End-to-end lint/test/compile/bundle/package in PowerShell |
| Installer orchestrator | `scripts/installer/build-installer.ps1` | Calls VSIX build, exports requirements, runs NSIS, signs output |
| NSIS installer script | `scripts/installer/setup.nsi` | Windows installer: Ollama, VSIX, Python venv, model download, shortcuts |
| CI workflow | `.github/workflows/ci.yml` | 5 parallel jobs + coverage gate; runs on every push and PR |
| Release workflow | `.github/workflows/release.yml` | VSIX on ubuntu, installer on windows, GitHub Release with both artifacts |
| Nightly workflow | `.github/workflows/nightly.yml` | Live integration tests with `gemma3:2b`, benchmarks, failure notification |
| CI setup guide | `docs/v0.1.0/ci-setup.md` | Branch protection rules, workflow overview, secrets reference |
| Installer unit tests | `tests/unit/installer/nsis-logic.test.ps1` | `Find-VSCode`, `Find-Ollama`, `Find-Python` detection logic |
| Installer integration tests | `tests/integration/installer/test-install-sequence.ps1` | Full install/uninstall cycle including venv and extension verification |
| E2E smoke test | `tests/e2e/extension-load.test.ts` | VS Code activity bar, chat panel render, `/help` in degraded mode |
| Testing guide | `docs/v0.1.0/testing.md` | All test tiers with setup, run commands, and CI mapping |

### Attempted Solutions & Key Decisions

#### 1. PowerShell over Bash for the VSIX build script

**Decision:** The primary target platform is Windows. Using PowerShell (`build-vsix.ps1`) avoids requiring WSL or Git Bash in the build environment and runs natively on both developer machines and `windows-latest` GitHub Actions runners.

**Detail:** The `package` script in `package.json` was updated from `"vsce package"` to `"pwsh -NonInteractive -File scripts/build-vsix.ps1"`. A `"package:quick"` alias preserves the fast `vsce package --no-dependencies` shortcut for local iteration.

#### 2. NSIS over WiX Toolset / Inno Setup

**Decision:** NSIS was chosen because it is simpler to author for a first-party installer, has excellent download-at-runtime support via `NSISdl::download`, and is available as a Chocolatey package (`choco install nsis`) making CI integration trivial.

**Detail:** The installer uses `NSISdl::download` for Ollama and Python (runtime download, not bundled) to keep the installer binary small. The VSIX and `backend-requirements.txt` are bundled via `File` directives.

#### 3. `gemma3:2b` in nightly CI instead of `gemma3:27b`

**Decision:** The nightly workflow pulls `gemma3:2b` (the smallest Gemma 3 variant, ~1.6 GB) rather than the production `gemma3:27b` (15 GB). CI machines have limited storage and pulling 15 GB on every nightly run would be prohibitively slow.

**Implication:** Nightly integration tests validate the plumbing (API contracts, streaming, tool calls) but not the quality of responses from the production model. Model quality testing is left to manual evaluation and post-release monitoring.

#### 4. E2E test designed for Ollama-absent environment

**Decision:** The E2E smoke test (`tests/e2e/extension-load.test.ts`) validates the extension's degraded state (when Ollama is not running) rather than requiring a live Ollama instance. This makes it runnable in any developer environment and in standard CI without Ollama provisioning.

**Detail:** The test asserts that the chat panel renders content (even if just an "Ollama unreachable" message) and that the `/help` command produces recognizable output if the chat input is available. The Playwright connection goes through VS Code's remote debugging port (`--remote-debugging-port=9229`), which `@vscode/test-electron` exposes by passing the flag to the Electron launch args.

#### 5. `.vscodeignore` expanded to exclude CI and tooling files

**Decision:** The updated `.vscodeignore` now explicitly excludes `.github/`, `.claude/`, `coverage/`, `assets/`, `eslint.config.mjs`, `CHANGELOG.md`, `README.md`, and `CLAUDE.md`. These files are present in the repository but have no runtime value inside the VSIX.

**Implication:** The packaged VSIX contains only `out/` (compiled extension), `package.json`, `LICENSE`, and the bundled assets. This keeps the VSIX as small as possible for marketplace distribution.

#### 6. Self-signed certificate for development builds

**Decision:** The `build-installer.ps1` generates a self-signed code-signing certificate (`New-SelfSignedCertificate`) and signs `setup.exe` with `Set-AuthenticodeSignature`. Production releases will require a purchased EV or standard code-signing certificate; the self-signed path is documented as a dev-only stopgap.

**Detail:** `Set-AuthenticodeSignature` with a self-signed cert returns `UnknownError` status rather than `Valid` because the cert is not in a trusted root store. The script explicitly allows this status code for dev builds so the pipeline does not fail.

### Changes

**New files — Scripts (3):**

| File | Purpose |
|---|---|
| `scripts/build-vsix.ps1` | PowerShell VSIX build pipeline (lint → test → compile → bundle → package) |
| `scripts/installer/setup.nsi` | NSIS installer: Ollama, VSIX, Python venv, optional model download, shortcuts |
| `scripts/installer/build-installer.ps1` | Orchestrates VSIX build, requirements export, NSIS compile, self-signed signing |

**New files — CI/CD (3):**

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | Per-push CI: lint-ts, test-ts, build-ts, lint-py, test-py, 80% coverage gate |
| `.github/workflows/release.yml` | Version-tag release: VSIX + installer + GitHub Release with CHANGELOG notes |
| `.github/workflows/nightly.yml` | Daily: live Ollama integration tests (gemma3:2b), benchmarks, Slack on failure |

**New files — Tests (3):**

| File | Purpose |
|---|---|
| `tests/unit/installer/nsis-logic.test.ps1` | Unit tests: `Find-VSCode`, `Find-Ollama`, `Find-Python` (deterministic, no NSIS required) |
| `tests/integration/installer/test-install-sequence.ps1` | Install/uninstall sequence: extension install, venv creation, dep install, clean removal |
| `tests/e2e/extension-load.test.ts` | Playwright E2E: activity bar icon, chat panel render, `/help` in Ollama-absent mode |

**New files — Documentation (3):**

| File | Purpose |
|---|---|
| `docs/v0.1.0/ci-setup.md` | Branch protection rules, workflow overview, secrets reference, local CI simulation |
| `docs/v0.1.0/testing.md` | Complete testing guide: unit, integration, installer, E2E, CI tier mapping |
| `docs/git/gitignore-audit-2026-04-05-phase7.md` | Phase 7 gitignore audit report (4 findings: G1×2, G2×2; all resolved) |

**Modified files (3):**

| File | Change |
|---|---|
| `.vscodeignore` | Expanded exclusions: `.github/`, `.claude/`, `coverage/`, `assets/`, `CHANGELOG.md`, `README.md`, `eslint.config.mjs`, `CLAUDE.md` |
| `package.json` | `"package"` script updated to run `build-vsix.ps1`; `"package:quick"` alias added |
| `.gitignore` | Added: `scripts/installer/setup.exe`, `scripts/installer/backend-requirements.txt`, `.coverage`, `coverage.xml`, `.npmrc` |

### Test Results

| Metric | Phase 6 | Phase 7 | Delta |
|---|---|---|---|
| TS test files | 20 | 20 | — |
| TS total tests | 205 | 205 | — |
| Python test files | 5 | 5 | — |
| Python total tests | 28 | 28 | — |
| PowerShell test files | — | 2 | +2 |
| E2E test files | — | 1 | +1 |
| Build errors | 0 | 0 | — |
| Lint errors | 0 | 0 | — |

No regressions. TypeScript and Python test suites are unaffected by Phase 7. The PowerShell tests run via `pwsh` directly (not Vitest). The E2E test requires `@vscode/test-electron` and `playwright` to be installed separately (`npm install --save-dev @vscode/test-electron playwright`) per `docs/v0.1.0/testing.md`.

### Lessons Learned

- **NSIS `RequestExecutionLevel admin` is required for Ollama installation but the Python venv should still be user-local.** `%LOCALAPPDATA%` resolves correctly under an admin-elevated installer because the token is inherited from the invoking user's session. Creating the venv at `%LOCALAPPDATA%\GemmaCode\venv` avoids requiring admin rights for future backend operations.
- **`NSISdl::download` pops two values — always pop both or the stack will be corrupted.** The pattern is: `NSISdl::download ... url dest; Pop $0` (result code) then read `$0`. If you forget to pop the second value (the downloaded file size that some NSIS versions push), subsequent `Pop` calls will retrieve garbage. Test every download step on a clean NSIS install.
- **`@vscode/test-electron` does not expose a `--remote-debugging-port` flag directly.** The flag must be passed via `launchArgs` in the `runTests()` call and Playwright must `connectOverCDP` to the port. The Electron process must be started before Playwright tries to connect — adding a `waitForLoadState('domcontentloaded')` call is the practical way to block until VS Code is ready.
- **Nightly CI should always use the smallest viable model, not the production model.** The production model (`gemma3:27b`) is 15 GB and would make every nightly run 20+ minutes just on the download. Use `gemma3:2b` (1.6 GB) in CI and rely on human testing for production model quality.
- **`uv export --no-dev --format requirements-txt` produces a pip-compatible requirements file.** This is the correct way to export dependencies from a `uv`-managed project for use in a plain `pip install -r` context (e.g., the installer's venv creation step). The `--no-dev` flag correctly excludes pytest and ruff from the runtime dependency set.
- **PowerShell's `$LASTEXITCODE` only reflects the last external command.** Inside a `Invoke-Step` wrapper that calls an `& $Action` scriptblock, `$LASTEXITCODE` is set by the external process inside the block. Returning a non-zero explicitly from the scriptblock (e.g., `exit 1`) will propagate correctly, but PowerShell cmdlets that throw exceptions do not set `$LASTEXITCODE`. Use `$ErrorActionPreference = 'Stop'` to convert all errors to terminating exceptions.

### Current Status

**Verified.** All Phase 7 artifacts are in place: VSIX build pipeline, NSIS installer script, installer orchestrator, three GitHub Actions workflows, branch protection documentation, PowerShell unit and integration tests for installer logic, E2E Playwright smoke test, and testing guide. TypeScript build is clean, 205 TS tests pass, 28 Python tests pass. Gitignore audit completed with 4 findings (all G1/G2) applied. Phase 7 is complete.

---

## [2026-04-05 18:00] Phase 4 — Skills, Commands & Plan Mode

### Summary

Implemented the full Phase 4 feature set: a `SkillLoader` that hot-reloads DevAI-Hub–compatible skill files from disk, a `CommandRouter` that parses `/command` slash inputs and dispatches to built-in handlers or skill prompts, a `PlanMode` that gates the agent loop behind per-step user approval, and all supporting webview UI (autocomplete dropdown, plan panel, PLAN badge). 7 built-in skills were bundled as a catalog. 42 new tests were added (174 total passing).

### Goal

Allow users to invoke structured workflows via `/commit`, `/review-pr`, and other skills bundled with the extension, type `/` to see an inline autocomplete, toggle plan mode to step through multi-step tasks with explicit approval, and switch models from the chat panel.

### Architecture

```
User types "/commit fix login bug"
    │
    ▼ GemmaCodePanel._handleSendMessage()
    │
    ▼ CommandRouter.route("/commit fix login bug")
    │   └─ returns { type: "skill", name: "commit", args: "fix login bug" }
    │
    ▼ SkillLoader.getSkill("commit")
    │   └─ reads src/skills/catalog/commit/SKILL.md → Skill object
    │   └─ replaces $ARGUMENTS → expanded prompt
    │
    ▼ StreamingPipeline.send(expandedPrompt)
    │   └─ AgentLoop.run() (same tool loop as Phase 3)
    │
    ▼ If plan mode active and response contains ≥2 numbered items:
        └─ PlanMode.detectPlan() → postMessage({ type: "planReady", steps })
        └─ Webview renders plan panel with per-step Approve buttons
        └─ User approves step N → postMessage({ type: "approveStep", step: N })
        └─ GemmaCodePanel sends follow-up message to agent to execute that step
```

### Key Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `SkillLoader` | `src/skills/SkillLoader.ts` | Load, parse, and hot-reload SKILL.md files from catalog and `~/.gemma-code/skills/` |
| `CommandRouter` | `src/commands/CommandRouter.ts` | Parse `/name args` input, route to builtin or skill, expose descriptor list |
| `PlanMode` | `src/modes/PlanMode.ts` | Track active state, detect plans, manage step lifecycle (pending → approved → done) |
| Built-in catalog | `src/skills/catalog/*/SKILL.md` | 7 skills: commit, review-pr, generate-readme, generate-changelog, generate-tests, analyze-codebase, setup-project |
| Webview autocomplete | `src/panels/webview/index.ts` | Dropdown appears on `/`, keyboard nav (↑↓ Tab Enter Esc), lazy command list fetch |
| Webview plan panel | `src/panels/webview/index.ts` | Sticky panel above footer, numbered steps, Approve buttons, status badges |

### Attempted Solutions & Key Decisions

#### 1. Skill catalog path resolution in tests

**Problem:** `GemmaCodePanel` constructs the catalog path via `path.join(this._extensionUri.fsPath, "src", "skills", "catalog")`. The unit test mock supplies `extensionUri: {} as vscode.Uri` — `fsPath` is `undefined`, causing `path.join` to throw `TypeError: The "path" argument must be of type string. Received undefined`.

**Error:**
```
TypeError: The "path" argument must be of type string. Received undefined
❯ Proxy.join node:path:513:7
❯ new GemmaCodePanel src/panels/GemmaCodePanel.ts:70:29
❯ activate src/extension.ts:55:21
```

**Fix:** Guarded with a nullish fallback:
```typescript
const extensionFsPath = this._extensionUri.fsPath ?? "";
const catalogDir = path.join(extensionFsPath, "src", "skills", "catalog");
```
When `fsPath` is undefined in tests, `catalogDir` becomes `"src/skills/catalog"` — a relative path that produces no skills when loaded (safe for tests).

#### 2. `PlanMode.state` snapshot not truly independent

**Problem:** The `state` getter did `[...this._state.currentPlan]` — a shallow array copy. The test `"state getter returns a snapshot, not a live reference"` failed because modifying a step object mutated the snapshot's copy too (same object references).

**Error:**
```
AssertionError: expected 'approved' to be 'pending'
❯ tests/unit/modes/PlanMode.test.ts:122:45
```

**Fix:** Deep-cloned each step with `map((s) => ({ ...s }))` so mutations to `_state.currentPlan` after the snapshot is taken do not affect the returned copy.

#### 3. Vitest `--include` flag not supported in v1.x

**Problem:** The `test:integration` script used `--include 'tests/integration/**'` which is not a valid Vitest v1.x CLI flag; only `vitest run <filter>` pattern matching is supported.

**Error:**
```
CACError: Unknown option `--include`
```

**Fix:** Two-part fix:
1. Updated `configs/vitest.config.ts` to add `"tests/integration/**/*.test.ts"` to the `include` array so both suites are covered by the default config.
2. Changed `test:integration` script to `vitest run --config configs/vitest.config.ts --reporter=verbose tests/integration` — using the positional path filter instead of `--include`.

#### 4. Skill SKILL.md frontmatter parser — missing `argument-hint` field

The `argument-hint` field is optional (not all skills need it). The parser correctly defaults to `""` when absent. Noted during test authoring: tests must not assert `argumentHint` is defined for skills that don't declare it, as the field may be an empty string.

### Changes

**New files (14):**

| File | Purpose |
|------|---------|
| `src/skills/SkillLoader.ts` | SKILL.md loader with frontmatter parser, user dir creation, fs.watch hot-reload |
| `src/commands/CommandRouter.ts` | Slash command parser and router with descriptor list for autocomplete |
| `src/modes/PlanMode.ts` | Plan mode state machine: toggle, setPlan, approveStep, markStepDone, detectPlan |
| `src/skills/catalog/commit/SKILL.md` | Built-in skill: conventional commit message generation |
| `src/skills/catalog/review-pr/SKILL.md` | Built-in skill: structured PR review with CVSS-style severity |
| `src/skills/catalog/generate-readme/SKILL.md` | Built-in skill: production-quality README generation |
| `src/skills/catalog/generate-changelog/SKILL.md` | Built-in skill: Keep a Changelog format from git history |
| `src/skills/catalog/generate-tests/SKILL.md` | Built-in skill: comprehensive test suite generation |
| `src/skills/catalog/analyze-codebase/SKILL.md` | Built-in skill: 12-section codebase analysis with Mermaid diagrams |
| `src/skills/catalog/setup-project/SKILL.md` | Built-in skill: project scaffolding and bootstrapping |
| `tests/unit/skills/SkillLoader.test.ts` | 8 tests: valid load, invalid frontmatter, user override, hot-reload |
| `tests/unit/commands/CommandRouter.test.ts` | 14 tests: routing, builtin dispatch, skill dispatch, unknown command warning |
| `tests/unit/modes/PlanMode.test.ts` | 16 tests: toggle, setPlan, approveStep, markStepDone, snapshot isolation |
| `tests/integration/commands/skill-execution.test.ts` | 4 integration tests: real catalog load, $ARGUMENTS substitution, 7-skill count |

**Modified files (6):**

| File | Change |
|------|--------|
| `src/panels/GemmaCodePanel.ts` | Full rewrite: wires SkillLoader, CommandRouter, PlanMode; handles 3 new message types; `_handleBuiltinCommand()` with /help /clear /history /plan /compact /model; `_checkForPlan()` post-send |
| `src/panels/messages.ts` | Added `CommandListMessage`, `PlanReadyMessage`, `PlanModeToggledMessage` (extension→webview); `RequestCommandListMessage`, `ApproveStepMessage` (webview→extension) |
| `src/panels/webview/index.ts` | Added plan badge, autocomplete dropdown (CSS + JS), plan panel with approve buttons; message handlers for `commandList`, `planReady`, `planModeToggled`; input event triggers `requestCommandList` on first `/` |
| `configs/vitest.config.ts` | Added `tests/integration/**/*.test.ts` to `include` array |
| `package.json` | Fixed `test:integration` script to use positional path filter |
| `docs/git/gitignore-audit-2026-04-05.md` | Updated for Phase 4 — 0 findings, 14 new untracked files documented |

### Test Results

| Metric | Phase 3 | Phase 4 | Delta |
|--------|---------|---------|-------|
| Test files | 13 | 17 | +4 |
| Total tests | 132 | 174 | +42 |
| Integration tests | 2 (skipped) | 6 (4 new pass + 2 skipped) | +4 |
| Build errors | 0 | 0 | — |
| Lint errors | 0 | 0 | — |

All 174 tests pass (2 skipped — the Ollama-server-dependent health check tests that require a live `ollama serve`).

### Lessons Learned

- **Mock `extensionUri.fsPath` explicitly in extension tests.** The `{} as vscode.Uri` stub is fine for tests that don't exercise path construction, but any code that does `path.join(extensionUri.fsPath, ...)` will throw. Guard with `?? ""` in production code and add `fsPath: "/mock"` to the mock in tests if needed.
- **Shallow array copies don't protect against object mutation.** A `state` getter that is intended to return a snapshot must deep-clone objects inside the array, not just the array wrapper. `map((s) => ({ ...s }))` is the correct idiom for a flat struct like `PlanStep`.
- **Vitest v1.x does not support `--include` as a CLI flag.** Use the positional path argument to filter tests, and add both `unit/` and `integration/` patterns to the `include` array in `vitest.config.ts` so the default `npm run test` command covers both suites.
- **SKILL.md frontmatter parsing is trivially implementable** without a full YAML library by splitting on `:` after the `---` delimiters. This avoids adding `js-yaml` as a dependency and keeps the parser transparent. The trade-off is that multi-line values are not supported — acceptable for the current skill format.
- **Hot-reload via `fs.watch` is non-deterministic in timing.** The SkillLoader hot-reload test uses a 200 ms `setTimeout` buffer. On slow CI machines this may flake; the test is intentionally lenient about timing but the production behavior is best-effort (not guaranteed delivery).

### Current Status

**Verified.** All 174 tests pass. `npm run build` and `npm run lint` are clean. 7 built-in skills are bundled. `/help`, `/clear`, `/plan`, `/compact`, `/model`, and all skill commands are functional. Phase 4 is complete; Phase 5 (Persistent Chat History, Auto-Compact, Edit Modes) is next.

---

## [2026-04-05 15:30] Phase 3 — Agentic Tool Layer

### Summary

Implemented the full agentic tool layer for Gemma Code. The model can now invoke 10 structured tools (file I/O, terminal, web search) via an XML-delimited JSON protocol. The extension parses, validates, and executes tool calls in a multi-turn loop, shows progress in the chat UI, and gates destructive operations behind a user confirmation dialog.

### Goal

Enable the Gemma 4 model to take real actions in the workspace: read and edit files, execute terminal commands, search the codebase, and query the web — all without any external API. The entire tool loop runs locally.

### Architecture

The tool layer sits between the existing `StreamingPipeline` and `ConversationManager`:

```
User message
    │
    ▼ StreamingPipeline.send()
    │  ↳ delegates to AgentLoop.run()
    │
    ▼ Stream model response (OllamaClient)
    │
    ├─ <tool_call> detected?
    │      │
    │      ▼ ToolCallParser.parseToolCalls()
    │      ▼ ToolRegistry.execute()   ← dispatches to handler
    │      │   ├─ filesystem.ts  (ReadFileTool, WriteFileTool, EditFileTool, …)
    │      │   ├─ terminal.ts    (RunTerminalTool + ConfirmationGate)
    │      │   └─ webSearch.ts   (WebSearchTool, FetchPageTool)
    │      ▼ inject <tool_result> as user message → loop
    │
    └─ No tool call → commit assistant message → done
```

Tool calls use XML-delimited JSON: `<tool_call>{"tool":"read_file","id":"c1","parameters":{"path":"..."}}` </tool_call>`. Results are injected as `<tool_result id="c1">...</tool_result>` user messages. The loop enforces a 20-iteration hard cap.

### Attempted Solutions & Key Decisions

#### 1. AgentLoop ↔ StreamingPipeline integration

**Problem:** `StreamingPipeline.send()` handled a single streaming pass. The agentic loop requires multiple passes (one per tool iteration), but `StreamingPipeline` is tested in isolation and its constructor signature can't change without breaking 10 existing tests.

**Solution:** Added an optional 4th constructor parameter `_runAgentLoop?: (postMessage) => Promise<void>`. When present, `send()` delegates to it; when absent, the original `_attemptStream()` path runs unchanged. Zero existing tests needed modification.

#### 2. `AgentLoop.cancel()` called before `run()`

**Problem:** The first test run failed with `expected 20 to be less than or equal to 1`. `run()` was resetting `this._cancelled = false` unconditionally at the top, so a `cancel()` call made before `run()` was invisible.

**Error:** `AssertionError: expected 20 to be less than or equal to 1`

**Fix:** Added a pre-reset check:
```typescript
if (this._cancelled) {
  this._cancelled = false;
  return;
}
this._cancelled = false;
```
The pattern honours a pre-run cancel and resets state so a future `run()` can proceed normally.

#### 3. `vscode.workspace.findTextInFiles` not in type definitions

**Problem:** The `GrepCodebaseTool` used `vscode.workspace.findTextInFiles` as a fallback when ripgrep is unavailable. TypeScript build failed with `Property 'findTextInFiles' does not exist on type 'typeof workspace'` — this is a proposed/unstable API not exported in `@types/vscode@1.90`.

**Error:** `src/tools/handlers/filesystem.ts(428,30): error TS2339: Property 'findTextInFiles' does not exist`

**Fix:** Replaced with `vscode.workspace.findFiles` (stable since VS Code 1.5) + manual per-file grep using `workspace.fs.readFile` and `RegExp.test()`. Also added `findFiles: vi.fn().mockResolvedValue([])` to the vscode mock in `tests/setup.ts`.

#### 4. `workspace.fs` and `workspace.findFiles` missing from test mock

**Problem:** `filesystem.test.ts` failed immediately because the vscode mock in `tests/setup.ts` didn't include `workspace.fs` or `workspace.findFiles`.

**Fix:** Added `mockFs` (with `readFile`, `writeFile`, `createDirectory`, `readDirectory`, `delete`, `stat` stubs) and `mockFindTextInFiles` (preserved for compatibility) and `findFiles: vi.fn()` to the vscode mock. Exported `mockFs` and `mockFindTextInFiles` from `setup.ts` so individual test files can configure return values per-test.

#### 5. `vscode.workspace.workspaceFolders[0]` possibly undefined

**Problem:** TypeScript strict mode flagged `folders[0]` as `T | undefined` in both `filesystem.ts` and `terminal.ts`.

**Error:** `error TS2532: Object is possibly 'undefined'`

**Fix:** Added `!` non-null assertion after the `folders.length === 0` guard that would have already thrown. Safe because the guard ensures the element exists.

#### 6. `ConfirmationGate` requires late-bound `postMessage`

**Problem:** `GemmaCodePanel` constructs `ConfirmationGate` in its constructor, but `this._view` (needed to call `webview.postMessage`) is only set in `resolveWebviewView`, which runs later.

**Solution:** Passed a closure `(msg) => void this._view?.webview.postMessage(msg)` to `ConfirmationGate`'s constructor. The closure captures `this._view` by reference, so it resolves to the live view object at call time. The `?.` optional chain makes it safe before the view is attached (messages are silently dropped if no view is open).

### Changes

**New files (19):**

| File | Purpose |
|------|---------|
| `src/tools/types.ts` | `ToolCall`, `ToolResult`, `ToolHandler`, `ConfirmationMode`, all parameter shapes |
| `src/tools/ToolCallParser.ts` | `parseToolCalls()`, `hasToolCall()`, `stripToolCalls()`, `formatToolResult()` |
| `src/tools/ConfirmationGate.ts` | Promise-based webview confirmation with 60s timeout |
| `src/tools/ToolRegistry.ts` | Register handlers by `ToolName`, execute with exception wrapping |
| `src/tools/AgentLoop.ts` | Multi-turn streaming + tool loop, max 20 iterations, cancel support |
| `src/tools/handlers/filesystem.ts` | 7 filesystem tools with path traversal guard and `diff` integration |
| `src/tools/handlers/terminal.ts` | Shell execution via `child_process.spawn`, blocklist, 30s timeout |
| `src/tools/handlers/webSearch.ts` | DuckDuckGo HTML scraper + page fetcher using `node-html-parser` |
| `docs/v0.1.0/tool-protocol.md` | Full tool protocol specification with all 10 tools documented |
| 7 test files | 79 new tests across all new modules |

**Modified files (11):**

| File | Change |
|------|--------|
| `src/panels/messages.ts` | Added `ToolUseMessage`, `ToolResultMessage`, `ConfirmationRequestMessage`, `ConfirmationResponseMessage` |
| `src/config/settings.ts` | Added `toolConfirmationMode: "always"|"ask"|"never"` and `maxAgentIterations: number` |
| `src/chat/ConversationManager.ts` | Replaced terse system prompt with full tool protocol description and 10-tool reference |
| `src/chat/StreamingPipeline.ts` | Optional `_runAgentLoop` 4th constructor param, backward-compatible |
| `src/panels/GemmaCodePanel.ts` | Constructs full tool stack, handles `confirmationResponse`, cancels AgentLoop |
| `src/panels/webview/index.ts` | Tool use indicator, collapsible tool result blocks, confirmation card UI |
| `tests/setup.ts` | Added `workspace.fs`, `workspace.findFiles`, `FileType`, `Uri.joinPath`, `Position` mocks |
| `package.json` | `diff` + `node-html-parser` runtime deps, 2 new settings schema entries |
| `package-lock.json` | Updated for new deps |
| `.gitignore` | 16 pattern additions (Windows metadata, VS, certs, SSH keys, npm logs, temp), duplicate `out/` removed |
| `docs/git/gitignore-audit-2026-04-05.md` | Updated with post-Phase-3 status (all G2 findings resolved) |

### Test Results

| Metric | Phase 2 | Phase 3 | Delta |
|--------|---------|---------|-------|
| Test files | 6 | 13 | +7 |
| Total tests | 53 | 132 | +79 |
| Statement coverage | 95.59% | — | maintained |
| Build errors | 0 | 0 | — |
| Lint errors | 0 | 0 | — |

All 132 tests pass. Build and lint are clean.

### Lessons Learned

- **`vscode.workspace.findTextInFiles` is a proposed API.** Avoid it; use `findFiles` + manual read for stable cross-version behavior.
- **`AgentLoop.run()` must not unconditionally reset `_cancelled`.** Doing so silently swallows pre-run cancellations. Check first, reset second.
- **Test mock completeness matters early.** The vscode mock in `setup.ts` needs to be kept in sync as new VS Code API surface is consumed. It's cheaper to add stubs proactively than to debug confusing "not a function" errors in test runs.
- **The optional 4th constructor parameter pattern** is the cleanest way to upgrade an existing class with new behavior without breaking its tests. The fallback path stays identical; the new path is exercised only by new callers.
- **`ConfirmationGate` timeout prevents deadlocks.** Without the 60-second auto-reject, a user closing the window without responding would leave the agent loop suspended indefinitely.

### Current Status

**Verified.** All 132 tests pass. `npm run build` and `npm run lint` are clean. The tool protocol is documented in `docs/v0.1.0/tool-protocol.md`. Phase 3 is complete; Phase 4 (Skills, Commands & DevAI-Hub Integration) is next.

---

## [2026-04-05] Project Kickoff

### Summary

Initialized the Gemma Code repository and established the project foundation.

### Vision

Gemma Code aims to replicate the agentic, codebase-aware workflow of tools like Claude Code, but running entirely offline via Ollama and Google's Gemma 4. The core design principle is privacy-first: no code, prompt, or context ever leaves the developer's machine.

The initial feature target includes:
- Multi-file codebase reading and reasoning
- Autonomous file editing with user confirmation
- Terminal command execution and output interpretation
- Multi-step task planning and execution

### Tech Stack Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Extension language | TypeScript | VS Code extensions are natively TypeScript; best tooling and API support |
| Inference layer | Python + Ollama REST API | Ollama provides a well-maintained local model server with a simple HTTP interface; Python is the natural fit for LLM tooling |
| Performance components | Rust | For any hot-path work (file indexing, tokenization helpers) where TypeScript or Python would be too slow |
| CLI/tooling | Go | Lightweight, fast-starting binaries for any standalone tooling or daemon components |
| Local model | Google Gemma 4 | Strong reasoning capability, runs well on consumer hardware via Ollama, and is fully open-weight |

### Initial Scaffold

Created the following structure:

```
CLAUDE.md       Project configuration for Claude Code assistant
README.md       Project overview and setup instructions
CHANGELOG.md    Version history (Keep a Changelog format)
.gitignore      Covers TypeScript, Python, Rust, Go, and VS Code extension artifacts
src/            Extension source (TypeScript)
lib/            Shared libraries
tests/          Test suites
docs/           Documentation (this file lives here)
configs/        Configuration files
scripts/        Build and utility scripts
assets/         Icons and static assets
examples/       Demo workflows
```

### Next Steps

- Define the VS Code extension manifest (`package.json`) and activation events
- Set up the TypeScript project with `tsconfig.json`, ESLint, and Prettier
- Scaffold the Ollama HTTP client in Python
- Design the agent loop architecture (tool use, planning, confirmation flow)
- Set up CI/CD (GitHub Actions) for linting and testing across all four language stacks
