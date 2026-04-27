import { createHash } from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { createPatch } from "diff";
import type {
  ToolHandler,
  ToolResult,
  EditMode,
  ReadFileParams,
  WriteFileParams,
  EditFileParams,
  CreateFileParams,
  DeleteFileParams,
  ListDirectoryParams,
  GrepCodebaseParams,
} from "../types.js";
import type { ConfirmationGate } from "../ConfirmationGate.js";
import type { ToolOutputCache } from "../../storage/ToolOutputCache.js";
import { matchesSecretPath } from "./secretPaths.js";
import { resolveInsideWorkspace, workspaceRoot as guardedWorkspaceRoot } from "./pathGuard.js";

const MAX_READ_LINES = 500;
const MAX_GREP_RESULTS = 50;
const MAX_GREP_RESULTS_CEILING = 500;
const READ_RANGE_MAX_WINDOW = 1024 * 1024; // 1 MB per paginated window
const MAX_LIST_DEPTH = 3;
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "out", "dist", "__pycache__"]);
const DRY_RUN_SHA_BYTES_CAP = 1024 * 1024; // 1 MB SHA-256 sample for delete_file dry-run
/** 64 KB byte budget mirrored from OutputRedirector.DEFAULT_MAX_BYTES; used for in-handler JSON pre-truncation. */
const FORMAT_JSON_BYTE_CAP = 64 * 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function workspaceRoot(): string {
  return guardedWorkspaceRoot();
}

// Realpath-aware resolution: every filesystem tool routes user-supplied paths
// through the unified pathGuard so symlinks that point outside the workspace
// are rejected. See docs/v0.6.0/plans/v0.6.0-cycle.md sub-task 1.1.
function resolveWorkspacePath(relativePath: string): string {
  return resolveInsideWorkspace(relativePath);
}

function uriFromRelative(relativePath: string): vscode.Uri {
  return vscode.Uri.file(resolveWorkspacePath(relativePath));
}

async function readFileContent(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf-8");
}

async function writeFileContent(uri: vscode.Uri, content: string): Promise<void> {
  const parentUri = vscode.Uri.file(path.dirname(uri.fsPath));
  await vscode.workspace.fs.createDirectory(parentUri);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
}

function failResult(id: string, error: string): ToolResult {
  return { id, success: false, output: "", error };
}

/**
 * Opens the VS Code built-in diff editor showing original vs. modified content.
 * The "modified" version is shown as an untitled in-memory document.
 */
async function openDiffEditor(
  filePath: string,
  originalUri: vscode.Uri,
  updatedContent: string
): Promise<void> {
  try {
    const modifiedDoc = await vscode.workspace.openTextDocument({
      content: updatedContent,
    });
    await vscode.commands.executeCommand(
      "vscode.diff",
      originalUri,
      modifiedDoc.uri,
      `${path.basename(filePath)} (proposed edit)`
    );
  } catch {
    // Non-fatal: the diff in the webview confirmation card already shows the change.
  }
}

// ---------------------------------------------------------------------------
// ReadFileTool
// ---------------------------------------------------------------------------

export class ReadFileTool implements ToolHandler {
  constructor(
    private readonly _confirmationGate: ConfirmationGate | null = null,
    private readonly _extraSecretPatterns: readonly string[] = [],
    private readonly _cache: ToolOutputCache | null = null,
  ) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as ReadFileParams;

    if (!p.path || typeof p.path !== "string") {
      return failResult(
        id,
        "Missing required parameter: path. " +
          "Usage: read_file(path=<workspace-relative path>). " +
          "Example: read_file(path='src/extension.ts').",
      );
    }

    // Validate optional pagination parameters before any I/O.
    const rangeStart = p.range_start;
    const rangeEnd = p.range_end;
    const hasRange = rangeStart !== undefined || rangeEnd !== undefined;
    if (hasRange) {
      if (typeof rangeStart !== "number" || !Number.isFinite(rangeStart) || rangeStart < 0) {
        return failResult(
          id,
          "Invalid range_start: must be a non-negative number. " +
            "Usage: read_file(path, range_start=<bytes from start>, range_end=<exclusive end>).",
        );
      }
      if (rangeEnd !== undefined &&
          (typeof rangeEnd !== "number" || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart)) {
        return failResult(
          id,
          `Invalid range_end=${rangeEnd}: must be a number greater than range_start=${rangeStart}. ` +
            `Usage: read_file(path, range_start=0, range_end=4096).`,
        );
      }
      if (rangeEnd !== undefined && rangeEnd - rangeStart > READ_RANGE_MAX_WINDOW) {
        return failResult(
          id,
          `Invalid range_end-range_start=${rangeEnd - rangeStart}: window exceeds the per-call limit of ${READ_RANGE_MAX_WINDOW} bytes. ` +
            `Usage: read_file(path, range_start=<offset>, range_end=<offset + at most ${READ_RANGE_MAX_WINDOW}>).`,
        );
      }
    }

