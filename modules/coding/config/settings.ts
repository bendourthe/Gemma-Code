import * as vscode from "vscode";
import type { EditMode } from "../../../src/tools/types.js";
import type { PromptStyle } from "../chat/PromptBuilder.types.js";
import type { HardwareTierId } from "./HardwareTier.types.js";
import { SettingsCompat } from "./SettingsCompat.js";

export type ToolConfirmationMode = "always" | "ask" | "never";

/**
 * v1.0.0 Phase 2.1: the type was renamed from `GemmaCodeSettings` ->
 * `NexusSettings` so cross-module callers do not need to know about the old
 * brand. A type-only re-export of the old name is kept for one cycle so
 * downstream files continue to compile while they migrate. Removed in
 * v1.1.0.
 */
export interface NexusSettings {
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
  egressDenyExtra: string[];
  terminalEnvScrub: boolean;
  terminalEnvScrubAllowlist: string[];
  operationLogEnabled: boolean;
  memoryAutoArchive: "off" | "weekly" | "monthly";
  contextLimitsPerModel: Record<string, { maxTokens?: number; minContextLimit?: number }>;
  compactionProtectedTools: string[];
  compactionErrorPurgeTurns: number;
  compactionProtectedFilePatterns: string[];
  compactExperimentalMessageMode: boolean;
  memoryHnswThreshold: number;
  auditWorkerEnabled: boolean;
  testgapsWorkerEnabled: boolean;
  curatorWorkerEnabled: boolean;
  preToolCompression: boolean;
  passStateGating: boolean;
  passStateSubAgentCredit: boolean;
  hooksScanInjection: boolean;
  inboundClassifierEnabled: boolean;
  inboundClassifierDeepScan: boolean;
  swarmOrchestrationEnabled: boolean;
  panelRoutingEnabled: boolean;
  harnessSelectorEnabled: boolean;
  patientTierEnabled: boolean;
  patientTierTimeoutMs: number;
  memorySnapshotMode: "frozen" | "live";
  /**
   * LLM backend selector. Known values are `ollama` | `lmstudio` | `auto`;
   * v1.6.0 Phase 5 (item A3) widens this to any string so a user-registered
   * local adapter (see `localAdapters`) is selectable by its manifest name.
   * An unknown / unregistered value falls back to the `auto` resolution in
   * `NexusCodingRuntime._resolveBackend`.
   */
  llmBackend: string;
  lmStudioBaseUrl: string;
  /**
   * v1.6.0 Phase 5 (item A3) -- raw, unvalidated local-runtime adapter
   * manifests from `nexus.llm.localAdapters`. Each entry is validated and
   * loopback-checked by the `LocalAdapterRegistry` at the composition root;
   * carried as `unknown[]` here because config is untrusted until validated.
   */
  localAdapters: unknown[];
  thinkingModePreset: "nothink" | "think" | "think-max";
  memoryScoringMethod: "rrf" | "weighted";
  memoryScoringDefault: "legacy" | "hybrid";
  memoryAnticipatoryCache: boolean;
  reflectWorkerEnabled: boolean;
  traceAutoEnable: boolean;
}

/**
 * Backwards-compat type alias for one cycle. Existing call sites that
 * imported `GemmaCodeSettings` keep working without churn while they migrate
 * to `NexusSettings`. Removed in v1.1.0 alongside the package-rename pass.
 */
export type GemmaCodeSettings = NexusSettings;

/**
 * Lazily-built shim instance. The factory is bound to
 * `vscode.workspace.getConfiguration` so tests can construct their own
 * `SettingsCompat` directly without going through this module.
 */
let _compat: SettingsCompat | null = null;
function getCompat(): SettingsCompat {
  if (!_compat) {
    _compat = new SettingsCompat((section) =>
      vscode.workspace.getConfiguration(section ?? undefined),
    );
  }
  return _compat;
}

/**
 * Test-only hook used by unit tests that swap the global compat instance.
 */
export function _setSettingsCompatForTesting(compat: SettingsCompat | null): void {
  _compat = compat;
}

