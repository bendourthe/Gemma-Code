import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import type { MemoryFiles } from "../storage/MemoryFiles.js";
import type { MemoryStore } from "../storage/MemoryStore.js";
import type { MemoryEntry } from "../storage/MemoryShared.types.js";
import { getMemoryViewHtml } from "./webview/memoryView.js";
import { getLogger } from "../utils/logger.js";
import { formatForUser } from "../utils/errors.js";

export const MEMORY_PANEL_VIEW_ID = "gemma-code.memoryPanel";

/**
 * v0.7.0 Phase 5 -- inbound message types for the memory webview. Each message
 * round-trips a typed action; no direct fs / sqlite imports run inside the
 * webview iframe (per AGENTS.md module-authorship contract).
 */
type MemoryViewInbound =
  | { type: "ready" }
  | { type: "requestMemorySnapshot" }
  | { type: "openMemoryFile"; section: "instructions" | "memory" | "context" }
  | { type: "promoteSqlMemory"; id: string }
  | { type: "deleteSqlMemory"; id: string }
  | { type: "archiveMemoryNow" }
  | { type: "restoreArchive"; date: string };

/**
 * v0.7.0 Phase 5 -- outbound shape sent back to the webview. The shape is
 * exposed for unit tests so the panel logic can be exercised without spawning
 * a live VS Code WebviewView.
 */
export interface MemorySnapshotMessage {
  readonly type: "memorySnapshot";
  readonly workspaceMissing: boolean;
  readonly instructions: string;
  readonly memory: string;
  readonly context: string;
  readonly instructionsPath: string;
  readonly memoryPath: string;
  readonly contextPath: string;
  readonly sqlMemories: readonly {
    readonly id: string;
    readonly content: string;
    readonly type: string;
    readonly createdAt: number;
    readonly accessCount: number;
    /**
     * v0.8.0 Phase 4 sub-task 4.6 -- optional "why retrieved" reasons attached
     * by `HybridRanker`. Empty/undefined when the entry was loaded via the
     * plain `listAll` path with no ranker-produced explanation.
     */
    readonly reason?: readonly string[];
    readonly matchSource?: "keyword" | "semantic" | "both" | "hybrid";
  }[];
  readonly archive: {
    readonly archiveDir: string;
    readonly snapshots: readonly { readonly date: string }[];
  };
}

/**
 * Build the snapshot payload that the webview renders. Pure with respect to
 * the supplied dependencies; safe to call from tests.
 */
export function buildMemorySnapshot(
  memoryFiles: MemoryFiles | null,
  memoryStore: MemoryStore | null,
): MemorySnapshotMessage {
  if (!memoryFiles) {
    return {
      type: "memorySnapshot",
      workspaceMissing: true,
      instructions: "",
      memory: "",
      context: "",
      instructionsPath: "",
      memoryPath: "",
      contextPath: "",
      sqlMemories: [],
      archive: { archiveDir: "", snapshots: [] },
    };
  }
  const contents = memoryFiles.read();
  const sqlMemories = memoryStore
    ? memoryStore.listAll(500).map((entry: MemoryEntry) => ({
        id: entry.id,
        content: entry.content,
        type: entry.type,
        createdAt: entry.createdAt,
        accessCount: entry.accessCount,
      }))
    : [];
  return {
    type: "memorySnapshot",
    workspaceMissing: false,
    instructions: contents.instructions,
    memory: contents.memory,
    context: contents.context,
    instructionsPath: contents.instructionsPath,
    memoryPath: contents.memoryPath,
    contextPath: contents.contextPath,
    sqlMemories,
    archive: {
      archiveDir: memoryFiles.archiveDir,
      snapshots: listArchiveSnapshots(memoryFiles.archiveDir),
    },
  };
}

/**
 * v0.7.0 Phase 5 -- enumerate `<archiveDir>/<YYYY-MM-DD>` directories,
 * newest-first. Returns an empty array when the directory does not exist.
 * Exported for unit testability.
 */
export function listArchiveSnapshots(archiveDir: string): { date: string }[] {
  if (!fs.existsSync(archiveDir)) return [];
  const entries = fs.readdirSync(archiveDir, { withFileTypes: true });
  const dated: { date: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    dated.push({ date: entry.name });
  }
  dated.sort((a, b) => b.date.localeCompare(a.date));
  return dated;
}

