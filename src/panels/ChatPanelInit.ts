import * as path from "path";
import * as vscode from "vscode";
import { ChatHistoryStore } from "../storage/ChatHistoryStore.js";
import { MemorySubsystem } from "../storage/MemorySubsystem.js";
import { MemoryFiles, deriveWorkspaceId } from "../storage/MemoryFiles.js";
import { ToolOutputCache } from "../storage/ToolOutputCache.js";
import { WebResponseCache } from "../tools/handlers/webCache.js";
import { OperationLog } from "../observability/OperationLog.js";
import type { GemmaCodeSettings } from "../config/settings.js";
import type { LLMClient } from "../llm/types.js";
import { getLogger } from "../../modules/coding/utils/logger.js";
import { formatForUser } from "../../modules/coding/utils/errors.js";

// Composition helpers extracted from NexusCodingPanel as part of v0.7.0 Phase 0
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
    hnsw: settings.memoryHnswThreshold > 0
      ? {
          indexPath: path.join(globalStorageUri.fsPath, "memory.hnsw"),
          threshold: settings.memoryHnswThreshold,
        }
      : undefined,
  });
}

/**
 * v0.7.0 Phase 2: build the file-backed memory architecture for the active
 * workspace. Auto-scaffolds Instructions.md / Memory.md / Context.md on first
 * session so the architecture is always present when PromptBuilder reads it.
 * When `memoryAutoArchive` is set to `weekly` or `monthly`, a stale snapshot
 * triggers a silent archive on session start.
 *
 * Returns `null` when no workspace is open (so a chat session in an empty
 * window keeps the existing degraded mode).
 *
 * The optional `baseDir` override exists primarily for integration tests --
 * Windows `os.homedir()` ignores `USERPROFILE` env overrides, so the test
 * harness needs an explicit injection point. Production callers should leave
 * it undefined so the canonical `~/.nexus/memory/` path is used.
 */
export function buildMemoryFiles(
  settings: GemmaCodeSettings,
  baseDir?: string,
): MemoryFiles | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  try {
    const workspacePath = folders[0]!.uri.fsPath;
    const workspaceId = deriveWorkspaceId(workspacePath);
    const memoryFiles = new MemoryFiles(workspaceId, baseDir);
    memoryFiles.init(false);
    runAutoArchive(memoryFiles, settings.memoryAutoArchive);
    return memoryFiles;
  } catch (err) {
    getLogger().debug(
      `[ChatPanelInit] MemoryFiles init failed:`,
      formatForUser(err),
    );
    return null;
  }
}

function runAutoArchive(memoryFiles: MemoryFiles, mode: "off" | "weekly" | "monthly"): void {
  if (mode === "off") return;
  const latest = memoryFiles.latestArchiveDate();
  const thresholdDays = mode === "weekly" ? 7 : 30;
  const now = new Date();
  if (latest) {
    const ageDays = (now.getTime() - latest.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < thresholdDays) return;
  }
  try {
    memoryFiles.archive();
    getLogger().debug(
      `[ChatPanelInit] Auto-archived memory files (mode=${mode}, latest=${latest?.toISOString() ?? "never"}).`,
    );
  } catch (err) {
    getLogger().debug(
      `[ChatPanelInit] Auto-archive failed:`,
      formatForUser(err),
    );
  }
}