    if (matchesSecretPath(p.path, this._extraSecretPatterns)) {
      if (p.allow_secrets !== true) {
        return failResult(
          id,
          `Path "${p.path}" matches the secret-path denylist. ` +
            `Usage: pass allow_secrets=true to request explicit user confirmation, or read a non-secret path.`,
        );
      }
      if (this._confirmationGate) {
        const approved = await this._confirmationGate.request(
          id,
          `Read secret-path file "${p.path}"?`,
          "The path matches the secret-path denylist (env/keys/credentials). Only approve if you trust this file.",
        );
        if (!approved) {
          return failResult(
            id,
            `Read of secret-path file "${p.path}" rejected by user. ` +
              `Usage: read_file(path=<non-secret path>) or retry with explicit user approval.`,
          );
        }
      }
    }

    let uri: vscode.Uri;
    try {
      uri = uriFromRelative(p.path);
    } catch (err) {
      return failResult(
        id,
        `${(err as Error).message} ` +
          `Usage: read_file(path=<workspace-relative path inside the project root>).`,
      );
    }

    let content: string;
    try {
      content = await readFileContent(uri);
    } catch {
      return failResult(
        id,
        `File not found or unreadable at path "${p.path}". ` +
          `Usage: read_file(path=<existing workspace-relative file>). ` +
          `To list directory contents, use list_directory(path=<dir>).`,
      );
    }

    // Paginated path: return the requested byte window (or up to EOF).
    if (hasRange) {
      const buf = Buffer.from(content, "utf-8");
      const fileSize = buf.length;
      const start = Math.min(rangeStart!, fileSize);
      const requestedEnd = rangeEnd ?? fileSize;
      const end = Math.min(requestedEnd, fileSize);
      const slice = buf.subarray(start, end);
      let windowText = slice.toString("utf-8");
      const eofReached = end >= fileSize;
      if (eofReached && requestedEnd > fileSize) {
        windowText += `\n=== End of file at byte ${fileSize} ===`;
      }
      return {
        id,
        success: true,
        output: JSON.stringify({
          content: windowText,
          range_start: start,
          range_end: end,
          file_size: fileSize,
          eof: eofReached,
        }),
      };
    }

    // Diff-based cache path. Active only when (a) a cache is wired in and
    // (b) `full=true` was not requested. On cache hit, return either the
    // unchanged-marker (byte-identical content) or a unified diff (file
    // changed since prior read). Always update the cache afterwards so the
    // next read diffs against the latest content.
    if (this._cache && p.full !== true) {
      try {
        const hit = this._cache.lookup(uri.fsPath);
        this._cache.store(uri.fsPath, content, p.path);
        if (hit !== null) {
          if (hit.content === content) {
            const storedAtIso = new Date().toISOString();
            return {
              id,
              success: true,
              output: JSON.stringify({
                cached: true,
                changed: false,
                marker: `=== cached: file unchanged since ${storedAtIso} ===`,
                file_size: Buffer.byteLength(content, "utf8"),
              }),
            };
          }
          const nowIso = new Date().toISOString();
          const diff = createPatch(p.path, hit.content, content, "cached", "current");
          const header = `=== diff vs. cached read at ${nowIso} ===\n`;
          return {
            id,
            success: true,
            output: JSON.stringify({
              cached: true,
              changed: true,
              diff: header + diff,
              file_size: Buffer.byteLength(content, "utf8"),
            }),
          };
        }
      } catch {
        // Cache failures must never break read_file.
      }
    }

    const lines = content.split("\n");
    let truncated = false;
    let displayContent = content;

    if (lines.length > MAX_READ_LINES) {
      displayContent = lines.slice(0, MAX_READ_LINES).join("\n");
      displayContent += `\n\n[... truncated: showing ${MAX_READ_LINES} of ${lines.length} lines ...]`;
      truncated = true;
    }

