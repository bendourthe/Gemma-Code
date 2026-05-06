import * as path from "path";
import * as vscode from "vscode";
import { ChatHistoryStore } from "../storage/ChatHistoryStore.js";
import { MemorySubsystem } from "../storage/MemorySubsystem.js";
import { ToolOutputCache } from "../storage/ToolOutputCache.js";
import { WebResponseCache } from "../tools/handlers/webCache.js";
import { OperationLog } from "../observability/OperationLog.js";
import type { GemmaCodeSettings } from "../config/settings.js";
import type { LLMClient } from "../llm/types.js";
import { getLogger } from "../utils/logger.js";
import { formatForUser } from "../utils/errors.js";

// Composition helpers extracted from GemmaCodePanel as part of v0.7.0 Phase 0
// sub-task 0.4 (panel decomposition + ChatController construction-graph
// hoist). Each helper builds a single subsystem from the runtime/workspace
// inputs the panel already owns; failures fall back to a null result so the
// panel can continue operating in a degraded mode rather than crashing.

export function initStore(
  globalStorageUri: vscode.Uri | undefined,
): ChatHistoryStore | null {
  if (!globalStorageUri) return null;
  try {
    const dbPath = path.join(globalStorageUri.fsPath, "chat-history.db");
    return new ChatHistoryStore(dbPath);
  } catch {
    return null;
  }
}

export function initToolOutputCache(
  settings: GemmaCodeSettings,
): ToolOutputCache | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  try {
    const cache = new ToolOutputCache({
      extraSecretPatterns: settings.secretPathDenyExtra,
    });
    cache.open(folders[0]!.uri.fsPath);
    return cache;
  } catch (err) {
    getLogger().debug(
      `[ChatPanelInit] ToolOutputCache init failed:`,
      formatForUser(err),
    );
    return null;
  }
}

export function initWebResponseCache(): WebResponseCache | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  try {
    const cache = new WebResponseCache();
    cache.open(folders[0]!.uri.fsPath);
    return cache;
  } catch (err) {
    getLogger().debug(
      `[ChatPanelInit] WebResponseCache init failed:`,
      formatForUser(err),
    );
    return null;
  }
}

export function initOperationLog(
  settings: GemmaCodeSettings,
): OperationLog | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  try {
    const log = new OperationLog({
      extraSecretPatterns: settings.secretPathDenyExtra,
    });
    log.open(folders[0]!.uri.fsPath);
    log.setEnabled(settings.operationLogEnabled);
    return log;
  } catch (err) {
    getLogger().debug(
      `[ChatPanelInit] OperationLog init failed:`,
      formatForUser(err),
    );
    return null;
  }
}

export function buildMemorySubsystem(
  settings: GemmaCodeSettings,
  llmClient: LLMClient,
  toolOutputCache: ToolOutputCache | null,
  globalStorageUri: vscode.Uri | undefined,
): MemorySubsystem {
  if (!settings.memoryEnabled || !globalStorageUri) {
    return MemorySubsystem.disabled();
  }
  const dbPath = path.join(globalStorageUri.fsPath, "memory.db");
  return new MemorySubsystem({
    dbPath,
    llmClient,
    embeddingModel: settings.embeddingModel ?? null,
    toolOutputCache,
    corroborationThreshold: settings.memoryCorroborationThreshold,
  });
}
