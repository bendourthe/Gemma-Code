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
import { matchesSecretPath } from "./secretPaths.js";

const MAX_READ_LINES = 500;
const MAX_GREP_RESULTS = 50;
const MAX_GREP_RESULTS_CEILING = 500;
const READ_RANGE_MAX_WINDOW = 1024 * 1024; // 1 MB per paginated window
const MAX_LIST_DEPTH = 3;
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "out", "dist", "__pycache__"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function workspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("No workspace folder is open.");
  }
  return folders[0]!.uri.fsPath;
}

function resolveWorkspacePath(relativePath: string): string {
  const root = workspaceRoot();
  const resolved = path.resolve(root, relativePath);
  // Path traversal guard: ensure the resolved path stays inside the workspace root.
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Path traversal detected: "${relativePath}" resolves outside the workspace.`);
  }
  return resolved;
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
      const resolved = path.resolve(workspaceRoot(), relativePath);
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

    return {
      id,
      success: true,
      output: JSON.stringify({ entries: filteredEntries, count: filteredEntries.length }),
    };
  }
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

    return {
      id,
      success: true,
      output: JSON.stringify(payload),
    };
  }
}
