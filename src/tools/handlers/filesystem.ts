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

const MAX_READ_LINES = 500;
const MAX_GREP_RESULTS = 50;
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
  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as ReadFileParams;

    if (!p.path || typeof p.path !== "string") {
      return failResult(id, "Missing required parameter: path");
    }

    let uri: vscode.Uri;
    try {
      uri = uriFromRelative(p.path);
    } catch (err) {
      return failResult(id, (err as Error).message);
    }

    let content: string;
    try {
      content = await readFileContent(uri);
    } catch {
      return failResult(id, `File not found or unreadable: "${p.path}"`);
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
      return failResult(id, "Missing required parameter: path");
    }
    if (typeof p.content !== "string") {
      return failResult(id, "Missing required parameter: content");
    }

    let uri: vscode.Uri;
    try {
      uri = uriFromRelative(p.path);
    } catch (err) {
      return failResult(id, (err as Error).message);
    }

    if (this._editMode === "manual") {
      // Show proposed content as a diff against an empty baseline, but don't write.
      const diff = createPatch(p.path, "", p.content, "empty", "proposed");
      await this._confirmationGate?.requestDiffPreview(id, p.path, diff);
      return failResult(
        id,
        `Edit shown in diff preview for "${p.path}" but not applied (manual mode).`
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
        return failResult(id, "Write rejected by user.");
      }
    }

    try {
      await writeFileContent(uri, p.content);
    } catch (err) {
      return failResult(id, `Failed to write file: ${(err as Error).message}`);
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
      return failResult(id, "Missing required parameter: path");
    }

    let uri: vscode.Uri;
    try {
      uri = uriFromRelative(p.path);
    } catch (err) {
      return failResult(id, (err as Error).message);
    }

    // Fail if the file already exists.
    try {
      await vscode.workspace.fs.stat(uri);
      return failResult(id, `File already exists: "${p.path}"`);
    } catch {
      // stat threw → file does not exist, which is what we want.
    }

    const content = typeof p.content === "string" ? p.content : "";

    if (this._editMode === "manual") {
      const diff = createPatch(p.path, "", content, "empty", "new file");
      await this._confirmationGate?.requestDiffPreview(id, p.path, diff);
      return failResult(
        id,
        `File creation shown in diff preview for "${p.path}" but not applied (manual mode).`
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
        return failResult(id, "File creation rejected by user.");
      }
    }

    try {
      await writeFileContent(uri, content);
    } catch (err) {
      return failResult(id, `Failed to create file: ${(err as Error).message}`);
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
      return failResult(id, "Missing required parameter: path");
    }

    let uri: vscode.Uri;
    try {
      uri = uriFromRelative(p.path);
    } catch (err) {
      return failResult(id, (err as Error).message);
    }

    try {
      await vscode.workspace.fs.delete(uri);
    } catch (err) {
      return failResult(id, `Failed to delete file: ${(err as Error).message}`);
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
      return failResult(id, "Missing required parameter: path");
    }
    if (typeof p.old_string !== "string") {
      return failResult(id, "Missing required parameter: old_string");
    }
    if (typeof p.new_string !== "string") {
      return failResult(id, "Missing required parameter: new_string");
    }

    let uri: vscode.Uri;
    try {
      uri = uriFromRelative(p.path);
    } catch (err) {
      return failResult(id, (err as Error).message);
    }

    let original: string;
    try {
      original = await readFileContent(uri);
    } catch {
      return failResult(id, `File not found or unreadable: "${p.path}"`);
    }

    // Count occurrences of old_string.
    const occurrences = original.split(p.old_string).length - 1;
    if (occurrences === 0) {
      return failResult(id, `old_string not found in "${p.path}". No changes made.`);
    }
    if (occurrences > 1) {
      return failResult(
        id,
        `old_string appears ${occurrences} times in "${p.path}". Provide a more specific string.`
      );
    }

    const updated = original.replace(p.old_string, p.new_string);
    const diff = createPatch(p.path, original, updated, "original", "modified");

    if (this._editMode === "manual") {
      // Show the diff but do not apply it.
      await this._confirmationGate?.requestDiffPreview(id, p.path, diff);
      return failResult(
        id,
        `Edit shown in diff preview for "${p.path}" but not applied (manual mode).`
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
        return failResult(id, "Edit rejected by user.");
      }
    }

    // "auto" mode (or approved "ask") — write without further prompting.
    try {
      await writeFileContent(uri, updated);
    } catch (err) {
      return failResult(id, `Failed to write edited file: ${(err as Error).message}`);
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
    entries = await vscode.workspace.fs.readDirectory(uri);
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
  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as ListDirectoryParams;

    const relativePath = typeof p.path === "string" ? p.path : ".";
    const recursive = p.recursive !== false; // defaults to true

    let uri: vscode.Uri;
    try {
      const resolved = path.resolve(workspaceRoot(), relativePath);
      uri = vscode.Uri.file(resolved);
    } catch (err) {
      return failResult(id, (err as Error).message);
    }

    const maxDepth = recursive ? MAX_LIST_DEPTH : 1;
    const entries = await walkDir(uri, 1, maxDepth);

    return {
      id,
      success: true,
      output: JSON.stringify({ entries, count: entries.length }),
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
  maxResults: number
): Promise<Array<{ file: string; line: number; content: string }> | null> {
  return new Promise((resolve) => {
    const args = ["--line-number", "--no-heading", "--color=never", "-m", String(maxResults)];
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

export class GrepCodebaseTool implements ToolHandler {
  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as GrepCodebaseParams;

    if (!p.pattern || typeof p.pattern !== "string") {
      return failResult(id, "Missing required parameter: pattern");
    }

    const maxResults = typeof p.max_results === "number" ? p.max_results : MAX_GREP_RESULTS;
    const root = workspaceRoot();

    // Try ripgrep first.
    let matches = await grepWithRipgrep(p.pattern, p.glob, root, maxResults);

    // Fall back to manual file-by-file search using vscode.workspace.findFiles.
    if (matches === null) {
      const vsMatches: Array<{ file: string; line: number; content: string }> = [];
      const includePattern = p.glob ?? "**/*";
      const uris = await vscode.workspace.findFiles(
        includePattern,
        "{node_modules,out,dist,.git}/**",
        500
      );
      const regex = new RegExp(p.pattern);
      for (const uri of uris) {
        if (vsMatches.length >= maxResults) break;
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const text = Buffer.from(bytes).toString("utf-8");
          const lines = text.split("\n");
          for (let i = 0; i < lines.length && vsMatches.length < maxResults; i++) {
            const line = lines[i] ?? "";
            if (regex.test(line)) {
              vsMatches.push({
                file: path.relative(root, uri.fsPath),
                line: i + 1,
                content: line.trim().slice(0, 200),
              });
            }
          }
        } catch {
          // Skip unreadable files silently.
        }
      }
      matches = vsMatches;
    }

    return {
      id,
      success: true,
      output: JSON.stringify({ matches, count: matches.length }),
    };
  }
}
