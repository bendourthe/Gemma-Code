import * as vscode from "vscode";

export interface GemmaCodeSettings {
  ollamaUrl: string;
  modelName: string;
  maxTokens: number;
  temperature: number;
  requestTimeout: number;
}

export function getSettings(): GemmaCodeSettings {
  const config = vscode.workspace.getConfiguration("gemma-code");
  return {
    ollamaUrl: config.get<string>("ollamaUrl") ?? "http://localhost:11434",
    modelName: config.get<string>("modelName") ?? "gemma3:27b",
    maxTokens: config.get<number>("maxTokens") ?? 8192,
    temperature: config.get<number>("temperature") ?? 0.2,
    requestTimeout: config.get<number>("requestTimeout") ?? 60000,
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
