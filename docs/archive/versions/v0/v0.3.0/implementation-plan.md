# Implementation Plan -- v0.3.0

**Project**: Gemma Code
**Version**: 0.3.0
**Created**: 2026-04-14
**Goal**: Deliver production-grade harness engineering infrastructure (GPU-aware context budgeting, 4-layer graph-vector memory, plan-and-execute orchestration, multi-layered safety, local observability, and a modern cross-platform installer) enabling Gemma Code to match Claude Code-level agentic capabilities using only a local Gemma 4 model on a single GPU.

## Overview

Gemma Code v0.3.0 transforms the extension from a functional coding assistant (v0.2.0) into a production-grade agentic system by implementing the infrastructure patterns validated by Claude Code, Codex, OpenHands, and LangGraph, adapted for local-only execution on consumer hardware.

The core insight from harness engineering research is that **the bottleneck in agentic systems is not model intelligence, but the surrounding infrastructure**. Claude Code's leaked QueryEngine.ts (46,000 lines) demonstrates that production systems are human-engineered harnesses. v0.3.0 builds this harness for Gemma Code with three key differentiators:

1. **Hardware-aware**: Three GPU tiers (6-8GB, 12-16GB, 24+GB) with auto-detection, tier-specific context budgets, and quantization-aware scheduling. Every component adapts to the user's hardware.
2. **Efficiency-first**: Lazy tool loading (46.9% token savings), output redirection for large results, regenerate-from-source compaction, and aggressive budget middleware. Local inference on a single GPU demands efficiency that cloud-hosted models can ignore.
3. **Safety-by-default**: Hash-based loop detection, irreversible action classification, git safety nets, and token/iteration budget caps. Unlike cloud APIs with billing alerts, a runaway local agent wastes the user's GPU time and electricity silently.

The extension will be distributed via a modern cross-platform PyQt5 installer (Windows, macOS, Linux) with dark theme, step-by-step wizard flow, GPU auto-detection, model recommendation, and real-time installation progress.

Success at v0.3.0 is demonstrated by a golden task suite: 20+ internal tasks (multi-file edits, bug fixes, refactors, test generation, code review) running on all three GPU tiers with >80% pass rate, full trace visibility in a local dashboard, and automated regression detection.

## Phases at a Glance

| Phase | Title | Sub-tasks | Outcome |
|-------|-------|-----------|---------|
| 1 | GPU Detection & Hardware-Aware Foundation | 5 | Auto-detect GPU/VRAM, establish three hardware tiers, implement quantization-aware context budgeting, and token/iteratio... |
| 2 | Advanced Context Engineering | 5 | Implement lazy tool loading, progressive disclosure, output redirection for large tool results, and enhanced compaction ... |
| 3 | Graph-Vector Hybrid Memory | 7 | Implement 4-layer memory stack (working/episodic/semantic/graph) with entity extraction, provenance tracking, and memory... |
| 4 | Safety, Budgeting & Runaway Prevention | 6 | Implement multi-layered safety: hash-based loop detection, irreversible action classification, git safety net, permissio... |
| 5 | Plan-and-Execute Orchestration | 6 | Replace current ReAct-style AgentLoop with Plan-and-Execute (DAG-based) orchestration, add Reflexion pattern for error r... |
| 6 | Local Observability & Trace Dashboard | 5 | Implement local SQLite trace store, webview-based trace viewer, optional OTLP export, and metrics collection. |
| 7 | Cross-Platform PyQt5 Installer | 7 | Build a modern, dark-themed wizard installer for Windows, macOS, and Linux with GPU auto-detection, model recommendation... |
| 8 | Golden Task Suite & Integration Stabilization | 7 | Create 20+ golden tasks, run per-tier benchmarks, establish regression baseline, smoke test installers, and generate ful... |

**Total: 8 phases, 48 sub-tasks**

---

## Phase 1: GPU Detection & Hardware-Aware Foundation

**Goal**: Auto-detect GPU/VRAM, establish three hardware tiers, implement quantization-aware context budgeting, and token/iteration budget middleware.
**Prerequisites**: None.
**Stability Gate**: Extension detects GPU at startup, classifies into correct tier, adjusts context budgets accordingly, and budget middleware stops a deliberate runaway loop within 3 iterations.

### Sub-tasks

#### 1.1 -- GPU/VRAM Detection Service

**Objective**: Create a hardware detection module that auto-detects GPU vendor, VRAM capacity, and available VRAM at runtime, providing a unified API regardless of whether the system has NVIDIA, AMD, or integrated graphics.

**Files**:
- Create: `src/config/GpuDetector.ts`
- Create: `src/config/GpuDetector.types.ts`
- Create: `tests/unit/config/GpuDetector.test.ts`

**Prompt**:
> You are implementing GPU/VRAM detection for the Gemma-Code VS Code extension (TypeScript, Vitest tests). The extension runs locally via Ollama on Windows/Linux/macOS.
> 
> CONTEXT:
> - The project is at c:\Users\bdour\Documents\Work\Coding\Github\Gemma-Code
> - Existing settings system: src/config/settings.ts (exports getSettings() reading from vscode.workspace.getConfiguration)
> - Existing Ollama client: src/ollama/client.ts (HTTP client wrapping Ollama REST API at localhost:11434)
> - Platform: win32 primarily, must degrade gracefully on Linux/macOS
> - Test pattern: Vitest with vi.fn() mocks, describe/it blocks (see tests/unit/config/PromptBudget.test.ts for conventions)
> 
> TASK:
> 1. Create src/config/GpuDetector.types.ts with:
>    - GpuVendor type: "nvidia" | "amd" | "apple" | "intel" | "unknown"
>    - GpuInfo interface: { vendor: GpuVendor; name: string; totalVramMb: number; freeVramMb: number; driverVersion: string | null }
>    - DetectionResult interface: { gpus: GpuInfo[]; primaryGpu: GpuInfo | null; detectionMethod: string; error: string | null }
> 
> 2. Create src/config/GpuDetector.ts with a GpuDetector class:
>    - async detect(): Promise<DetectionResult> -- main entry point
>    - Private methods for each detection strategy:
>      a. _detectNvidia(): Run `nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader,nounits` via child_process.execFile. Parse CSV output. Handle nvidia-smi not found gracefully.
>      b. _detectAmd(): Run `rocm-smi --showmeminfo vram --csv` on Linux. On Windows, try `Get-CimInstance -ClassName Win32_VideoController` via PowerShell. Parse output.
>      c. _detectApple(): On macOS (process.platform === "darwin"), run `system_profiler SPDisplaysDataType -json`. Extract VRAM from "spdisplays_vram" field. Apple Silicon reports unified memory; use `sysctl hw.memsize` and estimate GPU-available portion as 75% of total.
>      d. _detectFallback(): Query Ollama /api/ps endpoint which returns loaded models with their VRAM usage. If a model is loaded, estimate total VRAM from model size + free overhead. Also try WMI on Windows: `wmic path win32_VideoController get Name,AdapterRAM /format:csv`.
>    - Each detection method must: (a) set a timeout of 5 seconds, (b) catch all errors and return null rather than throwing, (c) log detection attempts to console.debug
>    - The detect() method tries strategies in order (nvidia -> amd -> apple -> fallback), collects all found GPUs, and picks the one with the most VRAM as primaryGpu
>    - Cache the result for the lifetime of the GpuDetector instance (re-detect only if refresh() is called)
>    - Export a singleton `getGpuDetector()` factory function
> 
> 3. Create tests/unit/config/GpuDetector.test.ts:
>    - Mock child_process.execFile to simulate nvidia-smi output
>    - Test: parses valid nvidia-smi CSV correctly (single GPU)
>    - Test: parses multi-GPU nvidia-smi output (picks highest VRAM as primary)
>    - Test: handles nvidia-smi not found (returns null for nvidia detection)
>    - Test: handles nvidia-smi timeout (returns null)
>    - Test: fallback to WMI on Windows when no nvidia-smi
>    - Test: detect() returns cached result on second call without re-running detection
>    - Test: refresh() clears cache and re-runs detection
> 
> CONVENTIONS:
> - Use readonly on interface fields
> - Export types from the .types.ts file
> - Use `import type` for type-only imports
> - Follow the pattern from src/config/settings.ts for module structure
> - All async methods should use try/catch, never let exceptions propagate uncaught

---

#### 1.2 -- Hardware Tier Classification and Model Mapping

**Objective**: Define three hardware tiers based on detected VRAM, map each tier to recommended Gemma 4 model variants and quantization levels, and expose a tier-aware configuration that downstream systems consume.

**Files**:
- Create: `src/config/HardwareTier.ts`
- Create: `src/config/HardwareTier.types.ts`
- Create: `tests/unit/config/HardwareTier.test.ts`
- Modify: `src/config/settings.ts` (add `gpuTier` and `autoDetectGpu` settings)

**Prompt**:
> You are implementing hardware tier classification for Gemma-Code. This builds on the GpuDetector (sub-task 1.1) to classify the user's hardware into one of three tiers and recommend appropriate model configurations.
> 
> CONTEXT:
> - GpuDetector at src/config/GpuDetector.ts provides: detect() -> { primaryGpu: { totalVramMb, freeVramMb, vendor } }
> - Existing settings: src/config/settings.ts with GemmaCodeSettings interface (22 settings including modelName, maxTokens)
> - Existing budget: src/config/PromptBudget.ts with calculateBudget(maxTokens, overrides)
> - Package.json contributes.configuration section defines VS Code setting schema
> 
> TASK:
> 1. Create src/config/HardwareTier.types.ts:
>    - HardwareTierId type: 1 | 2 | 3
>    - ModelRecommendation interface: { modelName: string; contextWindow: number; quantization: string; effectiveParams: string; vramRequired: number }
>    - HardwareTierConfig interface:
>      {
>        readonly id: HardwareTierId;
>        readonly name: string;                    // "constrained", "balanced", "full"
>        readonly vramRange: { min: number; max: number }; // in MB
>        readonly recommendedModels: ModelRecommendation[];  // ordered best-first
>        readonly maxAgentIterations: number;       // 10, 20, 30
>        readonly contextWindow: number;            // effective context for budget calculation
>        readonly budgetOverrides: {                // tier-specific budget percentages
>          systemPromptPercent: number;
>          memoryPercent: number;
>          conversationPercent: number;
>          responsePercent: number;
>        };
>        readonly compactionThreshold: number;      // 0.7, 0.8, 0.85
>      }
> 
> 2. Create src/config/HardwareTier.ts:
>    - Define TIER_CONFIGS: Record<HardwareTierId, HardwareTierConfig> as a const:
>      Tier 1 (6-8 GB VRAM): Models gemma4:e2b (Q4_K_M, 128K ctx but effective 32K), gemma4:e4b (Q4_0, 128K but effective 64K). maxAgentIterations=10. Budget: system 8%, memory 2%, conversation 70%, response 20%. compactionThreshold=0.7.
>      Tier 2 (12-16 GB): Models gemma4:e4b (FP16, 128K), gemma4:12b (Q4_K_M, 128K). maxAgentIterations=20. Budget: system 10%, memory 3%, conversation 65%, response 20%. compactionThreshold=0.8.  (Note: keep 2% unallocated as safety margin.)
>      Tier 3 (24+ GB): Models gemma4:26b-moe (Q4_K_M, 256K), gemma4:31b (Q4_K_M, 256K). maxAgentIterations=30. Budget: system 10%, memory 5%, conversation 60%, response 20%. compactionThreshold=0.85. (Note: keep 5% unallocated.)
>    - classifyTier(vramMb: number): HardwareTierId -- Returns 1 if vramMb < 10240, 2 if < 20480, 3 otherwise
>    - getRecommendedModel(tier: HardwareTierConfig, installedModels: string[]): ModelRecommendation | null -- Returns the first recommended model that is installed in Ollama (match by name prefix)
>    - getTierConfig(tierId: HardwareTierId): HardwareTierConfig
> 
> 3. Modify src/config/settings.ts:
>    - Add to GemmaCodeSettings: autoDetectGpu: boolean; gpuTierOverride: HardwareTierId | null
>    - Add to getSettings(): autoDetectGpu defaulting to true, gpuTierOverride defaulting to null
>    - Add these as VS Code configuration properties (you will need to note what to add to package.json contributes.configuration)
> 
> 4. Create tests/unit/config/HardwareTier.test.ts:
>    - Test classifyTier: 6144 MB -> Tier 1, 8192 -> Tier 1, 12288 -> Tier 2, 16384 -> Tier 2, 24576 -> Tier 3, 49152 -> Tier 3
>    - Test getRecommendedModel: returns first matching installed model; returns null when none installed
>    - Test TIER_CONFIGS: all three tiers have valid budget percentages that sum to <= 100
>    - Test TIER_CONFIGS: tier 1 has lower maxAgentIterations than tier 3
> 
> CONVENTIONS:
> - Keep the HardwareTier module pure (no vscode import) so it is testable without mocking
> - Follow existing patterns: readonly interfaces, explicit types, no `any`

---

#### 1.3 -- Tier-Aware Context Budget Calculator

**Objective**: Refactor `PromptBudget.ts` to accept tier configuration and compute budgets that scale with the tier's context window and budget overrides, replacing the current hardcoded percentages.

**Prompt**:
> You are refactoring the PromptBudget system in Gemma-Code to be hardware-tier-aware. Currently, calculateBudget uses hardcoded percentages. It must now accept tier-specific overrides while remaining backward-compatible.
> 
> CONTEXT:
> - Current src/config/PromptBudget.ts: exports BudgetAllocation interface and calculateBudget(maxTokens, overrides?) function. Current percentages: system 10%, memory 3%, skill 2%, conversation 65%, response 20%.
> - HardwareTier.types.ts (from sub-task 1.2) provides: HardwareTierConfig with budgetOverrides { systemPromptPercent, memoryPercent, conversationPercent, responsePercent }
> - PromptBuilder.ts calls calculateBudget at lines 29 and 218
> - ContextCompactor.ts uses calculateBudget at line 63 and has a hardcoded COMPACTION_THRESHOLD = 0.8
> 
> TASK:
> 1. Modify src/config/PromptBudget.ts:
>    - Expand the overrides parameter to accept all budget percentages:
>      interface BudgetOverrides {
>        systemPromptPercent?: number;
>        memoryPercent?: number;
>        skillPercent?: number;
>        conversationPercent?: number;
>        responsePercent?: number;
>      }
>    - Change calculateBudget signature to: calculateBudget(maxTokens: number, overrides?: BudgetOverrides): BudgetAllocation
>    - Apply overrides with fallback to current defaults: system 10%, memory 3%, skill 2%, conversation 65%, response 20%
>    - Add a new export: calculateTierBudget(tierConfig: HardwareTierConfig): BudgetAllocation that calls calculateBudget with tierConfig.contextWindow and tierConfig.budgetOverrides. Import HardwareTierConfig type.
>    - Add validation: if percentages sum > 100, log a warning and scale them proportionally
> 
> 2. Modify src/chat/ContextCompactor.ts:
>    - Replace the hardcoded COMPACTION_THRESHOLD = 0.8 with a constructor parameter compactionThreshold (default 0.8)
>    - The GemmaCodePanel will pass the tier's compactionThreshold when constructing ContextCompactor
> 
> 3. Update tests/unit/config/PromptBudget.test.ts:
>    - Keep all existing tests passing (backward compatibility)
>    - Add test: custom memoryPercent override changes memoryBudget
>    - Add test: custom conversationPercent + responsePercent override
>    - Add test: calculateTierBudget with a mock tier config returns expected values
>    - Add test: percentages summing to >100 triggers proportional scaling
> 
> 4. Do NOT modify PromptBuilder.ts or GemmaCodePanel.ts yet -- those will be wired in sub-task 1.5. Just ensure the API is ready.
> 
> CONVENTIONS:
> - Maintain the existing BudgetAllocation interface unchanged (all fields stay)
> - Keep calculateBudget backward-compatible: calling it with no overrides must produce identical results to v0.2.0
> - Use `import type` for HardwareTierConfig

---

#### 1.4 -- Token and Iteration Budget Middleware

**Objective**: Create middleware that enforces per-session token budgets and per-turn iteration caps, preventing runaway sessions from exhausting VRAM or compute. This wraps the AgentLoop with budget-aware guards.

**Files**:
- Create: `src/tools/BudgetMiddleware.ts`
- Create: `src/tools/BudgetMiddleware.types.ts`
- Create: `tests/unit/tools/BudgetMiddleware.test.ts`
- Modify: `src/tools/AgentLoop.ts` (integrate budget checks)

**Prompt**:
> You are implementing token and iteration budget middleware for Gemma-Code's agent loop. This prevents runaway sessions on constrained hardware.
> 
> CONTEXT:
> - AgentLoop at src/tools/AgentLoop.ts: has a _maxIterations field (default 20), runs a for-loop up to maxIterations, calls _streamOneTurn per iteration, tracks _fileEditCount and _modifiedFiles
> - ConversationManager at src/chat/ConversationManager.ts: getHistory() returns Message[], each with content string
> - CompactionStrategy.ts: exports estimateTokensForMessages(messages) which returns estimated token count
> - HardwareTierConfig (sub-task 1.2): provides maxAgentIterations per tier
> - ContextCompactor.ts: has estimateTokens() method and shouldCompact() check
> - PostMessageFn sends messages to the webview for UI updates
> 
> TASK:
> 1. Create src/tools/BudgetMiddleware.types.ts:
>    - SessionBudget interface: {
>        readonly maxSessionTokens: number;      // total tokens allowed in a session before forced compaction
>        readonly maxTurnTokens: number;          // max tokens in a single model response
>        readonly maxIterations: number;          // hard cap on agent loop iterations
>        readonly warningThresholdPercent: number; // post warning at this % of session budget (default 80)
>      }
>    - BudgetState interface: {
>        sessionTokensUsed: number;
>        currentTurnTokens: number;
>        iterationsUsed: number;
>        warningIssued: boolean;
>      }
>    - BudgetCheckResult type: { allowed: true } | { allowed: false; reason: string; action: "compact" | "stop" | "truncate" }
> 
> 2. Create src/tools/BudgetMiddleware.ts:
>    - BudgetMiddleware class:
>      - Constructor takes SessionBudget + a reference to the ContextCompactor (optional, for triggering compaction)
>      - getState(): BudgetState (readonly snapshot)
>      - checkPreTurn(): BudgetCheckResult -- Check if the session has budget for another turn. If sessionTokensUsed > maxSessionTokens, return { allowed: false, action: "compact" }. If iterationsUsed >= maxIterations, return { allowed: false, action: "stop" }.
>      - recordTurnTokens(tokens: number): BudgetCheckResult -- Called after a model response. Increments sessionTokensUsed and currentTurnTokens. If currentTurnTokens > maxTurnTokens, return { allowed: false, action: "truncate" }. If sessionTokensUsed > warningThreshold and !warningIssued, post a warning via postMessage.
>      - recordIteration(): void -- Increments iterationsUsed
>      - reset(): void -- Resets state for a new session
>    - Export createSessionBudget(tierId: HardwareTierId, contextWindow: number): SessionBudget:
>      Tier 1: maxSessionTokens = contextWindow * 0.65, maxTurnTokens = 4096, maxIterations = 10
>      Tier 2: maxSessionTokens = contextWindow * 0.70, maxTurnTokens = 8192, maxIterations = 20
>      Tier 3: maxSessionTokens = contextWindow * 0.75, maxTurnTokens = 16384, maxIterations = 30
> 
> 3. Modify src/tools/AgentLoop.ts:
>    - Add optional BudgetMiddleware parameter to constructor (after the existing options parameter)
>    - In the run() method's for-loop, before calling _streamOneTurn:
>      a. If _budgetMiddleware exists, call checkPreTurn(). If not allowed and action is "compact", trigger compaction via compactor and continue. If action is "stop", post an error and return.
>    - After _streamOneTurn returns accumulated text:
>      a. If _budgetMiddleware exists, call recordTurnTokens(estimateTokens(accumulated)). If action is "truncate", truncate the accumulated text to maxTurnTokens * 4 characters.
>      b. Call recordIteration()
>    - These additions must be backward-compatible: if no BudgetMiddleware is provided, behavior is identical to v0.2.0
> 
> 4. Create tests/unit/tools/BudgetMiddleware.test.ts:
>    - Test createSessionBudget for each tier
>    - Test checkPreTurn: allowed when under budget
>    - Test checkPreTurn: returns "stop" when iterations exhausted
>    - Test checkPreTurn: returns "compact" when session tokens exceeded
>    - Test recordTurnTokens: returns "truncate" when turn exceeds maxTurnTokens
>    - Test recordTurnTokens: issues warning at threshold
>    - Test reset: clears all state
>    - Test AgentLoop integration: mock BudgetMiddleware, verify checkPreTurn is called each iteration
> 
> CONVENTIONS:
> - The middleware must be pure (no vscode imports) for testability
> - Follow the AgentLoop test patterns from tests/unit/tools/AgentLoop.test.ts (makeClient, makeManager, makeRegistry helpers)
> - The BudgetMiddleware should not directly call postMessage; instead return results that the AgentLoop interprets

---

#### 1.5 -- Wire GPU Detection into Extension Lifecycle

**Objective**: Integrate GpuDetector and HardwareTier into the extension activation flow so that tier-aware configuration is established at startup and propagated to PromptBuilder, AgentLoop, and ContextCompactor.

**Prompt**:
> You are wiring the GPU detection and hardware tier system into Gemma-Code's extension lifecycle. This is the integration sub-task that connects sub-tasks 1.1-1.4.
> 
> CONTEXT:
> - src/extension.ts: activate() creates GemmaCodePanel, starts Ollama poller, registers commands
> - src/panels/GemmaCodePanel.ts: constructor creates ConversationManager, AgentLoop, ContextCompactor, SubAgentManager using settings from getSettings()
> - src/chat/PromptBuilder.ts: build(context: PromptContext) assembles system prompt sections
> - src/chat/PromptBuilder.types.ts: PromptContext interface has modelName, maxTokens, etc.
> - GpuDetector (sub-task 1.1): async detect() -> DetectionResult
> - HardwareTier (sub-task 1.2): classifyTier(vramMb), getTierConfig(tierId), getRecommendedModel(tier, installedModels)
> - BudgetMiddleware (sub-task 1.4): createSessionBudget(tierId, contextWindow) -> SessionBudget
> - PromptBudget (sub-task 1.3): calculateTierBudget(tierConfig) -> BudgetAllocation
> 
> TASK:
> 1. Modify src/extension.ts:
>    - After creating the outputChannel and before creating GemmaCodePanel:
>      a. Instantiate GpuDetector and call detect()
>      b. Log detection results to outputChannel
>      c. If autoDetectGpu is true and gpuTierOverride is null, classify the tier from detected VRAM
>      d. If gpuTierOverride is set in settings, use that instead
>      e. Query Ollama listModels() to get installed models
>      f. Call getRecommendedModel(tierConfig, installedModelNames) to find the best available model
>      g. Pass the tierConfig and detected model info to GemmaCodePanel constructor
>    - This must be async-safe: if detection fails, fall back to Tier 2 defaults
>    - Add a new command "gemma-code.detectGpu" that re-runs detection and logs results
> 
> 2. Modify src/panels/GemmaCodePanel.ts constructor:
>    - Accept optional HardwareTierConfig parameter
>    - Use tierConfig.contextWindow instead of settings.maxTokens for the ContextCompactor
>    - Use tierConfig.compactionThreshold for ContextCompactor constructor
>    - Use tierConfig.maxAgentIterations for AgentLoop._maxIterations
>    - Create BudgetMiddleware with createSessionBudget(tier.id, tier.contextWindow) and pass to AgentLoop
>    - Store tierConfig for use in _buildPromptContext()
> 
> 3. Modify src/chat/PromptBuilder.types.ts:
>    - Add to PromptContext: tierName?: string; tierVramMb?: number; tierModelName?: string
>    
> 4. Modify src/chat/PromptBuilder.ts:
>    - In _buildBaseInstructions, if context.tierName is set, append a line: "Running on {tierName} tier ({tierVramMb} MB VRAM) with model {tierModelName}."
>    - This informs the model about its own hardware constraints for better self-awareness
> 
> 5. Add to package.json contributes.configuration.properties:
>    - "gemma-code.autoDetectGpu": { type: "boolean", default: true, description: "Auto-detect GPU and VRAM at startup to select optimal model configuration." }
>    - "gemma-code.gpuTierOverride": { type: ["number", "null"], enum: [1, 2, 3, null], default: null, description: "Override auto-detected GPU tier (1=6-8GB, 2=12-16GB, 3=24+GB)." }
> 
> 6. Add a status bar item showing the detected tier: "Gemma Code: Tier {N} ({VRAM}GB)"
> 
> CONVENTIONS:
> - GPU detection is best-effort; never block activation on it
> - Log all detection steps to the output channel for debugging
> - Follow existing GemmaCodePanel patterns (constructor builds everything, resolveWebviewView wires the webview)

---

#### 1.T -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 1. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 1. Include unit tests for GPU detection (mock nvidia-smi output), tier classification, budget calculation, and budget middleware enforcement.
> Run the tests, fix all failures, and iterate until every test passes with 80%+ coverage.
> Do not advance to Phase 2 until this phase is fully verified.
> After all tests pass, run /generate-session-history to document this phase.

---

### Phase 1 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing (80%+ coverage)
- [ ] No known regressions from prior phases
- [ ] Session history generated for this phase
- [ ] Ready to advance to Phase 2

---

## Phase 2: Advanced Context Engineering

**Goal**: Implement lazy tool loading, progressive disclosure, output redirection for large tool results, and enhanced compaction with regenerate-from-source.
**Prerequisites**: Phase 1 (hardware tiers inform budget calculations and compaction aggressiveness).
**Stability Gate**: System prompt token count drops by 40%+ with lazy tool loading enabled. Large tool outputs redirect to temp files. Compaction regenerates from source files instead of summarizing conversation text.

### Sub-tasks

#### 2.1 -- Lazy Tool Loading with get_tool_schema

**Objective**: Replace the current approach of embedding all 10+ tool schemas in the system prompt with a lazy loading pattern: include only tool names and one-line descriptions in the system prompt, and provide a `get_tool_schema` meta-tool that the model calls to retrieve full parameter schemas on demand. This targets the 46.9% token reduction benchmark.

**Files**:
- Create: `src/tools/LazyToolLoader.ts`
- Create: `tests/unit/tools/LazyToolLoader.test.ts`
- Modify: `src/tools/ToolCatalog.ts` (add compact description format)
- Modify: `src/tools/Gemma4ToolFormat.ts` (add compact serialization)
- Modify: `src/chat/PromptBuilder.ts` (use compact tool declarations + lazy meta-tool)
- Modify: `src/tools/ToolRegistry.ts` (register get_tool_schema handler)

**Prompt**:
> You are implementing lazy tool loading for Gemma-Code to reduce context window usage. Currently, all tool schemas are serialized into the system prompt (~2000 tokens for 10 tools). With lazy loading, only names and one-line descriptions go in the prompt; the model calls get_tool_schema(name) to get full parameter details before using a tool.
> 
> CONTEXT:
> - src/tools/ToolCatalog.ts: TOOL_CATALOG array of 10 ToolMetadata objects, each with name, description, and parameters
> - src/tools/Gemma4ToolFormat.ts: serializeToolDefinitions(tools) converts metadata to <|tool>...<tool|> blocks with full JSON schema. Currently ~200 tokens per tool.
> - src/tools/ToolRegistry.ts: register(name, handler), execute(call), getEnabledNames()
> - src/chat/PromptBuilder.ts: _buildToolDeclarations(context) calls serializeToolDefinitions with all enabled tools
> - src/tools/types.ts: ToolHandler interface with execute(parameters) -> Promise<ToolResult>
> 
> TASK:
> 1. Modify src/tools/Gemma4ToolFormat.ts:
>    - Add new function: serializeToolSummary(tools: readonly ToolMetadata[]): string
>      Produces a compact format with only the get_tool_schema meta-tool as a full <|tool> block, followed by a markdown list of available tools:

---

#### 2.2 -- Output Redirection for Large Tool Results

**Objective**: When a tool result exceeds a threshold (5000 characters), redirect the output to a temporary workspace file and return a pointer message instead. Provide `tail_output` and `grep_output` helper tools so the model can read subsets without loading the full result into context.

**Files**:
- Create: `src/tools/OutputRedirector.ts`
- Create: `tests/unit/tools/OutputRedirector.test.ts`
- Modify: `src/tools/ToolRegistry.ts` (wrap execute with redirection logic)
- Modify: `src/tools/types.ts` (add tail_output and grep_output to BuiltinToolName)
- Modify: `src/tools/ToolCatalog.ts` (add metadata for new tools)

