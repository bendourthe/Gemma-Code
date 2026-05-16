import * as vscode from "vscode";
import type { EditMode } from "../tools/types.js";
import type { PromptStyle } from "../chat/PromptBuilder.types.js";
import type { HardwareTierId } from "./HardwareTier.types.js";

export type ToolConfirmationMode = "always" | "ask" | "never";

export interface GemmaCodeSettings {
  ollamaUrl: string;
  modelName: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  requestTimeout: number;
  toolConfirmationMode: ToolConfirmationMode;
  maxAgentIterations: number;
  editMode: EditMode;
  thinkingMode: boolean;
  promptStyle: PromptStyle;
  systemPromptBudgetPercent: number;
  compactionKeepRecent: number;
  compactionToolResultsKeep: number;
  memoryEnabled: boolean;
  embeddingModel: string;
  memoryMaxEntries: number;
  memoryCorroborationThreshold: number;
  ollamaEmbeddingThreshold: number;
  heuristicEmbeddingThreshold: number;
  mcpEnabled: boolean;
  mcpServerMode: "stdio" | "off";
  mcpExposedTools: string[];
  verificationEnabled: boolean;
  verificationThreshold: number;
  subAgentMaxIterations: number;
  autoDetectGpu: boolean;
  gpuTierOverride: HardwareTierId | null;
  permissionOverrides: Record<string, number>;
  otlpEnabled: boolean;
  otlpEndpoint: string;
  otlpHeaders: string;
  secretPathDenyExtra: string[];
  operationLogEnabled: boolean;
  /**
   * v0.7.0 Phase 2: schedule for automatic Memory.md / Instructions.md /
   * Context.md snapshots into `~/.gemma-code/memory/<workspace-id>/Archive/<YYYY-MM-DD>/`.
   * `weekly` triggers when the most recent archive is older than 7 days,
   * `monthly` waits 30 days. `off` (default) means archives only run on an
   * explicit `/memory archive` invocation.
   */
  memoryAutoArchive: "off" | "weekly" | "monthly";
  /** v0.7.0 Phase 3: per-model context-window overrides (C15). */
  contextLimitsPerModel: Record<string, { maxTokens?: number; minContextLimit?: number }>;
  /** v0.7.0 Phase 3: tool names skipped by every compaction strategy and the compress tool. */
  compactionProtectedTools: string[];
  /** v0.7.0 Phase 3: errored tool calls older than N user-message turns are purged. */
  compactionErrorPurgeTurns: number;
  /** v0.7.0 Phase 3: file-path patterns whose tool calls are exempt from deduplication. */
  compactionProtectedFilePatterns: string[];
  /** v0.7.0 Phase 3: when true, registers the experimental compress_message tool. */
  compactExperimentalMessageMode: boolean;
  /**
   * v0.7.0 Phase 7 (C32): row-count threshold for activating the optional HNSW
   * vector index over memory embeddings. When the entry count exceeds this
   * value AND `hnswlib-node` is loadable, MemoryStore switches from the
   * FTS5-pre-filtered linear scan to the persistent ANN index. Set to 0 to
   * disable HNSW entirely (linear-scan fallback only).
   */
  memoryHnswThreshold: number;
  /**
   * v0.7.0 Phase 7 (C34): when true, every time the file-edit threshold trips
   * the audit background worker invokes `bin/gemma-check --json` on the
   * changed files and posts findings as a chat message. Off by default.
   */
  auditWorkerEnabled: boolean;
  /**
   * v0.7.0 Phase 7 (C34): when true, every time the file-edit threshold trips
   * the testgaps background worker runs `vitest --coverage --json` on the
   * test files matching the changed source and posts uncovered branches as a
   * chat message. Off by default.
   */
  testgapsWorkerEnabled: boolean;
  /**
   * v0.8.0 Phase 5 sub-task 5.2 (items D6, D7): when true, the curator
   * background worker proposes stale-skill / duplicate-memory / frontmatter-
   * patch actions on a 12 h cadence. Off by default; the user must review and
   * apply the manifest via `/curate --apply`.
   */
  curatorWorkerEnabled: boolean;
  /**
   * v0.8.0 Phase 5 sub-task 5.7 (item E5): when true (default), `run_terminal`
   * routes long stdout through the pre-tool compressor (npm test / git diff /
   * cargo test / npm install summaries instead of raw output).
   */
  preToolCompression: boolean;
  /**
   * v0.8.0 Phase 2 (item C8): when true (default), `AgentLoop` refuses to
   * terminate via a no-tool-call response unless at least one
   * verification-class tool call has succeeded since the last user message.
   * See ADR-0015 and `src/tools/AgentLoop.ts`.
   */
  passStateGating: boolean;
  /**
   * v0.8.0 Phase 2 (item A1): memory snapshot semantics. `frozen` (default)
   * captures Instructions.md / Memory.md / Context.md once at session start
   * so the rendered prompt stays byte-stable for prefix-cache stability.
   * `live` re-reads on every prompt build (v0.7.0 behaviour).
   */
  memorySnapshotMode: "frozen" | "live";
  /**
   * v0.8.0 Phase 4 sub-task 4.2 (item F1): LLM backend selector. `auto`
   * probes LM Studio at `:1234` on macOS and falls back to Ollama; `ollama`
   * forces the existing client; `lmstudio` forces the new adapter.
   */
  llmBackend: "ollama" | "lmstudio" | "auto";
  /** LM Studio base URL. Defaults to `http://127.0.0.1:1234`. */
  lmStudioBaseUrl: string;
  /**
   * v0.8.0 Phase 4 sub-task 4.4 (items F4/F5/E4): active thinking-mode preset.
   * `nothink` (concise default), `think` (Qwen/jola sampler), `think-max`
   * (extended budget, auto-downgrades when context < 64K).
   */
  thinkingModePreset: "nothink" | "think" | "think-max";
  /**
   * v0.8.0 Phase 4 sub-task 4.6 (items A5/A6): hybrid memory scoring method.
   * `rrf` (default) fuses vector + lexical + recency via reciprocal-rank
   * fusion; `weighted` blends with a 50/30/20 split.
   */
  memoryScoringMethod: "rrf" | "weighted";
  /**
   * v0.8.0 Phase 4 sub-task 4.1 (item G3): when true, the trace file is
   * pre-enabled at session start so users can reproduce a bug without
   * needing to remember to call `/trace enable` first.
   */
  traceAutoEnable: boolean;
}