    return {
      id,
      success: true,
      output: JSON.stringify({
        content: displayContent,
        lines: lines.length,
        truncated,
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// WriteFileTool
// ---------------------------------------------------------------------------

export class WriteFileTool implements ToolHandler {
  constructor(
    private readonly _confirmationGate: ConfirmationGate | null = null,
    private readonly _editMode: EditMode = "auto"
  ) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as WriteFileParams;

    if (!p.path || typeof p.path !== "string") {
      return failResult(
        id,
        "Missing required parameter: path. " +
          "Usage: write_file(path=<workspace-relative path>, content=<file contents>).",
      );
    }
    if (typeof p.content !== "string") {
      return failResult(
        id,
        "Missing required parameter: content. " +
          "Usage: write_file(path=<workspace-relative path>, content=<file contents as a string>).",
      );
    }

    let uri: vscode.Uri;
    try {
      uri = uriFromRelative(p.path);
    } catch (err) {
      return failResult(
        id,
        `${(err as Error).message} ` +
          `Usage: write_file(path=<workspace-relative path inside the project root>, content=<...>).`,
      );
    }

    if (this._editMode === "plan") {
      // Show proposed content as a diff against an empty baseline, but don't write.
      const diff = createPatch(p.path, "", p.content, "empty", "proposed");
      await this._confirmationGate?.requestDiffPreview(id, p.path, diff);
      return failResult(
        id,
        `Edit shown in diff preview for path "${p.path}" but not applied (plan mode). ` +
          `Usage: switch editMode out of 'plan' to apply, or call edit_file/create_file outside plan mode.`,
      );
    }

    if (this._editMode === "ask" && this._confirmationGate) {
      let original = "";
      try {
        original = await readFileContent(uri);
      } catch {
        // New file — diff against empty.
      }
      const diff = createPatch(p.path, original, p.content, "original", "modified");
      await openDiffEditor(p.path, uri, p.content);
      const approved = await this._confirmationGate.request(
        id,
        `Write file "${p.path}"?`,
        diff
      );
      if (!approved) {
        return failResult(
          id,
          `Write of path "${p.path}" rejected by user. ` +
            `Usage: write_file(path=<...>, content=<...>) — the user must approve the diff.`,
        );
      }
    }

    try {
      await writeFileContent(uri, p.content);
    } catch (err) {
      return failResult(
        id,
        `Failed to write file at path "${p.path}": ${(err as Error).message}. ` +
          `Usage: write_file(path=<writable workspace-relative path>, content=<...>).`,
      );
    }

    return { id, success: true, output: JSON.stringify({ success: true, path: p.path }) };
  }
}

// ---------------------------------------------------------------------------
// CreateFileTool
// ---------------------------------------------------------------------------

export class CreateFileTool implements ToolHandler {
  constructor(
    private readonly _confirmationGate: ConfirmationGate | null = null,
    private readonly _editMode: EditMode = "auto"
  ) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as CreateFileParams;

    if (!p.path || typeof p.path !== "string") {
      return failResult(
        id,
        "Missing required parameter: path. " +
          "Usage: create_file(path=<workspace-relative path>, content=<optional initial content>).",
      );
    }

    let uri: vscode.Uri;
    try {
      uri = uriFromRelative(p.path);
    } catch (err) {
      return failResult(
        id,
        `${(err as Error).message} ` +
          `Usage: create_file(path=<workspace-relative path inside the project root>).`,
      );
    }

    // Fail if the file already exists.
    try {
      await vscode.workspace.fs.stat(uri);
      return failResult(
        id,
        `File already exists at path "${p.path}". ` +
          `Usage: use write_file(path=<...>, content=<...>) to overwrite, or edit_file to modify in place.`,
      );
    } catch {
      // stat threw → file does not exist, which is what we want.
    }

    const content = typeof p.content === "string" ? p.content : "";

    if (this._editMode === "plan") {
      const diff = createPatch(p.path, "", content, "empty", "new file");
      await this._confirmationGate?.requestDiffPreview(id, p.path, diff);
      return failResult(
        id,
        `File creation shown in diff preview for path "${p.path}" but not applied (plan mode). ` +
          `Usage: switch editMode out of 'plan' to commit the new file.`,
      );
    }

    if (this._editMode === "ask" && this._confirmationGate) {
      const diff = createPatch(p.path, "", content, "empty", "new file");
      const approved = await this._confirmationGate.request(
        id,
        `Create file "${p.path}"?`,
        diff
      );
      if (!approved) {
        return failResult(
          id,
          `File creation at path "${p.path}" rejected by user. ` +
            `Usage: create_file(path=<...>, content=<...>) — the user must approve the diff.`,
        );
      }
    }

    try {
      await writeFileContent(uri, content);
    } catch (err) {
      return failResult(
        id,
        `Failed to create file at path "${p.path}": ${(err as Error).message}. ` +
          `Usage: create_file(path=<writable workspace-relative path>).`,
      );
    }

    return { id, success: true, output: JSON.stringify({ success: true, path: p.path }) };
  }
}

// ---------------------------------------------------------------------------
// DeleteFileTool
// ---------------------------------------------------------------------------

export class DeleteFileTool implements ToolHandler {
  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as DeleteFileParams;

    if (!p.path || typeof p.path !== "string") {
      return failResult(
        id,
        "Missing required parameter: path. " +
          "Usage: delete_file(path=<workspace-relative path>).",
      );
    }

    let uri: vscode.Uri;
    try {
      uri = uriFromRelative(p.path);
    } catch (err) {
      return failResult(
        id,
        `${(err as Error).message} ` +
          `Usage: delete_file(path=<workspace-relative path inside the project root>).`,
      );
    }

    if (p.dry_run === true) {
      return this._dryRunReport(id, p.path, uri);
    }

    try {
      await vscode.workspace.fs.delete(uri);
    } catch (err) {
      return failResult(
        id,
        `Failed to delete file at path "${p.path}": ${(err as Error).message}. ` +
          `Usage: delete_file(path=<existing workspace-relative file>).`,
      );
    }

    return { id, success: true, output: JSON.stringify({ success: true, path: p.path }) };
  }

  /**
   * Build the dry-run report for `delete_file`: stat the file (size in bytes)
   * and SHA-256 the first 1 MB of content (so the agent can verify identity
   * without paying the full hash cost on multi-GB files). Crucially, no
   * `vscode.workspace.fs.delete` call is made.
   */
  private async _dryRunReport(
    id: string,
    relativePath: string,
    uri: vscode.Uri,
  ): Promise<ToolResult> {
    let stat: { size: number };
    try {
      stat = (await vscode.workspace.fs.stat(uri)) as { size: number };
    } catch (err) {
      return failResult(
        id,
        `Failed to stat file at path "${relativePath}": ${(err as Error).message}. ` +
          `Usage: delete_file(path=<existing workspace-relative file>, dry_run=true).`,
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (err) {
      return failResult(
        id,
        `Failed to read file at path "${relativePath}" for dry-run hash: ${(err as Error).message}. ` +
          `Usage: delete_file(path=<existing workspace-relative file>, dry_run=true).`,
      );
    }

    const sample = bytes.length > DRY_RUN_SHA_BYTES_CAP
      ? bytes.subarray(0, DRY_RUN_SHA_BYTES_CAP)
      : bytes;
    const hash = createHash("sha256").update(sample).digest("hex");
    const hashLabel =
      bytes.length > DRY_RUN_SHA_BYTES_CAP
        ? `Content SHA-256 (first 1 MB): ${hash}`
        : `Content SHA-256: ${hash}`;

    const output =
      "=== DRY RUN: no deletion occurred ===\n" +
      `Target: ${uri.fsPath}\n` +
      `Size: ${stat.size}\n` +
      hashLabel;
    return { id, success: true, output };
  }
}

// ---------------------------------------------------------------------------
// EditFileTool
// ---------------------------------------------------------------------------

export class EditFileTool implements ToolHandler {
  constructor(
    private readonly _confirmationGate: ConfirmationGate | null = null,
    private readonly _editMode: EditMode = "auto"
  ) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as EditFileParams;

    if (!p.path || typeof p.path !== "string") {
      return failResult(
        id,
        "Missing required parameter: path. " +
          "Usage: edit_file(path=<workspace-relative path>, old_string=<exact text to find>, new_string=<replacement text>).",
      );
    }
    if (typeof p.old_string !== "string") {
      return failResult(
        id,
        "Missing required parameter: old_string. " +
          "Usage: edit_file(path=<...>, old_string=<exact text to find>, new_string=<replacement text>).",
      );
    }
    if (typeof p.new_string !== "string") {
      return failResult(
        id,
        "Missing required parameter: new_string. " +
          "Usage: edit_file(path=<...>, old_string=<...>, new_string=<replacement text>).",
      );
    }

    let uri: vscode.Uri;
    try {
      uri = uriFromRelative(p.path);
    } catch (err) {
      return failResult(
        id,
        `${(err as Error).message} ` +
          `Usage: edit_file(path=<workspace-relative path inside the project root>, ...).`,
      );
    }

    let original: string;
    try {
      original = await readFileContent(uri);
    } catch {
      return failResult(
        id,
        `File not found or unreadable at path "${p.path}". ` +
          `Usage: edit_file(path=<existing workspace-relative file>, ...).`,
      );
    }

    // Count occurrences of old_string.
    const occurrences = original.split(p.old_string).length - 1;
    if (occurrences === 0) {
      return failResult(
        id,
        `old_string not found in path "${p.path}". No changes made. ` +
          `Usage: re-read the file with read_file(path="${p.path}") and pass an exact-matching old_string.`,
      );
    }
    if (occurrences > 1) {
      return failResult(
        id,
        `old_string appears ${occurrences} times in path "${p.path}"; cannot apply ambiguously. ` +
          `Usage: pass a more specific old_string with surrounding context that appears only once.`,
      );
    }

    const updated = original.replace(p.old_string, p.new_string);
    const diff = createPatch(p.path, original, updated, "original", "modified");

    if (this._editMode === "plan") {
      // Show the diff but do not apply it.
      await this._confirmationGate?.requestDiffPreview(id, p.path, diff);
      return failResult(
        id,
        `Edit shown in diff preview for path "${p.path}" but not applied (plan mode). ` +
          `Usage: switch editMode out of 'plan' to apply.`,
      );
    }

    if (this._editMode === "ask" && this._confirmationGate) {
      // Open VS Code diff editor and show webview confirmation card.
      await openDiffEditor(p.path, uri, updated);
      const approved = await this._confirmationGate.request(
        id,
        `Apply edit to "${p.path}"?`,
        diff
      );
      if (!approved) {
        return failResult(
          id,
          `Edit of path "${p.path}" rejected by user. ` +
            `Usage: edit_file(path=<...>, old_string=<...>, new_string=<...>) — the user must approve the diff.`,
        );
      }
    }

    // "auto" mode (or approved "ask") — write without further prompting.
    try {
      await writeFileContent(uri, updated);
    } catch (err) {
      return failResult(
        id,
        `Failed to write edited file at path "${p.path}": ${(err as Error).message}. ` +
          `Usage: edit_file(path=<writable workspace-relative path>, ...).`,
      );
    }

    return {
      id,
      success: true,
      output: JSON.stringify({ success: true, diff }),
    };
  }
}

// ---------------------------------------------------------------------------
// ListDirectoryTool
// ---------------------------------------------------------------------------

interface DirEntry {
  name: string;
  type: "file" | "directory";
}

async function walkDir(
  uri: vscode.Uri,
  depth: number,
  maxDepth: number
): Promise<DirEntry[]> {
  if (depth > maxDepth) return [];

  let entries: [string, vscode.FileType][];
  try {
    const raw = await vscode.workspace.fs.readDirectory(uri);
    // Defensive: treat any non-iterable / non-array result as an empty directory.
    entries = Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }

  const result: DirEntry[] = [];
  for (const [name, fileType] of entries) {
    if (EXCLUDED_DIRS.has(name)) continue;

    if (fileType === vscode.FileType.Directory) {
      result.push({ name, type: "directory" });
      if (depth < maxDepth) {
        const childUri = vscode.Uri.joinPath(uri, name);
        const children = await walkDir(childUri, depth + 1, maxDepth);
        for (const child of children) {
          result.push({ name: `${name}/${child.name}`, type: child.type });
        }
      }
    } else {
      result.push({ name, type: "file" });
    }
  }

  return result;
}

export class ListDirectoryTool implements ToolHandler {
  constructor(
    private readonly _confirmationGate: ConfirmationGate | null = null,
    private readonly _extraSecretPatterns: readonly string[] = [],
  ) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as ListDirectoryParams;

    const relativePath = typeof p.path === "string" ? p.path : ".";

    if (matchesSecretPath(relativePath, this._extraSecretPatterns)) {
      if (p.allow_secrets !== true) {
        return failResult(
          id,
          `Path "${relativePath}" matches the secret-path denylist. ` +
            `Usage: pass allow_secrets=true to request explicit user confirmation, or list a non-secret path.`,
        );
      }
      if (this._confirmationGate) {
        const approved = await this._confirmationGate.request(
          id,
          `List secret-path directory "${relativePath}"?`,
          "The path matches the secret-path denylist. Only approve if you trust this location.",
        );
        if (!approved) {
          return failResult(
            id,
            `List of secret-path directory "${relativePath}" rejected by user. ` +
              `Usage: list_directory(path=<non-secret path>).`,
          );
        }
      }
    }

    const recursive = p.recursive !== false; // defaults to true

    let uri: vscode.Uri;
    try {
      const resolved = resolveWorkspacePath(relativePath);
      uri = vscode.Uri.file(resolved);
    } catch (err) {
      return failResult(
        id,
        `${(err as Error).message} ` +
          `Usage: list_directory(path=<workspace-relative directory>).`,
      );
    }

    const maxDepth = recursive ? MAX_LIST_DEPTH : 1;
    const entries = await walkDir(uri, 1, maxDepth);

    // Filter out secret-path entries from results when allow_secrets is not set.
    const filteredEntries = p.allow_secrets === true
      ? entries
      : entries.filter((e) => !matchesSecretPath(e.name, this._extraSecretPatterns));

    if (p.format === "json") {
      const output = await renderListDirectoryJson(uri, filteredEntries);
      return { id, success: true, output };
    }

    return {
      id,
      success: true,
      output: JSON.stringify({ entries: filteredEntries, count: filteredEntries.length }),
    };
  }
}

/**
 * Stat each file entry to capture `size_bytes`, then serialise as parseable JSON
 * with a 64 KB byte budget. When the budget is exceeded the array is truncated
 * at the last entry that fits and a `_truncation` string is appended so the
 * output remains valid JSON the agent can `JSON.parse` end-to-end.
 */
async function renderListDirectoryJson(
  rootUri: vscode.Uri,
  entries: readonly DirEntry[],
): Promise<string> {
  interface JsonEntry {
    name: string;
    type: "file" | "directory";
    size_bytes?: number;
  }
  const enriched: JsonEntry[] = [];
  for (const entry of entries) {
    if (entry.type === "file") {
      let size: number | undefined;
      try {
        const childUri = vscode.Uri.file(path.resolve(rootUri.fsPath, entry.name));
        const stat = (await vscode.workspace.fs.stat(childUri)) as { size: number };
        size = typeof stat.size === "number" ? stat.size : undefined;
      } catch {
        // Best-effort: omit size_bytes when stat fails (broken symlink, permissions).
      }
      enriched.push(
        size !== undefined
          ? { name: entry.name, type: "file", size_bytes: size }
          : { name: entry.name, type: "file" },
      );
    } else {
      enriched.push({ name: entry.name, type: "directory" });
    }
  }

  const totalCount = enriched.length;
  const fullPayload = { path: rootUri.fsPath, entries: enriched };
  const fullSerialised = JSON.stringify(fullPayload);
  if (Buffer.byteLength(fullSerialised, "utf8") <= FORMAT_JSON_BYTE_CAP) {
    return fullSerialised;
  }

  // Binary-search the largest prefix whose serialised payload (with the
  // `_truncation` field) fits inside the byte budget. Uses the worst-case
  // truncation hint length so each candidate is evaluated at its final size.
  let lo = 0;
  let hi = totalCount;
  let best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = {
      path: rootUri.fsPath,
      entries: enriched.slice(0, mid),
      _truncation: truncationMessage(mid, totalCount, "entries", "list_directory with subset paths"),
    };
    const serialised = JSON.stringify(candidate);
    if (Buffer.byteLength(serialised, "utf8") <= FORMAT_JSON_BYTE_CAP) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return JSON.stringify({
    path: rootUri.fsPath,
    entries: enriched.slice(0, best),
    _truncation: truncationMessage(best, totalCount, "entries", "list_directory with subset paths"),
  });
}

function truncationMessage(
  shown: number,
  total: number,
  noun: string,
  narrowHint: string,
): string {
  return `Showing ${shown} of ${total} ${noun}; use ${narrowHint} to narrow.`;
}

// ---------------------------------------------------------------------------
// GrepCodebaseTool
// ---------------------------------------------------------------------------

import { spawn } from "child_process";

async function grepWithRipgrep(
  pattern: string,
  glob: string | undefined,
  root: string,
  maxResults: number,
  caseInsensitive: boolean = false,
): Promise<Array<{ file: string; line: number; content: string }> | null> {
  return new Promise((resolve) => {
    const args = ["--line-number", "--no-heading", "--color=never", "-m", String(maxResults)];
    if (caseInsensitive) args.push("-i");
    if (glob) args.push("--glob", glob);
    args.push(pattern, root);

    const child = spawn("rg", args, { cwd: root });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });

    child.on("close", (code) => {
      if (code === null || code > 1) {
        resolve(null); // ripgrep not available or crashed
        return;
      }
      const matches = stdout
        .split("\n")
        .filter(Boolean)
        .slice(0, maxResults)
        .map((line) => {
          const m = line.match(/^(.+?):(\d+):(.*)$/);
          if (!m) return null;
          const [, file = "", lineStr = "", content = ""] = m;
          return { file: path.relative(root, file), line: parseInt(lineStr, 10), content };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      resolve(matches);
    });

    child.on("error", () => resolve(null)); // rg not on PATH
  });
}

const MAX_PATTERN_LENGTH = 512;
const GREP_TIME_BUDGET_MS = 500;

/**
 * Reject patterns with nested quantifiers or other known catastrophic-backtracking
 * shapes. Not exhaustive: pairs with a runtime time-budget for defense in depth.
 *
 * Examples rejected: `(a+)+b`, `(a*)*`, `(\w+)+$`, `[a-z]+[a-z]+`.
 */
function isRedosRisky(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return true;
  // Nested quantifiers like (x+)+, (x*)+, (x+)*, [x]+[x]+
  if (/(\([^)]*[+*?][^)]*\))\s*[+*?]/.test(pattern)) return true;
  if (/(\[[^\]]+\])\s*[+*?]\s*(\[[^\]]+\])\s*[+*?]/.test(pattern)) return true;
  return false;
}