**Prompt**:
> You are implementing output redirection for Gemma-Code. Large tool results (>5000 chars) consume excessive context. Instead, they should be written to temp files with the model receiving a summary pointer.
> 
> CONTEXT:
> - src/tools/ToolRegistry.ts: execute(call) returns Promise<ToolResult> with { id, success, output, error }
> - src/tools/types.ts: ToolResult interface, ToolHandler interface, BuiltinToolName union type
> - vscode.workspace.workspaceFolders[0].uri.fsPath provides the workspace root
> - Large outputs commonly come from: run_terminal (test output, build logs), read_file (large files), grep_codebase (many matches), list_directory (deep recursive)
> 
> TASK:
> 1. Create src/tools/OutputRedirector.ts:
>    - OutputRedirector class:
>      - Constructor takes: outputDir (string path for temp files), charThreshold (default 5000)
>      - shouldRedirect(output: string): boolean -- returns true if output.length > charThreshold
>      - redirect(toolName: string, callId: string, output: string): RedirectedResult
>        a. Write output to {outputDir}/.gemma-code-output/{callId}.txt
>        b. Return: {
>             redirectedPath: string,
>             summary: string,  // first 500 chars + "... [truncated, {totalChars} chars total, {lineCount} lines]"
>             lineCount: number,
>             charCount: number
>           }
>      - readTail(filePath: string, lines: number): string -- Read last N lines from a redirected file
>      - grepOutput(filePath: string, pattern: string, maxResults: number): string -- Grep through a redirected file, return matching lines
>      - cleanup(): void -- Remove all files in the output directory
> 
>    - TailOutputTool class implementing ToolHandler:
>      - Parameters: { path: string, lines?: number (default 50) }
>      - Reads the last N lines from a redirected output file
>      - Returns the content as ToolResult
> 
>    - GrepOutputTool class implementing ToolHandler:
>      - Parameters: { path: string, pattern: string, max_results?: number (default 20) }
>      - Searches the redirected file for regex matches
>      - Returns matching lines with line numbers
> 
> 2. Modify src/tools/ToolRegistry.ts:
>    - Add a wrapWithRedirection(redirector: OutputRedirector) method or allow the caller to wrap:
>      After execute() returns a successful result, if redirector.shouldRedirect(result.output), call redirector.redirect() and replace result.output with the summary text including the file path
>    - The redirected summary format:
>      "[Output redirected to {path}] ({lineCount} lines, {charCount} chars)\n\nPreview (first 500 chars):\n{preview}\n\nUse tail_output or grep_output to read specific parts."
> 
> 3. Modify src/tools/types.ts:
>    - Add "tail_output" | "grep_output" to BuiltinToolName union
>    - Add parameter interfaces: TailOutputParams { path: string; lines?: number } and GrepOutputParams { path: string; pattern: string; max_results?: number }
> 
> 4. Modify src/tools/ToolCatalog.ts:
>    - Add metadata entries for tail_output and grep_output tools
> 
> 5. Create tests/unit/tools/OutputRedirector.test.ts:
>    - Test: shouldRedirect returns false for short output
>    - Test: shouldRedirect returns true for output exceeding threshold
>    - Test: redirect writes file and returns correct summary
>    - Test: readTail returns last N lines
>    - Test: grepOutput finds matching lines with line numbers
>    - Test: TailOutputTool.execute returns correct output
>    - Test: GrepOutputTool.execute handles regex patterns
>    - Test: cleanup removes output directory
>    - Use tmp directories (os.tmpdir) for test file operations
> 
> CONVENTIONS:
> - Output files go in {workspaceRoot}/.gemma-code-output/ (gitignored)
> - Each redirected file is named by callId to prevent collisions
> - The redirector must handle file I/O errors gracefully (return the original output if write fails)
> - Follow existing tool handler patterns (see src/tools/handlers/filesystem.ts)

---

#### 2.3 -- Regenerate-from-Source Compaction Strategy

**Objective**: Add a new compaction strategy that, instead of summarizing from the conversation text, regenerates summaries by re-reading the actual source files, test results, and git state. This prevents information degradation across multiple compaction cycles.

**Files**:
- Create: `src/chat/RegenerateFromSource.ts`
- Create: `tests/unit/chat/RegenerateFromSource.test.ts`
- Modify: `src/chat/CompactionStrategy.ts` (add to pipeline)
- Modify: `src/chat/ContextCompactor.ts` (insert into pipeline before LlmSummary)

**Prompt**:
> You are implementing regenerate-from-source compaction for Gemma-Code. Standard LLM summary compaction degrades information over multiple cycles. Regenerate-from-source reads actual project state to produce fresh, accurate summaries.
> 
> CONTEXT:
> - src/chat/CompactionStrategy.ts: defines CompactionStrategy interface { name, canApply(), apply() } and CompactionPipeline that runs strategies in sequence. Current 5 strategies: ToolResultClearing, SlidingWindow, CodeBlockTruncation, LlmSummary, EmergencyTrim.
> - src/chat/ContextCompactor.ts: creates the pipeline in compact(), wires pre-compaction hooks
> - AgentLoop tracks _modifiedFiles and _recentToolResults
> - The workspace root is available from vscode.workspace.workspaceFolders
> 
> TASK:
> 1. Create src/chat/RegenerateFromSource.ts:
>    - RegenerateFromSource class implementing CompactionStrategy:
>      - Constructor takes: workspacePath (string), maxSummaryTokens (number, default 2000)
>      - name = "RegenerateFromSource"
>      - canApply(messages, budgetTokens): boolean -- Returns true if there are modified files referenced in the conversation (scan messages for file paths)
>      - apply(messages, budgetTokens): Promise<Message[]>:
>        a. Extract all file paths mentioned in messages (regex: paths with extensions like .ts, .py, .json, .md)
>        b. Extract git context: run `git diff --stat HEAD~5` and `git log --oneline -5` (via child_process, with 5s timeout)
>        c. For each mentioned file that exists: read the first 20 lines to get current state
>        d. Check for test results: look for messages containing "PASS", "FAIL", "Error:", "test" patterns
>        e. Build a regenerated summary:
>           "[Regenerated context from source]\n\n## Modified Files\n{file list with first-line summaries}\n\n## Recent Git Activity\n{git log}\n\n## Test Status\n{test results summary}\n\n## Key Decisions\n{extracted decisions from conversation}"
>        f. Replace the conversation with: system messages + regenerated summary message + last N messages (keepRecent from settings)
>      - _extractFilePaths(messages): string[] -- Regex extraction of file paths from message content
>      - _extractDecisions(messages): string[] -- Reuse the decision extraction patterns from MemoryStore._extractPatterns
>      - _readFileHead(filePath, lines): string -- Read first N lines, return empty string on error
> 
> 2. Modify src/chat/ContextCompactor.ts:
>    - Accept optional workspacePath parameter in constructor
>    - In compact(), insert RegenerateFromSource into the pipeline between CodeBlockTruncation and LlmSummary:
>      Pipeline order: ToolResultClearing, SlidingWindow, CodeBlockTruncation, RegenerateFromSource, LlmSummary, EmergencyTrim
>    - RegenerateFromSource runs only if there are source files to regenerate from; otherwise it falls through to LlmSummary
> 
> 3. Create tests/unit/chat/RegenerateFromSource.test.ts:
>    - Test: _extractFilePaths finds .ts, .py, .json paths in messages
>    - Test: canApply returns true when messages contain file paths
>    - Test: canApply returns false when no file paths are present
>    - Test: apply produces a regenerated summary with file and git sections
>    - Test: apply falls through gracefully when files don't exist (mock fs)
>    - Test: apply respects maxSummaryTokens budget
>    - Mock child_process for git commands, mock fs for file reads
> 
> CONVENTIONS:
> - All file system and git operations must have timeouts and error handling
> - The strategy must work on any OS (use path.join, not hardcoded separators)
> - Follow CompactionStrategy interface exactly (see existing strategies in CompactionStrategy.ts)
> - Use the estimateTokensForMessages helper for token counting

---

#### 2.4 -- Enhanced PromptBuilder with Hierarchical Relevance Scoring

**Objective**: Upgrade PromptBuilder to score sections by multiple relevance signals (semantic similarity to current query, temporal recency, explicit user mentions, section priority) so that the most relevant context is always included under budget, not just the highest-static-priority content.

**Files**:
- Modify: `src/chat/PromptBuilder.ts`
- Modify: `src/chat/PromptBuilder.types.ts`
- Create: `src/chat/RelevanceScorer.ts`
- Create: `tests/unit/chat/RelevanceScorer.test.ts`