export function getSettings(): GemmaCodeSettings {
  const config = vscode.workspace.getConfiguration("gemma-code");
  return {
    ollamaUrl: config.get<string>("ollamaUrl") ?? "http://localhost:11434",
    modelName: config.get<string>("modelName") ?? "gemma4:e4b",
    maxTokens: config.get<number>("maxTokens") ?? 131072,
    temperature: config.get<number>("temperature") ?? 1.0,
    topP: config.get<number>("topP") ?? 0.95,
    topK: config.get<number>("topK") ?? 64,
    requestTimeout: config.get<number>("requestTimeout") ?? 60000,
    toolConfirmationMode:
      (config.get<string>("toolConfirmationMode") as ToolConfirmationMode | undefined) ?? "ask",
    maxAgentIterations: config.get<number>("maxAgentIterations") ?? 20,
    editMode: (config.get<string>("editMode") as EditMode | undefined) ?? "ask",
    thinkingMode: config.get<boolean>("thinkingMode") ?? true,
    promptStyle: (config.get<string>("promptStyle") as PromptStyle | undefined) ?? "concise",
    systemPromptBudgetPercent: config.get<number>("systemPromptBudgetPercent") ?? 10,
    compactionKeepRecent: config.get<number>("compactionKeepRecent") ?? 10,
    compactionToolResultsKeep: config.get<number>("compactionToolResultsKeep") ?? 8,
    memoryEnabled: config.get<boolean>("memoryEnabled") ?? true,
    embeddingModel: config.get<string>("embeddingModel") ?? "nomic-embed-text",
    memoryMaxEntries: config.get<number>("memoryMaxEntries") ?? 10000,
    memoryCorroborationThreshold:
      Math.max(1, Math.min(5, config.get<number>("memoryCorroborationThreshold") ?? 2)),
    ollamaEmbeddingThreshold:
      Math.max(0, Math.min(1, config.get<number>("ollamaEmbeddingThreshold") ?? 0.85)),
    heuristicEmbeddingThreshold:
      Math.max(0, Math.min(1, config.get<number>("heuristicEmbeddingThreshold") ?? 0.95)),
    mcpEnabled: config.get<boolean>("mcpEnabled") ?? false,
    mcpServerMode: (config.get<string>("mcpServerMode") as "stdio" | "off" | undefined) ?? "off",
    mcpExposedTools: config.get<string[]>("mcpExposedTools") ?? ["read_file", "list_directory", "grep_codebase"],
    verificationEnabled: config.get<boolean>("verificationEnabled") ?? true,
    verificationThreshold: config.get<number>("verificationThreshold") ?? 3,
    subAgentMaxIterations: config.get<number>("subAgentMaxIterations") ?? 10,
    autoDetectGpu: config.get<boolean>("autoDetectGpu") ?? true,
    gpuTierOverride: (() => {
      const v = config.get<number | null>("gpuTierOverride");
      return v === 1 || v === 2 || v === 3 ? (v as HardwareTierId) : null;
    })(),
    permissionOverrides: config.get<Record<string, number>>("permissionOverrides") ?? {},
    otlpEnabled: config.get<boolean>("otlpEnabled") ?? false,
    otlpEndpoint: config.get<string>("otlpEndpoint") ?? "http://localhost:4318/v1/traces",
    otlpHeaders: config.get<string>("otlpHeaders") ?? "",
    secretPathDenyExtra: config.get<string[]>("secretPathDenyExtra") ?? [],
    operationLogEnabled: config.get<boolean>("operationLog.enabled") ?? false,
    memoryAutoArchive: ((): "off" | "weekly" | "monthly" => {
      const raw = config.get<string>("memoryAutoArchive") ?? "off";
      return raw === "weekly" || raw === "monthly" ? raw : "off";
    })(),
    contextLimitsPerModel: config.get<Record<string, { maxTokens?: number; minContextLimit?: number }>>(
      "contextLimitsPerModel",
    ) ?? {},
    compactionProtectedTools: config.get<string[]>("compactionProtectedTools") ?? [
      "compress_range",
      "compress_message",
      "verify",
      "research",
      "memory",
      "write_file",
      "edit_file",
      "create_file",
      "delete_file",
    ],
    compactionErrorPurgeTurns: Math.max(
      1,
      Math.min(50, config.get<number>("compactionErrorPurgeTurns") ?? 4),
    ),
    compactionProtectedFilePatterns: config.get<string[]>("compactionProtectedFilePatterns") ?? [],
    compactExperimentalMessageMode: config.get<boolean>("compactExperimentalMessageMode") ?? false,
    memoryHnswThreshold: Math.max(
      0,
      Math.min(1_000_000, config.get<number>("memoryHnswThreshold") ?? 1000),
    ),
    auditWorkerEnabled: config.get<boolean>("workers.audit.enabled") ?? false,
    testgapsWorkerEnabled: config.get<boolean>("workers.testgaps.enabled") ?? false,
    curatorWorkerEnabled: config.get<boolean>("workers.curator.enabled") ?? false,
    preToolCompression: config.get<boolean>("preToolCompression") ?? true,
    passStateGating: config.get<boolean>("passStateGating") ?? true,
    memorySnapshotMode: ((): "frozen" | "live" => {
      const raw = config.get<string>("memorySnapshotMode") ?? "frozen";
      return raw === "live" ? "live" : "frozen";
    })(),
    llmBackend: ((): "ollama" | "lmstudio" | "auto" => {
      const raw = config.get<string>("llm.backend") ?? "ollama";
      return raw === "lmstudio" || raw === "auto" ? raw : "ollama";
    })(),
    lmStudioBaseUrl: config.get<string>("lmstudio.baseUrl") ?? "http://127.0.0.1:1234",
    thinkingModePreset: ((): "nothink" | "think" | "think-max" => {
      const raw = config.get<string>("thinkingModePreset") ?? "nothink";
      return raw === "think" || raw === "think-max" ? raw : "nothink";
    })(),
    memoryScoringMethod: ((): "rrf" | "weighted" => {
      const raw = config.get<string>("memory.scoringMethod") ?? "rrf";
      return raw === "weighted" ? "weighted" : "rrf";
    })(),
    traceAutoEnable: config.get<boolean>("trace.autoEnable") ?? false,
  };
}

export function onSettingsChange(
  callback: (settings: GemmaCodeSettings) => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("gemma-code")) {
      callback(getSettings());
    }
  });
}