/**
 * v0.7.0 Phase 5 -- "Promote" action: write the SQL row's content into
 * Memory.md (under the Preferences section) and delete the row from the SQL
 * store. Returns a result describing whether the promotion happened so the
 * panel host can surface a toast back to the webview.
 *
 * Pure with respect to the supplied dependencies; the section-resolution
 * heuristic maps SQL types to Memory.md sections so the user gets a
 * predictable place for each promoted row.
 */
export function promoteSqlMemoryToFile(
  memoryFiles: MemoryFiles,
  memoryStore: MemoryStore,
  id: string,
): { ok: true; section: string } | { ok: false; reason: string } {
  const rows = memoryStore.listAll(2000);
  const row = rows.find((r) => r.id === id);
  if (!row) return { ok: false, reason: "Memory not found" };
  const section = sectionForType(row.type, readPromotionMappingOverride());
  try {
    memoryFiles.appendToMemory(section, row.content);
  } catch (err) {
    return { ok: false, reason: formatForUser(err) };
  }
  if (!memoryStore.deleteById(id)) {
    return { ok: false, reason: "SQL row vanished after append" };
  }
  return { ok: true, section };
}

/**
 * v0.8.0 Phase 5 sub-task 5.10 -- documented + override-able section mapping.
 *
 * The default mapping was set in v0.7.0 Phase 5 and now lives in
 * `docs/v0.8.0/memory-promotion-mapping.md`. Users can override any entry via
 * the `gemma-code.memory.promotionMapping` setting (a flat object of
 * SQL-type -> section heading). Unknown SQL types fall back to "Preferences".
 */
export type MemorySectionHeading =
  | "Preferences"
  | "Corrections"
  | "Patterns"
  | "Decisions";

export const DEFAULT_PROMOTION_MAPPING: Readonly<Record<string, MemorySectionHeading>> =
  Object.freeze({
    decision: "Decisions",
    preference: "Preferences",
    error_resolution: "Corrections",
    file_pattern: "Patterns",
  });

export function sectionForType(
  type: string,
  override: Readonly<Record<string, MemorySectionHeading>> | null = null,
): MemorySectionHeading {
  if (override && override[type] && isValidSection(override[type]!)) {
    return override[type]!;
  }
  if (DEFAULT_PROMOTION_MAPPING[type]) {
    return DEFAULT_PROMOTION_MAPPING[type]!;
  }
  return "Preferences";
}

function isValidSection(value: string): value is MemorySectionHeading {
  return (
    value === "Preferences" ||
    value === "Corrections" ||
    value === "Patterns" ||
    value === "Decisions"
  );
}

/**
 * Read the user's optional override map from VS Code settings. Skipped in
 * non-VS-Code contexts (tests, CLI scripts) so the function stays pure when
 * the workspace API is unavailable.
 */
function readPromotionMappingOverride(): Readonly<Record<string, MemorySectionHeading>> | null {
  try {
    const config = vscode.workspace.getConfiguration("gemma-code");
    const raw = config.get<Record<string, string>>("memory.promotionMapping");
    if (!raw || typeof raw !== "object") return null;
    const out: Record<string, MemorySectionHeading> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && isValidSection(value)) {
        out[key] = value;
      }
    }
    return Object.keys(out).length > 0 ? Object.freeze(out) : null;
  } catch {
    return null;
  }
}

/**
 * v0.7.0 Phase 5 -- "Restore" action: copy a dated archive snapshot back over
 * the three live memory files. Returns the live paths that were written so
 * the panel host can echo a confirmation toast. Refuses to restore if the
 * snapshot path is missing or contains unexpected files.
 */
export function restoreArchiveSnapshot(
  memoryFiles: MemoryFiles,
  date: string,
): { ok: true; written: readonly string[] } | { ok: false; reason: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, reason: "Invalid archive date" };
  }
  const snapshotDir = path.join(memoryFiles.archiveDir, date);
  if (!fs.existsSync(snapshotDir)) {
    return { ok: false, reason: `Snapshot ${date} does not exist` };
  }
  const written: string[] = [];
  const targets: ReadonlyArray<[string, string]> = [
    ["Instructions.md", memoryFiles.instructionsPath],
    ["Memory.md", memoryFiles.memoryPath],
    ["Context.md", memoryFiles.contextPath],
  ];
  for (const [name, target] of targets) {
    const src = path.join(snapshotDir, name);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(src, target);
      written.push(target);
    }
  }
  memoryFiles.invalidateCache();
  return { ok: true, written };
}