**Prompt**:
> You are upgrading Gemma-Code's PromptBuilder with hierarchical relevance scoring. Currently, sections are packed greedily by static priority (lower number = higher priority). This means low-priority sections are always dropped first, even if they are more relevant to the current query.
> 
> CONTEXT:
> - src/chat/PromptBuilder.ts: build(context) collects sections, separates always-include from conditional, sorts conditional by priority ascending, packs greedily. PromptSection has { id, content, priority, alwaysInclude, estimatedTokens }.
> - src/chat/PromptBuilder.types.ts: PromptContext and PromptSection interfaces
> - src/storage/EmbeddingClient.ts: embed(text) -> number[] via Ollama nomic-embed-text
> 
> TASK:
> 1. Create src/chat/RelevanceScorer.ts:
>    - RelevanceScorer class:
>      - Constructor takes optional EmbeddingClient (can be null for environments without embeddings)
>      - async scoreSection(section: PromptSection, context: ScoringContext): Promise<number>
>        Returns a combined relevance score in [0, 1] computed from:
>        a. staticPriority (weight 0.3): Normalize section.priority to [0,1] where priority 0 maps to 1.0 and priority 100 maps to 0.0
>        b. temporalRecency (weight 0.2): If context.currentTimestamp and section has a lastRelevantAt field, compute recency decay: 1.0 for <1 hour, 0.8 for <6 hours, 0.5 for <24 hours, 0.2 for older
>        c. semanticSimilarity (weight 0.3): If embedder available and context.currentQuery provided, compute cosine similarity between query embedding and section content embedding. If embedder unavailable, default to 0.5.
>        d. userMention (weight 0.2): If context.recentUserMessage contains keywords from the section.id or section content (simple keyword overlap), score 1.0. Otherwise 0.0.
>      - Cache embeddings for section content (they don't change within a build call)
>      - The weights should be configurable via a ScoringWeights interface
>    - ScoringContext interface: { currentQuery?: string; currentTimestamp: number; recentUserMessage?: string }
>    - ScoringWeights interface: { staticPriority: number; temporalRecency: number; semanticSimilarity: number; userMention: number } (must sum to 1.0)
> 
> 2. Modify src/chat/PromptBuilder.types.ts:
>    - Add optional fields to PromptSection: lastRelevantAt?: number
>    - Add to PromptContext: currentQuery?: string; recentUserMessage?: string; relevanceScorer?: RelevanceScorer (import type)
> 
> 3. Modify src/chat/PromptBuilder.ts:
>    - In build(), if context.relevanceScorer is provided:
>      a. Score all conditional sections using the scorer
>      b. Sort by relevance score descending (instead of by static priority ascending)
>      c. Pack greedily in score order
>    - If no relevanceScorer, fall back to current behavior (sort by priority)
>    - The method becomes async: async build(context): Promise<string>
>    - Update buildForSubAgent to await the build call
> 
> 4. Create tests/unit/chat/RelevanceScorer.test.ts:
>    - Test: staticPriority scoring maps priority 0 -> 1.0, priority 50 -> 0.5
>    - Test: userMention scoring finds keyword overlap
>    - Test: combined score respects weights
>    - Test: scorer without embedder defaults semantic similarity to 0.5
>    - Test: caching avoids duplicate embedding calls
>    - Test: PromptBuilder with scorer packs higher-scored sections first
> 
> IMPORTANT: Making build() async is a significant change. Ensure all callers of PromptBuilder.build() are updated to await the result. Grep for all call sites.
> 
> CONVENTIONS:
> - RelevanceScorer must work without embeddings (graceful degradation)
> - The scoring is deterministic given the same inputs (no randomness)
> - Keep the always-include sections logic unchanged (they bypass scoring)

---

#### 2.5 -- Chat History Syncing for Semantic Self-Search

**Objective**: Sync the conversation to local JSONL files alongside the SQLite storage, enabling the agent to search its own conversation history using grep_codebase and enabling future semantic search over past sessions.

**Files**:
- Create: `src/storage/ConversationSync.ts`
- Create: `tests/unit/storage/ConversationSync.test.ts`
- Modify: `src/chat/ConversationManager.ts` (add sync hook)

**Prompt**:
> You are implementing conversation syncing for Gemma-Code. Conversations are persisted to SQLite (ChatHistoryStore), but they cannot be searched by the agent's own grep_codebase tool. By syncing to JSONL files in the workspace, the agent gains the ability to search its own history.
> 
> CONTEXT:
> - src/chat/ConversationManager.ts: _append() adds messages. Has onDidChange event. _sessionId tracks current session. _store is ChatHistoryStore.
> - src/storage/ChatHistoryStore.ts: SQLite-backed, has searchFts() for FTS5 search
> - Workspace root: vscode.workspace.workspaceFolders[0].uri.fsPath
> - Agent's grep_codebase tool searches files in the workspace
> 
> TASK:
> 1. Create src/storage/ConversationSync.ts:
>    - ConversationSync class:
>      - Constructor takes: syncDir (string, e.g., "{workspace}/.gemma-code/sessions")
>      - syncMessage(sessionId: string, message: Message): void
>        a. Append to {syncDir}/{sessionId}.jsonl as one JSON line per message
>        b. Format: {"id":"...","role":"...","content":"...","timestamp":1234567890}
>        c. Create the directory if it doesn't exist
>        d. Use appendFileSync for simplicity (messages are small)
>      - syncSession(sessionId: string, messages: Message[]): void
>        a. Write all messages at once (used for initial sync or after compaction)
>        b. Overwrites the file (not append)
>      - deleteSession(sessionId: string): void
>        a. Remove the JSONL file
>      - getSessionPath(sessionId: string): string -- returns the file path
>      - listSyncedSessions(): string[] -- returns session IDs from filenames
> 
> 2. Modify src/chat/ConversationManager.ts:
>    - Add optional ConversationSync parameter to constructor
>    - In _append(): after pushing the message, if sync is available, call sync.syncMessage(sessionId, message)
>    - In replaceMessages(): after replacing, call sync.syncSession(sessionId, messages) to rewrite the file
>    - In clearHistory(): sync the new empty session
> 
> 3. Create tests/unit/storage/ConversationSync.test.ts:
>    - Test: syncMessage creates directory and appends JSONL line
>    - Test: syncMessage appends multiple messages to same file
>    - Test: syncSession overwrites file with all messages
>    - Test: deleteSession removes file
>    - Test: listSyncedSessions returns session IDs from filenames
>    - Use os.tmpdir() for test directory
> 
> 4. Add ".gemma-code/" to the project's .gitignore template documentation (the sessions directory should not be committed)
> 
> CONVENTIONS:
> - JSONL format (one JSON object per line, newline-terminated)
> - File operations must be synchronous (append is fast for single messages) or use writeFile with error handling
> - Session ID is used as filename (UUID format, safe for filenames)
> - The sync is fire-and-forget: errors are logged but never throw

---

#### 2.T -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 2. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 2. Include unit tests for lazy tool loading, output redirection, regenerate-from-source compaction, relevance scoring, and chat history syncing.
> Run the tests, fix all failures, and iterate until every test passes with 80%+ coverage.
> Do not advance to Phase 3 until this phase is fully verified.
> After all tests pass, run /generate-session-history to document this phase.

---

### Phase 2 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing (80%+ coverage)
- [ ] No known regressions from prior phases
- [ ] Session history generated for this phase
- [ ] Ready to advance to Phase 3

---

## Phase 3: Graph-Vector Hybrid Memory

**Goal**: Implement 4-layer memory stack (working/episodic/semantic/graph) with entity extraction, provenance tracking, and memory consolidation.
**Prerequisites**: Phase 2 (context engineering provides the retrieval and budgeting infrastructure memory layers plug into).
**Stability Gate**: Working memory shows current task state in prompt. Episodic memory records and retrieves session events. Graph memory extracts entities/relations and answers multi-hop queries. Consolidation promotes recurring patterns to semantic memory.

### Sub-tasks

#### 3.1 -- Memory Layer Architecture and Type Definitions

**Objective**: Define the 4-layer memory architecture types and interfaces (working, episodic, semantic, graph) with provenance tracking, TTL, and staleness detection. This is the type foundation for all subsequent memory sub-tasks.

**Files**:
- Create: `src/storage/MemoryLayers.types.ts`
- Modify: `src/storage/MemoryStore.types.ts` (extend with provenance, TTL, layer types)

**Prompt**:
> You are defining the type architecture for Gemma-Code's 4-layer memory system. This replaces the flat MemoryType system with a layered architecture while maintaining backward compatibility.
> 
> CONTEXT:
> - Current src/storage/MemoryStore.types.ts: MemoryType = "decision" | "fact" | "preference" | "file_pattern" | "error_resolution". MemoryEntry has: id, sessionId, content, type, embedding, createdAt, accessedAt, accessCount, relevanceDecay.
> - Current MemoryStore.ts: SQLite with FTS5, optional embeddings via Ollama, save/search/retrieve/prune APIs
> - The 4-layer design:
>   Layer 1 (Working Memory): In-context JSON, ephemeral, ~5-10KB
>   Layer 2 (Episodic Memory): Session logs as JSONL with timestamps
>   Layer 3 (Semantic Memory): Vector embeddings (already partially implemented)
>   Layer 4 (Graph/Relational): Entity-relationship triples
> 
> TASK:
> 1. Create src/storage/MemoryLayers.types.ts:
> 
>    // --- Provenance ---
>    interface MemoryProvenance {
>      readonly source: "user_stated" | "tool_verified" | "llm_extracted" | "pattern_detected" | "consolidated";
>      readonly sourceSessionId: string | null;
>      readonly sourceMessageId: string | null;
>      readonly timestamp: number;
>      readonly confidence: number;  // 0.0 to 1.0
>    }
> 
>    // --- Write Policy ---
>    type WritePolicy = "user_requested" | "tool_verified" | "pattern_recurring" | "always";
>    interface WriteGate {
>      readonly policy: WritePolicy;
>      readonly minRecurrences: number;      // for pattern_recurring, default 2
>      readonly requireVerification: boolean; // must be confirmed by tool result
>    }
> 
>    // --- TTL and Staleness ---
>    interface MemoryTTL {
>      readonly createdAt: number;
>      readonly expiresAt: number | null;    // null = no expiry
>      readonly lastVerifiedAt: number;
>      readonly staleAfterMs: number;        // mark stale after this duration without access
>    }
>    function isStale(ttl: MemoryTTL, now?: number): boolean;
>    function isExpired(ttl: MemoryTTL, now?: number): boolean;
> 
>    // --- Layer 1: Working Memory ---
>    interface WorkingMemoryState {
>      currentTask: string | null;
>      openFiles: string[];
>      recentErrors: Array<{ file: string; error: string; timestamp: number }>;
>      architecturalDecisions: Array<{ decision: string; rationale: string; timestamp: number }>;
>      activeGoals: string[];
>      scratchpad: Record<string, unknown>;  // free-form key-value for agent use
>    }
> 
>    // --- Layer 2: Episodic Memory ---
>    interface EpisodicEntry {
>      readonly id: string;
>      readonly sessionId: string;
>      readonly action: string;           // what happened
>      readonly context: string;          // surrounding context
>      readonly outcome: string | null;   // result
>      readonly timestamp: number;
>      readonly provenance: MemoryProvenance;
>      readonly tags: readonly string[];
>    }
> 
>    // --- Layer 3: Semantic Memory (extends existing MemoryEntry) ---
>    // The existing MemoryEntry is the Layer 3 type. Add provenance and TTL fields.
>    interface SemanticMemoryEntry extends MemoryEntry {
>      readonly provenance: MemoryProvenance;
>      readonly ttl: MemoryTTL;
>      readonly scope: "global" | "project" | "session";
>    }
> 
>    // --- Layer 4: Graph Memory ---
>    interface GraphEntity {
>      readonly id: string;
>      readonly name: string;
>      readonly type: EntityType;
>      readonly properties: Record<string, unknown>;
>      readonly firstSeenAt: number;
>      readonly lastSeenAt: number;
>      readonly mentionCount: number;
>    }
>    type EntityType = "file" | "function" | "class" | "module" | "variable" | "concept" | "person" | "technology" | "error" | "decision";
> 
>    interface GraphRelation {
>      readonly id: string;
>      readonly sourceId: string;
>      readonly targetId: string;
>      readonly type: RelationType;
>      readonly weight: number;           // 0.0 to 1.0
>      readonly provenance: MemoryProvenance;
>      readonly firstSeenAt: number;
>      readonly lastSeenAt: number;
>    }
>    type RelationType = "imports" | "calls" | "extends" | "implements" | "depends_on" | "causes" | "resolves" | "related_to" | "modifies" | "tests" | "decided_for" | "decided_against";
> 
>    // --- Unified Query ---
>    interface MemoryQuery {
>      readonly query: string;
>      readonly layers: readonly MemoryLayerId[];  // which layers to search
>      readonly tokenBudget: number;
>      readonly maxResults: number;
>      readonly includeStale: boolean;
>    }
>    type MemoryLayerId = "working" | "episodic" | "semantic" | "graph";
> 
>    interface MemoryQueryResult {
>      readonly entries: readonly MemoryResultEntry[];
>      readonly totalTokens: number;
>      readonly layerCounts: Record<MemoryLayerId, number>;
>    }
>    interface MemoryResultEntry {
>      readonly layer: MemoryLayerId;
>      readonly content: string;
>      readonly score: number;
>      readonly provenance: MemoryProvenance;
>    }
> 
> 2. Modify src/storage/MemoryStore.types.ts:
>    - Add provenance?: MemoryProvenance to the existing MemoryEntry interface (optional for backward compatibility)
>    - Add ttl?: MemoryTTL
>    - Add scope?: "global" | "project" | "session"
>    - Re-export the new types from MemoryLayers.types.ts
> 
> CONVENTIONS:
> - All interfaces use readonly fields
> - Types are pure (no runtime code in .types.ts files)
> - The existing MemoryType union stays unchanged for backward compatibility
> - Use `import type` everywhere
> - isStale and isExpired are pure utility functions exported alongside the types

---

#### 3.2 -- Working Memory Manager (Layer 1)

**Objective**: Implement the in-context working memory layer -- a lightweight JSON state that tracks the agent's current task, open files, recent errors, and active decisions, serialized directly into the system prompt's memory section.

**Files**:
- Create: `src/storage/WorkingMemory.ts`
- Create: `tests/unit/storage/WorkingMemory.test.ts`
- Modify: `src/chat/PromptBuilder.ts` (inject working memory into prompt)
- Modify: `src/tools/AgentLoop.ts` (update working memory after tool calls)

**Prompt**:
> You are implementing Layer 1 (Working Memory) for Gemma-Code. Working memory is an ephemeral JSON object that lives in the system prompt, giving the model awareness of its current state. It is NOT persisted to disk -- it exists only for the current session.
> 
> CONTEXT:
> - MemoryLayers.types.ts (sub-task 3.1): WorkingMemoryState interface with currentTask, openFiles, recentErrors, architecturalDecisions, activeGoals, scratchpad
> - src/chat/PromptBuilder.ts: _buildMemorySection(context) creates a memory prompt section at priority 30
> - src/tools/AgentLoop.ts: tracks _modifiedFiles, _recentToolResults, executes tool calls in sequence
> - src/config/PromptBudget.ts: memoryBudget (3% of context = ~3900 tokens for 128K)
> 
> TASK:
> 1. Create src/storage/WorkingMemory.ts:
>    - WorkingMemory class:
>      - Private _state: WorkingMemoryState initialized to all-empty
>      - setCurrentTask(task: string | null): void
>      - addOpenFile(path: string): void -- add if not already present, cap at 10 files
>      - removeOpenFile(path: string): void
>      - addRecentError(file: string, error: string): void -- add to array, cap at 5 most recent
>      - addDecision(decision: string, rationale: string): void -- cap at 5
>      - setActiveGoals(goals: string[]): void
>      - setScratchpad(key: string, value: unknown): void
>      - getScratchpad(key: string): unknown
>      - getState(): Readonly<WorkingMemoryState>
>      - serialize(maxTokens: number): string
>        a. Produce a compact markdown format:
>           "## Working Memory\n\n**Task**: {currentTask}\n**Open files**: {comma-separated}\n**Recent errors**: {list}\n**Decisions**: {list}\n**Goals**: {list}"
>        b. If the serialized form exceeds maxTokens (estimated at chars/4), truncate least-important sections (scratchpad first, then goals, then errors)
>        c. Target: 5-10KB (1250-2500 tokens)
>      - clear(): void -- reset to empty state
>      - toJSON(): string -- JSON.stringify of state for debugging
>    - Export a factory: createWorkingMemory(): WorkingMemory
> 
> 2. Modify src/chat/PromptBuilder.ts:
>    - Add workingMemory?: WorkingMemory to PromptContext
>    - In _buildMemorySection: if context.workingMemory is provided, prepend its serialized form before the recalled memories section. The working memory gets higher priority within the memory budget.
> 
> 3. Modify src/tools/AgentLoop.ts:
>    - Accept optional WorkingMemory in constructor options
>    - After each tool call:
>      a. If tool is read_file: call workingMemory.addOpenFile(path)
>      b. If tool is write_file/edit_file/create_file: call workingMemory.addOpenFile(path)
>      c. If tool result has success=false: call workingMemory.addRecentError(toolName, error)
>    - On first user message in a session: extract task intent (first sentence) and call setCurrentTask
> 
> 4. Create tests/unit/storage/WorkingMemory.test.ts:
>    - Test: initial state is empty
>    - Test: setCurrentTask updates state
>    - Test: addOpenFile caps at 10
>    - Test: addRecentError caps at 5
>    - Test: serialize produces valid markdown
>    - Test: serialize truncates within token budget
>    - Test: clear resets all state
>    - Test: addOpenFile deduplicates
> 
> CONVENTIONS:
> - WorkingMemory is ephemeral -- no disk I/O
> - It must be lightweight (no async operations)
> - Cap all arrays to prevent unbounded growth
> - Follow the MemoryStore pattern for the class structure

---

#### 3.3 -- Episodic Memory Layer (Layer 2)

**Objective**: Implement session-level episodic memory that records significant events (tool executions, decisions, errors, discoveries) as structured JSONL entries with provenance, enabling cross-session learning about what worked and what did not.

**Files**:
- Create: `src/storage/EpisodicMemory.ts`
- Create: `tests/unit/storage/EpisodicMemory.test.ts`
- Modify: `src/tools/AgentLoop.ts` (record episodic events after tool calls)

**Prompt**:
> You are implementing Layer 2 (Episodic Memory) for Gemma-Code. Episodic memory records significant events from sessions as structured entries that can be retrieved to inform future sessions.
> 
> CONTEXT:
> - MemoryLayers.types.ts (sub-task 3.1): EpisodicEntry interface with id, sessionId, action, context, outcome, timestamp, provenance, tags
> - src/storage/MemoryStore.ts: uses SQLite (better-sqlite3) with FTS5 and optional embeddings
> - src/storage/EmbeddingClient.ts: embed(text) for vector search
> - src/tools/AgentLoop.ts: executes tool calls, tracks modified files, emits postMessage events
> - The existing ChatHistoryStore stores raw messages; episodic memory stores structured events
> 
> TASK:
> 1. Create src/storage/EpisodicMemory.ts:
>    - EpisodicMemory class:
>      - Constructor takes: dbPath (string, will be same SQLite DB as MemoryStore), embedder (EmbeddingClient | null)
>      - _initSchema(): Create table `episodic_events`:
>        CREATE TABLE IF NOT EXISTS episodic_events (
>          id TEXT PRIMARY KEY,
>          session_id TEXT NOT NULL,
>          action TEXT NOT NULL,
>          context TEXT NOT NULL,
>          outcome TEXT,
>          timestamp INTEGER NOT NULL,
>          source TEXT NOT NULL,        -- provenance source
>          confidence REAL DEFAULT 1.0,
>          tags TEXT,                   -- JSON array stored as text
>          embedding BLOB
>        );
>        CREATE VIRTUAL TABLE IF NOT EXISTS episodic_fts USING fts5(action, context, outcome, content=episodic_events, content_rowid=rowid);
>        Plus appropriate triggers for FTS sync (follow MemoryStore pattern)
> 
>      - async record(event: Omit<EpisodicEntry, "id">): Promise<EpisodicEntry>
>        a. Generate UUID for id
>        b. Compute embedding of "{action} {context} {outcome}" if embedder available
>        c. Insert into episodic_events
>        d. Return the complete entry
> 
>      - searchKeyword(query: string, limit: number): EpisodicEntry[]
>        Use FTS5 MATCH with BM25 ranking (follow MemoryStore.searchKeyword pattern)
> 
>      - async searchSemantic(query: string, limit: number): Promise<EpisodicEntry[]>
>        Cosine similarity search (follow MemoryStore.searchSemantic pattern)
> 
>      - async retrieve(query: string, tokenBudget: number): Promise<string>
>        Merge keyword + semantic results, deduplicate, format as:
>        "## Past Experiences\n\n- [action] context -> outcome (confidence: 0.9)\n- ..."
>        Pack within tokenBudget
> 
>      - getSessionEvents(sessionId: string): EpisodicEntry[]
>        All events for a specific session, ordered by timestamp
> 
>      - prune(maxEntries: number): number -- remove oldest entries exceeding limit
> 
>      - close(): void
> 
>    - Helper: recordToolEvent(sessionId, toolName, parameters, result, contextDescription): Promise<EpisodicEntry>
>      Creates an EpisodicEntry with:
>      - action: "{toolName}({key params})"
>      - context: contextDescription
>      - outcome: result.success ? result.output.slice(0,200) : result.error
>      - provenance: { source: "tool_verified", confidence: result.success ? 0.9 : 0.5 }
>      - tags: [toolName, ...extracted keywords]
> 
>    - Helper: recordDecisionEvent(sessionId, decision, rationale): Promise<EpisodicEntry>
> 
> 2. Modify src/tools/AgentLoop.ts:
>    - Accept optional EpisodicMemory in AgentLoopOptions
>    - After each successful tool call, call recordToolEvent
>    - Only record events for "significant" tool calls: write_file, edit_file, create_file, run_terminal, grep_codebase (not read_file or list_directory which are too frequent)
> 
> 3. Create tests/unit/storage/EpisodicMemory.test.ts:
>    - Test: record creates entry with generated ID
>    - Test: searchKeyword finds relevant events
>    - Test: searchSemantic works with mock embedder
>    - Test: retrieve formats events within token budget
>    - Test: getSessionEvents returns chronological order
>    - Test: prune removes oldest events
>    - Test: recordToolEvent helper creates correct entry structure
>    - Use ":memory:" SQLite database for tests
> 
> CONVENTIONS:
> - Share the SQLite database file with MemoryStore (different tables in same DB)
> - Follow MemoryStore patterns exactly for FTS5 setup, embedding storage, and search
> - Provenance must be set on every entry
> - Tags are stored as JSON array text in SQLite

---

#### 3.4 -- Graph Memory Layer -- Schema and Entity Extraction (Layer 4, Part A)

**Objective**: Implement the graph layer's SQLite schema and entity extraction pipeline that identifies entities (files, functions, classes, concepts, technologies) and relationships from conversation text, building a knowledge graph over time.

**Files**:
- Create: `src/storage/GraphMemory.ts`
- Create: `src/storage/EntityExtractor.ts`
- Create: `tests/unit/storage/GraphMemory.test.ts`
- Create: `tests/unit/storage/EntityExtractor.test.ts`

**Prompt**:
> You are implementing the Graph Memory layer (Layer 4) for Gemma-Code. This is Part A: the SQLite schema for entities and relations, plus the entity extraction pipeline that identifies entities from conversation text without requiring an LLM call.
> 
> CONTEXT:
> - MemoryLayers.types.ts (sub-task 3.1): GraphEntity (id, name, type, properties, firstSeenAt, lastSeenAt, mentionCount), GraphRelation (id, sourceId, targetId, type, weight, provenance), EntityType and RelationType unions
> - The graph must be entirely local (SQLite, no external graph DB)
> - MemoryStore.ts pattern: better-sqlite3, WAL mode, FTS5, transactions
> - The entity extractor must be fast (regex + heuristic, no LLM calls) since it runs on every compaction
> 
> TASK:
> 1. Create src/storage/GraphMemory.ts:
>    - GraphMemory class:
>      - Constructor takes: db (Database instance, shared with MemoryStore)
>      - _initSchema():
>        CREATE TABLE IF NOT EXISTS graph_entities (
>          id TEXT PRIMARY KEY,
>          name TEXT NOT NULL,
>          type TEXT NOT NULL,
>          properties TEXT DEFAULT '{}',  -- JSON
>          first_seen_at INTEGER NOT NULL,
>          last_seen_at INTEGER NOT NULL,
>          mention_count INTEGER DEFAULT 1,
>          UNIQUE(name, type)
>        );
>        CREATE TABLE IF NOT EXISTS graph_relations (
>          id TEXT PRIMARY KEY,
>          source_id TEXT NOT NULL REFERENCES graph_entities(id),
>          target_id TEXT NOT NULL REFERENCES graph_entities(id),
>          type TEXT NOT NULL,
>          weight REAL DEFAULT 0.5,
>          source TEXT NOT NULL,           -- provenance source
>          confidence REAL DEFAULT 0.5,
>          first_seen_at INTEGER NOT NULL,
>          last_seen_at INTEGER NOT NULL,
>          UNIQUE(source_id, target_id, type)
>        );
>        CREATE INDEX IF NOT EXISTS idx_relations_source ON graph_relations(source_id);
>        CREATE INDEX IF NOT EXISTS idx_relations_target ON graph_relations(target_id);
>        CREATE INDEX IF NOT EXISTS idx_entities_type ON graph_entities(type);
> 
>      - upsertEntity(name: string, type: EntityType, properties?: Record<string, unknown>): GraphEntity
>        INSERT OR UPDATE: if entity with same (name, type) exists, increment mention_count and update last_seen_at. Otherwise create new with generated ID.
>      
>      - upsertRelation(sourceName: string, sourceType: EntityType, targetName: string, targetType: EntityType, relationType: RelationType, provenance: MemoryProvenance): GraphRelation
>        First upsert both entities, then upsert the relation. If relation exists, increase weight by 0.1 (cap at 1.0) and update last_seen_at.
> 
>      - getEntity(name: string, type?: EntityType): GraphEntity | null
>      - getEntityRelations(entityId: string, direction?: "outgoing" | "incoming" | "both"): GraphRelation[]
>      - findRelatedEntities(entityName: string, depth: number): GraphEntity[]
>        BFS traversal up to `depth` hops from the named entity. Returns all reachable entities. Cap at 50 results.
> 
>      - searchEntities(query: string, type?: EntityType, limit?: number): GraphEntity[]
>        LIKE search on entity names
> 
>      - getStats(): { entityCount: number; relationCount: number; byType: Record<string, number> }
>      - prune(minMentions: number, olderThanMs: number): number -- Remove entities with mentionCount < minMentions AND lastSeenAt < now - olderThanMs
> 
> 2. Create src/storage/EntityExtractor.ts:
>    - EntityExtractor class:
>      - extractFromText(text: string): ExtractedEntity[]
>        Uses regex patterns to identify:
>        a. File paths: /[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\.[a-zA-Z]+/ -> type "file"
>        b. Function/method names: /(?:function|def|fn|func|method)\s+(\w+)/ -> type "function"
>        c. Class/interface names: /(?:class|interface|struct|enum|type)\s+(\w+)/ -> type "class"
>        d. Import/module references: /(?:import|require|from)\s+['"]([^'"]+)['"]/ -> type "module"
>        e. Technology names: Match against a curated list of 50+ common technologies (React, TypeScript, SQLite, Ollama, Express, FastAPI, etc.) -> type "technology"
>        f. Error patterns: /(?:Error|Exception|FAIL):\s*(.+)/ -> type "error"
>        g. Decision markers: /(?:decided to|going with|chose)\s+(.+)/i -> type "decision"
> 
>      - extractRelationsFromText(text: string, entities: ExtractedEntity[]): ExtractedRelation[]
>        Infer relationships from co-occurrence and syntax:
>        a. If two file entities appear in the same sentence with "imports"/"requires" -> "imports" relation
>        b. If a function entity appears near a file entity -> "modifies" relation
>        c. If an error entity co-occurs with a file entity -> "causes" relation
>        d. If a decision entity co-occurs with a technology -> "decided_for" relation
>        e. Proximity-based: entities within 100 characters of each other -> "related_to" with weight 0.3
> 
>    - ExtractedEntity: { name: string; type: EntityType; startIndex: number; endIndex: number }
>    - ExtractedRelation: { source: ExtractedEntity; target: ExtractedEntity; type: RelationType; confidence: number }
> 
> 3. Create tests/unit/storage/GraphMemory.test.ts:
>    - Test: upsertEntity creates new entity
>    - Test: upsertEntity increments mentionCount on duplicate
>    - Test: upsertRelation creates entities and relation
>    - Test: upsertRelation increases weight on duplicate relation
>    - Test: getEntityRelations returns correct direction
>    - Test: findRelatedEntities BFS traversal (3 entities in chain A->B->C, depth 2 from A returns B and C)
>    - Test: prune removes low-mention old entities
>    - Use ":memory:" SQLite
> 
> 4. Create tests/unit/storage/EntityExtractor.test.ts:
>    - Test: extracts file paths from code discussion
>    - Test: extracts function names from "function readFile(path)"
>    - Test: extracts class names from "class MemoryStore"
>    - Test: extracts technology names (TypeScript, SQLite, Ollama)
>    - Test: extracts error patterns
>    - Test: infers import relations between file entities
>    - Test: proximity-based related_to relations
> 
> CONVENTIONS:
> - GraphMemory shares the SQLite database with MemoryStore (pass the same Database instance)
> - All graph operations are synchronous (better-sqlite3 is sync)
> - Entity names are case-sensitive but normalized (trim whitespace)
> - The EntityExtractor must be fast: no LLM calls, pure regex + heuristic

---

#### 3.5 -- Graph Memory -- Multi-Hop Query and Context Formatting (Layer 4, Part B)

**Objective**: Implement graph traversal queries that follow entity relationships across multiple hops, format graph context for injection into the system prompt, and integrate with the existing memory retrieval pipeline.

**Files**:
- Modify: `src/storage/GraphMemory.ts` (add query methods)
- Create: `src/storage/GraphQueryEngine.ts`
- Create: `tests/unit/storage/GraphQueryEngine.test.ts`
- Modify: `src/storage/MemoryStore.ts` (integrate graph results into retrieve())

**Prompt**:
> You are implementing the graph query engine for Gemma-Code's graph memory layer. This builds on the GraphMemory schema (sub-task 3.4) to enable multi-hop reasoning and formatted context injection.
> 
> CONTEXT:
> - GraphMemory (sub-task 3.4): has upsertEntity, upsertRelation, getEntity, getEntityRelations, findRelatedEntities, searchEntities
> - MemoryStore.ts: has retrieve(query, tokenBudget) that merges keyword + semantic results into a formatted string
> - PromptBuilder injects the retrieve() output into the memory section of the system prompt
> - The graph query must answer questions like: "What files depend on MemoryStore?" or "What caused the last build failure?"
> 
> TASK:
> 1. Create src/storage/GraphQueryEngine.ts:
>    - GraphQueryEngine class:
>      - Constructor takes: graphMemory (GraphMemory), embedder (EmbeddingClient | null)
>      
>      - queryByEntity(entityName: string, depth: number, limit: number): GraphQueryResult
>        a. Find the entity by name
>        b. BFS traverse to depth hops
>        c. Collect all entities and relations encountered
>        d. Sort results by: weight * recency_factor (recency = 1.0 for <1 day, 0.7 for <7 days, 0.4 otherwise)
>        e. Return top N results
> 
>      - queryByRelationType(relationType: RelationType, limit: number): GraphQueryResult
>        All relations of a given type, sorted by weight descending
> 
>      - queryContextFor(query: string, limit: number): GraphQueryResult
>        a. Extract entity names from query using EntityExtractor
>        b. For each extracted entity, run queryByEntity with depth=2
>        c. Merge and deduplicate results
>        d. If embedder available, compute semantic similarity between query and entity descriptions to re-rank
> 
>      - formatAsContext(result: GraphQueryResult, maxTokens: number): string
>        Format for injection into the system prompt:
>        "## Knowledge Graph Context\n\n### Entities\n- [file] src/storage/MemoryStore.ts (mentioned 15 times)\n- [class] MemoryStore (mentioned 8 times)\n\n### Relationships\n- MemoryStore.ts --imports--> EmbeddingClient.ts\n- MemoryStore --depends_on--> better-sqlite3\n- PromptBuilder --calls--> MemoryStore.retrieve()\n\n### Related Context\n- MemoryStore was modified in session abc123 to add FTS5 support"
>        Truncate to fit maxTokens
> 
>      - explainPath(from: string, to: string, maxDepth: number): PathExplanation | null
>        Find shortest path between two entities using BFS.
>        Return: { path: GraphEntity[], relations: GraphRelation[], explanation: string }
>        The explanation is a natural-language sentence: "MemoryStore depends on EmbeddingClient which uses Ollama for embeddings"
> 
>    - GraphQueryResult interface: { entities: GraphEntity[]; relations: GraphRelation[]; totalWeight: number }
>    - PathExplanation interface: { path: GraphEntity[]; relations: GraphRelation[]; explanation: string }
> 
> 2. Modify src/storage/MemoryStore.ts retrieve():
>    - Accept optional GraphQueryEngine parameter (or set via a setter method)
>    - In retrieve(), after merging keyword + semantic results:
>      a. If graph engine is available, call graphEngine.queryContextFor(query, 10)
>      b. Format graph results and append to the output string
>      c. The graph context gets up to 25% of the total tokenBudget
>    - This extends the existing retrieve() without breaking its signature (the graphEngine is injected separately)
> 
> 3. Create tests/unit/storage/GraphQueryEngine.test.ts:
>    - Setup: create a small graph with 5 entities and 6 relations
>    - Test: queryByEntity returns correct depth-limited subgraph
>    - Test: queryByRelationType filters correctly
>    - Test: queryContextFor extracts entities from query and traverses
>    - Test: formatAsContext produces valid markdown within token limit
>    - Test: explainPath finds shortest path between two entities
>    - Test: explainPath returns null when no path exists
>    - Test: results are sorted by weight * recency
> 
> CONVENTIONS:
> - All graph traversals must have a hard cap (max 100 nodes visited) to prevent runaway BFS
> - The query engine must handle missing entities gracefully (return empty results, not throw)
> - Format output matches the existing "## Recalled Memories" format from MemoryStore.retrieve()
> - The graph engine is pure (no vscode imports)

---

#### 3.6 -- Memory Consolidation and Write Policy Enforcement

**Objective**: Implement the memory consolidation pipeline that recognizes recurring patterns across sessions, promotes them to semantic memory, and enforces the write policy (persist only if user-requested, tool-verified, or pattern recurred 2+ times).

**Files**:
- Create: `src/storage/MemoryConsolidator.ts`
- Create: `tests/unit/storage/MemoryConsolidator.test.ts`
- Modify: `src/storage/MemoryStore.ts` (add write gate enforcement)
- Modify: `src/chat/ContextCompactor.ts` (trigger consolidation during compaction)

**Prompt**:
> You are implementing the memory consolidation pipeline for Gemma-Code. Consolidation detects recurring patterns in episodic memory and promotes them to persistent semantic memory, enforcing a strict write policy to prevent memory pollution.
> 
> CONTEXT:
> - MemoryLayers.types.ts (sub-task 3.1): WriteGate { policy, minRecurrences, requireVerification }, MemoryProvenance
> - EpisodicMemory (sub-task 3.3): stores session events, searchKeyword, getSessionEvents
> - MemoryStore.ts: save(content, type, sessionId), searchKeyword, _isDuplicate
> - GraphMemory (sub-task 3.4): upsertEntity, upsertRelation
> - EntityExtractor (sub-task 3.4): extractFromText, extractRelationsFromText
> - ContextCompactor.ts: has _preCompactionHook that currently calls MemoryStore.extractAndSave
> 
> TASK:
> 1. Create src/storage/MemoryConsolidator.ts:
>    - MemoryConsolidator class:
>      - Constructor takes: memoryStore (MemoryStore), episodicMemory (EpisodicMemory), graphMemory (GraphMemory), entityExtractor (EntityExtractor), writeGate (WriteGate)
> 
>      - async consolidate(sessionId: string): ConsolidationReport
>        Main entry point. Runs the full consolidation pipeline:
>        a. Gather: get all episodic events from the session
>        b. Extract: run entityExtractor on all event texts to find entities and relations
>        c. Graph update: upsert all extracted entities and relations into graphMemory
>        d. Pattern detection: check episodic memory for recurring patterns:
>           - Group events by (action, simplified context) using fuzzy matching (Levenshtein or token overlap > 70%)
>           - If a pattern appears >= writeGate.minRecurrences times across different sessions, it qualifies for promotion
>        e. Promotion: for qualifying patterns, create a semantic memory entry:
>           - content: "Pattern: {action} in context {context} typically results in {most common outcome}"
>           - type: infer from action (tool_verified events -> "fact", decisions -> "decision", errors -> "error_resolution")
>           - provenance: { source: "pattern_detected", confidence: min(0.95, 0.5 + 0.1 * occurrences) }
>        f. Write gate: before saving to memoryStore, enforce the write policy:
>           - "user_requested": only save if event has provenance.source === "user_stated"
>           - "tool_verified": only save if event has provenance.source === "tool_verified"
>           - "pattern_recurring": only save if pattern count >= minRecurrences
>           - "always": save everything (for development/testing)
>        g. Deduplication: check memoryStore._isDuplicate (or expose a public method) before saving
>        h. Return report: { entitiesAdded, relationsAdded, patternsDetected, memoriesPromoted, memoriesSkipped }
> 
>      - detectPatterns(events: EpisodicEntry[]): DetectedPattern[]
>        Group similar events and return patterns with occurrence counts
>        DetectedPattern: { action: string; context: string; outcome: string | null; occurrences: number; sessionIds: string[]; confidence: number }
> 
>      - shouldPersist(pattern: DetectedPattern, gate: WriteGate): boolean
>        Apply write gate rules to determine if a pattern should be promoted
> 
>      - async promoteToMemory(pattern: DetectedPattern): Promise<SemanticMemoryEntry | null>
>        Create and save the semantic memory entry
> 
>    - ConsolidationReport interface: { entitiesAdded: number; relationsAdded: number; patternsDetected: number; memoriesPromoted: number; memoriesSkipped: number; errors: string[] }
> 
> 2. Modify src/storage/MemoryStore.ts:
>    - Make _isDuplicate public (rename to isDuplicate) so consolidator can use it
>    - Add method: saveWithProvenance(content, type, provenance, ttl?, scope?, sessionId?): Promise<SemanticMemoryEntry>
>      Like save() but accepts the full provenance and TTL fields from sub-task 3.1
>    - Add the provenance and ttl columns to the memories table schema (backward-compatible: nullable columns)
> 
> 3. Modify src/chat/ContextCompactor.ts:
>    - Extend the _preCompactionHook to also run consolidation:
>      After extractAndSave (which handles immediate extraction), run consolidator.consolidate(sessionId)
>    - This means the consolidator is injected alongside the memoryStore in the hook
> 
> 4. Create tests/unit/storage/MemoryConsolidator.test.ts:
>    - Test: consolidate extracts entities from episodic events
>    - Test: consolidate upserts entities and relations to graph
>    - Test: detectPatterns groups similar events (same action, similar context)
>    - Test: detectPatterns requires minimum occurrences
>    - Test: shouldPersist enforces "pattern_recurring" write gate
>    - Test: shouldPersist allows "user_requested" events
>    - Test: promoteToMemory creates semantic entry with correct provenance
>    - Test: consolidate respects deduplication
>    - Test: consolidationReport has correct counts
>    - Mock all dependencies (MemoryStore, EpisodicMemory, GraphMemory)
> 
> CONVENTIONS:
> - Pattern similarity uses simple token overlap (intersection / union > 0.7), not LLM calls
> - The consolidator is designed to be called once per compaction, not on every message
> - All database operations use transactions for atomicity
> - The write gate is the primary defense against memory pollution

---

#### 3.7 -- Unified Memory Retrieval and Prompt Integration

**Objective**: Create the unified retrieval layer that queries all four memory layers (working, episodic, semantic, graph), merges and ranks results across layers, and produces a single formatted context string for injection into the system prompt within the memory token budget.

**Files**:
- Create: `src/storage/UnifiedMemoryRetriever.ts`
- Create: `tests/unit/storage/UnifiedMemoryRetriever.test.ts`
- Modify: `src/chat/PromptBuilder.ts` (use unified retriever for memory section)
- Modify: `src/panels/GemmaCodePanel.ts` (wire all memory layers together)

**Prompt**:
> You are implementing the unified memory retrieval layer for Gemma-Code. This is the final integration point that ties all four memory layers into a single query interface consumed by the PromptBuilder.
> 
> CONTEXT:
> - WorkingMemory (sub-task 3.2): ephemeral JSON, serialize(maxTokens) -> string
> - EpisodicMemory (sub-task 3.3): SQLite + FTS5, retrieve(query, tokenBudget) -> string
> - MemoryStore (existing, Layer 3): retrieve(query, tokenBudget) -> string with "## Recalled Memories" format
> - GraphQueryEngine (sub-task 3.5): queryContextFor(query, limit) -> GraphQueryResult, formatAsContext(result, maxTokens) -> string
> - MemoryLayers.types.ts: MemoryQuery { query, layers, tokenBudget, maxResults, includeStale }, MemoryQueryResult, MemoryLayerId
> - PromptBudget: memoryBudget is 3-5% of context (3900-6500 tokens for 128K context)
> 
> TASK:
> 1. Create src/storage/UnifiedMemoryRetriever.ts:
>    - UnifiedMemoryRetriever class:
>      - Constructor takes:
>        workingMemory: WorkingMemory | null
>        episodicMemory: EpisodicMemory | null
>        semanticMemory: MemoryStore | null
>        graphEngine: GraphQueryEngine | null
>      - Each layer is optional for graceful degradation
> 
>      - async retrieve(query: MemoryQuery): Promise<string>
>        Main entry point. Distributes the token budget across layers and merges results:
>        a. Budget distribution (configurable but with defaults):
>           - Working memory: 20% of tokenBudget (always first, most important for current context)
>           - Semantic memory: 30% of tokenBudget (facts, decisions, preferences)
>           - Graph memory: 25% of tokenBudget (structural knowledge)
>           - Episodic memory: 25% of tokenBudget (past experiences)
>           - Only requested layers (query.layers) receive budget; unused budget redistributes proportionally
>        b. Query each requested layer in parallel:
>           - Working: workingMemory.serialize(workingBudget)
>           - Semantic: semanticMemory.retrieve(query.query, semanticBudget)
>           - Graph: graphEngine.queryContextFor(query.query, 15) then formatAsContext(result, graphBudget)
>           - Episodic: episodicMemory.retrieve(query.query, episodicBudget)
>        c. Merge results into a single formatted string:
>           "## Memory Context\n\n{working memory section}\n\n{semantic section}\n\n{graph section}\n\n{episodic section}"
>        d. If total exceeds tokenBudget, trim sections in reverse priority (episodic first, then graph, then semantic; never trim working)
>        e. Filter out stale entries unless query.includeStale is true
> 
>      - async retrieveForPrompt(currentQuery: string, maxTokens: number): Promise<string>
>        Convenience method that creates a MemoryQuery with all layers and calls retrieve()
>        This is the method PromptBuilder will call
> 
>      - getLayerStats(): Record<MemoryLayerId, { available: boolean; entryCount: number }>
> 
> 2. Modify src/chat/PromptBuilder.ts:
>    - Change _buildMemorySection:
>      a. If context.unifiedRetriever is provided (new field in PromptContext), call retriever.retrieveForPrompt(context.currentQuery, budget.memoryBudget) to get the memory context
>      b. Fall back to existing context.memoryContext string if no retriever
>    - Add unifiedRetriever?: UnifiedMemoryRetriever to PromptContext in PromptBuilder.types.ts
>    - Since the retriever is async, this makes _buildMemorySection async (build() is already async from sub-task 2.4)
> 
> 3. Modify src/panels/GemmaCodePanel.ts:
>    - In the constructor, after initializing all memory stores:
>      a. Create WorkingMemory instance
>      b. Create EpisodicMemory instance (sharing the SQLite DB)
>      c. Create GraphMemory and EntityExtractor instances
>      d. Create GraphQueryEngine with the graph memory
>      e. Create MemoryConsolidator (sub-task 3.6)
>      f. Create UnifiedMemoryRetriever with all layers
>      g. Pass the retriever to _buildPromptContext()
>    - Wire the WorkingMemory into AgentLoop options
>    - Wire the EpisodicMemory into AgentLoop options
>    - Wire the MemoryConsolidator into the compaction hook
> 
> 4. Create tests/unit/storage/UnifiedMemoryRetriever.test.ts:
>    - Test: retrieve with all layers returns merged context
>    - Test: retrieve with only semantic + graph layers (episodic null)
>    - Test: retrieve distributes budget proportionally
>    - Test: retrieve redistributes budget when some layers are null
>    - Test: retrieve trims episodic first when over budget
>    - Test: retrieveForPrompt calls retrieve with correct defaults
>    - Test: getLayerStats reports correct availability
>    - Mock all four layer dependencies
> 
> CONVENTIONS:
> - All four layers are optional (null) for backward compatibility
> - The retriever never throws; errors in individual layers are caught and that layer returns empty string
> - Token counting uses the chars/4 heuristic consistent with the rest of the codebase
> - The merged output is a single string ready for injection into PromptContext.memoryContext
> - Layer queries run in parallel (Promise.all) for performance

---

#### 3.T -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 3. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 3. Include unit tests for all 4 memory layers, entity extraction, graph queries, memory consolidation, write policy enforcement, and unified retrieval.
> Run the tests, fix all failures, and iterate until every test passes with 80%+ coverage.
> Do not advance to Phase 4 until this phase is fully verified.
> After all tests pass, run /generate-session-history to document this phase.

---

### Phase 3 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing (80%+ coverage)
- [ ] No known regressions from prior phases
- [ ] Session history generated for this phase
- [ ] Ready to advance to Phase 4

---

## Phase 4: Safety, Budgeting & Runaway Prevention

**Goal**: Implement multi-layered safety: hash-based loop detection, irreversible action classification, git safety net, permission tier enforcement, and hard budget caps.
**Prerequisites**: Phase 1 (GPU tiers determine iteration limits) and Phase 3 (episodic memory records safety events).
**Stability Gate**: Loop detector catches a repeated tool call within 3 iterations. Permission tiers block dangerous actions without confirmation. Git safety net auto-commits before agent modifications. Budget middleware terminates session at configured token ceiling.

### Sub-tasks

#### 4.1 -- Sliding Window Hash Loop Detector

**Objective**: Create a `LoopDetector` class that tracks crypto hashes of consecutive tool call payloads. When the same hash appears 3 times within a sliding window of 4 iterations, it injects a system warning into the conversation. If the pattern persists for one more iteration after the warning, it terminates the agent loop.

**Prompt**:
> You are implementing loop detection for the Gemma-Code VS Code extension (TypeScript).
> 
> CONTEXT:
> - The agent loop lives at src/tools/AgentLoop.ts (239 lines). It iterates up to _maxIterations, streaming model responses and executing tool calls sequentially. Tool calls are parsed via parseToolCalls() and executed via this._registry.execute().
> - Each tool call has a ToolCall shape: { tool: ToolName, id: string, parameters: Record<string, unknown> }.
> - The ConversationManager at src/chat/ConversationManager.ts has addSystemMessage() and addUserMessage() methods.
> - Messages are posted to the webview via PostMessageFn from src/chat/StreamingPipeline.ts.
> - The existing webview message types are in src/panels/messages.ts (ExtensionToWebviewMessage union).
> 
> CREATE the following file:
> - src/safety/LoopDetector.ts
> 
> This class must:
> 1. Accept a configurable windowSize (default 4) and repeatThreshold (default 3) in the constructor.
> 2. Expose a record(toolCall: ToolCall): LoopDetectorVerdict method. It computes a SHA-256 hash of JSON.stringify({ tool: call.tool, parameters: call.parameters }) (strip the id since it changes each call). Store hashes in a circular buffer of size windowSize.
> 3. After each record(), count how many of the last windowSize hashes are identical. If count >= repeatThreshold, return { action: 'warn', message: string } on the first occurrence and { action: 'terminate', message: string } if a warn was already issued and the pattern continues.
> 4. Expose a reset() method that clears the buffer and warning state.
> 5. The verdict type should be: { action: 'ok' | 'warn' | 'terminate'; message?: string }.
> 
> MODIFY src/tools/AgentLoop.ts:
> 1. Import LoopDetector.
> 2. Add a _loopDetector: LoopDetector field, instantiated in the constructor.
> 3. In the tool execution loop (after each this._registry.execute() call), call this._loopDetector.record(call). Check the verdict:
>    - If 'warn': inject a system message via this._manager.addUserMessage("[SYSTEM WARNING] Identical tool calls detected...") and post a warning to the webview.
>    - If 'terminate': post an error message and return from run() immediately.
> 4. Reset the loop detector at the start of run().
> 
> CREATE test file:
> - tests/unit/safety/LoopDetector.test.ts with tests for: normal operation (no repeats), warning after threshold, termination after warning persists, reset clears state, different calls do not trigger, and window size boundary cases.
> 
> Follow the existing test patterns from tests/unit/tools/AgentLoop.test.ts (vitest, vi.fn mocking, makeMessage helpers).

---

#### 4.2 -- Permission Tier System

**Objective**: Replace the flat `ToolConfirmationMode` setting and ad-hoc `BLOCKED_PATTERNS` with a formal three-tier permission system: `AUTO_APPROVE` (read-only tools), `CONFIRM` (write/git tools), and `DANGEROUS` (shell execution, network). Each tool is assigned a tier. The ConfirmationGate is consulted only for CONFIRM and DANGEROUS tiers, with DANGEROUS getting an additional prominent warning.

**Prompt**:
> You are implementing a permission tier system for Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - Current tool types are defined in src/tools/types.ts as BuiltinToolName union: "read_file" | "write_file" | "edit_file" | "create_file" | "delete_file" | "list_directory" | "grep_codebase" | "run_terminal" | "web_search" | "fetch_page".
> - ConfirmationGate at src/tools/ConfirmationGate.ts bridges webview confirmations to Promises. It has request(id, description, detail?) which returns Promise<boolean>.
> - ToolActivationRules.ts already classifies tools into NETWORK_TOOLS, WRITE_TOOLS, etc., but only for enable/disable purposes, not for permission enforcement.
> - The ToolRegistry.execute() method at src/tools/ToolRegistry.ts is the central dispatch point.
> - Settings are in src/config/settings.ts (GemmaCodeSettings interface).
> - Tool handlers like RunTerminalTool (src/tools/handlers/terminal.ts) currently handle their own confirmation logic internally.
> 
> CREATE:
> - src/safety/PermissionTiers.ts
> 
> Define:
> 1. An enum PermissionTier { AUTO_APPROVE = 0, CONFIRM = 1, DANGEROUS = 2 }.
> 2. A const TOOL_PERMISSION_MAP: Record<BuiltinToolName, PermissionTier> mapping:
>    - AUTO_APPROVE: read_file, list_directory, grep_codebase
>    - CONFIRM: write_file, edit_file, create_file, delete_file
>    - DANGEROUS: run_terminal, web_search, fetch_page
> 3. A function getPermissionTier(toolName: ToolName): PermissionTier that looks up builtins from the map and defaults MCP tools (prefixed "mcp:") to DANGEROUS.
> 4. A function shouldRequireConfirmation(toolName: ToolName, userOverride?: PermissionTier): boolean that returns false for AUTO_APPROVE, true for CONFIRM and DANGEROUS unless the user has overridden.
> 5. A function getDangerousWarning(toolName: ToolName, parameters: Record<string, unknown>): string that returns a human-readable warning string for DANGEROUS-tier tools (e.g., "This will execute a shell command: {command}").
> 
> MODIFY src/tools/ToolRegistry.ts:
> 1. Import getPermissionTier and shouldRequireConfirmation.
> 2. Add an optional ConfirmationGate parameter to the constructor.
> 3. In execute(), before calling handler.execute(), check the tier. If CONFIRM or DANGEROUS and a gate exists, call gate.request() with an appropriate description. If rejected, return a failure ToolResult.
> 4. This centralizes permission enforcement, so individual handlers (like RunTerminalTool) no longer need to call the gate themselves.
> 
> MODIFY src/tools/handlers/terminal.ts:
> 1. Remove the internal _confirmationGate and _mode fields.
> 2. Remove the confirmation logic from execute().
> 3. Keep the BLOCKED_PATTERNS safety check (this is a hard block, separate from the permission tier).
> 4. Update the constructor to no longer require ConfirmationGate or ConfirmationMode parameters.
> 
> MODIFY src/config/settings.ts:
> 1. Add a new setting permissionOverrides: Record<string, number> (default {}) that allows users to override individual tool tiers.
> 
> ADD to package.json contributes.configuration:
> 1. A "gemma-code.permissionOverrides" property with type "object" and appropriate description.
> 
> CREATE test file:
> - tests/unit/safety/PermissionTiers.test.ts covering: tier lookup for all builtins, MCP default to DANGEROUS, shouldRequireConfirmation logic, user override behavior, getDangerousWarning output.
> 
> Follow existing patterns. Use vitest.

---

#### 4.3 -- Git Safety Net

**Objective**: Implement automatic git stash/commit before the agent makes file modifications. Every batch of AI-driven changes gets its own commit with a `[gemma-code]` prefix. On failure or user rollback, the extension can revert to the safety checkpoint.

**Prompt**:
> You are implementing a git safety net for Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - The AgentLoop at src/tools/AgentLoop.ts tracks modified files via _modifiedFiles array, populated when FILE_EDIT_TOOLS (write_file, edit_file, create_file) are called.
> - The workspace root is obtained via vscode.workspace.workspaceFolders[0].uri.fsPath.
> - child_process.spawn is already used in src/tools/handlers/terminal.ts.
> - No git operations exist anywhere in the codebase currently.
> 
> CREATE:
> - src/safety/GitSafetyNet.ts
> 
> This class must:
> 1. Constructor accepts workspaceRoot: string.
> 2. Expose async isGitRepo(): Promise<boolean> â€” runs `git rev-parse --is-inside-work-tree`.
> 3. Expose async createCheckpoint(message?: string): Promise<GitCheckpoint | null> â€” runs:
>    a. `git stash push -m "[gemma-code] auto-stash before agent run"` if there are uncommitted changes (check via `git status --porcelain`).
>    b. Records the current HEAD SHA via `git rev-parse HEAD`.
>    c. Returns a GitCheckpoint object: { headSha: string, stashCreated: boolean, timestamp: number }.
>    d. Returns null if not a git repo.
> 4. Expose async commitAgentChanges(files: string[], message: string): Promise<string | null> â€” runs:
>    a. `git add <file1> <file2> ...` for the specific files.
>    b. `git commit -m "[gemma-code] <message>"` with --no-verify to avoid user hooks during auto-commits.
>    c. Returns the new commit SHA or null on failure.
> 5. Expose async rollback(checkpoint: GitCheckpoint): Promise<boolean> â€” runs:
>    a. `git reset --hard <checkpoint.headSha>`.
>    b. If checkpoint.stashCreated, runs `git stash pop`.
>    c. Returns true on success.
> 6. All git commands should use execFile (not spawn with shell: true) for safety, with a 10-second timeout.
> 7. Errors should be caught and logged, never thrown.
> 
> Interface:
> - GitCheckpoint: { headSha: string; stashCreated: boolean; timestamp: number }
> 
> MODIFY src/tools/AgentLoop.ts:
> 1. Accept an optional GitSafetyNet in AgentLoopOptions.
> 2. At the start of run(), if git safety net is provided, call createCheckpoint().
> 3. After the loop completes (whether normally or via max-iterations), if files were modified and a checkpoint exists, call commitAgentChanges() with the modified files list.
> 4. Store the checkpoint so GemmaCodePanel can offer rollback via a new webview message.
> 
> ADD to src/panels/messages.ts:
> 1. A GitCheckpointMessage (Extension -> Webview): { type: "gitCheckpoint", sha: string, filesChanged: number }.
> 2. A RollbackRequest (Webview -> Extension): { type: "rollbackRequest" }.
> 3. Add both to the respective union types.
> 
> CREATE test file:
> - tests/unit/safety/GitSafetyNet.test.ts â€” mock child_process.execFile, test: isGitRepo true/false, createCheckpoint with/without dirty state, commitAgentChanges success/failure, rollback flow.
> 
> Use vitest. Follow patterns from tests/unit/tools/handlers/terminal.test.ts for child_process mocking.

---

#### 4.4 -- Token & Time Budget Middleware

**Objective**: Create a budget enforcement layer that wraps the Ollama client, tracking cumulative token usage and wall-clock time per session. When configurable ceilings are reached, the agent loop is interrupted with a clear explanation.

**Prompt**:
> You are implementing token and time budget enforcement for Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - The OllamaClient interface at src/ollama/types.ts has streamChat() returning AsyncGenerator<OllamaChatChunk>.
> - The AgentLoop at src/tools/AgentLoop.ts calls this._client.streamChat() in _streamOneTurn().
> - Settings are in src/config/settings.ts (GemmaCodeSettings interface).
> - PromptBudget.ts at src/config/PromptBudget.ts handles budget allocation but only for the system prompt, not session-level enforcement.
> - Token estimation uses chars/4 heuristic throughout (CompactionStrategy.ts line 10: CHARS_PER_TOKEN = 4).
> 
> CREATE:
> - src/safety/BudgetEnforcer.ts
> 
> This class must:
> 1. Constructor accepts: { maxSessionTokens: number, maxSessionMinutes: number, maxSingleTurnTokens: number, onBudgetWarning: (msg: string) => void, onBudgetExceeded: (msg: string) => void }.
> 2. Track cumulative input tokens and output tokens across the session (estimated via chars/4).
> 3. Track session start time.
> 4. Expose recordInput(text: string): void â€” adds estimated tokens from the input.
> 5. Expose recordOutput(text: string): void â€” adds estimated tokens from the output.
> 6. Expose checkBudget(): BudgetStatus â€” returns { withinBudget: boolean, tokensUsed: number, tokensRemaining: number, minutesElapsed: number, minutesRemaining: number, warningIssued: boolean }.
> 7. At 80% of token budget or 80% of time budget, call onBudgetWarning once.
> 8. At 100%, call onBudgetExceeded.
> 9. Expose reset(): void for starting a new session.
> 10. Expose getUsageReport(): string â€” returns a human-readable summary of tokens used, time elapsed.
> 
> MODIFY src/config/settings.ts:
> 1. Add maxSessionTokens: number (default 500000 â€” ~4x the 128K context window, accounting for multi-turn).
> 2. Add maxSessionMinutes: number (default 30).
> 
> MODIFY src/tools/AgentLoop.ts:
> 1. Accept an optional BudgetEnforcer in AgentLoopOptions.
> 2. In _streamOneTurn(), after accumulating the full response, call _budgetEnforcer.recordOutput(accumulated).
> 3. Before each iteration in the loop, call _budgetEnforcer.checkBudget(). If not within budget, post an error and return.
> 4. When injecting tool results as user messages, call _budgetEnforcer.recordInput() with the result text.
> 
> ADD to package.json contributes.configuration:
> 1. "gemma-code.maxSessionTokens" with type "number" and default 500000.
> 2. "gemma-code.maxSessionMinutes" with type "number" and default 30.
> 
> CREATE test file:
> - tests/unit/safety/BudgetEnforcer.test.ts covering: token accumulation, 80% warning threshold, 100% exceeded, time tracking, reset, usage report string format, single-turn limit.
> 
> Use vitest.

---

#### 4.5 -- Irreversible Action Classifier

**Objective**: Build an action classification system that categorizes every tool call as reversible, destructive, or blocked. This integrates with the PermissionTier system (Sub-Task 4.2) and the GitSafetyNet (Sub-Task 4.3) to auto-create checkpoints before destructive actions and require enhanced confirmation.

**Prompt**:
> You are implementing an irreversible action classifier for Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - PermissionTiers.ts (created in Sub-Task 4.2) defines AUTO_APPROVE, CONFIRM, and DANGEROUS tiers.
> - GitSafetyNet.ts (created in Sub-Task 4.3) can create checkpoints before destructive operations.
> - The ToolCall interface: { tool: ToolName, id: string, parameters: Record<string, unknown> }.
> - The terminal handler at src/tools/handlers/terminal.ts has BLOCKED_PATTERNS for hardcoded blocks.
> - ToolActivationRules.ts at src/tools/ToolActivationRules.ts has WRITE_TOOLS and NETWORK_TOOLS lists.
> 
> CREATE:
> - src/safety/ActionClassifier.ts
> 
> Define:
> 1. An enum ActionRisk { REVERSIBLE = 'reversible', DESTRUCTIVE = 'destructive', BLOCKED = 'blocked' }.
> 2. A function classifyAction(call: ToolCall): ActionClassification where ActionClassification is:
>    { risk: ActionRisk, reason: string, requiresCheckpoint: boolean, enhancedConfirmation: boolean }.
> 3. Classification rules:
>    - read_file, list_directory, grep_codebase, web_search, fetch_page â†’ REVERSIBLE (no side effects).
>    - write_file, edit_file, create_file â†’ DESTRUCTIVE if the file already exists (overwrite), otherwise REVERSIBLE for create_file on new files. Since we cannot know at classification time whether the file exists, mark write_file and edit_file as DESTRUCTIVE always; create_file as DESTRUCTIVE.
>    - delete_file â†’ DESTRUCTIVE always, requiresCheckpoint = true.
>    - run_terminal â†’ Classify based on command content analysis:
>      a. Read-only commands (ls, cat, head, tail, git status, git log, git diff, echo, pwd, which, type, find, grep, rg, node --version, npm list) â†’ REVERSIBLE.
>      b. Commands matching BLOCKED_PATTERNS â†’ BLOCKED.
>      c. Commands containing git push, git reset, rm, del, rmdir, DROP, TRUNCATE, npm publish â†’ DESTRUCTIVE with enhancedConfirmation = true.
>      d. All other commands â†’ DESTRUCTIVE (default-deny for shell commands).
> 4. For MCP tools (prefixed "mcp:"): default to DESTRUCTIVE.
> 
> MODIFY src/tools/AgentLoop.ts:
> 1. Import classifyAction.
> 2. Before executing each tool call, classify it.
> 3. If BLOCKED, skip execution and return an error ToolResult.
> 4. If DESTRUCTIVE and requiresCheckpoint, trigger git checkpoint (if GitSafetyNet is available).
> 5. Post the classification to the webview so the UI can show risk indicators.
> 
> ADD to src/panels/messages.ts:
> 1. An ActionClassificationMessage: { type: "actionClassification", callId: string, risk: string, reason: string }.
> 2. Add to ExtensionToWebviewMessage union.
> 
> CREATE test file:
> - tests/unit/safety/ActionClassifier.test.ts covering: each builtin tool classification, shell command analysis for read-only vs destructive vs blocked, MCP default, enhanced confirmation flagging.
> 
> Use vitest.

---

#### 4.6 -- GPU-Tier-Aware Iteration Limits

**Objective**: Establish three GPU tiers and make the agent loop iteration limit, sub-agent max iterations, and compaction aggressiveness configurable per tier. This prepares the infrastructure for Phase 5's GPU-aware scheduling.

**Prompt**:
> You are implementing GPU-tier-aware iteration limits for Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - Settings at src/config/settings.ts has maxAgentIterations (default 20) and subAgentMaxIterations (default 10).
> - AgentLoop.ts uses _maxIterations from the constructor.
> - SubAgentManager.ts passes config.maxIterations to each sub-agent's AgentLoop.
> - The PromptBudget at src/config/PromptBudget.ts calculates token budgets from maxTokens.
> - The compaction threshold is hardcoded at 0.8 in ContextCompactor.ts.
> 
> CREATE:
> - src/config/GpuTierConfig.ts
> 
> Define:
> 1. An enum GpuTier { TIER_1 = 1, TIER_2 = 2, TIER_3 = 3 } with descriptions:
>    - TIER_1 (6-8 GB VRAM): E4B model, 128K context, conservative limits.
>    - TIER_2 (12-16 GB VRAM): 26B MoE model, 256K context, moderate limits.
>    - TIER_3 (24+ GB VRAM): 31B Dense model, 256K context, generous limits.
> 
> 2. An interface GpuTierProfile:
>    { tier: GpuTier, maxAgentIterations: number, subAgentMaxIterations: number, maxConcurrentSubAgents: number, compactionThreshold: number, contextWindow: number, recommendedModel: string }
> 
> 3. A const GPU_TIER_PROFILES: Record<GpuTier, GpuTierProfile>:
>    - TIER_1: { maxAgentIterations: 25, subAgentMaxIterations: 8, maxConcurrentSubAgents: 1, compactionThreshold: 0.7, contextWindow: 131072, recommendedModel: "gemma4:e4b" }
>    - TIER_2: { maxAgentIterations: 40, subAgentMaxIterations: 12, maxConcurrentSubAgents: 2, compactionThreshold: 0.8, contextWindow: 262144, recommendedModel: "gemma4:26b" }
>    - TIER_3: { maxAgentIterations: 60, subAgentMaxIterations: 15, maxConcurrentSubAgents: 3, compactionThreshold: 0.85, contextWindow: 262144, recommendedModel: "gemma4:31b" }
> 
> 4. A function detectGpuTier(): Promise<GpuTier> that:
>    a. Calls the Ollama API (GET /api/ps or /api/tags) and checks available model sizes, or
>    b. Falls back to reading the configured modelName from settings and inferring tier from model name patterns (e4b â†’ TIER_1, 26b â†’ TIER_2, 31b â†’ TIER_3).
>    c. Returns TIER_1 as the safe default.
> 
> 5. A function getEffectiveProfile(settings: GemmaCodeSettings, detectedTier?: GpuTier): GpuTierProfile that merges detected tier defaults with any user overrides from settings.
> 
> MODIFY src/config/settings.ts:
> 1. Add gpuTier: "auto" | "1" | "2" | "3" (default "auto").
> 2. Update getSettings() to include the new field.
> 
> ADD to package.json contributes.configuration:
> 1. "gemma-code.gpuTier" with type "string", enum ["auto", "1", "2", "3"], default "auto".
> 
> MODIFY src/panels/GemmaCodePanel.ts constructor:
> 1. Call detectGpuTier() and getEffectiveProfile() to determine the active profile.
> 2. Use profile.maxAgentIterations instead of settings.maxAgentIterations when constructing AgentLoop.
> 3. Use profile.compactionThreshold (this requires exposing it; for now, store it as a field and pass to ContextCompactor if its constructor is updated).
> 
> CREATE test file:
> - tests/unit/config/GpuTierConfig.test.ts covering: all three tier profiles are valid, detectGpuTier model name inference, getEffectiveProfile with user overrides, auto-detection fallback.
> 
> Use vitest.

---

#### 4.T -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 4. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 4. Include unit tests for loop detection (deliberate repetition scenarios), permission tiers, git safety net (mock git operations), budget enforcement, and action classification.
> Run the tests, fix all failures, and iterate until every test passes with 80%+ coverage.
> Do not advance to Phase 5 until this phase is fully verified.
> After all tests pass, run /generate-session-history to document this phase.

---

### Phase 4 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing (80%+ coverage)
- [ ] No known regressions from prior phases
- [ ] Session history generated for this phase
- [ ] Ready to advance to Phase 5

---

## Phase 5: Plan-and-Execute Orchestration

**Goal**: Replace current ReAct-style AgentLoop with Plan-and-Execute (DAG-based) orchestration, add Reflexion pattern for error recovery, and implement GPU-aware sub-agent scheduling.
**Prerequisites**: Phase 4 (safety infrastructure protects DAG execution) and Phase 3 (episodic memory stores reflections).
**Stability Gate**: Complex multi-file task produces a DAG plan, executes nodes in dependency order, recovers from a deliberate failure using Reflexion, and replans when >30% of nodes fail.

### Sub-tasks

#### 5.1 -- Task DAG Data Model and Planner

**Objective**: Define the data structures for a directed acyclic graph (DAG) of subtasks, and implement a PlannerAgent that takes a user request plus codebase context and produces a DAG. This replaces the current PlanMode's simple numbered-list approach with a structured, dependency-aware plan.

**Prompt**:
> You are implementing the task DAG data model and planner agent for Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - The current PlanMode at src/modes/PlanMode.ts is a simple toggle that adds a prompt addendum. It detects numbered lists via detectPlan() regex but does not create structured task graphs.
> - SubAgentManager at src/agents/SubAgentManager.ts creates isolated agents with scoped tools.
> - SubAgentPrompts at src/agents/SubAgentPrompts.ts has a "planning" type that generates implementation steps.
> - The PromptBuilder at src/chat/PromptBuilder.ts builds dynamic system prompts.
> - Agent types are in src/agents/types.ts: SubAgentType = "verification" | "research" | "planning".
> 
> CREATE:
> - src/orchestration/TaskDAG.ts
> 
> Define:
> 1. Interface TaskNode:
>    { id: string, title: string, description: string, type: 'research' | 'code' | 'test' | 'verify', dependencies: string[] (IDs of prerequisite tasks), status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped', result?: string, error?: string, retryCount: number, maxRetries: number }
> 
> 2. Class TaskDAG:
>    - Constructor accepts nodes: TaskNode[].
>    - addNode(node: TaskNode): void â€” validates no duplicate IDs, validates dependencies exist.
>    - getReadyNodes(): TaskNode[] â€” returns nodes whose status is 'pending' and all dependencies are 'completed'.
>    - markCompleted(nodeId: string, result: string): void.
>    - markFailed(nodeId: string, error: string): void â€” if retryCount < maxRetries, set status back to 'pending' and increment retryCount; otherwise set to 'failed'.
>    - skipDependents(nodeId: string): void â€” recursively marks all transitive dependents as 'skipped'.
>    - isComplete(): boolean â€” all nodes are 'completed' or 'skipped'.
>    - hasCycle(): boolean â€” topological sort cycle detection.
>    - getProgress(): { total: number, completed: number, failed: number, skipped: number, pending: number, running: number }.
>    - toJSON(): serializable representation.
>    - static fromJSON(json): TaskDAG â€” deserialize.
>    - Validate the DAG is acyclic on construction; throw if a cycle is detected.
> 
> CREATE:
> - src/orchestration/PlannerAgent.ts
> 
> This class:
> 1. Constructor accepts: OllamaClient, modelName, ollamaOptions.
> 2. Expose async plan(userRequest: string, codebaseContext: string): Promise<TaskDAG>.
> 3. Internally, constructs a system prompt that instructs the model to decompose the request into a JSON array of TaskNode objects with dependency references.
> 4. Calls the Ollama API once (non-streaming for simplicity), parses the JSON response.
> 5. Validates the DAG (no cycles, all dependency references valid) and returns it.
> 6. If parsing fails, retries once with a "Your response was not valid JSON" correction message.
> 7. The system prompt should include examples of well-formed task nodes with dependencies.
> 
> CREATE test file:
> - tests/unit/orchestration/TaskDAG.test.ts covering: addNode, getReadyNodes with dependencies, markCompleted/markFailed, cycle detection, skipDependents, progress tracking, serialization roundtrip.
> - tests/unit/orchestration/PlannerAgent.test.ts covering: successful plan generation (mock Ollama), JSON parse failure and retry, cycle rejection.
> 
> Use vitest.

---

#### 5.2 -- DAG Executor with GPU-Aware Scheduling

**Objective**: Implement a `DAGExecutor` that walks the TaskDAG, dispatches ready nodes to sub-agents (respecting GPU tier concurrency limits), collects results, and handles failures. This is the runtime engine that replaces the flat ReAct loop for complex tasks.

**Prompt**:
> You are implementing the DAG executor with GPU-aware scheduling for Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - TaskDAG from src/orchestration/TaskDAG.ts (Sub-Task 5.1) provides getReadyNodes(), markCompleted(), markFailed(), skipDependents(), isComplete().
> - SubAgentManager at src/agents/SubAgentManager.ts has async run(config: SubAgentConfig, postMessage): Promise<SubAgentResult>.
> - GpuTierConfig from src/config/GpuTierConfig.ts (Sub-Task 4.6) provides GpuTierProfile with maxConcurrentSubAgents.
> - SubAgentConfig in src/agents/types.ts: { type, maxIterations, userRequest, modifiedFiles, recentToolResults, memoryContext? }.
> - PostMessageFn from src/chat/StreamingPipeline.ts.
> 
> CREATE:
> - src/orchestration/DAGExecutor.ts
> 
> This class must:
> 1. Constructor accepts: subAgentManager: SubAgentManager, profile: GpuTierProfile, postMessage: PostMessageFn.
> 2. Expose async execute(dag: TaskDAG): Promise<DAGExecutionResult>.
> 3. The execution loop:
>    a. While !dag.isComplete():
>       i. Get ready nodes via dag.getReadyNodes().
>       ii. Respect maxConcurrentSubAgents: if already running that many, await one to finish before starting the next.
>       iii. For each ready node, map its type to a SubAgentConfig.type: 'research' â†’ 'research', 'code' â†’ 'planning' (for now, until code-generation sub-agent exists), 'test' â†’ 'verification', 'verify' â†’ 'verification'.
>       iv. Launch sub-agent via subAgentManager.run(). Mark node as 'running'.
>       v. On success: markCompleted(node.id, result.output).
>       vi. On failure: markFailed(node.id, result.error). If the node transitions to 'failed' (no retries left), call skipDependents(node.id).
>    b. Post progress updates to the webview after each node completes.
> 4. Return DAGExecutionResult: { dag: TaskDAG, totalTimeMs: number, nodesCompleted: number, nodesFailed: number, nodesSkipped: number }.
> 
> For TIER_1 (maxConcurrentSubAgents = 1): All nodes execute sequentially.
> For TIER_2 (maxConcurrentSubAgents = 2): Up to 2 independent nodes run in parallel.
> For TIER_3 (maxConcurrentSubAgents = 3): Up to 3 independent nodes run in parallel.
> 
> Use a semaphore pattern (simple counter + Promise-based queue) for concurrency control. Do NOT use third-party concurrency libraries.
> 
> ADD to src/panels/messages.ts:
> 1. A DAGProgressMessage: { type: "dagProgress", total: number, completed: number, failed: number, running: number, currentNodes: string[] }.
> 2. Add to ExtensionToWebviewMessage union.
> 
> CREATE test file:
> - tests/unit/orchestration/DAGExecutor.test.ts covering: sequential execution on TIER_1, parallel execution on TIER_3, failure with skipDependents, retry logic, progress message posting.
> 
> Mock SubAgentManager.run() with controlled delays to test concurrency. Use vitest.

---

#### 5.3 -- Reflexion Pattern for Error Recovery

**Objective**: When a sub-agent task fails, implement the Reflexion pattern: generate a textual self-reflection analyzing the root cause, store it in episodic memory, and on retry inject the reflection as a negative constraint. This significantly improves recovery rates on subsequent attempts.

**Prompt**:
> You are implementing the Reflexion error recovery pattern for Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - The DAGExecutor from src/orchestration/DAGExecutor.ts (Sub-Task 5.2) calls markFailed() on task nodes. If retryCount < maxRetries, the node goes back to 'pending'.
> - SubAgentManager at src/agents/SubAgentManager.ts creates isolated agents.
> - MemoryStore at src/storage/MemoryStore.ts has async save(content, type, sessionId) for persisting memories, and searchKeyword() for retrieval.
> - MemoryStore.types.ts defines MemoryType = "decision" | "fact" | "preference" | "file_pattern" | "error_resolution".
> - The OllamaClient can be used for a one-shot reflection generation call.
> 
> CREATE:
> - src/orchestration/ReflexionEngine.ts
> 
> This class must:
> 1. Constructor accepts: OllamaClient, modelName, ollamaOptions, memoryStore: MemoryStore | null.
> 2. Expose async reflect(failedTask: TaskNode, error: string, context: string): Promise<Reflection>.
>    - Constructs a prompt: "A coding task failed. Task: {task.description}. Error: {error}. Context: {context}. Analyze the root cause in 2-3 sentences. What went wrong and what should be done differently on retry?"
>    - Calls the Ollama API (non-streaming) to generate the reflection text.
>    - Returns Reflection: { taskId: string, analysis: string, constraints: string[], timestamp: number }.
>    - The constraints array is extracted from the analysis (sentences starting with "Do not" or "Avoid" or "Instead").
> 3. Expose async storeReflection(reflection: Reflection, sessionId?: string): Promise<void>.
>    - Saves the reflection analysis to MemoryStore as type "error_resolution".
> 4. Expose buildRetryContext(reflections: Reflection[]): string.
>    - Formats all past reflections for the failed task into a context block:
>      "## Previous Attempt Failures\n\n- Attempt 1: {analysis}\n  Constraints: {constraints}\n- Attempt 2: ..."
>    - This string is injected into the sub-agent's memoryContext on retry.
> 
> MODIFY src/orchestration/DAGExecutor.ts:
> 1. Accept an optional ReflexionEngine in the constructor.
> 2. When a node fails and will be retried (retryCount < maxRetries):
>    a. Call reflexionEngine.reflect() to generate a reflection.
>    b. Call reflexionEngine.storeReflection() to persist it.
>    c. When re-dispatching the node, include reflexionEngine.buildRetryContext() in the SubAgentConfig.memoryContext.
> 3. Store reflections per-node in a Map<string, Reflection[]>.
> 
> CREATE test file:
> - tests/unit/orchestration/ReflexionEngine.test.ts covering: reflection generation (mock Ollama), constraint extraction, memory store integration, buildRetryContext formatting, multi-attempt accumulation.
> 
> Use vitest.

---

#### 5.4 -- Orchestrator Integration and AgentLoop Refactor

**Objective**: Create the top-level `Orchestrator` class that ties together the PlannerAgent, DAGExecutor, and ReflexionEngine. Refactor the GemmaCodePanel to use the Orchestrator for complex tasks (multi-step requests) while preserving the existing AgentLoop for simple single-turn requests.

**Prompt**:
> You are implementing the top-level orchestrator and refactoring the agent dispatch for Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - PlannerAgent from src/orchestration/PlannerAgent.ts (Sub-Task 5.1) generates TaskDAGs.
> - DAGExecutor from src/orchestration/DAGExecutor.ts (Sub-Task 5.2) executes TaskDAGs.
> - ReflexionEngine from src/orchestration/ReflexionEngine.ts (Sub-Task 5.3) handles error recovery.
> - The current GemmaCodePanel at src/panels/GemmaCodePanel.ts creates an AgentLoop and a StreamingPipeline. The pipeline calls _agentLoop.run(pm) for every user message.
> - The AgentLoop at src/tools/AgentLoop.ts is a ReAct-style loop.
> - Settings include planModeActive toggle and GPU tier config.
> 
> CREATE:
> - src/orchestration/Orchestrator.ts
> 
> This class must:
> 1. Constructor accepts: { client: OllamaClient, modelName: string, ollamaOptions: OllamaOptions, subAgentManager: SubAgentManager, gpuTierProfile: GpuTierProfile, memoryStore: MemoryStore | null, postMessage: PostMessageFn }.
> 2. Expose async execute(userRequest: string, codebaseContext: string): Promise<OrchestratorResult>.
> 3. The execution flow:
>    a. Call PlannerAgent.plan() to generate a TaskDAG.
>    b. Post the DAG to the webview for visualization (new message type).
>    c. Create a DAGExecutor with the ReflexionEngine.
>    d. Execute the DAG.
>    e. Collect all node results into a summary.
>    f. Return OrchestratorResult: { dag: TaskDAG, summary: string, totalTimeMs: number }.
> 4. Expose async shouldUseOrchestrator(userRequest: string): Promise<boolean>.
>    - Heuristic: if the request contains keywords like "implement", "refactor", "build", "create a feature", "fix all", "update across", or is longer than 200 characters, return true.
>    - Simple queries ("what is", "explain", "read file", "show me") return false.
>    - This is a simple heuristic, not an LLM call.
> 
> MODIFY src/panels/GemmaCodePanel.ts:
> 1. Import Orchestrator.
> 2. In the constructor, create an Orchestrator instance alongside the existing AgentLoop.
> 3. In _handleSendMessage(), after checking for slash commands:
>    a. Call orchestrator.shouldUseOrchestrator(text).
>    b. If true and plan mode is active, use orchestrator.execute().
>    c. Otherwise, use the existing pipeline.send() path (preserving backward compatibility).
> 4. This means plan mode + complex request = DAG orchestration; everything else = ReAct loop.
> 
> ADD to src/panels/messages.ts:
> 1. A DAGVisualizationMessage: { type: "dagVisualization", nodes: Array<{ id: string, title: string, status: string, dependencies: string[] }> }.
> 2. Add to ExtensionToWebviewMessage union.
> 
> CREATE test file:
> - tests/unit/orchestration/Orchestrator.test.ts covering: shouldUseOrchestrator heuristic (short vs long requests, keyword detection), execute flow with mocked PlannerAgent and DAGExecutor, error propagation.
> 
> Use vitest.

---

#### 5.5 -- Dynamic Replanning on Divergence

**Objective**: When a DAG execution encounters a significant failure (more than 30% of nodes failed) or the environment has changed (files expected to exist are missing), trigger a replanning cycle that generates a new DAG for the remaining work, incorporating lessons learned.

**Prompt**:
> You are implementing dynamic replanning for the DAG orchestration in Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - The Orchestrator from src/orchestration/Orchestrator.ts (Sub-Task 5.4) runs PlannerAgent then DAGExecutor.
> - TaskDAG from src/orchestration/TaskDAG.ts has getProgress() returning { total, completed, failed, skipped, pending, running }.
> - PlannerAgent from src/orchestration/PlannerAgent.ts can generate a new TaskDAG.
> - ReflexionEngine from src/orchestration/ReflexionEngine.ts provides reflection context.
> - DAGExecutor from src/orchestration/DAGExecutor.ts runs the execution.
> 
> MODIFY src/orchestration/Orchestrator.ts:
> 1. Add a _maxReplanAttempts: number field (default 2).
> 2. Add a _replanThreshold: number field (default 0.3 â€” replan if >30% of nodes failed).
> 3. After DAGExecutor.execute() completes, check:
>    a. If dag progress shows failed/(total - skipped) > _replanThreshold AND replan attempts < max:
>       i. Collect completed results as context.
>       ii. Collect all reflections from the ReflexionEngine.
>       iii. Build a replanning prompt: "Original request: {request}. Completed so far: {completed nodes + results}. Failed: {failed nodes + reflections}. Generate a new plan for the REMAINING work only."
>       iv. Call PlannerAgent.plan() with this augmented context.
>       v. Execute the new DAG.
>       vi. Increment replan counter.
>    b. If replan threshold is not met OR max replans exhausted, return the result as-is.
> 4. The final OrchestratorResult should include: replanCount: number, allDags: TaskDAG[] (original + any replans).
> 
> ADD to src/panels/messages.ts:
> 1. A ReplanningMessage: { type: "replanning", attempt: number, reason: string, failedNodes: string[] }.
> 2. Add to ExtensionToWebviewMessage union.
> 
> MODIFY src/orchestration/DAGExecutor.ts:
> 1. Expose getReflections(): Map<string, Reflection[]> so the Orchestrator can pass accumulated reflections to the replanner.
> 
> CREATE test file:
> - tests/unit/orchestration/Orchestrator.replan.test.ts covering: no replan when failures below threshold, replan triggered when >30% failed, max replan attempts respected, completed work preserved across replans, replanning context includes reflections.
> 
> Use vitest.

---

#### 5.6 -- Structured Output Contracts Between Orchestrator and Sub-Agents

**Objective**: Define input/output JSON schemas for communication between the orchestrator and specialist sub-agents. Each task node type has a well-defined input contract (what the sub-agent receives) and output contract (what it must return). This replaces the current free-text SubAgentConfig.userRequest with structured, validated payloads.

**Prompt**:
> You are implementing structured output contracts for sub-agent communication in Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - SubAgentConfig at src/agents/types.ts currently has: { type, maxIterations, userRequest: string, modifiedFiles, recentToolResults, memoryContext? }.
> - SubAgentManager at src/agents/SubAgentManager.ts passes userRequest as a free-text string.
> - TaskNode from src/orchestration/TaskDAG.ts has type: 'research' | 'code' | 'test' | 'verify'.
> - The DAGExecutor at src/orchestration/DAGExecutor.ts maps node types to sub-agent types.
> 
> CREATE:
> - src/orchestration/contracts.ts
> 
> Define:
> 1. Interface ResearchInput: { question: string, relevantFiles?: string[], searchScope?: 'codebase' | 'web' | 'both' }.
> 2. Interface ResearchOutput: { findings: string, references: Array<{ source: string, excerpt: string }>, confidence: 'high' | 'medium' | 'low' }.
> 3. Interface CodeTaskInput: { description: string, targetFiles: string[], constraints?: string[], dependencyResults?: Record<string, string> }.
> 4. Interface CodeTaskOutput: { filesModified: string[], summary: string, linesChanged: number }.
> 5. Interface TestTaskInput: { targetFiles: string[], testCommand?: string, expectedBehavior: string }.
> 6. Interface TestTaskOutput: { passed: boolean, testOutput: string, failureDetails?: string }.
> 7. Interface VerifyTaskInput: { filesModified: string[], originalRequest: string, previousResults: string[] }.
> 8. Interface VerifyTaskOutput: { approved: boolean, issues: Array<{ file: string, line?: number, description: string, severity: 'error' | 'warning' }> }.
> 
> 9. A union type TaskInput = ResearchInput | CodeTaskInput | TestTaskInput | VerifyTaskInput.
> 10. A union type TaskOutput = ResearchOutput | CodeTaskOutput | TestTaskOutput | VerifyTaskOutput.
> 
> 11. A function buildSubAgentRequest(node: TaskNode, input: TaskInput): string â€” serializes the input into a structured prompt that instructs the sub-agent to respond with a JSON block matching the output schema.
> 
> 12. A function parseSubAgentResponse(type: TaskNode['type'], rawOutput: string): TaskOutput | null â€” extracts JSON from the sub-agent's output (looking for

---

#### 5.T -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 5. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 5. Include unit tests for DAG construction, executor scheduling, Reflexion generation, orchestrator routing, dynamic replanning, and output contract validation.
> Run the tests, fix all failures, and iterate until every test passes with 80%+ coverage.
> Do not advance to Phase 6 until this phase is fully verified.
> After all tests pass, run /generate-session-history to document this phase.

---

### Phase 5 Exit Checklist

- [x] All sub-tasks completed
- [x] All tests passing (80%+ coverage) -- 97.85% statement coverage
- [x] No known regressions from prior phases -- 669 existing tests still passing
- [x] Session history generated for this phase
- [x] Ready to advance to Phase 6

---

## Phase 6: Local Observability & Trace Dashboard

**Goal**: Implement local SQLite trace store, webview-based trace viewer, optional OTLP export, and metrics collection.
**Prerequisites**: Phases 1-5 (all components need instrumentation).
**Stability Gate**: Agent session produces a full trace viewable in the dashboard. Metrics show task success rate, tool steps, and compaction count. Optional OTLP export sends spans to a local Jaeger instance.

### Sub-tasks

#### 6.1 -- Trace Data Model and SQLite Trace Store

**Objective**: Define an OpenTelemetry-compatible trace data model (spans with parent-child relationships) and implement a lightweight SQLite-backed trace store. Every agent turn, tool call, LLM call, compaction event, and sub-agent invocation produces a span.

**Prompt**:
> You are implementing the trace data model and SQLite trace store for Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - ChatHistoryStore at src/storage/ChatHistoryStore.ts uses better-sqlite3 with WAL mode. This is the established pattern for SQLite usage.
> - The global storage URI is available from vscode.ExtensionContext.globalStorageUri.
> - Message type definitions are in src/chat/types.ts.
> - All SQLite databases in the project use the same pattern: constructor(dbPath), _initSchema(), WAL mode, foreign keys.
> 
> CREATE:
> - src/observability/TraceStore.ts
> 
> Define:
> 1. Interface Span:
>    { traceId: string, spanId: string, parentSpanId: string | null, name: string, kind: 'agent_turn' | 'tool_call' | 'llm_call' | 'compaction' | 'sub_agent' | 'planning' | 'reflexion' | 'custom', startTime: number, endTime: number | null, durationMs: number | null, status: 'ok' | 'error' | 'cancelled', attributes: Record<string, string | number | boolean>, events: SpanEvent[] }
> 
> 2. Interface SpanEvent:
>    { name: string, timestamp: number, attributes?: Record<string, string | number | boolean> }
> 
> 3. Interface Trace:
>    { traceId: string, sessionId: string | null, rootSpanId: string, startTime: number, endTime: number | null, spanCount: number }
> 
> 4. Class TraceStore:
>    - Constructor accepts dbPath: string. Creates tables:
>      a. traces: (trace_id TEXT PK, session_id TEXT, root_span_id TEXT, start_time INTEGER, end_time INTEGER)
>      b. spans: (span_id TEXT PK, trace_id TEXT FK, parent_span_id TEXT, name TEXT, kind TEXT, start_time INTEGER, end_time INTEGER, duration_ms INTEGER, status TEXT, attributes TEXT [JSON], events TEXT [JSON])
>      c. Indexes on trace_id, parent_span_id, kind, start_time.
>    - startTrace(sessionId?: string): Trace â€” creates a new trace with a root span.
>    - startSpan(traceId: string, name: string, kind: Span['kind'], parentSpanId?: string, attributes?: Record<string, string | number | boolean>): Span â€” inserts an open span.
>    - endSpan(spanId: string, status: Span['status'], attributes?: Record<string, string | number | boolean>): void â€” sets endTime, durationMs, status, merges attributes.
>    - addEvent(spanId: string, event: SpanEvent): void â€” appends to the span's events JSON array.
>    - getTrace(traceId: string): Trace & { spans: Span[] } | null.
>    - listTraces(limit?: number, offset?: number): Trace[].
>    - getSpansByKind(traceId: string, kind: Span['kind']): Span[].
>    - deleteOlderThan(daysAgo: number): number â€” prune old traces.
>    - close(): void.
> 
> CREATE test file:
> - tests/unit/observability/TraceStore.test.ts covering: startTrace/startSpan/endSpan lifecycle, parent-child relationships, getTrace with full span tree, listTraces pagination, deleteOlderThan pruning, concurrent span creation, event appending.
> 
> Use vitest. Use better-sqlite3 in-memory database (':memory:') for tests.

---

#### 6.2 -- Trace Instrumentation of Core Components

**Objective**: Instrument the AgentLoop, SubAgentManager, ToolRegistry, ContextCompactor, and OllamaClient to emit trace spans. Each component reports its start/end timing, success/failure, and key attributes. This is done via a lightweight `Tracer` singleton that components can import.

**Prompt**:
> You are instrumenting the core Gemma-Code components with trace spans (TypeScript VS Code extension).
> 
> CONTEXT:
> - TraceStore from src/observability/TraceStore.ts (Sub-Task 6.1) provides startTrace(), startSpan(), endSpan(), addEvent().
> - AgentLoop at src/tools/AgentLoop.ts iterates and calls _streamOneTurn() and _registry.execute().
> - SubAgentManager at src/agents/SubAgentManager.ts runs isolated agents.
> - ToolRegistry at src/tools/ToolRegistry.ts dispatches tool calls.
> - ContextCompactor at src/chat/ContextCompactor.ts runs the compaction pipeline.
> - The OllamaClient at src/ollama/client.ts calls the Ollama HTTP API.
> 
> CREATE:
> - src/observability/Tracer.ts
> 
> This class must:
> 1. Be a singleton (Tracer.getInstance()).
> 2. Hold a reference to a TraceStore (set via init(store: TraceStore)).
> 3. Expose convenience methods:
>    a. startTrace(sessionId?: string): string â€” returns traceId.
>    b. startSpan(traceId: string, name: string, kind: Span['kind'], parentSpanId?: string, attrs?: Record<string, string | number | boolean>): string â€” returns spanId.
>    c. endSpan(spanId: string, status: 'ok' | 'error' | 'cancelled', attrs?: Record<string, string | number | boolean>): void.
>    d. addEvent(spanId: string, name: string, attrs?: Record<string, string | number | boolean>): void.
> 4. If no TraceStore is initialized (store is null), all methods are no-ops. This ensures tracing is optional and zero-cost when disabled.
> 
> MODIFY src/tools/AgentLoop.ts:
> 1. Import Tracer.
> 2. At the start of run(), call tracer.startTrace() and store the traceId.
> 3. Each iteration gets a span: tracer.startSpan(traceId, `iteration_${i}`, 'agent_turn').
> 4. Each _streamOneTurn() call gets a child span with kind 'llm_call' recording model name and estimated tokens.
> 5. Each tool execution gets a child span with kind 'tool_call' recording tool name, success/failure, and duration.
> 6. End each span with appropriate status.
> 
> MODIFY src/agents/SubAgentManager.ts:
> 1. In run(), create a span with kind 'sub_agent' and attributes: agentType, maxIterations.
> 2. End with success/failure status and toolCallCount attribute.
> 
> MODIFY src/chat/ContextCompactor.ts:
> 1. In compact(), create a span with kind 'compaction' and attributes: strategyApplied, tokensBefore, tokensAfter.
> 
> MODIFY src/tools/ToolRegistry.ts:
> 1. In execute(), create a span with kind 'tool_call' and attributes: toolName, success.
> 2. Record duration.
> 
> DO NOT modify src/ollama/client.ts directly (it's a thin HTTP wrapper). Instead, record LLM call spans in AgentLoop where streamChat is called.
> 
> CREATE test file:
> - tests/unit/observability/Tracer.test.ts covering: singleton pattern, no-op when uninitialized, span creation and ending, nested spans, event adding.
> 
> Use vitest. Mock TraceStore.

---

#### 6.3 -- Metrics Collector and Golden Task Evaluation

**Objective**: Implement a metrics collector that computes aggregate statistics from traces: task success rate, average time-to-completion, tool step count, retry count, compaction frequency, human intervention rate, and safety approval rate. Define the golden task evaluation suite interface for regression detection.

**Prompt**:
> You are implementing the metrics collector and golden task evaluation framework for Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - TraceStore from src/observability/TraceStore.ts stores spans with kinds: 'agent_turn', 'tool_call', 'llm_call', 'compaction', 'sub_agent', 'planning', 'reflexion'.
> - Span attributes include: toolName, success, duration_ms, model, tokens_estimated, etc.
> - ConfirmationGate interactions can be tracked via 'tool_call' spans that have a 'confirmation_required' attribute.
> 
> CREATE:
> - src/observability/MetricsCollector.ts
> 
> This class must:
> 1. Constructor accepts: TraceStore.
> 2. Expose computeSessionMetrics(traceId: string): SessionMetrics:
>    - totalDurationMs: number (root span duration)
>    - toolStepCount: number (count of 'tool_call' spans)
>    - llmCallCount: number (count of 'llm_call' spans)
>    - retryCount: number (count of reflexion spans)
>    - compactionCount: number (count of 'compaction' spans)
>    - humanInterventionCount: number (tool_call spans where confirmation_required = true)
>    - successRate: number (successful tool_call spans / total tool_call spans)
>    - estimatedTokensUsed: number (sum of tokens_estimated attributes)
>    - subAgentCount: number (count of 'sub_agent' spans)
> 
> 3. Expose computeAggregateMetrics(traceIds: string[]): AggregateMetrics:
>    - averageDurationMs, medianDurationMs
>    - averageToolSteps, averageRetries
>    - overallSuccessRate
>    - totalCompactions
>    - humanInterventionRate (interventions / total tool calls)
> 
> 4. Expose getMetricsTrend(lastN: number): MetricsTrend:
>    - Computes metrics for the last N traces and returns arrays for time-series visualization.
> 
> CREATE:
> - src/observability/GoldenTaskSuite.ts
> 
> Define:
> 1. Interface GoldenTask:
>    { id: string, name: string, description: string, category: 'file_ops' | 'code_gen' | 'refactor' | 'debug' | 'test_gen' | 'multi_file', input: string, expectedOutcome: GoldenTaskExpectation, timeoutMs: number }
> 
> 2. Interface GoldenTaskExpectation:
>    { filesModified?: string[], filesCreated?: string[], outputContains?: string[], maxToolCalls?: number, maxDurationMs?: number, mustPass?: boolean }
> 
> 3. Interface GoldenTaskResult:
>    { taskId: string, passed: boolean, traceId: string, metrics: SessionMetrics, failures: string[], durationMs: number }
> 
> 4. A const GOLDEN_TASKS: GoldenTask[] with 5 initial placeholder definitions (users will add more):
>    a. "Read and summarize a file" (file_ops)
>    b. "Create a new TypeScript module with exports" (code_gen)
>    c. "Add error handling to an existing function" (refactor)
>    d. "Find and explain a bug in code" (debug)
>    e. "Generate unit tests for a utility function" (test_gen)
> 
> 5. A class GoldenTaskRunner:
>    - Constructor accepts: Orchestrator (or AgentLoop), TraceStore, MetricsCollector.
>    - Expose async runTask(task: GoldenTask): Promise<GoldenTaskResult>.
>    - Expose async runSuite(tasks?: GoldenTask[]): Promise<GoldenTaskResult[]>.
>    - Validates results against GoldenTaskExpectation.
>    - Detects regressions by comparing against the previous run's results (stored in a simple JSON file).
> 
> CREATE test files:
> - tests/unit/observability/MetricsCollector.test.ts covering: session metrics computation from mock spans, aggregate metrics averaging, empty trace handling.
> - tests/unit/observability/GoldenTaskSuite.test.ts covering: task definition validation, expectation checking logic, regression detection.
> 
> Use vitest.

---

#### 6.4 -- Webview Trace Dashboard Panel

**Objective**: Build a VS Code webview panel (separate from the main chat panel) that displays trace data as a timeline/waterfall visualization. Users can browse recent traces, drill into individual spans, view attributes, and see metrics summaries.

**Prompt**:
> You are implementing a webview-based trace dashboard for Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - The existing webview pattern is in src/panels/GemmaCodePanel.ts (implements vscode.WebviewViewProvider) and src/panels/webview/index.ts (client-side HTML/JS).
> - SessionListPanel at src/panels/SessionListPanel.ts is a simpler secondary panel â€” use this as a structural reference.
> - Message types are in src/panels/messages.ts with strict unions for Extension<->Webview communication.
> - TraceStore from src/observability/TraceStore.ts provides getTrace(), listTraces(), getSpansByKind().
> - MetricsCollector from src/observability/MetricsCollector.ts provides computeSessionMetrics().
> 
> CREATE:
> - src/panels/TraceDashboardPanel.ts
> 
> This class must:
> 1. Implement vscode.WebviewViewProvider (register with a new view ID "gemma-code.traceDashboard").
> 2. Constructor accepts: extensionUri, traceStore: TraceStore, metricsCollector: MetricsCollector.
> 3. Handle incoming messages:
>    a. "requestTraceList" â†’ query listTraces(50) and send back a trace list.
>    b. "requestTraceDetail" with traceId â†’ query getTrace() and send back the full span tree.
>    c. "requestMetrics" with traceId â†’ compute and send SessionMetrics.
> 4. The panel shows:
>    a. A list of recent traces (date, session, duration, span count, status).
>    b. Clicking a trace shows a waterfall/timeline view of its spans.
>    c. Each span shows: name, kind (with color coding), duration, status, key attributes.
>    d. A metrics summary card at the top.
> 
> CREATE:
> - src/panels/webview/traceDashboard.ts
> 
> The client-side HTML/JS for the trace dashboard:
> 1. Render a table of traces with columns: Date, Duration, Spans, Status.
> 2. On row click, show a nested span tree below the table.
> 3. Use CSS to create a simple waterfall: each span is a horizontal bar positioned by startTime relative to the trace start, with width proportional to duration.
> 4. Color-code by kind: agent_turn=blue, tool_call=green, llm_call=purple, compaction=orange, sub_agent=teal, reflexion=red.
> 5. Clicking a span shows its attributes in a detail pane.
> 6. Include a "Refresh" button and auto-refresh toggle.
> 7. Follow the styling patterns from src/panels/webview/index.ts (VS Code theme variables, same CSS structure).
> 
> ADD to src/panels/messages.ts:
> 1. TraceListMessage: { type: "traceList", traces: Array<{ traceId: string, startTime: number, durationMs: number, spanCount: number, status: string }> }.
> 2. TraceDetailMessage: { type: "traceDetail", traceId: string, spans: Span[] }.
> 3. TraceMetricsMessage: { type: "traceMetrics", metrics: SessionMetrics }.
> 4. RequestTraceListMessage: { type: "requestTraceList" }.
> 5. RequestTraceDetailMessage: { type: "requestTraceDetail", traceId: string }.
> 6. Add to the appropriate union types.
> 
> ADD to package.json:
> 1. A new view "gemma-code.traceDashboard" in the "gemma-code-sidebar" views container with name "Traces".
> 
> MODIFY src/extension.ts:
> 1. Import and register TraceDashboardPanel as a webview view provider.
> 2. Pass the TraceStore and MetricsCollector instances.
> 
> CREATE test file:
> - tests/unit/panels/TraceDashboardPanel.test.ts covering: message handling for requestTraceList, requestTraceDetail, requestMetrics, with mocked TraceStore and MetricsCollector.
> 
> Use vitest.

---

#### 6.5 -- Optional OTLP Export

**Objective**: Implement an optional OpenTelemetry Protocol (OTLP) exporter that can send trace data to external collectors like Jaeger or Grafana Tempo. This is off by default, respecting the offline-first philosophy, but available for power users.

**Prompt**:
> You are implementing optional OTLP trace export for Gemma-Code (TypeScript VS Code extension).
> 
> CONTEXT:
> - TraceStore from src/observability/TraceStore.ts stores spans locally.
> - The Tracer singleton from src/observability/Tracer.ts is the central span creation point.
> - Settings are in src/config/settings.ts.
> - The extension is offline-first; OTLP export is strictly opt-in.
> - We want to avoid heavy dependencies. Implement a minimal OTLP/HTTP JSON exporter using the built-in fetch API, NOT the full @opentelemetry/sdk-trace-node package.
> 
> CREATE:
> - src/observability/OtlpExporter.ts
> 
> This class must:
> 1. Constructor accepts: { endpoint: string, headers?: Record<string, string>, batchSize?: number, flushIntervalMs?: number }.
>    Default endpoint: "http://localhost:4318/v1/traces" (OTLP HTTP standard).
> 2. Expose enqueueSpan(span: Span): void â€” adds to an internal buffer.
> 3. Expose async flush(): Promise<void> â€” converts buffered spans to OTLP JSON format and POSTs them.
> 4. The OTLP JSON format must follow the OpenTelemetry Trace JSON schema:
>    { resourceSpans: [{ resource: { attributes: [...] }, scopeSpans: [{ scope: { name: "gemma-code" }, spans: [...] }] }] }.
> 5. Map internal Span fields to OTLP Span fields:
>    - traceId â†’ traceId (hex string)
>    - spanId â†’ spanId (hex string)
>    - parentSpanId â†’ parentSpanId
>    - name â†’ name
>    - kind â†’ SPAN_KIND_INTERNAL (1) for most, SPAN_KIND_CLIENT (3) for llm_call
>    - startTimeUnixNano â†’ startTime * 1_000_000 (ms to ns)
>    - endTimeUnixNano â†’ endTime * 1_000_000
>    - status â†’ { code: STATUS_CODE_OK (1) or STATUS_CODE_ERROR (2) }
>    - attributes â†’ key-value array format
> 6. Auto-flush when buffer reaches batchSize (default 100).
> 7. Start an interval timer for periodic flush (default every 30 seconds).
> 8. Expose dispose(): void â€” flushes remaining spans and clears the timer.
> 9. Handle network errors gracefully: log and discard, never throw.
> 
> MODIFY src/observability/Tracer.ts:
> 1. Add an optional OtlpExporter field.
> 2. In endSpan(), if the exporter is configured, also enqueue the completed span.
> 3. Add setExporter(exporter: OtlpExporter | null): void.
> 
> MODIFY src/config/settings.ts:
> 1. Add otlpEnabled: boolean (default false).
> 2. Add otlpEndpoint: string (default "http://localhost:4318/v1/traces").
> 3. Add otlpHeaders: string (default "" â€” comma-separated key=value pairs).
> 
> ADD to package.json contributes.configuration:
> 1. "gemma-code.otlpEnabled" boolean, default false.
> 2. "gemma-code.otlpEndpoint" string, default "http://localhost:4318/v1/traces".
> 3. "gemma-code.otlpHeaders" string, default "".
> 
> MODIFY src/extension.ts:
> 1. If settings.otlpEnabled, create an OtlpExporter and set it on the Tracer singleton.
> 2. Add the exporter to context.subscriptions for cleanup on deactivation.
> 
> CREATE test file:
> - tests/unit/observability/OtlpExporter.test.ts covering: span to OTLP format conversion, batch buffering and flush trigger, periodic flush timer, network error handling (mock fetch to reject), dispose flushes remaining.
> 
> Use vitest. Mock global fetch.

---

#### 6.T -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 6. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 6. Include unit tests for trace store operations, span instrumentation, metrics aggregation, and OTLP export serialization. Integration tests for dashboard rendering.
> Run the tests, fix all failures, and iterate until every test passes with 80%+ coverage.
> Do not advance to Phase 7 until this phase is fully verified.
> After all tests pass, run /generate-session-history to document this phase.

---

### Phase 6 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing (80%+ coverage)
- [ ] No known regressions from prior phases
- [ ] Session history generated for this phase
- [ ] Ready to advance to Phase 7

---

## Phase 7: Cross-Platform PyQt5 Installer

**Goal**: Build a modern, dark-themed wizard installer for Windows, macOS, and Linux with GPU auto-detection, model recommendation, and real-time progress.
**Prerequisites**: Phase 1 (GPU detection logic is reused by the installer).
**Stability Gate**: Installer launches on all three platforms, detects GPU, recommends model, installs all components, and opens VS Code with the extension ready.

### Sub-tasks

#### 7.1 -- PyQt5 Project Scaffold and Theme Engine

**Objective**: Create the Python project structure, dependency management, and a reusable QSS theme engine implementing every color, dimension, and font specification from the reference design. This is the foundation all wizard pages build on.

**Prompt**:
> Create the cross-platform PyQt5 installer project scaffold at scripts/installer/pyqt/.
> 
> 1. Create the following directory structure:
>    scripts/installer/pyqt/
>    â”œâ”€â”€ pyproject.toml
>    â”œâ”€â”€ src/
>    â”‚   â””â”€â”€ gemma_installer/
>    â”‚       â”œâ”€â”€ __init__.py
>    â”‚       â”œâ”€â”€ main.py            # Entry point: QApplication, window init, sys.exit
>    â”‚       â”œâ”€â”€ constants.py       # All color codes, dimensions, fonts as named constants
>    â”‚       â”œâ”€â”€ theme.py           # QSS stylesheet generation from constants
>    â”‚       â”œâ”€â”€ window.py          # Main QMainWindow (912x768 default, 840x672 minimum)
>    â”‚       â”œâ”€â”€ widgets/
>    â”‚       â”‚   â”œâ”€â”€ __init__.py
>    â”‚       â”‚   â”œâ”€â”€ header.py      # 64px header band: logo + title + step counter
>    â”‚       â”‚   â”œâ”€â”€ step_indicator.py  # 88px custom-painted step progress bar
>    â”‚       â”‚   â”œâ”€â”€ footer.py      # 56px footer: hint text + Back/Next buttons
>    â”‚       â”‚   â”œâ”€â”€ callout_box.py # Info callout with 3px left cyan stripe
>    â”‚       â”‚   â”œâ”€â”€ primary_button.py  # Cyan gradient button (38px, 7px radius)
>    â”‚       â”‚   â”œâ”€â”€ secondary_button.py  # Transparent border button
>    â”‚       â”‚   â””â”€â”€ log_panel.py   # Scrollable log panel (#111820 bg, Consolas 9pt)
>    â”‚       â””â”€â”€ pages/
>    â”‚           â””â”€â”€ __init__.py
>    â””â”€â”€ tests/
>        â”œâ”€â”€ __init__.py
>        â””â”€â”€ test_theme.py
> 
> 2. constants.py must define all colors from the reference:
>    - BG_WINDOW = "#0f1318", BG_HEADER = "#161c24", BG_CARD = "#1c2433"
>    - BG_INPUT = "#111820", BORDER = "#1e2d3d", ACCENT = "#0ABFBF"
>    - ACCENT_DIM = "#0a8f8f", ACCENT_FOCUS = "#0ABFBF88"
>    - TEXT_PRIMARY = "#e8edf2", TEXT_SECONDARY = "#6b7f96", TEXT_MUTED = "#3d5066"
>    - SUCCESS = "#22c55e", ERROR = "#ef4444", WARNING = "#f59e0b"
>    - FONT_PRIMARY = "Segoe UI" (Windows) / "SF Pro Display" (macOS) / "Cantarell" (Linux)
>    - FONT_MONO = "Consolas" (Windows) / "SF Mono" (macOS) / "Ubuntu Mono" (Linux)
>    - HEADER_HEIGHT = 64, STEP_BAR_HEIGHT = 88, FOOTER_HEIGHT = 56
>    - SIDE_MARGIN = 32, VERTICAL_MARGIN = 28
>    - BUTTON_HEIGHT = 38, BUTTON_RADIUS = 7
> 
> 3. theme.py must generate a complete QSS stylesheet string from the constants,
>    covering QMainWindow, QWidget, QPushButton (primary/secondary variants via
>    objectName), QLineEdit, QTextEdit, QScrollArea, QLabel, QProgressBar.
>    The QProgressBar must support an 8px indeterminate mode with cyan gradient.
> 
> 4. window.py must create a resizable QMainWindow with:
>    - Three-band layout: header (fixed 64px), step indicator (fixed 88px),
>      scrollable content area with 32px side margins and 28px vertical padding,
>      footer (fixed 56px).
>    - setMinimumSize(840, 672), resize(912, 768)
>    - Apply the theme stylesheet on construction.
>    - A method switchPage(pageWidget: QWidget) that replaces the content area.
>    - Dark window chrome (set WA_TranslucentBackground if needed on macOS).
> 
> 5. step_indicator.py must be a custom QWidget that:
>    - Paints horizontal dots (radius 13px) connected by lines.
>    - Completed steps: filled #0ABFBF with a white checkmark SVG.
>    - Active step: hollow #0ABFBF stroke (2px).
>    - Future steps: hollow #1e2d3d.
>    - Connector lines between dots match the step state.
>    - Labels below each dot in TEXT_SECONDARY font.
>    - Accepts a list of step names and a current_step index.
> 
> 6. primary_button.py: QPushButton subclass with cyan gradient background
>    (#0ABFBF to #0a8f8f), black bold text, 38px height, 7px border-radius.
>    Hover state slightly brightens. Disabled state grays out.
> 
> 7. log_panel.py: QTextEdit subclass with:
>    - Background #111820, text color #8bb4cc, Consolas 9pt
>    - Read-only, auto-scroll to bottom on new text
>    - Method append_log(text: str, level: str = "info") that color-codes
>      by level (info=#8bb4cc, success=#22c55e, error=#ef4444, warn=#f59e0b)
> 
> 8. pyproject.toml dependencies: PyQt5>=5.15, PyInstaller>=6.0 (dev only)
>    Project name: gemma-code-installer, version matching package.json (0.3.0).
>    Use hatchling as build backend matching the existing backend pattern.
> 
> 9. main.py: Parse --step N (optional) arg to jump to a specific step for dev testing.
>    Instantiate QApplication, apply theme, show window with step indicator
>    showing 9 steps: Welcome, Prerequisites, GPU Detection, Install Path,
>    Model Selection, Configuration, Review, Installing, Complete.
>    Show the Welcome page by default.
> 
> 10. tests/test_theme.py: Verify that generate_stylesheet() returns a non-empty
>     string containing all key selectors (QPushButton, QLineEdit, QProgressBar).
>     Verify constants.py has all required color constants.
> 
> Run the installer with: cd scripts/installer/pyqt && uv run python -m gemma_installer.main
> Verify the window opens at the correct size with the dark theme applied and
> the step indicator rendering all 9 steps with step 1 active.

---

#### 7.2 -- Wizard Pages: Welcome, Prerequisites Check, and GPU Detection

**Objective**: Implement the first three wizard pages -- Welcome (project introduction and "before you begin" callout), Prerequisites (auto-detect VS Code, Python, disk space, Ollama), and GPU Detection (probe nvidia-smi, rocm-smi, and system APIs to classify GPU tier and recommend a model variant).

**Prompt**:
> Implement the first three wizard pages for the Gemma Code PyQt5 installer at
> scripts/installer/pyqt/src/gemma_installer/pages/.
> 
> Files to create:
>   pages/welcome.py
>   pages/prerequisites.py
>   pages/gpu_detection.py
> 
> Also create a shared state object:
>   installer_state.py  (at the gemma_installer package level)
> 
> 1. installer_state.py:
>    Create a dataclass InstallerState holding all wizard state:
>    - install_path: str (default platform-appropriate: C:\Program Files\GemmaCode
>      on Windows, /usr/local/share/gemma-code on Linux, /Applications/GemmaCode on macOS)
>    - vscode_path: str = ""  (detected path to code/code.cmd)
>    - python_path: str = ""  (detected Python 3.11+ executable)
>    - ollama_installed: bool = False
>    - gpu_vendor: str = ""  ("nvidia", "amd", "apple", "intel", "none")
>    - gpu_name: str = ""
>    - vram_mb: int = 0
>    - recommended_model: str = ""  (e.g., "gemma4:e4b")
>    - selected_model: str = ""
>    - disk_space_gb: float = 0.0
>    - platform: str = sys.platform
>    - components_to_install: list[str] = field(default_factory=lambda: ["extension", "ollama", "venv", "model"])
> 
> 2. pages/welcome.py:
>    A QWidget page with:
>    - Page title "Welcome" (24pt bold, TEXT_PRIMARY)
>    - Subtitle: "This wizard will install Gemma Code, a fully offline agentic coding
>      assistant powered by Gemma 4 via Ollama. The process takes approximately
>      5-15 minutes depending on your internet connection."
>    - A CalloutBox widget (from widgets/callout_box.py) titled "Before you begin" listing:
>      * "Visual Studio Code installed" (dot indicator: green if detected, orange if not)
>      * "Python 3.11 or newer" (dot indicator)
>      * "At least 10 GB free disk space" (dot indicator)
>      * "Internet connection for downloading components"
>    - The callout runs detection in a background QThread and updates the dot indicators
>      in real-time as each check completes.
>    - Detection results are written to InstallerState.
> 
> 3. pages/prerequisites.py:
>    A QWidget page with:
>    - Title "Prerequisites Check"
>    - A card-style panel listing each prerequisite with status icon, name, and detail:
>      * VS Code: show detected path or "Not found â€” install from https://code.visualstudio.com"
>      * Python: show version and path, or "Not found â€” will be installed automatically"
>      * Disk space: show available GB in install drive, green/red threshold at 10 GB
>      * Ollama: show version if installed, or "Will be installed automatically"
>    - Detection logic must be platform-aware:
>      * Windows: check registry (HKLM/HKCU App Paths), well-known paths, PATH lookup
>        (mirror the logic in the existing setup.nsi FindVSCode/FindOllama/FindPython functions)
>      * macOS: check /Applications/Visual Studio Code.app, `which python3`, `brew list ollama`
>      * Linux: check `which code`, `which python3`, `which ollama`, snap/flatpak paths
>    - Each check runs in a DetectionWorker(QThread) to avoid blocking the UI.
>    - A "Re-check" secondary button to re-run all detections.
>    - The Next button is enabled only when VS Code is found and disk space >= 10 GB.
>      (Python and Ollama can be installed later.)
> 
> 4. pages/gpu_detection.py:
>    A QWidget page with:
>    - Title "GPU Detection"
>    - Run GPU detection in a background thread:
>      * Windows: `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits`
>        If nvidia-smi fails, check for AMD via `rocm-smi --showproductname`
>        If both fail, check WMI: `wmic path win32_VideoController get Name,AdapterRAM`
>      * macOS: `system_profiler SPDisplaysDataType -json` to get GPU name and VRAM
>        For Apple Silicon, parse "Chip" from SPHardwareDataType to determine unified memory
>      * Linux: nvidia-smi (same as Windows), rocm-smi for AMD, lspci for fallback
>    - Display detected GPU info in a card: GPU name, VRAM, vendor
>    - Based on VRAM, recommend a model tier:
>      * VRAM >= 20 GB: recommend gemma4:31b (Dense 31B) â€” "Best quality, requires high VRAM"
>      * VRAM >= 8 GB: recommend gemma4:26b (26B MoE) â€” "Excellent balance of quality and speed"
>      * VRAM >= 6 GB: recommend gemma4:e4b (E4B) â€” "Recommended for most GPUs"
>      * VRAM >= 4 GB: recommend gemma4:e2b (E2B) â€” "Lightweight, fast responses"
>      * VRAM < 4 GB or no GPU: recommend gemma4:e2b with warning about CPU-only mode
>    - Show the recommendation in a highlighted callout box with the model name,
>      parameter count, download size, and expected VRAM usage.
>    - Store results in InstallerState (gpu_vendor, gpu_name, vram_mb, recommended_model).
> 
> 5. Wire all three pages into window.py:
>    - Pass InstallerState to each page constructor.
>    - Back/Next buttons navigate between pages and update the step indicator.
>    - The step indicator highlights the current page.
> 
> 6. Write tests in tests/:
>    - test_installer_state.py: Verify default values, platform-appropriate install paths.
>    - test_gpu_detection.py: Mock subprocess.run outputs for nvidia-smi, rocm-smi, and
>      system_profiler. Verify correct GPU vendor/VRAM/model recommendation for each tier.
>    - test_prerequisites.py: Mock platform detection functions. Verify Next button is
>      disabled when VS Code is not found.
> 
> Run the installer and verify all three pages render correctly, GPU detection produces
> a model recommendation, and the step indicator advances properly.

---

#### 7.3 -- Wizard Pages: Install Path, Model Selection, Configuration, and Review

**Objective**: Implement the four configuration wizard pages where the user chooses an install path, selects a model variant, configures optional settings, and reviews all choices before installation begins.

**Prompt**:
> Implement four wizard configuration pages for the Gemma Code PyQt5 installer at
> scripts/installer/pyqt/src/gemma_installer/pages/.
> 
> Files to create:
>   pages/install_path.py
>   pages/model_selection.py
>   pages/configuration.py
>   pages/review.py
> 
> 1. pages/install_path.py:
>    A QWidget page with:
>    - Title "Install Location"
>    - A text input field (#1c2433 bg, #1e2d3d border, 8px radius) pre-filled
>      with the platform-default install path from InstallerState.
>    - A "Browse..." secondary button that opens QFileDialog.getExistingDirectory().
>    - Below the input, show available disk space on the selected drive/mount point
>      in real-time as the path changes. Color-code: green if >= 10 GB, yellow
>      if 5-10 GB, red if < 5 GB.
>    - A CalloutBox explaining what gets installed where:
>      * "VS Code extension: installed via `code --install-extension`"
>      * "Ollama: system-wide (platform package manager)"
>      * "Python venv: <install_path>/venv/"
>      * "Gemma model: stored by Ollama in its default model directory"
>    - Validate the path is writable. Show an error label if not.
>    - Update InstallerState.install_path on change.
> 
> 2. pages/model_selection.py:
>    A QWidget page with:
>    - Title "Model Selection"
>    - Subtitle showing the GPU detection result: "Detected: <gpu_name> (<vram_mb> MB VRAM)"
>    - Four model option cards in a vertical list, each a clickable card widget:
>      * gemma4:e2b â€” "E2B (2.3B params)" / "5.1 GB download, 4 GB VRAM" / "Fast, lightweight"
>      * gemma4:e4b â€” "E4B (4.5B params)" / "8 GB download, 6 GB VRAM" / "Recommended for most GPUs"
>      * gemma4:26b â€” "26B MoE (3.8B active)" / "18 GB download, 8 GB VRAM" / "High quality, efficient"
>      * gemma4:31b â€” "31B Dense (30.7B params)" / "20 GB download, 20 GB VRAM" / "Maximum quality"
>    - The recommended model (from GPU detection) has a cyan "Recommended" badge.
>    - Cards that exceed detected VRAM show a yellow warning: "May exceed your GPU memory"
>    - Only one card can be selected (radio behavior). Selected card has a cyan border.
>    - A "Skip model download" checkbox at the bottom: "I'll pull the model later with
>      `ollama pull <model>`". When checked, removes "model" from components_to_install.
>    - Update InstallerState.selected_model on selection.
> 
> 3. pages/configuration.py:
>    A QWidget page with:
>    - Title "Configuration"
>    - Toggle switches (styled as custom QCheckBox with slider appearance) for:
>      * "Install Ollama" â€” default ON, disabled and checked if Ollama already installed
>      * "Create Python virtual environment" â€” default ON
>      * "Add Start Menu / Applications shortcut" â€” default ON (platform-appropriate label)
>      * "Enable thinking mode (chain-of-thought reasoning)" â€” default ON
>      * "Enable persistent memory (cross-session recall)" â€” default ON
>    - Ollama URL input: default "http://localhost:11434", editable
>    - VS Code extension settings section: show which settings will be configured
>      (model name, max tokens based on selected model, temperature 1.0, topP 0.95, topK 64)
>    - All toggles update InstallerState.components_to_install accordingly.
> 
> 4. pages/review.py:
>    A QWidget page with:
>    - Title "Review"
>    - Subtitle: "Please review your installation settings before proceeding."
>    - A summary card showing all choices:
>      * Install path
>      * Components to install (checkmarks for each)
>      * Selected model + download size
>      * Detected GPU
>      * Estimated total disk usage
>      * Estimated installation time (rough heuristic based on model size and components)
>    - A prominent CalloutBox: "Installation will download components from the internet.
>      Ensure you have a stable connection."
>    - The Next button text changes to "Install" with a download icon.
>    - All values are read from InstallerState (read-only display).
> 
> 5. Wire pages into window.py:
>    - Pages 4-7 in the step sequence (after GPU Detection, before Installing).
>    - Back/Next navigation flows correctly through all 7 pages so far.
>    - The "Install" button on the Review page triggers transition to the Installing page.
> 
> 6. Write tests in tests/:
>    - test_install_path.py: Verify path validation (writable vs. non-writable), disk space
>      display updates on path change, Browse button opens dialog.
>    - test_model_selection.py: Verify recommended badge appears on correct model,
>      VRAM warning logic, skip checkbox removes model from components.
>    - test_review.py: Verify all InstallerState fields are displayed correctly.
> 
> Run the installer and navigate through all 7 pages. Verify model selection highlights
> the recommended model, configuration toggles update state, and the review page
> displays an accurate summary.

---

#### 7.4 -- Installation Engine and Real-Time Log Panel

**Objective**: Implement the core installation engine that orchestrates all component installations (Ollama, VS Code extension, Python venv, model pull) with platform-specific logic, real-time progress reporting to the log panel, and the Installing wizard page with an indeterminate progress bar.

**Prompt**:
> Implement the installation engine and the Installing wizard page for the Gemma Code
> PyQt5 installer.
> 
> Files to create:
>   scripts/installer/pyqt/src/gemma_installer/engine/
>   â”œâ”€â”€ __init__.py
>   â”œâ”€â”€ installer.py          # Main InstallEngine orchestrator
>   â”œâ”€â”€ ollama_installer.py   # Platform-specific Ollama installation
>   â”œâ”€â”€ extension_installer.py # VS Code extension installation
>   â”œâ”€â”€ venv_installer.py     # Python venv creation and backend deps
>   â”œâ”€â”€ model_puller.py       # Ollama model pull with progress parsing
>   â””â”€â”€ platform_utils.py     # Cross-platform subprocess helpers
>   scripts/installer/pyqt/src/gemma_installer/pages/installing.py
> 
> 1. platform_utils.py:
>    - run_command(cmd: list[str], cwd: str | None = None) -> tuple[int, str, str]:
>      Runs subprocess with real-time stdout/stderr capture. Returns (exit_code, stdout, stderr).
>    - run_command_streaming(cmd: list[str], callback: Callable[[str], None]):
>      Runs subprocess and calls callback with each line of output as it arrives.
>      Used for long-running operations like model pull.
>    - is_windows() / is_macos() / is_linux(): Platform checks.
>    - find_executable(name: str, extra_paths: list[str]) -> str | None:
>      Cross-platform executable finder (checks PATH + common install locations).
> 
> 2. ollama_installer.py:
>    - class OllamaInstaller with install(state: InstallerState, log: Callable[[str, str], None]):
>    - Windows: Download OllamaSetup.exe from GitHub releases, run silently (/SILENT /AUTOSTART=0).
>      Mirror the existing NSIS logic from setup.nsi lines 128-143.
>    - macOS: Run `brew install ollama` if Homebrew is available, otherwise download from
>      https://ollama.com/download/Ollama-darwin.zip, extract, and copy to /usr/local/bin.
>    - Linux: Run `curl -fsSL https://ollama.com/install.sh | sh` (the official installer).
>    - After installation, verify Ollama is reachable: start `ollama serve` in background
>      (if not already running), poll http://localhost:11434/api/tags with 30-second timeout.
>    - Log each step to the callback (e.g., "Downloading Ollama...", "Installing Ollama...",
>      "Verifying Ollama connectivity...").
> 
> 3. extension_installer.py:
>    - class ExtensionInstaller with install(state: InstallerState, log: Callable):
>    - Locate the VSIX file. The installer must bundle the VSIX (embedded in the PyInstaller
>      executable via --add-data, or downloaded from GitHub Releases at install time).
>      For now, assume the VSIX is at a known relative path: ../gemma-code-{version}.vsix
>    - Run: `{state.vscode_path} --install-extension <vsix_path>`
>    - Verify installation: `{state.vscode_path} --list-extensions` contains "gemma-code.gemma-code"
>    - Platform-specific vscode_path resolution:
>      * Windows: state.vscode_path should be code.cmd (already detected in prerequisites)
>      * macOS: /Applications/Visual Studio Code.app/Contents/Resources/app/bin/code
>      * Linux: code (on PATH) or /usr/bin/code
> 
> 4. venv_installer.py:
>    - class VenvInstaller with install(state: InstallerState, log: Callable):
>    - Create venv: `{state.python_path} -m venv {state.install_path}/venv`
>    - Install backend dependencies:
>      * Locate backend-requirements.txt (bundled with installer or generated from
>        src/backend/pyproject.toml using `uv export`)
>      * Run: `{venv_pip} install -r backend-requirements.txt --quiet`
>    - Verify by checking that `{venv}/Scripts/python.exe` (Windows) or
>      `{venv}/bin/python` (Unix) exists and `import fastapi` succeeds.
> 
> 5. model_puller.py:
>    - class ModelPuller with pull(state: InstallerState, log: Callable, progress: Callable[[float], None]):
>    - Run: `ollama pull {state.selected_model}` with streaming output.
>    - Parse Ollama's progress output (lines like "pulling manifest...",
>      "pulling abc123... 45% |â–ˆâ–ˆâ–ˆâ–ˆ      |  2.3 GB/5.1 GB") to extract
>      percentage and report via the progress callback.
>    - This is the longest step. Provide size estimates in the log output.
>    - Handle cancellation (subprocess.terminate on user cancel).
> 
> 6. installer.py:
>    - class InstallEngine(QObject) with:
>      - Signal: log_message(str, str)  # (message, level)
>      - Signal: progress_update(float)  # 0.0 to 1.0
>      - Signal: step_completed(str)     # component name
>      - Signal: install_finished(bool, str)  # (success, error_message)
>      - Method: run(state: InstallerState) â€” runs in a QThread:
>        1. Install Ollama (if in components_to_install) â€” ~10% of progress
>        2. Install VS Code extension â€” ~20% of progress
>        3. Create Python venv â€” ~30% of progress
>        4. Pull Gemma model (if in components_to_install) â€” ~40% of progress
>        Each step logs to log_message and catches exceptions.
>        If a step fails, log the error and continue to the next step (non-fatal).
>        Report overall success/failure at the end.
> 
> 7. pages/installing.py:
>    A QWidget page with:
>    - Title "Installing..." (updates to "Installation Complete" or "Installation Failed")
>    - 8px indeterminate QProgressBar with cyan gradient (#0ABFBF to #0a8f8f),
>      track color #1c2433. Switches to determinate mode when model pull provides percentage.
>    - The LogPanel widget (from widgets/log_panel.py) showing real-time installation logs.
>      Automatically scrolls to the bottom. Color-coded by level.
>    - Back button disabled during installation.
>    - Next button disabled during installation, enabled on completion.
>    - A "Cancel" secondary button that terminates the current subprocess and asks
>      for confirmation ("Cancel installation? Components already installed will remain.").
>    - Connect InstallEngine signals to UI updates.
> 
> 8. Write tests in tests/:
>    - test_ollama_installer.py: Mock subprocess.run for each platform. Verify correct
>      commands are called for Windows (OllamaSetup.exe), macOS (brew install), Linux (curl).
>    - test_extension_installer.py: Mock subprocess.run. Verify code --install-extension
>      is called with correct VSIX path.
>    - test_model_puller.py: Mock subprocess output with sample Ollama progress lines.
>      Verify progress percentage parsing.
>    - test_install_engine.py: Mock all sub-installers. Verify the engine runs steps
>      in order, emits signals correctly, and handles partial failures gracefully.
> 
> Run the installer end-to-end (with Ollama already installed to skip that step).
> Verify the log panel shows real-time output and the progress bar updates.

---

#### 7.5 -- Completion Page and Window Navigation Polish

**Objective**: Implement the final "Complete" wizard page showing running services, management commands, and an "Open VS Code" button. Polish the full wizard navigation flow, error handling, and page transition animations.

**Prompt**:
> Implement the Complete wizard page and polish the full wizard navigation for the
> Gemma Code PyQt5 installer.
> 
> Files to create:
>   scripts/installer/pyqt/src/gemma_installer/pages/complete.py
> 
> Files to modify:
>   scripts/installer/pyqt/src/gemma_installer/window.py (navigation polish)
>   scripts/installer/pyqt/src/gemma_installer/main.py (finalize page registration)
> 
> 1. pages/complete.py:
>    A QWidget page with:
>    - Title "Installation Complete" (with a green checkmark icon) or
>      "Installation Completed with Warnings" (yellow icon if some steps failed)
>    - Subtitle: "Gemma Code is installed and ready to use."
>    - A "Running Services" card (matching the reference design screenshot 3):
>      Table layout with service name and endpoint:
>      * "Ollama" â€” "http://localhost:11434" (or "Not running" in yellow if health check fails)
>      * "Python backend" â€” "http://localhost:11435"
>      * "VS Code extension" â€” "gemma-code.gemma-code (installed)"
>    - A "Managing Gemma Code" card with useful commands:
>      * "Start Ollama" â€” `ollama serve`
>      * "Pull a different model" â€” `ollama pull gemma4:26b`
>      * "Check model status" â€” `ollama list`
>      * "Uninstall extension" â€” `code --uninstall-extension gemma-code.gemma-code`
>      Each command is in a monospace code block (Consolas/SF Mono, #111820 bg) with
>      a copy-to-clipboard button.
>    - An "Open VS Code" primary button that launches VS Code via subprocess:
>      * Windows: start "" "{vscode_path}"
>      * macOS: open -a "Visual Studio Code"
>      * Linux: code &
>    - A "View Installation Log" secondary button that opens a save dialog to export
>      the full installation log to a .txt file.
>    - If any installation steps failed, show a warning callout box listing the failures
>      and manual remediation steps.
>    - The footer shows "Finish" instead of "Next" and closes the application on click.
> 
> 2. window.py navigation polish:
>    - Implement smooth page transitions: content area fades out current page (150ms
>      QPropertyAnimation on opacity) then fades in the new page.
>    - Back button: return to previous page, update step indicator.
>    - Next button: advance to next page, run page validation first.
>      Each page exposes a validate() -> tuple[bool, str] method.
>      If validation fails, show the error message in a red label below the content.
>    - Keyboard shortcuts: Enter/Return triggers Next, Escape triggers Back.
>    - On window close (X button), if installation is in progress, show a confirmation dialog.
>    - If installation has not started, close without confirmation.
> 
> 3. main.py finalization:
>    - Register all 9 pages in order.
>    - Set the window title to "Gemma Code â€” Setup" matching the reference design.
>    - Set the window icon to the Gemma Code icon (assets/icon.ico from repo root).
>    - Handle --debug flag: enables verbose logging to stdout.
>    - Handle --version flag: prints the version and exits.
>    - On macOS: set NSHighResolutionCapable = True for Retina displays.
> 
> 4. Write tests in tests/:
>    - test_complete.py: Verify "Open VS Code" button triggers the correct subprocess
>      command per platform. Verify log export creates a valid text file.
>    - test_navigation.py: Create a mock wizard with 3 dummy pages. Verify Back/Next
>      navigation, step indicator updates, and validation blocking.
> 
> 5. Final end-to-end verification:
>    Run the full installer wizard from step 1 through step 9. Verify:
>    - All 9 steps appear in the step indicator
>    - Back/Next navigation works across all pages
>    - GPU detection populates model recommendation
>    - Model selection pre-selects the recommended model
>    - Review page shows accurate summary
>    - Installing page shows real-time log output
>    - Complete page shows running services and management commands
>    - "Open VS Code" button launches VS Code
>    - "Finish" closes the application

---

#### 7.6 -- Cross-Platform Packaging (PyInstaller/py2app/AppImage)

**Objective**: Create build scripts that package the PyQt5 installer into a single-file executable for each target platform: Windows (.exe via PyInstaller), macOS (.app in .dmg via PyInstaller or py2app), and Linux (AppImage via PyInstaller). Integrate into the existing CI/CD pipeline.

**Prompt**:
> Create cross-platform packaging scripts for the Gemma Code PyQt5 installer.
> 
> Files to create:
>   scripts/installer/pyqt/build/
>   â”œâ”€â”€ build-windows.ps1     # PowerShell: PyInstaller --onefile --windowed for Windows
>   â”œâ”€â”€ build-macos.sh        # Bash: PyInstaller for macOS .app, optional .dmg creation
>   â”œâ”€â”€ build-linux.sh        # Bash: PyInstaller for Linux, optional AppImage bundling
>   â”œâ”€â”€ gemma-installer.spec  # PyInstaller spec file (shared, platform-adapted)
>   â””â”€â”€ hooks/
>       â””â”€â”€ hook-PyQt5.py     # PyInstaller hook to include QSS and assets
> 
> Files to modify:
>   .github/workflows/release.yml  # Add macOS and Linux installer build jobs
> 
> 1. gemma-installer.spec:
>    - name: "GemmaCodeSetup" (Windows), "Gemma Code Installer" (macOS), "gemma-code-setup" (Linux)
>    - onefile: True (produces a single executable)
>    - windowed: True (no console window)
>    - icon: ../../assets/icon.ico (Windows), ../../assets/icon.icns (macOS, must create)
>    - datas: Include the VSIX file (../gemma-code-{version}.vsix), backend-requirements.txt,
>      and assets/icon.png for the installer UI.
>    - hidden_imports: PyQt5.QtWidgets, PyQt5.QtCore, PyQt5.QtGui, PyQt5.QtSvg
>    - Platform detection in spec: use sys.platform to set platform-specific options.
> 
> 2. build-windows.ps1:
>    - Install build dependencies: `uv pip install pyinstaller pyqt5`
>    - Copy the VSIX from the repo root to the pyqt/ directory
>    - Copy backend-requirements.txt from scripts/installer/
>    - Run PyInstaller with the spec file
>    - Output: dist/GemmaCodeSetup.exe
>    - Optionally sign with signtool (if a certificate is available) matching the
>      existing code-signing pattern from scripts/installer/build-installer.ps1
>    - Print the file size and SHA256 hash of the output
> 
> 3. build-macos.sh:
>    - Install dependencies: `pip install pyinstaller pyqt5`
>    - Create an .icns icon from the PNG (use `sips` and `iconutil` on macOS)
>    - Run PyInstaller with --windowed --onefile
>    - Output: dist/Gemma Code Installer.app
>    - Optionally create a .dmg using hdiutil:
>      * Create a temporary directory with the .app and a symlink to /Applications
>      * `hdiutil create -volname "Gemma Code Installer" -srcfolder <tmpdir> -ov -format UDBZ GemmaCodeSetup.dmg`
>    - If codesign identity is available (CI), sign the .app
> 
> 4. build-linux.sh:
>    - Install dependencies: `pip install pyinstaller pyqt5`
>    - Run PyInstaller with --onefile
>    - Output: dist/gemma-code-setup
>    - Make it executable: chmod +x
>    - Optionally bundle as AppImage:
>      * Create AppDir structure with .desktop file and icon
>      * Download appimagetool if not present
>      * Run appimagetool to create GemmaCodeSetup-x86_64.AppImage
>    - Print file size and SHA256
> 
> 5. Update .github/workflows/release.yml:
>    Add two new build jobs alongside the existing build-installer job:
> 
>    build-installer-macos:
>      runs-on: macos-latest
>      needs: build-vsix
>      steps:
>        - Checkout, setup Python 3.12, download VSIX artifact
>        - Run build-macos.sh
>        - Upload artifact: installer-macos (the .dmg or .app)
> 
>    build-installer-linux:
>      runs-on: ubuntu-latest
>      needs: build-vsix
>      steps:
>        - Checkout, setup Python 3.12, install system deps (libxcb, etc. for PyQt5)
>        - Download VSIX artifact
>        - Run build-linux.sh
>        - Upload artifact: installer-linux (the AppImage or binary)
> 
>    Update the create-release job:
>      - Download all three installer artifacts
>      - Attach all three to the GitHub Release alongside the VSIX:
>        * GemmaCodeSetup.exe (Windows)
>        * GemmaCodeSetup.dmg (macOS)
>        * GemmaCodeSetup-x86_64.AppImage (Linux)
> 
>    Rename the existing build-installer job to build-installer-windows and update it
>    to use the new PyQt5 installer instead of NSIS:
>      - Replace the NSIS compile step with build-windows.ps1
>      - Remove the `choco install nsis` step
> 
> 6. Write a test script tests/test_packaging.py:
>    - Verify the .spec file exists and contains required datas entries
>    - Verify build scripts exist and are executable (on their respective platforms)
>    - Verify VSIX file pattern resolution works
> 
> Run build-windows.ps1 locally and verify it produces a working GemmaCodeSetup.exe
> that launches the PyQt5 installer wizard. Verify the bundled VSIX and requirements
> file are accessible from within the packaged executable.

---

#### 7.7 -- Installer Test Suite and Migration Cleanup

**Objective**: Create a comprehensive test suite for the installer (unit tests for detection logic, integration tests for install sequences on each platform), update the existing CI workflows to run these tests, and deprecate the old NSIS installer by moving it to a legacy directory.

**Prompt**:
> Create the installer test suite and clean up the NSIS-to-PyQt5 migration.
> 
> Files to create:
>   scripts/installer/pyqt/tests/
>   â”œâ”€â”€ test_detection.py       # Unit tests for prerequisite detection
>   â”œâ”€â”€ test_gpu_detection.py   # Unit tests for GPU probing (mocked subprocesses)
>   â”œâ”€â”€ test_engine.py          # Integration tests for InstallEngine
>   â”œâ”€â”€ test_widgets.py         # Widget rendering tests (QTest)
>   â”œâ”€â”€ conftest.py             # Shared fixtures and platform mocks
>   tests/integration/installer/
>   â”œâ”€â”€ test-install-pyqt.ps1   # Windows integration test (replaces test-install-sequence.ps1)
>   â”œâ”€â”€ test-install-pyqt-macos.sh   # macOS integration test
>   â””â”€â”€ test-install-pyqt-linux.sh   # Linux integration test
> 
> Files to modify:
>   .github/workflows/ci.yml   # Add installer unit tests
>   .github/workflows/nightly.yml  # Add installer integration tests per platform
> 
> Directories to reorganize:
>   scripts/installer/legacy/   # Move setup.nsi, build-installer.ps1, backend-requirements.txt here
> 
> 1. conftest.py:
>    - Fixture: mock_state() â€” returns an InstallerState with all fields populated
>      for the current platform (auto-detected).
>    - Fixture: mock_subprocess() â€” patches subprocess.run and subprocess.Popen
>      with configurable return values.
>    - Fixture: mock_platform(platform_name: str) â€” patches sys.platform, os.name,
>      and platform-specific detection functions.
>    - Fixture: qt_app() â€” creates a QApplication instance for widget tests.
> 
> 2. test_detection.py:
>    Test the prerequisite detection logic for all three platforms using mocked subprocess:
>    - test_find_vscode_windows_registry: Mock registry query returning a path, verify detection
>    - test_find_vscode_windows_path: Mock PATH lookup, verify detection
>    - test_find_vscode_macos_app: Mock /Applications/Visual Studio Code.app existence
>    - test_find_vscode_linux_which: Mock `which code` returning a path
>    - test_find_vscode_not_found: Mock all lookups failing, verify empty result
>    - test_find_python_311_plus: Mock Python 3.12 found, verify version check passes
>    - test_find_python_310_rejected: Mock Python 3.10 found, verify it's rejected (< 3.11)
>    - test_find_python_windows_store_excluded: Mock WindowsApps Python, verify excluded
>    - test_find_ollama_installed: Mock `ollama --version` succeeding
>    - test_find_ollama_not_installed: Mock all checks failing
>    - test_disk_space_check: Mock shutil.disk_usage, verify threshold logic
> 
> 3. test_gpu_detection.py:
>    - test_nvidia_gpu_detected: Mock nvidia-smi output "NVIDIA GeForce RTX 4090,24576"
>      Verify gpu_vendor="nvidia", vram_mb=24576, recommended_model="gemma4:31b"
>    - test_nvidia_8gb: Mock output "NVIDIA GeForce RTX 3060,8192"
>      Verify recommended_model="gemma4:26b"
>    - test_amd_gpu_detected: Mock rocm-smi output. Verify gpu_vendor="amd"
>    - test_apple_silicon: Mock system_profiler JSON with Apple M2 Pro.
>      Verify gpu_vendor="apple", unified memory handling
>    - test_no_gpu: Mock all tools failing. Verify gpu_vendor="none",
>      recommended_model="gemma4:e2b"
>    - test_intel_integrated: Mock lspci showing Intel UHD. Verify low-tier recommendation
> 
> 4. test_engine.py:
>    - test_full_install_sequence: Mock all sub-installers. Verify InstallEngine
>      calls them in order: Ollama -> extension -> venv -> model.
>    - test_skip_ollama_when_installed: Set ollama_installed=True, verify OllamaInstaller
>      is not called.
>    - test_skip_model_when_unchecked: Remove "model" from components_to_install,
>      verify ModelPuller is not called.
>    - test_partial_failure_continues: Make VenvInstaller raise, verify ModelPuller
>      still runs and install_finished reports partial success.
>    - test_cancel_during_model_pull: Simulate cancel signal, verify subprocess is terminated.
> 
> 5. test_widgets.py (using QTest from PyQt5.QtTest):
>    - test_step_indicator_renders: Create StepIndicator with 9 steps, set current_step=3,
>      grab the widget pixmap and verify it's not blank.
>    - test_log_panel_scrolls: Append 100 lines to LogPanel, verify scroll position
>      is at the bottom.
>    - test_primary_button_style: Verify button height is 38px and objectName is set.
>    - test_callout_box_structure: Verify CalloutBox contains the left stripe and icon.
> 
> 6. Platform integration tests:
>    - test-install-pyqt.ps1 (Windows): Similar to the existing test-install-sequence.ps1
>      but testing the PyQt5 installer:
>      * Launch GemmaCodeSetup.exe in silent/headless mode (add a --headless --auto flag
>        that skips UI and runs all install steps with defaults)
>      * Verify VS Code extension is installed
>      * Verify Python venv is created
>      * Verify Ollama is reachable
>      * Clean up: uninstall extension, remove venv
>    - test-install-pyqt-macos.sh: Same logic for macOS (launch .app from CLI)
>    - test-install-pyqt-linux.sh: Same logic for Linux (run AppImage with --headless)
> 
> 7. CI integration:
>    Update .github/workflows/ci.yml:
>    - Add a job "test-installer" that runs on ubuntu-latest:
>      * Install PyQt5 system dependencies (libxcb, etc.)
>      * cd scripts/installer/pyqt && uv run pytest tests/ -v
> 
>    Update .github/workflows/nightly.yml:
>    - Add per-platform installer smoke tests:
>      * installer-smoke-windows: runs-on windows-latest, run test-install-pyqt.ps1
>      * installer-smoke-macos: runs-on macos-latest, run test-install-pyqt-macos.sh
>      * installer-smoke-linux: runs-on ubuntu-latest, run test-install-pyqt-linux.sh
> 
> 8. NSIS migration:
>    - Move scripts/installer/setup.nsi to scripts/installer/legacy/setup.nsi
>    - Move scripts/installer/build-installer.ps1 to scripts/installer/legacy/build-installer.ps1
>    - Move scripts/installer/backend-requirements.txt to scripts/installer/legacy/
>    - Keep scripts/installer/setup.exe in legacy/ (the already-built NSIS installer)
>    - Update any documentation references from the NSIS installer to the new PyQt5 installer
>    - Add a README.md in scripts/installer/legacy/ explaining these are deprecated v0.1.0/v0.2.0
>      artifacts retained for reference.
> 
> Run the full installer test suite with:
>   cd scripts/installer/pyqt && uv run pytest tests/ -v
> Verify all tests pass. Then run the CI workflow locally (if possible) or verify
> the YAML syntax is valid.

---

#### 7.T -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 7. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 7. Include unit tests for prerequisite detection, GPU detection, installation engine steps, and theme rendering. Integration tests for full wizard flow on each platform.
> Run the tests, fix all failures, and iterate until every test passes with 80%+ coverage.
> Do not advance to Phase 8 until this phase is fully verified.
> After all tests pass, run /generate-session-history to document this phase.

---

### Phase 7 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing (80%+ coverage)
- [ ] No known regressions from prior phases
- [ ] Session history generated for this phase
- [ ] Ready to advance to Phase 8

---

## Phase 8: Golden Task Suite & Integration Stabilization

**Goal**: Create 20+ golden tasks, run per-tier benchmarks, establish regression baseline, smoke test installers, and generate full documentation.
**Prerequisites**: All prior phases.
**Stability Gate**: Golden task suite achieves 80%+ pass rate on Tier 2 hardware. Benchmarks establish v0.3.0 baseline. Installer smoke tests pass on all platforms. Documentation is complete and accurate.

### Sub-tasks

#### 8.1 -- Golden Task Framework and Repository Scaffold

**Objective**: Design and implement the golden task framework -- a harness that can load task definitions from YAML, set up initial repository state from git snapshots, run the agent loop against a task, evaluate success criteria, and report results. This is the infrastructure all individual golden tasks plug into.

**Prompt**:
> Create the golden task evaluation framework for Gemma Code.
> 
> Files to create:
>   tests/golden/
>   â”œâ”€â”€ README.md              # Documentation for the golden task format
>   â”œâ”€â”€ framework/
>   â”‚   â”œâ”€â”€ __init__.py
>   â”‚   â”œâ”€â”€ task_loader.py     # Loads task definitions from YAML
>   â”‚   â”œâ”€â”€ task_runner.py     # Executes tasks against the agent loop
>   â”‚   â”œâ”€â”€ evaluator.py       # Evaluates task outcomes against success criteria
>   â”‚   â”œâ”€â”€ reporter.py        # Generates JSON/Markdown result reports
>   â”‚   â”œâ”€â”€ snapshot.py        # Git snapshot setup/teardown (worktree-based)
>   â”‚   â””â”€â”€ types.py           # GoldenTask, TaskResult, SuccessCriteria dataclasses
>   â”œâ”€â”€ conftest.py            # Pytest fixtures for golden task execution
>   â”œâ”€â”€ tasks/                 # Individual task YAML definitions (created in 8.2)
>   â”‚   â””â”€â”€ .gitkeep
>   â””â”€â”€ snapshots/             # Git repo snapshots for task initial state
>       â””â”€â”€ .gitkeep
> 
> 1. types.py:
>    Define the data model for golden tasks:
> 
>    @dataclass
>    class GoldenTask:
>        id: str                    # e.g., "multi-file-rename-01"
>        name: str                  # Human-readable name
>        category: str              # "multi-file-edit", "bug-fix", "refactor", "test-gen", "code-review"
>        description: str           # Task prompt (what the user would type)
>        initial_state: str         # Path to snapshot directory or git ref
>        expected_files_changed: list[str]  # Files that should be modified
>        success_criteria: list[SuccessCriteria]
>        max_iterations: int        # Agent loop iteration limit (default 20)
>        timeout_seconds: int       # Hard timeout (default 300)
>        model_tier: str            # Minimum model: "e2b", "e4b", "26b", "31b", "any"
>        tags: list[str]            # For filtering: ["fast", "filesystem", "typescript"]
> 
>    @dataclass
>    class SuccessCriteria:
>        type: str                  # "file_contains", "file_exists", "file_deleted",
>                                   # "test_passes", "lint_passes", "diff_matches",
>                                   # "output_contains", "no_errors"
>        target: str                # File path or command
>        pattern: str               # Regex or literal string to match
>        description: str           # Human-readable description of what this checks
> 
>    @dataclass
>    class TaskResult:
>        task_id: str
>        success: bool
>        criteria_results: list[tuple[SuccessCriteria, bool, str]]  # (criteria, passed, detail)
>        iterations_used: int
>        time_elapsed_ms: float
>        tokens_consumed: int
>        model_used: str
>        error: str | None
>        agent_trace: list[dict]    # Full conversation + tool calls for debugging
> 
> 2. task_loader.py:
>    - load_task(yaml_path: str) -> GoldenTask: Parse a YAML file into a GoldenTask.
>    - load_all_tasks(directory: str) -> list[GoldenTask]: Load all .yaml files from a dir.
>    - Filter functions: by_category(), by_model_tier(), by_tag().
>    YAML format example:

---

#### 8.2 -- Golden Task Definitions (20+ Tasks)

**Objective**: Create 20+ golden task YAML definitions spanning all five target categories (multi-file edits, bug fixes, refactors, test generation, code review), along with their git snapshot initial states. Each task must be self-contained and reproducible.

**Prompt**:
> Create 24 golden task definitions for the Gemma Code evaluation suite.
> 
> Files to create in tests/golden/tasks/:
>   # Multi-file edit tasks (5)
>   multi-file-rename-01.yaml
>   multi-file-add-import-02.yaml
>   multi-file-config-update-03.yaml
>   multi-file-api-endpoint-04.yaml
>   multi-file-type-propagation-05.yaml
> 
>   # Bug fix tasks (5)
>   bugfix-off-by-one-01.yaml
>   bugfix-null-check-02.yaml
>   bugfix-async-await-03.yaml
>   bugfix-import-path-04.yaml
>   bugfix-race-condition-05.yaml
> 
>   # Refactor tasks (5)
>   refactor-extract-function-01.yaml
>   refactor-class-to-module-02.yaml
>   refactor-callback-to-async-03.yaml
>   refactor-deduplicate-04.yaml
>   refactor-rename-pattern-05.yaml
> 
>   # Test generation tasks (5)
>   testgen-unit-function-01.yaml
>   testgen-edge-cases-02.yaml
>   testgen-mock-dependency-03.yaml
>   testgen-integration-api-04.yaml
>   testgen-error-handling-05.yaml
> 
>   # Code review tasks (4)
>   review-security-vuln-01.yaml
>   review-performance-02.yaml
>   review-error-handling-03.yaml
>   review-code-quality-04.yaml
> 
> Also create git snapshot directories in tests/golden/snapshots/ with minimal
> TypeScript/Python projects for each task.
> 
> DESIGN PRINCIPLES:
> - Each task must be completable in under 20 agent iterations on E4B.
> - Snapshots must be small (3-10 files, under 500 lines total per project).
> - Tasks should test real Gemma Code capabilities: file reading, editing, terminal
>   execution, multi-file reasoning, error detection.
> - Success criteria must be objectively verifiable (no subjective quality judgments).
> - Each category should have a range of difficulties: 2 easy, 2 medium, 1 hard.
> 
> TASK SPECIFICATIONS:
> 
> 1. multi-file-rename-01: Rename `processData` to `transformPayload` across 3 TypeScript files.
>    Snapshot: 3 TS files with function definition and imports.
>    Criteria: function renamed, imports updated, `tsc` succeeds.
> 
> 2. multi-file-add-import-02: Add a new utility function to utils.ts and use it in 2 other files.
>    Snapshot: 3 TS files, utils.ts has existing functions.
>    Criteria: new function exists, imports added, `tsc` succeeds.
> 
> 3. multi-file-config-update-03: Update a config schema and all consumers (5 files).
>    Snapshot: config.ts defines a Settings interface, 4 files reference it.
>    Criteria: new field added to interface, all consumers updated, `tsc` succeeds.
> 
> 4. multi-file-api-endpoint-04: Add a new REST endpoint with handler, router, and test.
>    Snapshot: Express-style project with existing endpoints.
>    Criteria: new route file exists, router updated, basic test exists, `tsc` succeeds.
> 
> 5. multi-file-type-propagation-05: Change a return type and propagate through call chain.
>    Snapshot: 4-file call chain where function A calls B calls C calls D.
>    Criteria: return type changed at source, all callers updated, `tsc` succeeds.
> 
> 6. bugfix-off-by-one-01: Fix an off-by-one error in a loop that processes an array.
>    Snapshot: function with `for (let i = 0; i <= arr.length; ...)` bug.
>    Criteria: loop condition fixed, existing test passes.
> 
> 7. bugfix-null-check-02: Add missing null check that causes a runtime crash.
>    Snapshot: function that accesses .property without null guard.
>    Criteria: null check added, function handles null input gracefully, test passes.
> 
> 8. bugfix-async-await-03: Fix missing await on an async function call.
>    Snapshot: async function that forgets to await a promise.
>    Criteria: await added, function returns correct value, test passes.
> 
> 9. bugfix-import-path-04: Fix broken import paths after a directory restructure.
>    Snapshot: 3 files with wrong relative import paths.
>    Criteria: imports corrected, `tsc` succeeds.
> 
> 10. bugfix-race-condition-05: Fix a race condition in concurrent operations.
>     Snapshot: Two async functions that share mutable state without synchronization.
>     Criteria: Mutex/lock added, concurrent test passes.
> 
> 11. refactor-extract-function-01: Extract a 30-line code block into a named function.
>     Snapshot: Single file with a long function containing an extractable block.
>     Criteria: new function created, original code calls it, `tsc` succeeds.
> 
> 12. refactor-class-to-module-02: Convert a singleton class to a module with functions.
>     Snapshot: Class with static methods only.
>     Criteria: class removed, exported functions replace methods, callers updated.
> 
> 13. refactor-callback-to-async-03: Convert callback-based code to async/await.
>     Snapshot: File using nested callbacks (callback hell).
>     Criteria: Callbacks replaced with async/await, `tsc` succeeds, test passes.
> 
> 14. refactor-deduplicate-04: Extract duplicated code from 3 files into a shared utility.
>     Snapshot: 3 files with nearly identical 10-line blocks.
>     Criteria: shared utility created, duplicates replaced with imports, `tsc` succeeds.
> 
> 15. refactor-rename-pattern-05: Rename all Hungarian notation variables (strName, intCount)
>     to camelCase across 4 files.
>     Snapshot: 4 files with Hungarian notation variables.
>     Criteria: no Hungarian prefixes remain, `tsc` succeeds.
> 
> 16. testgen-unit-function-01: Generate unit tests for a pure function.
>     Snapshot: math utility with add, multiply, divide functions, no tests.
>     Criteria: test file created, covers happy path + edge cases, tests pass.
> 
> 17. testgen-edge-cases-02: Add edge case tests to an existing test file.
>     Snapshot: string utility with basic tests, missing edge cases (empty, unicode, long).
>     Criteria: edge case tests added, all tests pass.
> 
> 18. testgen-mock-dependency-03: Generate tests for a function with external dependencies.
>     Snapshot: function that calls an HTTP client (needs mocking).
>     Criteria: test file with mocked dependency, tests pass.
> 
> 19. testgen-integration-api-04: Generate integration test for an API handler.
>     Snapshot: Express handler with database calls.
>     Criteria: integration test with supertest, tests pass.
> 
> 20. testgen-error-handling-05: Generate tests that verify error handling paths.
>     Snapshot: function with try/catch but no tests for error paths.
>     Criteria: tests verify each error branch, thrown errors match expected types.
> 
> 21. review-security-vuln-01: Identify and fix a SQL injection vulnerability.
>     Snapshot: function with string-concatenated SQL query.
>     Criteria: parameterized query used, no string concatenation in SQL.
> 
> 22. review-performance-02: Identify and fix an O(n^2) algorithm.
>     Snapshot: nested loops doing a lookup that should use a Map.
>     Criteria: Map/Set used, time complexity improved.
> 
> 23. review-error-handling-03: Identify missing error handling in async code.
>     Snapshot: multiple unguarded async calls without try/catch.
>     Criteria: proper error handling added, errors don't crash the process.
> 
> 24. review-code-quality-04: Identify and fix code smells (magic numbers, dead code, long function).
>     Snapshot: file with multiple code smells.
>     Criteria: constants extracted, dead code removed, function split.
> 
> For each task, create:
> 1. The YAML definition file in tests/golden/tasks/
> 2. A snapshot directory in tests/golden/snapshots/{task-id}/ with:
>    - package.json (minimal, with TypeScript + vitest dev dependencies)
>    - tsconfig.json (strict mode)
>    - The source files representing the initial state
>    - Any existing test files (for bug-fix tasks that have tests)
>    - A README.md in each snapshot explaining the task
> 3. Initialize each snapshot as a mini git repo (`git init` + initial commit)
>    so the agent can use git tools.
> 
> After creating all tasks, run the task loader to verify all 24 YAML files parse
> correctly:
>   cd tests/golden && python -c "from framework.task_loader import load_all_tasks; tasks = load_all_tasks('tasks'); print(f'{len(tasks)} tasks loaded')"
> Verify it prints "24 tasks loaded".

---

#### 8.3 -- Per-Tier GPU Benchmarks and Regression Baseline

**Objective**: Extend the existing benchmark suite with per-model-tier benchmarks that measure time-to-first-token, task completion time, token efficiency, and memory recall accuracy. Establish the v0.3.0 regression baseline and implement automated comparison against it.

**Prompt**:
> Extend the benchmark suite with per-tier GPU benchmarks and establish a regression baseline.
> 
> Files to create:
>   tests/benchmarks/golden-task-perf.bench.ts   # Golden task performance benchmarks
>   tests/benchmarks/memory-recall.bench.ts       # Memory system accuracy benchmark
>   tests/benchmarks/model-tier-matrix.bench.ts   # Per-tier latency and throughput
>   tests/golden/framework/baseline.py            # Baseline management
>   tests/golden/framework/regression.py          # Regression detection
>   tests/golden/baselines/                        # Baseline JSON files
>       v0.3.0-e2b.json
>       v0.3.0-e4b.json
>   docs/archive/versions/v0/v0.3.0/performance-benchmarks.md         # Updated benchmark documentation
> 
> 1. model-tier-matrix.bench.ts:
>    Extend the existing time-to-first-token.bench.ts pattern to run against multiple model tiers.
>    - Read TEST_MODEL_TIERS from env (comma-separated, e.g., "gemma4:e2b,gemma4:e4b")
>      or default to the single TEST_MODEL.
>    - For each tier, benchmark:
>      * Time to first token (existing metric): p50 and p99
>      * Tokens per second (throughput): measure over a 100-token generation
>      * Context load time: time to process a 10K-token system prompt
>    - Thresholds per tier (configurable via constants):
>      * E2B: TTFT p50 < 1000ms, throughput > 30 tok/s
>      * E4B: TTFT p50 < 2000ms, throughput > 20 tok/s
>      * 26B: TTFT p50 < 3000ms, throughput > 10 tok/s
>      * 31B: TTFT p50 < 5000ms, throughput > 5 tok/s
>    - Output structured JSON results alongside Vitest bench output.
> 
> 2. memory-recall.bench.ts:
>    Benchmark the MemoryStore accuracy and retrieval latency.
>    - Set up: Create a MemoryStore instance, insert 100 memory entries of each type
>      (decision, fact, preference, file_pattern, error_resolution) = 500 total entries.
>    - Benchmark: keyword search recall
>      * Query 20 known terms, measure recall@5 (how many of top-5 results are relevant)
>      * Target: recall@5 >= 0.8
>    - Benchmark: semantic search recall (if embeddings available)
>      * Query 20 paraphrased descriptions of stored facts
>      * Target: recall@5 >= 0.7
>    - Benchmark: retrieval latency
>      * p99 < 100ms for keyword search on 500 entries
>      * p99 < 500ms for semantic search on 500 entries
>    - Skip semantic benchmarks if OLLAMA_URL is not set.
> 
> 3. golden-task-perf.bench.ts:
>    Bridge the Python golden task framework with the TypeScript benchmark suite.
>    - For each golden task category, run 2 representative tasks and measure:
>      * Task completion time (wall clock)
>      * Agent iterations used
>      * Total tokens consumed (input + output)
>      * Token efficiency: tokens per successful criteria
>    - This benchmark requires OLLAMA_URL and a pulled model.
>    - Output results as structured JSON that feeds into the regression detector.
> 
> 4. tests/golden/framework/baseline.py:
>    - save_baseline(results: list[TaskResult], model: str, version: str, output_dir: str):
>      Save task results as a JSON baseline file: {version}-{model_tier}.json
>      Includes: per-task metrics (time, iterations, tokens, pass/fail), aggregate stats,
>      timestamp, model name, hardware info (GPU, VRAM from nvidia-smi).
>    - load_baseline(path: str) -> dict: Load a baseline JSON file.
>    - Baseline format:
>      {
>        "version": "0.3.0",
>        "model": "gemma4:e4b",
>        "timestamp": "2026-04-14T...",
>        "hardware": { "gpu": "RTX 4090", "vram_mb": 24576 },
>        "tasks": {
>          "multi-file-rename-01": {
>            "passed": true, "iterations": 8, "time_ms": 45000, "tokens": 12000
>          }, ...
>        },
>        "aggregates": {
>          "pass_rate": 0.92, "mean_iterations": 10.5, "mean_time_ms": 52000,
>          "by_category": { "multi-file-edit": { "pass_rate": 1.0, ... }, ... }
>        }
>      }
> 
> 5. tests/golden/framework/regression.py:
>    - detect_regressions(current: list[TaskResult], baseline: dict, thresholds: dict) -> list[Regression]:
>    - Compare current results against baseline. Flag regressions:
>      * Task that passed in baseline but fails now
>      * Task completion time increased by more than 50%
>      * Token consumption increased by more than 30%
>      * Iterations increased by more than 50%
>      * Overall pass rate dropped by more than 5%
>    - Each Regression has: task_id, metric, baseline_value, current_value, severity (warn/error)
>    - generate_regression_report(regressions: list[Regression]) -> str:
>      Markdown report listing all regressions with severity.
> 
> 6. docs/archive/versions/v0/v0.3.0/performance-benchmarks.md:
>    Update the existing performance benchmarks documentation (based on docs/archive/versions/v0/v0.1.0/performance-benchmarks.md)
>    to include:
>    - Model tier benchmark matrix table
>    - Memory recall accuracy targets
>    - Golden task performance targets by category
>    - Regression detection methodology
>    - Instructions for running per-tier benchmarks
>    - Instructions for generating and comparing baselines
> 
> 7. Write tests:
>    - tests/golden/framework/test_baseline.py: Verify save/load round-trip, format validation
>    - tests/golden/framework/test_regression.py: Mock baseline and current results, verify
>      regression detection for each metric type (pass/fail change, time increase, token increase)
>    - Verify model-tier-matrix.bench.ts compiles with `npx tsc --noEmit`
> 
> 8. Update .github/workflows/nightly.yml:
>    Add a golden-task-benchmarks job:
>    - runs-on: ubuntu-latest (with GPU if available, otherwise E2B on CPU)
>    - Install Ollama, pull gemma4:e2b
>    - Run: npm run bench -- tests/benchmarks/model-tier-matrix.bench.ts
>    - Run: cd tests/golden && python -m pytest -x --golden-run
>    - Upload baseline JSON as artifact
>    - Compare against stored baseline, fail if regressions detected
> 
> Run the regression framework tests to verify correctness:
>   cd tests/golden && python -m pytest framework/test_baseline.py framework/test_regression.py -v

---

#### 8.4 -- Cross-Platform Installer Smoke Tests

**Objective**: Create automated smoke tests that verify the PyQt5 installer works correctly on each platform (Windows, macOS, Linux), testing both the headless install mode and verifying all installed components function after installation. Design these to run in CI using GitHub Actions runners.

**Prompt**:
> Create automated cross-platform smoke tests for the Gemma Code installer.
> 
> Files to create:
>   tests/smoke/
>   â”œâ”€â”€ README.md
>   â”œâ”€â”€ smoke-windows.ps1      # Windows installer smoke test
>   â”œâ”€â”€ smoke-macos.sh         # macOS installer smoke test
>   â”œâ”€â”€ smoke-linux.sh         # Linux installer smoke test
>   â”œâ”€â”€ verify-components.py   # Cross-platform component verification
>   â””â”€â”€ cleanup.py             # Cross-platform cleanup after smoke test
> 
> Files to modify:
>   .github/workflows/nightly.yml   # Add smoke test jobs
> 
> 1. The installer must support a headless mode for CI:
>    Add to scripts/installer/pyqt/src/gemma_installer/main.py:
>    - --headless flag: Skips the GUI, runs all installation steps with defaults.
>    - --model <name>: Override model selection (default: gemma4:e2b for CI).
>    - --install-path <path>: Override install path.
>    - --skip-model: Skip model download (for fast smoke tests).
>    - --json-output: Print results as JSON to stdout for machine parsing.
>    Exit code: 0 on success, 1 on any failure.
> 
> 2. verify-components.py:
>    A Python script that verifies all installed components work:
>    - Check 1: VS Code extension installed
>      * Run `code --list-extensions` and verify "gemma-code.gemma-code" appears
>    - Check 2: Ollama reachable
>      * HTTP GET to http://localhost:11434/api/tags, verify 200 response
>    - Check 3: Python venv functional
>      * Run `{venv}/bin/python -c "import fastapi; print(fastapi.__version__)"`
>      * Verify exit code 0
>    - Check 4: Model available (if not skipped)
>      * Check Ollama API for the expected model in the model list
>    - Check 5: Backend starts
>      * Start the backend process, wait 5 seconds, check http://localhost:11435/health
>      * Stop the backend
>    - Output: JSON with each check's pass/fail status and details.
>    - Exit code: 0 if all checks pass, 1 if any fail.
> 
> 3. smoke-windows.ps1:
>    - Prerequisites: Verify VS Code is installed, Python 3.11+ available
>    - Install Ollama if not present (winget install Ollama.Ollama or direct download)
>    - Start Ollama service: `ollama serve` in background
>    - Wait for Ollama to be ready (poll /api/tags with 60s timeout)
>    - Run the installer in headless mode:
>      `python -m gemma_installer.main --headless --skip-model --install-path $env:TEMP\gemma-test`
>    - Run verify-components.py
>    - Run cleanup.py
>    - Report results
> 
> 4. smoke-macos.sh:
>    - Prerequisites: Verify VS Code installed (/Applications/Visual Studio Code.app)
>    - Install Ollama if not present (`brew install ollama` or curl)
>    - Start `ollama serve &`
>    - Run the installer in headless mode:
>      `python -m gemma_installer.main --headless --skip-model --install-path /tmp/gemma-test`
>    - Run verify-components.py
>    - Run cleanup.py
> 
> 5. smoke-linux.sh:
>    - Prerequisites: Verify VS Code installed (`which code`)
>    - Install Ollama if not present (`curl -fsSL https://ollama.com/install.sh | sh`)
>    - Start `ollama serve &`
>    - Run installer in headless mode
>    - Run verify-components.py
>    - Run cleanup.py
>    - Additional Linux check: verify no leftover processes (ollama, python backend)
> 
> 6. cleanup.py:
>    - Uninstall the VS Code extension: `code --uninstall-extension gemma-code.gemma-code`
>    - Remove the Python venv at the install path
>    - Stop the Ollama service (if started by the smoke test)
>    - Remove the install path directory
>    - Report what was cleaned up
> 
> 7. Update .github/workflows/nightly.yml:
>    Add three new jobs (after the existing integration tests):
> 
>    smoke-installer-windows:
>      runs-on: windows-latest
>      steps:
>        - uses: actions/checkout@v4
>        - uses: actions/setup-node@v4 (for VS Code CLI)
>        - uses: actions/setup-python@v5 with python-version: "3.12"
>        - name: Install VS Code
>          run: choco install vscode --no-progress -y
>        - name: Run Windows smoke test
>          run: pwsh -File tests/smoke/smoke-windows.ps1
>        - uses: actions/upload-artifact@v4
>          if: always()
>          with:
>            name: smoke-windows-results
>            path: tests/smoke/results/
> 
>    smoke-installer-macos:
>      runs-on: macos-latest
>      steps:
>        - uses: actions/checkout@v4
>        - uses: actions/setup-python@v5 with python-version: "3.12"
>        - name: Install VS Code
>          run: brew install --cask visual-studio-code
>        - name: Run macOS smoke test
>          run: bash tests/smoke/smoke-macos.sh
>        - Upload artifact
> 
>    smoke-installer-linux:
>      runs-on: ubuntu-latest
>      steps:
>        - uses: actions/checkout@v4
>        - uses: actions/setup-python@v5 with python-version: "3.12"
>        - name: Install VS Code
>          run: |
>            wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > packages.microsoft.gpg
>            sudo install -D -o root -g root -m 644 packages.microsoft.gpg /etc/apt/keyrings/
>            echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/] https://packages.microsoft.com/repos/code stable main" | sudo tee /etc/apt/sources.list.d/vscode.list
>            sudo apt update && sudo apt install -y code
>        - name: Run Linux smoke test
>          run: bash tests/smoke/smoke-linux.sh
>        - Upload artifact
> 
> 8. README.md:
>    Document: purpose, prerequisites, how to run locally, how to interpret results,
>    CI integration details, and troubleshooting common failures.
> 
> Run the Windows smoke test locally:
>   pwsh -File tests/smoke/smoke-windows.ps1
> Verify it completes with all component checks passing.

---

#### 8.5 -- End-to-End Integration Tests (All Phases Working Together)

**Objective**: Create integration tests that verify all 8 phases of v0.3.0 work together: the Gemma 4 native protocol, dynamic prompt builder, context compaction, persistent memory, tool activation, MCP, sub-agents, and the new installer. These tests exercise real cross-component interactions.

**Prompt**:
> Create end-to-end integration tests verifying all v0.3.0 components work together.
> 
> Files to create:
>   tests/integration/e2e/
>   â”œâ”€â”€ full-pipeline.test.ts       # Complete agent pipeline test
>   â”œâ”€â”€ memory-across-sessions.test.ts  # Memory persistence across sessions
>   â”œâ”€â”€ compaction-under-load.test.ts   # Compaction triggers under large conversations
>   â”œâ”€â”€ sub-agent-verification.test.ts  # Sub-agent auto-trigger after file edits
>   â”œâ”€â”€ mcp-tool-integration.test.ts    # MCP tools available in agent loop
>   â””â”€â”€ prompt-budget-compliance.test.ts # System prompt stays within budget
> 
> Files to modify:
>   configs/vitest.config.ts  # Add e2e test pattern
>   .github/workflows/nightly.yml  # Add e2e job
> 
> 1. full-pipeline.test.ts:
>    Test the complete agent pipeline from user message to tool execution to response:
>    - Set up: ConversationManager + PromptBuilder + AgentLoop + ToolRegistry with
>      all tools enabled. Use a mock or real Ollama (skip if OLLAMA_URL not set).
>    - Test: Send "Read the file src/extension.ts and tell me what it exports"
>    - Verify:
>      * PromptBuilder generates a system prompt within budget (check token count)
>      * System prompt uses Gemma 4 native tool declarations (<|tool>)
>      * Agent calls read_file tool
>      * Tool result is injected in <|tool_result> format
>      * Agent produces a final response mentioning "activate" and "deactivate"
>    - This tests Phase 0 (protocol), Phase 1 (prompt builder), Phase 3 (memory injection),
>      and Phase 4 (tool activation) working together.
> 
> 2. memory-across-sessions.test.ts:
>    Test that memories persist and are recalled across sessions:
>    - Set up: Create MemoryStore, save 5 memories of different types.
>    - Session 1: Start a conversation, verify memory injection appears in system prompt.
>    - Tear down session 1, create a new ConversationManager for session 2.
>    - Session 2: Verify the same memories are retrieved and injected.
>    - Test: Save a decision memory "Always use async/await instead of callbacks",
>      then in session 2, ask about coding style. Verify the memory appears
>      in the PromptBuilder output.
>    - This tests Phase 3 (memory) + Phase 1 (prompt builder) integration.
> 
> 3. compaction-under-load.test.ts:
>    Test that compaction triggers correctly under large conversation loads:
>    - Set up: ConversationManager with 128K token budget, ContextCompactor.
>    - Simulate: Add 100 messages with tool calls and large tool results.
>    - Verify:
>      * Compaction triggers when token count exceeds 80% of conversation budget
>      * After compaction, token count is below 60% of budget
>      * The 5-strategy pipeline is applied in order (tool result clearing first)
>      * Recent messages (last 10) are preserved after compaction
>      * Pre-compaction memory extraction hook fires (mock MemoryStore.extractAndSave)
>    - This tests Phase 2 (compaction) end-to-end with realistic data.
> 
> 4. sub-agent-verification.test.ts:
>    Test that the verification sub-agent triggers automatically:
>    - Set up: SubAgentManager with verificationEnabled=true, verificationThreshold=3.
>    - Simulate: Perform 3 file edits via the AgentLoop (mock write_file tool calls).
>    - Verify:
>      * After the 3rd edit, SubAgentManager.triggerVerification() is called
>      * The verification sub-agent gets its own ConversationManager and AgentLoop
>      * The sub-agent uses read-only tools (no write_file in its ToolRegistry)
>      * Sub-agent results are injected into the main conversation
>    - This tests Phase 5 (sub-agents) + Phase 4 (tool activation scoping).
> 
> 5. mcp-tool-integration.test.ts:
>    Test that MCP-provided tools are available in the agent loop:
>    - Set up: McpManager with a mock MCP server providing a "lookup_docs" tool.
>    - Verify:
>      * The tool appears in ToolRegistry after MCP connection
>      * PromptBuilder includes the MCP tool in <|tool> declarations
>      * ToolActivationRules respects the 15-tool cap (add 14 built-in + 2 MCP tools,
>        verify only 15 are declared)
>    - This tests Phase 4 (MCP + tool activation) integration.
> 
> 6. prompt-budget-compliance.test.ts:
>    Test that the system prompt stays within its budget under all configurations:
>    - Test with E2B (128K context): verify system prompt < 12,800 tokens
>    - Test with E4B (128K context): verify system prompt < 12,800 tokens
>    - Test with 26B (256K context): verify system prompt < 25,600 tokens
>    - Test with all optional sections active (memory, skill, sub-agent, plan mode):
>      verify total stays within budget
>    - Test with 15 tools declared: verify tool declarations fit within budget
>    - Test that over-budget scenario drops lowest-priority sections first
>    - This tests Phase 1 (prompt budget) thoroughly.
> 
> 7. Update configs/vitest.config.ts:
>    Add to the include array: "tests/integration/e2e/**/*.test.ts"
>    These tests should be skippable via an E2E=true environment variable
>    (or always run when OLLAMA_URL is set).
> 
> 8. Update .github/workflows/nightly.yml:
>    Add an e2e-integration job:
>    - runs-on: ubuntu-latest
>    - Install Ollama, pull gemma4:e2b
>    - npm ci && npm run build
>    - Run: OLLAMA_URL=http://localhost:11434 TEST_MODEL=gemma4:e2b npm run test:integration -- tests/integration/e2e/
>    - Upload results as artifact
> 
> Run the e2e tests that don't require Ollama:
>   npm run test:integration -- tests/integration/e2e/ --reporter=verbose
> Verify the mockable tests pass. Tests requiring Ollama should skip gracefully.

---

#### 8.6 -- v0.2.0 vs v0.3.0 Performance Comparison and Documentation

**Objective**: Run a systematic performance comparison between v0.2.0 and v0.3.0, generate comparison reports, and produce complete v0.3.0 documentation updates including ARCHITECTURE.md, CHANGELOG.md, README.md, and a dedicated v0.3.0 architecture document.

**Prompt**:
> Create the v0.2.0 vs v0.3.0 performance comparison framework and update all documentation.
> 
> Files to create:
>   tests/golden/framework/comparison.py     # Version comparison tool
>   docs/archive/versions/v0/v0.3.0/architecture.md              # Full v0.3.0 architecture document
>   docs/archive/versions/v0/v0.3.0/performance-comparison.md    # v0.2.0 vs v0.3.0 comparison report
> 
> Files to modify:
>   ARCHITECTURE.md          # Update for v0.3.0
>   CHANGELOG.md             # Add v0.3.0 section
>   README.md                # Update for v0.3.0 features
>   docs/todos.md            # Add v0.3.0 task tracking
> 
> 1. tests/golden/framework/comparison.py:
>    - compare_versions(baseline_v2: dict, baseline_v3: dict) -> ComparisonReport:
>      Load two baseline JSON files (v0.2.0 and v0.3.0) and compare:
>      * Overall pass rate change
>      * Per-category pass rate change
>      * Mean time change per task category
>      * Token efficiency change
>      * New tasks added in v0.3.0 that didn't exist in v0.2.0
>    - generate_comparison_markdown(report: ComparisonReport) -> str:
>      Produce a Markdown document with:
>      * Executive summary (1 paragraph)
>      * Table: metric, v0.2.0 value, v0.3.0 value, delta, direction arrow
>      * Per-category breakdown table
>      * Notable improvements (tasks that went from fail to pass)
>      * Regressions (tasks that went from pass to fail)
>      * Recommendations for next version
>    - Write test: test_comparison.py verifying comparison logic with mock data.
> 
> 2. docs/archive/versions/v0/v0.3.0/architecture.md:
>    Comprehensive v0.3.0 architecture document following the pattern of
>    docs/archive/versions/v0/v0.2.0/architecture.md. Must include:
> 
>    - Updated Three-Process Architecture diagram (ASCII) showing the PyQt5 installer
>      as a fourth component in the ecosystem.
>    - Component table with all existing v0.2.0 components plus v0.3.0 additions:
>      * InstallEngine (scripts/installer/pyqt/) â€” cross-platform installer
>      * GoldenTaskRunner (tests/golden/) â€” evaluation framework
>      * RegressionDetector (tests/golden/framework/) â€” baseline comparison
>    - Installer architecture section:
>      * PyQt5 wizard page flow diagram
>      * Installation engine component diagram (OllamaInstaller, ExtensionInstaller, etc.)
>      * Platform detection and GPU classification flowchart
>    - Quality assurance architecture section:
>      * Golden task execution flow
>      * Benchmark pipeline diagram
>      * Regression detection flow
>    - Updated token budget allocation table (same as v0.2.0 unless changed)
>    - Cross-platform support matrix:
>      | Component | Windows | macOS | Linux |
>      | Installer | PyInstaller .exe | PyInstaller .app/.dmg | PyInstaller/AppImage |
>      | GPU Detection | nvidia-smi, WMI | system_profiler | nvidia-smi, lspci |
>      | Ollama Install | OllamaSetup.exe | brew/curl | curl install.sh |
> 
> 3. docs/archive/versions/v0/v0.3.0/performance-comparison.md:
>    Template for the version comparison report. Include:
>    - Methodology section explaining how benchmarks are run
>    - Hardware requirements for reproducible results
>    - Placeholder tables for v0.2.0 vs v0.3.0 metrics (to be filled by running the
>      comparison tool)
>    - Instructions for generating the comparison: command to run, how to interpret results
> 
> 4. ARCHITECTURE.md (root level):
>    Update the root-level architecture overview:
>    - Add v0.3.0 additions: PyQt5 installer, golden task suite, cross-platform support
>    - Update the "Further Reading" section to include v0.3.0 docs
>    - Keep the existing v0.2.0 component table and add v0.3.0 components below it
> 
> 5. CHANGELOG.md:
>    Add a v0.3.0 section following the existing format (Keep a Changelog):
> 
>    ## [0.3.0] -- 2026-XX-XX
> 
>    Cross-platform installer, golden task evaluation suite, and integration stabilization.
> 
>    ### Added
> 
>    **Phase 7 -- Cross-Platform PyQt5 Installer**
>    - PyQt5 wizard installer replacing Windows-only NSIS installer
>    - 9-step installation wizard: Welcome, Prerequisites, GPU Detection, Install Path,
>      Model Selection, Configuration, Review, Installing, Complete
>    - Automatic GPU detection (NVIDIA, AMD, Apple Silicon, Intel) with model recommendation
>    - Platform-specific installation: Windows (.exe), macOS (.dmg), Linux (AppImage)
>    - Real-time log panel during installation with color-coded output
>    - Headless mode for CI/automated installations
>    - "Open VS Code" button on completion page
> 
>    **Phase 8 -- Golden Task Suite & Integration Stabilization**
>    - Golden task evaluation framework with YAML-based task definitions
>    - 24 golden tasks across 5 categories: multi-file edits, bug fixes, refactors,
>      test generation, code review
>    - Per-model-tier benchmark suite (E2B, E4B, 26B, 31B)
>    - Memory recall accuracy benchmarks (keyword and semantic search)
>    - Regression detection with baseline comparison
>    - Cross-platform installer smoke tests (Windows, macOS, Linux)
>    - End-to-end integration tests for all v0.2.0 + v0.3.0 components
>    - v0.2.0 vs v0.3.0 performance comparison framework
> 
>    ### Changed
>    - Installer technology changed from NSIS (Windows-only) to PyQt5 (cross-platform)
>    - Old NSIS installer moved to scripts/installer/legacy/
>    - Release workflow updated to build installers for all three platforms
> 
>    ### Known Limitations
>    - macOS .dmg is not notarized (requires Apple Developer account)
>    - Linux AppImage requires FUSE to run on some distributions
>    - Golden tasks require a running Ollama instance; CI uses E2B on CPU which is slower
>    - GPU detection may not work in virtualized environments (CI runners)
> 
> 6. README.md:
>    Update the following sections:
>    - Installation: Add macOS and Linux instructions alongside Windows
>    - Quick Start: Update to reference the new installer
>    - Features: Add "Cross-platform installer with GPU-aware model recommendation"
>    - Requirements: Add macOS and Linux requirements
>    - Development > Testing: Document the golden task suite
>    - Troubleshooting: Add cross-platform troubleshooting entries
> 
> 7. docs/todos.md:
>    Add a v0.3.0 section with all Phase 7 and Phase 8 sub-tasks as checkboxes,
>    following the existing format of the v0.2.0 section.
> 
> Run a final verification:
> - Verify all new Markdown files render correctly (no broken links, valid tables)
> - Verify CHANGELOG.md follows the Keep a Changelog format
> - Verify all file paths referenced in docs exist (or are correctly marked as future)

---

#### 8.7 -- CI/CD Pipeline Finalization and Release Preparation

**Objective**: Finalize the CI/CD pipeline to support the full v0.3.0 quality gate: all existing tests plus golden tasks, benchmarks, regression checks, installer smoke tests, and multi-platform release builds. Create a release checklist document.

**Prompt**:
> Finalize the CI/CD pipeline for v0.3.0 and create the release preparation documents.
> 
> Files to create:
>   docs/archive/versions/v0/v0.3.0/release-checklist.md     # Step-by-step release procedure
>   docs/archive/versions/v0/v0.3.0/ci-pipeline.md           # CI/CD pipeline documentation
>   .github/workflows/golden-tasks.yml   # Dedicated golden task workflow
> 
> Files to modify:
>   .github/workflows/ci.yml             # Add installer tests to PR checks
>   .github/workflows/release.yml        # Full multi-platform release
>   .github/workflows/nightly.yml        # Complete nightly pipeline
> 
> 1. .github/workflows/golden-tasks.yml (new):
>    A dedicated workflow for golden task execution:
> 
>    on:
>      workflow_dispatch:
>        inputs:
>          model:
>            description: "Model tier to test"
>            default: "gemma4:e2b"
>            type: choice
>            options: ["gemma4:e2b", "gemma4:e4b"]
>          categories:
>            description: "Task categories (comma-separated, or 'all')"
>            default: "all"
>      schedule:
>        - cron: "0 4 * * 0"  # Weekly on Sunday at 04:00 UTC
> 
>    jobs:
>      run-golden-tasks:
>        runs-on: ubuntu-latest
>        timeout-minutes: 60
>        steps:
>          - Checkout
>          - Setup Node 20, Python 3.12
>          - Install Ollama, pull selected model
>          - npm ci && npm run build
>          - Run golden tasks: cd tests/golden && python -m pytest --golden-run
>            --model=${{ inputs.model }} --categories=${{ inputs.categories }}
>          - Generate baseline: python -m framework.baseline --save
>          - Compare against stored baseline: python -m framework.regression --compare
>          - Upload results artifacts (JSON baseline, Markdown report)
>          - If regressions detected, create a GitHub Issue automatically:
>            gh issue create --title "Golden task regression detected (${{ inputs.model }})"
>            --body-file regression-report.md --label "regression,automated"
> 
> 2. .github/workflows/ci.yml updates:
>    Add the installer unit test job to the PR check pipeline:
> 
>    test-installer:
>      name: Test installer (PyQt5)
>      runs-on: ubuntu-latest
>      steps:
>        - uses: actions/checkout@v4
>        - uses: actions/setup-python@v5
>          with: python-version: "3.12"
>        - name: Install system deps for PyQt5
>          run: sudo apt-get install -y libxcb-xinerama0 libxkbcommon-x11-0
>        - name: Install installer dependencies
>          run: cd scripts/installer/pyqt && uv pip install -e ".[dev]"
>        - name: Run installer unit tests
>          run: cd scripts/installer/pyqt && uv run pytest tests/ -v --tb=short
>          env:
>            QT_QPA_PLATFORM: offscreen  # Headless Qt rendering for CI
> 
>    Update the coverage-gate job to include installer test coverage.
> 
> 3. .github/workflows/release.yml updates:
>    Complete the multi-platform release pipeline:
> 
>    build-installer-windows:
>      name: Build Windows installer (PyQt5)
>      runs-on: windows-latest
>      needs: build-vsix
>      steps:
>        - Checkout, setup Python 3.12
>        - Download VSIX artifact
>        - Run: pwsh scripts/installer/pyqt/build/build-windows.ps1
>        - Upload artifact: installer-windows
> 
>    build-installer-macos:
>      name: Build macOS installer
>      runs-on: macos-latest
>      needs: build-vsix
>      steps:
>        - Checkout, setup Python 3.12
>        - Download VSIX artifact
>        - Run: bash scripts/installer/pyqt/build/build-macos.sh
>        - Upload artifact: installer-macos
> 
>    build-installer-linux:
>      name: Build Linux installer
>      runs-on: ubuntu-latest
>      needs: build-vsix
>      steps:
>        - Checkout, setup Python 3.12
>        - Install system deps
>        - Download VSIX artifact
>        - Run: bash scripts/installer/pyqt/build/build-linux.sh
>        - Upload artifact: installer-linux
> 
>    Update create-release to download and attach all three installer artifacts
>    plus the VSIX to the GitHub Release.
> 
> 4. .github/workflows/nightly.yml updates:
>    Add the following jobs to the nightly pipeline:
> 
>    golden-tasks-e2b:
>      name: Golden tasks (E2B)
>      runs-on: ubuntu-latest
>      timeout-minutes: 45
>      steps: (same as golden-tasks.yml but with model=gemma4:e2b, triggered nightly)
> 
>    installer-smoke-windows / installer-smoke-macos / installer-smoke-linux:
>      (As defined in sub-task 8.4, add to nightly)
> 
>    regression-check:
>      name: Regression check
>      needs: [golden-tasks-e2b]
>      runs-on: ubuntu-latest
>      steps:
>        - Download golden task results artifact
>        - Download stored baseline from previous nightly (use GitHub Actions cache or artifacts)
>        - Run regression detection
>        - If regressions found, post to Slack (if webhook configured) and create issue
> 
> 5. docs/archive/versions/v0/v0.3.0/release-checklist.md:
>    Step-by-step release procedure:
>    1. Pre-release verification:
>       - [ ] All CI checks pass on main branch
>       - [ ] Nightly golden tasks pass with >= 90% pass rate on E2B
>       - [ ] Nightly golden tasks pass with >= 95% pass rate on E4B
>       - [ ] No open regression issues
>       - [ ] Installer smoke tests pass on all 3 platforms
>       - [ ] E2E integration tests pass
>       - [ ] Benchmark results are within acceptable thresholds
>    2. Version bump:
>       - [ ] Update package.json version to 0.3.0
>       - [ ] Update pyproject.toml versions (backend, installer)
>       - [ ] Update CHANGELOG.md with release date
>       - [ ] Update README.md "Latest version" badge
>    3. Build and test:
>       - [ ] Run full test suite locally: npm test && npm run bench
>       - [ ] Build VSIX: npm run package
>       - [ ] Build installers for all platforms (or verify CI built them)
>       - [ ] Manual smoke test: install from each platform's installer
>    4. Release:
>       - [ ] Create annotated git tag: git tag -a v0.3.0 -m "v0.3.0"
>       - [ ] Push tag: git push origin v0.3.0
>       - [ ] Verify release.yml creates the GitHub Release with all artifacts
>       - [ ] Download each artifact and verify integrity (SHA256)
>    5. Post-release:
>       - [ ] Update docs/todos.md to mark v0.3.0 tasks complete
>       - [ ] Save golden task baseline as the v0.3.0 reference baseline
>       - [ ] Archive nightly benchmark results
> 
> 6. docs/archive/versions/v0/v0.3.0/ci-pipeline.md:
>    Document the complete CI/CD pipeline:
>    - Pipeline diagram (ASCII) showing workflow triggers and job dependencies
>    - Per-workflow documentation: trigger conditions, jobs, artifacts, failure handling
>    - Quality gates: coverage thresholds, benchmark limits, golden task pass rates
>    - Secret requirements: SLACK_WEBHOOK_URL (optional), code signing certs (optional)
>    - Troubleshooting common CI failures
> 
> Verify all workflow YAML files are syntactically valid:
>   for f in .github/workflows/*.yml; do python -c "import yaml; yaml.safe_load(open('$f'))"; done
> Verify no broken job dependency references exist.

---

#### 8.T -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 8. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 8. Include golden task framework execution, benchmark harness, installer smoke tests on all platforms, and full end-to-end integration tests.
> Run the tests, fix all failures, and iterate until every test passes with 80%+ coverage.
> Do not advance to Phase release until this phase is fully verified.
> After all tests pass, run /generate-session-history to document this phase.

---

### Phase 8 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing (80%+ coverage)
- [ ] No known regressions from prior phases
- [ ] Session history generated for this phase
- [ ] Ready to advance to Phase release
