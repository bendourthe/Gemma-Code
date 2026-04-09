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
    editMode: (config.get<string>("editMode") as EditMode | undefined) ?? "auto",
    thinkingMode: config.get<boolean>("thinkingMode") ?? true,
    promptStyle: (config.get<string>("promptStyle") as PromptStyle | undefined) ?? "concise",
    systemPromptBudgetPercent: config.get<number>("systemPromptBudgetPercent") ?? 10,
    compactionKeepRecent: config.get<number>("compactionKeepRecent") ?? 10,
    compactionToolResultsKeep: config.get<number>("compactionToolResultsKeep") ?? 8,
    useBackend: config.get<boolean>("useBackend") ?? true,
    backendPort: config.get<number>("backendPort") ?? 11435,
    pythonPath: config.get<string>("pythonPath") ?? "python",
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
