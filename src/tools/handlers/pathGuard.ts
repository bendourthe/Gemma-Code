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
 * given root (default: the current workspace root). Symlinks are followed via
 * realpathSync; for paths that do not exist on disk yet (e.g.
 * write_file/create_file targets), the deepest existing ancestor is realpath'd
 * and the missing tail is appended, so a symlink in the parent chain still
 * resolves through realpath. This closes the symlink leg of Attack Path A.
 *
 * v1.4.0 Phase 6 (A10): the optional `root` override lets a worktree-isolated
 * sub-agent re-base resolution onto its dedicated worktree directory instead of
 * the shared workspace root. The boundary check is unchanged -- the resolved
 * path must still live inside the supplied root -- so passing a worktree root
 * confines the sub-agent to that worktree rather than weakening the guard.
 */
export function resolveInsideWorkspace(userPath: string, root: string = workspaceRoot()): string {
  const rootReal = safeRealpath(root);

  const absolute = path.isAbsolute(userPath)
    ? userPath
    : path.resolve(rootReal, userPath);
  const real = realpathThroughExistingAncestor(absolute);

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

/**
 * Walk upward until an existing ancestor is found, realpath that, then
 * re-attach the non-existent tail. This makes the boundary check
 * symlink-correct for paths whose leaf does not yet exist.
 */
function realpathThroughExistingAncestor(absolute: string): string {
  const normalized = path.resolve(absolute);
  try {
    return fs.realpathSync(normalized);
  } catch {
    // Fall through to ancestor walk.
  }

  const segments: string[] = [];
  let current = normalized;
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) {
      // Reached the filesystem root; nothing exists, return lexical resolution.
      return normalized;
    }
    segments.unshift(path.basename(current));
    current = parent;
    try {
      const realParent = fs.realpathSync(current);
      return path.join(realParent, ...segments);
    } catch {
      // keep climbing
    }
  }
}