export function getSettings(): NexusSettings {
  const c = getCompat();
  const gpuTier = c.get<number | null>("nexus.gpuTierOverride", null);
  return {
    ollamaUrl: c.get<string>("nexus.llm.ollamaUrl", "http://localhost:11434"),
    modelName: c.get<string>("nexus.llm.modelName", "gemma4:e4b"),
    maxTokens: c.get<number>("nexus.llm.maxTokens", 131072),
    temperature: c.get<number>("nexus.llm.temperature", 1.0),
    topP: c.get<number>("nexus.llm.topP", 0.95),
    topK: c.get<number>("nexus.llm.topK", 64),
    requestTimeout: c.get<number>("nexus.llm.requestTimeout", 60000),
    toolConfirmationMode: c.get<ToolConfirmationMode>(
      "nexus.coding.toolConfirmationMode",
      "ask",
    ),
    maxAgentIterations: c.get<number>("nexus.coding.maxAgentIterations", 20),
    editMode: c.get<EditMode>("nexus.coding.editMode", "ask"),
    thinkingMode: c.get<boolean>("nexus.coding.thinkingMode", true),
    promptStyle: c.get<PromptStyle>("nexus.coding.promptStyle", "concise"),
    systemPromptBudgetPercent: c.get<number>(
      "nexus.coding.systemPromptBudgetPercent",
      10,
    ),
    compactionKeepRecent: c.get<number>("nexus.coding.compactionKeepRecent", 10),
    compactionToolResultsKeep: c.get<number>(
      "nexus.coding.compactionToolResultsKeep",
      8,
    ),
    memoryEnabled: c.get<boolean>("nexus.memory.enabled", true),
    embeddingModel: c.get<string>("nexus.memory.embeddingModel", "nomic-embed-text"),
    memoryMaxEntries: c.get<number>("nexus.memory.maxEntries", 10000),
    memoryCorroborationThreshold: clamp(
      c.get<number>("nexus.memory.corroborationThreshold", 2),
      1,
      5,
    ),
    ollamaEmbeddingThreshold: clamp(
      c.get<number>("nexus.memory.ollamaEmbeddingThreshold", 0.85),
      0,
      1,
    ),
    heuristicEmbeddingThreshold: clamp(
      c.get<number>("nexus.memory.heuristicEmbeddingThreshold", 0.95),
      0,
      1,
    ),
    mcpEnabled: c.get<boolean>("nexus.mcp.enabled", false),
    mcpServerMode: c.get<"stdio" | "off">("nexus.mcp.serverMode", "off"),
    mcpExposedTools: c.get<string[]>("nexus.mcp.exposedTools", [
      "read_file",
      "list_directory",
      "grep_codebase",
    ]),
    verificationEnabled: c.get<boolean>("nexus.coding.verificationEnabled", true),
    verificationThreshold: c.get<number>("nexus.coding.verificationThreshold", 3),
    subAgentMaxIterations: c.get<number>("nexus.coding.subAgentMaxIterations", 10),
    autoDetectGpu: c.get<boolean>("nexus.autoDetectGpu", true),
    gpuTierOverride: gpuTier === 1 || gpuTier === 2 || gpuTier === 3
      ? (gpuTier as HardwareTierId)
      : null,
    permissionOverrides: c.get<Record<string, number>>(
      "nexus.coding.permissionOverrides",
      {},
    ),
    otlpEnabled: c.get<boolean>("nexus.otlp.enabled", false),
    otlpEndpoint: c.get<string>(
      "nexus.otlp.endpoint",
      "http://localhost:4318/v1/traces",
    ),
    otlpHeaders: c.get<string>("nexus.otlp.headers", ""),
    secretPathDenyExtra: c.get<string[]>("nexus.secretPathDenyExtra", []),
    egressDenyExtra: c.get<string[]>("nexus.coding.egressDenyExtra", []),
    terminalEnvScrub: c.get<boolean>("nexus.coding.terminalEnvScrub", true),
    terminalEnvScrubAllowlist: c.get<string[]>(
      "nexus.coding.terminalEnvScrubAllowlist",
      [],
    ),
    operationLogEnabled: c.get<boolean>("nexus.operationLog.enabled", false),
    memoryAutoArchive: (() => {
      const raw = c.get<string>("nexus.memory.autoArchive", "off");
      return raw === "weekly" || raw === "monthly" ? raw : "off";
    })(),
    contextLimitsPerModel: c.get<
      Record<string, { maxTokens?: number; minContextLimit?: number }>
    >("nexus.coding.contextLimitsPerModel", {}),
    compactionProtectedTools: c.get<string[]>("nexus.coding.compactionProtectedTools", [
      "compress_range",
      "compress_message",
      "verify",
      "research",
      "memory",
      "write_file",
      "edit_file",
      "create_file",
      "delete_file",
    ]),
    compactionErrorPurgeTurns: clamp(
      c.get<number>("nexus.coding.compactionErrorPurgeTurns", 4),
      1,
      50,
    ),
    compactionProtectedFilePatterns: c.get<string[]>(
      "nexus.coding.compactionProtectedFilePatterns",
      [],
    ),
    compactExperimentalMessageMode: c.get<boolean>(
      "nexus.coding.compactExperimentalMessageMode",
      false,
    ),
    memoryHnswThreshold: clamp(
      c.get<number>("nexus.memory.hnswThreshold", 1000),
      0,
      1_000_000,
    ),
    auditWorkerEnabled: c.get<boolean>("nexus.workers.audit.enabled", false),
    testgapsWorkerEnabled: c.get<boolean>("nexus.workers.testgaps.enabled", false),
    curatorWorkerEnabled: c.get<boolean>("nexus.workers.curator.enabled", false),
    preToolCompression: c.get<boolean>("nexus.coding.preToolCompression", true),
    passStateGating: c.get<boolean>("nexus.coding.passStateGating", true),
    passStateSubAgentCredit: c.get<boolean>(
      "nexus.coding.passStateGating.subAgentCredit",
      true,
    ),
    hooksScanInjection: c.get<boolean>("nexus.hooks.scanInjection", true),
    inboundClassifierEnabled: c.get<boolean>(
      "nexus.coding.inboundClassifier.enabled",
      true,
    ),
    inboundClassifierDeepScan: c.get<boolean>(
      "nexus.coding.inboundClassifier.deepScan",
      false,
    ),
    swarmOrchestrationEnabled: c.get<boolean>(
      "nexus.coding.swarmOrchestration.enabled",
      false,
    ),
    panelRoutingEnabled: c.get<boolean>("nexus.llm.panelRouting", false),
    harnessSelectorEnabled: c.get<boolean>(
      "nexus.coding.harnessSelector.enabled",
      false,
    ),
    patientTierEnabled: c.get<boolean>("nexus.llm.patientTier.enabled", false),
    patientTierTimeoutMs: c.get<number>(
      "nexus.llm.patientTier.timeoutMs",
      3_600_000,
    ),
    memorySnapshotMode: (() => {
      const raw = c.get<string>("nexus.memory.snapshotMode", "frozen");
      return raw === "live" ? "live" : "frozen";
    })(),
    llmBackend: (() => {
      const raw = c.get<string>("nexus.llm.backend", "ollama");
      return typeof raw === "string" && raw.trim().length > 0
        ? raw.trim()
        : "ollama";
    })(),
    lmStudioBaseUrl: c.get<string>("nexus.llm.lmstudio.baseUrl", "http://127.0.0.1:1234"),
    localAdapters: c.get<unknown[]>("nexus.llm.localAdapters", []),
    thinkingModePreset: (() => {
      const raw = c.get<string>("nexus.coding.thinkingModePreset", "nothink");
      return raw === "think" || raw === "think-max" ? raw : "nothink";
    })(),
    memoryScoringMethod: (() => {
      const raw = c.get<string>("nexus.memory.scoringMethod", "rrf");
      return raw === "weighted" ? "weighted" : "rrf";
    })(),
    memoryScoringDefault: (() => {
      const raw = c.get<string>("nexus.memory.scoringDefault", "hybrid");
      return raw === "legacy" ? "legacy" : "hybrid";
    })(),
    memoryAnticipatoryCache: c.get<boolean>("nexus.memory.anticipatoryCache", false),
    reflectWorkerEnabled: c.get<boolean>("nexus.workers.reflect.enabled", true),
    traceAutoEnable: c.get<boolean>("nexus.trace.autoEnable", false),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * v1.0.0 Phase 2.1: notify when EITHER namespace changes. During the one-
 * cycle compat window we listen to both `nexus` (canonical) and `gemma-code`
 * (legacy) so users in the middle of migrating their `settings.json` keep
 * getting the same reactive behaviour.
 */
export function onSettingsChange(
  callback: (settings: NexusSettings) => void,
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("nexus") || event.affectsConfiguration("gemma-code")) {
      callback(getSettings());
    }
  });
}
