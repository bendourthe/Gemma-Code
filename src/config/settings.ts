import * as vscode from "vscode";
import type { EditMode } from "../tools/types.js";
import type { PromptStyle } from "../chat/PromptBuilder.types.js";

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
  useBackend: boolean;
  backendPort: number;
  pythonPath: string;
  memoryEnabled: boolean;
  embeddingModel: string;
  memoryAutoSaveInterval: number;
  memoryMaxEntries: number;
  mcpEnabled: boolean;
  mcpServerMode: "stdio" | "off";
  verificationEnabled: boolean;
  verificationThreshold: number;
  subAgentMaxIterations: number;
}

export function getSettings(): GemmaCodeSettings {
  const config = vscode.workspace.getConfiguration("gemma-code");
  return {
    ollamaUrl: config.get<string>("ollamaUrl") ?? "http://localhost:11434",
    modelName: config.get<string>("modelName") ?? "gemma4",
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
    useBackend: config.get<boolean>("useBackend") ?? true,
    backendPort: config.get<number>("backendPort") ?? 11435,
    pythonPath: config.get<string>("pythonPath") ?? "python",
    memoryEnabled: config.get<boolean>("memoryEnabled") ?? true,
    embeddingModel: config.get<string>("embeddingModel") ?? "nomic-embed-text",
    memoryAutoSaveInterval: config.get<number>("memoryAutoSaveInterval") ?? 15,
    memoryMaxEntries: config.get<number>("memoryMaxEntries") ?? 10000,
    mcpEnabled: config.get<boolean>("mcpEnabled") ?? false,
    mcpServerMode: (config.get<string>("mcpServerMode") as "stdio" | "off" | undefined) ?? "off",
    verificationEnabled: config.get<boolean>("verificationEnabled") ?? true,
    verificationThreshold: config.get<number>("verificationThreshold") ?? 3,
    subAgentMaxIterations: config.get<number>("subAgentMaxIterations") ?? 10,
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