interface GrepCursor {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly matchIndex: number;
}

function encodeGrepCursor(cursor: GrepCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64");
}

function decodeGrepCursor(encoded: string): GrepCursor {
  let json: string;
  try {
    json = Buffer.from(encoded, "base64").toString("utf-8");
  } catch {
    throw new Error(
      `Invalid next_offset cursor: not valid base64. ` +
        `Usage: pass next_offset=<the cursor returned by a prior grep_codebase call>, or omit next_offset to start from the beginning.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(
      `Invalid next_offset cursor: payload is not parseable JSON. ` +
        `Usage: pass next_offset=<the cursor returned by a prior grep_codebase call>.`,
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as GrepCursor).filePath !== "string" ||
    typeof (parsed as GrepCursor).lineNumber !== "number" ||
    typeof (parsed as GrepCursor).matchIndex !== "number"
  ) {
    throw new Error(
      `Invalid next_offset cursor: missing expected fields. ` +
        `Usage: pass next_offset=<the cursor returned by a prior grep_codebase call>, or omit it to start fresh.`,
    );
  }
  return parsed as GrepCursor;
}

export class GrepCodebaseTool implements ToolHandler {
  constructor(
    private readonly _confirmationGate: ConfirmationGate | null = null,
    private readonly _extraSecretPatterns: readonly string[] = [],
  ) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as GrepCodebaseParams;

    if (!p.pattern || typeof p.pattern !== "string") {
      return failResult(
        id,
        "Missing required parameter: pattern. " +
          "Usage: grep_codebase(pattern=<RE2-compatible regex>, glob='*.ts'). " +
          "Example: grep_codebase(pattern='TODO', glob='**/*.ts').",
      );
    }

    if (isRedosRisky(p.pattern)) {
      return failResult(
        id,
        `Pattern "${p.pattern}" rejected as potentially catastrophic for regex backtracking. ` +
          `Usage: grep_codebase(pattern=<simple regex>) — avoid nested quantifiers (e.g. "(a+)+b") and keep patterns under ${MAX_PATTERN_LENGTH} chars.`,
      );
    }

    // Secret-path denylist: if glob filter targets a secret location, require approval.
    if (p.glob && matchesSecretPath(p.glob, this._extraSecretPatterns)) {
      if (p.allow_secrets !== true) {
        return failResult(
          id,
          `Glob "${p.glob}" matches the secret-path denylist. ` +
            `Usage: pass allow_secrets=true to request explicit user confirmation, or use a non-secret glob.`,
        );
      }
      if (this._confirmationGate) {
        const approved = await this._confirmationGate.request(
          id,
          `Grep across secret-path glob "${p.glob}"?`,
          "The glob matches the secret-path denylist.",
        );
        if (!approved) {
          return failResult(
            id,
            `Grep against secret-path rejected by user. ` +
              `Usage: grep_codebase(pattern=..., glob=<non-secret glob>).`,
          );
        }
      }
    }

    // Resolve and validate max_results (clamped to [1, MAX_GREP_RESULTS_CEILING]).
    const requestedMaxResults = typeof p.max_results === "number" ? p.max_results : MAX_GREP_RESULTS;
    if (requestedMaxResults <= 0 || !Number.isFinite(requestedMaxResults)) {
      return failResult(
        id,
        `Invalid max_results=${p.max_results}: must be a positive number. ` +
          `Usage: grep_codebase(pattern=..., max_results=<1..${MAX_GREP_RESULTS_CEILING}>).`,
      );
    }
    const clampedMaxResults = Math.min(Math.floor(requestedMaxResults), MAX_GREP_RESULTS_CEILING);
    const maxResultsClampWarning =
      requestedMaxResults > MAX_GREP_RESULTS_CEILING
        ? `max_results clamped from ${requestedMaxResults} to ${MAX_GREP_RESULTS_CEILING} (per-call ceiling).`
        : null;

    // Resolve and validate next_offset cursor.
    let cursor: GrepCursor | null = null;
    if (p.next_offset !== undefined) {
      if (typeof p.next_offset !== "string") {
        return failResult(
          id,
          `Invalid next_offset: must be a string cursor returned by a prior grep_codebase call. ` +
            `Usage: pass next_offset=<the cursor>, or omit it to start fresh.`,
        );
      }
      try {
        cursor = decodeGrepCursor(p.next_offset);
      } catch (err) {
        return failResult(id, (err as Error).message);
      }
    }

    const caseInsensitive = p.case_insensitive === true;
    const root = workspaceRoot();

    // Validate the regex eagerly so an invalid pattern fails clearly even when
    // ripgrep handles the search (which would otherwise return an empty list).
    try {
      new RegExp(p.pattern, caseInsensitive ? "i" : "");
    } catch (err) {
      return failResult(
        id,
        `Invalid regex pattern "${p.pattern}": ${(err as Error).message}. ` +
          `Usage: grep_codebase(pattern=<RE2-compatible regex>).`,
      );
    }

    // Fetch a pool of (clampedMaxResults + cursor offset) matches so we can apply
    // the cursor and still return up to clampedMaxResults entries plus a follow-up
    // cursor when more remain.
    const cursorMatchIndex = cursor?.matchIndex ?? 0;
    const fetchSize = Math.min(clampedMaxResults + cursorMatchIndex + 1, MAX_GREP_RESULTS_CEILING + 1);

    // Try ripgrep first.
    let allMatches = await grepWithRipgrep(p.pattern, p.glob, root, fetchSize, caseInsensitive);

    // Fall back to manual file-by-file search using vscode.workspace.findFiles.
    if (allMatches === null) {
      const vsMatches: Array<{ file: string; line: number; content: string }> = [];
      const includePattern = p.glob ?? "**/*";
      const uris = await vscode.workspace.findFiles(
        includePattern,
        "{node_modules,out,dist,.git}/**",
        500
      );
      let regex: RegExp;
      try {
        regex = new RegExp(p.pattern, caseInsensitive ? "i" : "");
      } catch (err) {
        return failResult(
          id,
          `Invalid regex pattern "${p.pattern}": ${(err as Error).message}. ` +
            `Usage: grep_codebase(pattern=<RE2-compatible regex>).`,
        );
      }
      const deadline = Date.now() + GREP_TIME_BUDGET_MS;
      for (const uri of uris) {
        if (vsMatches.length >= fetchSize) break;
        if (Date.now() > deadline) {
          // Time budget exhausted: return what we collected so far so the agent
          // can still page forward via next_offset rather than getting nothing.
          break;
        }
        const relFile = path.relative(root, uri.fsPath);
        if (p.allow_secrets !== true && matchesSecretPath(relFile, this._extraSecretPatterns)) {
          continue;
        }
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const text = Buffer.from(bytes).toString("utf-8");
          const lines = text.split("\n");
          for (let i = 0; i < lines.length && vsMatches.length < fetchSize; i++) {
            const line = lines[i] ?? "";
            if (regex.test(line)) {
              vsMatches.push({
                file: relFile,
                line: i + 1,
                content: line.trim().slice(0, 200),
              });
            }
          }
        } catch {
          // Skip unreadable files silently.
        }
      }
      allMatches = vsMatches;
    } else if (p.allow_secrets !== true) {
      // Filter ripgrep results through the denylist.
      allMatches = allMatches.filter(
        (m) => !matchesSecretPath(m.file, this._extraSecretPatterns),
      );
    }

    // Apply cursor offset (skip already-returned matches) and slice the page.
    const windowStart = cursorMatchIndex;
    const windowEnd = windowStart + clampedMaxResults;
    const pageMatches = allMatches.slice(windowStart, windowEnd);
    const hasMore = allMatches.length > windowEnd;
    const nextOffset = hasMore
      ? encodeGrepCursor({ filePath: "", lineNumber: 0, matchIndex: windowEnd })
      : undefined;

    const payload: Record<string, unknown> = {
      matches: pageMatches,
      count: pageMatches.length,
    };
    if (nextOffset !== undefined) {
      payload["next_offset"] = nextOffset;
      payload["truncation_hint"] =
        `Showing ${pageMatches.length} matches; pass next_offset='${nextOffset}' to grep_codebase to continue.`;
    }
    if (maxResultsClampWarning !== null) {
      payload["warning"] = maxResultsClampWarning;
    }

    if (p.format === "json") {
      const jsonOutput = renderGrepJson(p.pattern, pageMatches, nextOffset);
      return { id, success: true, output: jsonOutput };
    }

    return {
      id,
      success: true,
      output: JSON.stringify(payload),
    };
  }
}

/**
 * Serialise the grep page as RFC-8259 JSON with `pattern`/`matches`/`next_offset`
 * fields, pre-truncating to keep the payload under 64 KB. Per-match shape is
 * `{file_path, line_number, line}` (renamed from the text-mode `file/line/content`
 * to match the agent-friendly contract).
 */
function renderGrepJson(
  pattern: string,
  matches: readonly { file: string; line: number; content: string }[],
  nextOffset: string | undefined,
): string {
  const projected = matches.map((m) => ({
    file_path: m.file,
    line_number: m.line,
    line: m.content,
  }));
  const totalCount = projected.length;
  const fullPayload: Record<string, unknown> = { pattern, matches: projected };
  if (nextOffset !== undefined) fullPayload["next_offset"] = nextOffset;
  const fullSerialised = JSON.stringify(fullPayload);
  if (Buffer.byteLength(fullSerialised, "utf8") <= FORMAT_JSON_BYTE_CAP) {
    return fullSerialised;
  }

  let lo = 0;
  let hi = totalCount;
  let best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate: Record<string, unknown> = {
      pattern,
      matches: projected.slice(0, mid),
    };
    if (nextOffset !== undefined) candidate["next_offset"] = nextOffset;
    candidate["_truncation"] = truncationMessage(
      mid,
      totalCount,
      "matches",
      "max_results / next_offset, or pass a tighter glob",
    );
    const serialised = JSON.stringify(candidate);
    if (Buffer.byteLength(serialised, "utf8") <= FORMAT_JSON_BYTE_CAP) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const truncated: Record<string, unknown> = {
    pattern,
    matches: projected.slice(0, best),
  };
  if (nextOffset !== undefined) truncated["next_offset"] = nextOffset;
  truncated["_truncation"] = truncationMessage(
    best,
    totalCount,
    "matches",
    "max_results / next_offset, or pass a tighter glob",
  );
  return JSON.stringify(truncated);
}