/**
 * Memory-panel webview host. Mirrors the trace dashboard pattern: registers a
 * `WebviewViewProvider`, posts a snapshot when asked, and routes button
 * actions back to the underlying MemoryFiles / MemoryStore via small typed
 * messages so the webview iframe never needs to import storage modules.
 */
export interface MemoryPanelDeps {
  /** Returns the live MemoryFiles instance, or null when no workspace is open. */
  getMemoryFiles(): MemoryFiles | null;
  /** Returns the live MemoryStore instance, or null when SQL memory is disabled. */
  getMemoryStore(): MemoryStore | null;
}

export class MemoryPanel implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _deps: MemoryPanelDeps,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    const nonce = randomUUID().replace(/-/g, "");
    const cspSource = webviewView.webview.cspSource;
    webviewView.webview.html = getMemoryViewHtml(nonce, cspSource);

    webviewView.webview.onDidReceiveMessage((msg: MemoryViewInbound) => {
      void this._handle(msg);
    });

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });
  }

  /** Refresh the snapshot view. Safe to call from external triggers. */
  refresh(): void {
    if (!this._view) return;
    void this._view.webview.postMessage(
      buildMemorySnapshot(this._deps.getMemoryFiles(), this._deps.getMemoryStore()),
    );
  }

  private async _handle(msg: MemoryViewInbound): Promise<void> {
    switch (msg.type) {
      case "ready":
      case "requestMemorySnapshot":
        this.refresh();
        return;
      case "openMemoryFile":
        await this._openMemoryFile(msg.section);
        return;
      case "promoteSqlMemory":
        this._promoteSqlMemory(msg.id);
        return;
      case "deleteSqlMemory":
        this._deleteSqlMemory(msg.id);
        return;
      case "archiveMemoryNow":
        this._archiveNow();
        return;
      case "restoreArchive":
        this._restoreArchive(msg.date);
        return;
      default:
        return;
    }
  }

  private async _openMemoryFile(
    section: "instructions" | "memory" | "context",
  ): Promise<void> {
    const memoryFiles = this._deps.getMemoryFiles();
    if (!memoryFiles) {
      this._toast("Open a workspace to edit memory files.");
      return;
    }
    const target =
      section === "instructions"
        ? memoryFiles.instructionsPath
        : section === "context"
          ? memoryFiles.contextPath
          : memoryFiles.memoryPath;
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      getLogger().warn(`[MemoryPanel] openMemoryFile failed: ${formatForUser(err)}`);
      this._toast("Failed to open file.");
    }
  }

  private _promoteSqlMemory(id: string): void {
    const memoryFiles = this._deps.getMemoryFiles();
    const memoryStore = this._deps.getMemoryStore();
    if (!memoryFiles || !memoryStore) {
      this._toast("Memory system unavailable.");
      return;
    }
    const result = promoteSqlMemoryToFile(memoryFiles, memoryStore, id);
    if (result.ok) {
      this._toast(`Promoted to Memory.md (${result.section})`);
      this.refresh();
    } else {
      this._toast(`Promote failed: ${result.reason}`);
    }
  }

  private _deleteSqlMemory(id: string): void {
    const memoryStore = this._deps.getMemoryStore();
    if (!memoryStore) {
      this._toast("SQL memory unavailable.");
      return;
    }
    if (memoryStore.deleteById(id)) {
      this._toast("Memory deleted.");
      this.refresh();
    } else {
      this._toast("Memory not found.");
    }
  }

  private _archiveNow(): void {
    const memoryFiles = this._deps.getMemoryFiles();
    if (!memoryFiles) {
      this._toast("Open a workspace to archive memory.");
      return;
    }
    try {
      const result = memoryFiles.archive();
      this._toast(`Archived to ${path.basename(result.archivedPath)}`);
      this.refresh();
    } catch (err) {
      this._toast(`Archive failed: ${formatForUser(err)}`);
    }
  }

  private _restoreArchive(date: string): void {
    const memoryFiles = this._deps.getMemoryFiles();
    if (!memoryFiles) {
      this._toast("Open a workspace to restore memory.");
      return;
    }
    const result = restoreArchiveSnapshot(memoryFiles, date);
    if (result.ok) {
      this._toast(`Restored ${date} (${result.written.length} files)`);
      this.refresh();
    } else {
      this._toast(`Restore failed: ${result.reason}`);
    }
  }

  private _toast(text: string): void {
    if (!this._view) return;
    void this._view.webview.postMessage({ type: "memoryToast", text });
  }
}
