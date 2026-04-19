import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export function workspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("No workspace folder is open.");
  }
  return folders[0]!.uri.fsPath;
}

/**
 * Resolve a path (absolute or workspace-relative) and assert it is inside the
 * current workspace root. Symlinks are followed via realpathSync when the
 * resolved target exists, so escaping the root via a symlink is rejected.
 */
export function resolveInsideWorkspace(userPath: string): string {
  const root = workspaceRoot();
  const rootReal = safeRealpath(root);

  const absolute = path.isAbsolute(userPath)
    ? userPath
    : path.resolve(rootReal, userPath);
  const real = safeRealpath(absolute);

  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new Error(
      `Path "${userPath}" resolves outside the workspace root "${rootReal}".`,
    );
  }
  return real;
}

function safeRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
