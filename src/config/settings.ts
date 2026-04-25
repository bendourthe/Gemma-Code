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
  mcpEnabled: boolean;
  mcpServerMode: "stdio" | "off";
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
}

// NOTE(v0.5): remove gpuTier fallback. Reads the legacy `gemma-code.gpuTier`
// string setting and maps it onto the canonical `gpuTierOverride` numeric tier
// for one release so users with the old preference do not regress.
function readGpuTierOverride(
  config: vscode.WorkspaceConfiguration,
): HardwareTierId | null {
  const explicit = config.get<number | null>("gpuTierOverride");
  if (explicit === 1 || explicit === 2 || explicit === 3) {
    return explicit;
  }
  const legacy = config.get<string>("gpuTier");
  if (legacy === "1" || legacy === "2" || legacy === "3") {
    return Number(legacy) as HardwareTierId;
  }
  return null;
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
    mcpEnabled: config.get<boolean>("mcpEnabled") ?? false,
    mcpServerMode: (config.get<string>("mcpServerMode") as "stdio" | "off" | undefined) ?? "off",
    verificationEnabled: config.get<boolean>("verificationEnabled") ?? true,
    verificationThreshold: config.get<number>("verificationThreshold") ?? 3,
    subAgentMaxIterations: config.get<number>("subAgentMaxIterations") ?? 10,
    autoDetectGpu: config.get<boolean>("autoDetectGpu") ?? true,
    gpuTierOverride: readGpuTierOverride(config),
    permissionOverrides: config.get<Record<string, number>>("permissionOverrides") ?? {},
    otlpEnabled: config.get<boolean>("otlpEnabled") ?? false,
    otlpEndpoint: config.get<string>("otlpEndpoint") ?? "http://localhost:4318/v1/traces",
    otlpHeaders: config.get<string>("otlpHeaders") ?? "",
    secretPathDenyExtra: config.get<string[]>("secretPathDenyExtra") ?? [],
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
