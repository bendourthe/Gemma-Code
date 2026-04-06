import * as vscode from "vscode";
import type { EditMode } from "../tools/types.js";

export type ToolConfirmationMode = "always" | "ask" | "never";

export interface GemmaCodeSettings {
  ollamaUrl: string;
  modelName: string;
  maxTokens: number;
  temperature: number;
  requestTimeout: number;
  toolConfirmationMode: ToolConfirmationMode;
  maxAgentIterations: number;
  editMode: EditMode;
  useBackend: boolean;
  backendPort: number;
  pythonPath: string;
}

export function getSettings(): GemmaCodeSettings {
  const config = vscode.workspace.getConfiguration("gemma-code");
  return {
    ollamaUrl: config.get<string>("ollamaUrl") ?? "http://localhost:11434",
    modelName: config.get<string>("modelName") ?? "gemma3:27b",
    maxTokens: config.get<number>("maxTokens") ?? 8192,
    temperature: config.get<number>("temperature") ?? 0.2,
    requestTimeout: config.get<number>("requestTimeout") ?? 60000,
    toolConfirmationMode:
      (config.get<string>("toolConfirmationMode") as ToolConfirmationMode | undefined) ?? "ask",
    maxAgentIterations: config.get<number>("maxAgentIterations") ?? 20,
    editMode: (config.get<string>("editMode") as EditMode | undefined) ?? "auto",
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
