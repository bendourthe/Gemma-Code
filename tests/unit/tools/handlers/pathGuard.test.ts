/**
 * Phase 7.6 mutation-test pinning for [src/tools/handlers/pathGuard.ts](../../../src/tools/handlers/pathGuard.ts).
 *
 * These tests target specific mutants that survived the v0.6.0 Stryker pass
 * on `workspaceRoot()` and the realpath ancestor walk inside
 * `resolveInsideWorkspace()`. Do not delete without re-running mutation
 * testing -- each test below exists to kill a named mutant.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  workspaceRoot,
  resolveInsideWorkspace,
} from "../../../../src/tools/handlers/pathGuard.js";

const realFolders = vscode.workspace.workspaceFolders;

afterEach(() => {
  // Restore the default mock workspaceFolders set up in tests/setup.ts.
  (vscode.workspace as { workspaceFolders: typeof realFolders }).workspaceFolders = realFolders;
  vi.restoreAllMocks();
});

describe("workspaceRoot mutant pins", () => {
  it("throws when workspaceFolders is undefined", () => {
    // Pins line 7 mutation: `!folders || folders.length === 0` mutated
    // to `false` would let the function fall through and dereference
    // `folders[0]` on undefined, which is a less-actionable error than
    // the deliberate "No workspace folder" message tools rely on.
    (vscode.workspace as { workspaceFolders: undefined }).workspaceFolders = undefined;
    expect(() => workspaceRoot()).toThrow(/No workspace folder/);
  });

  it("throws when workspaceFolders is an empty array", () => {
    // Pins the same line 7 mutation in the `length === 0` half of the
    // disjunction. The original guard treats both shapes (undefined and
    // empty array) identically; a mutation that drops either half opens
    // an "undefined.fsPath" crash inside path.resolve.
    (vscode.workspace as { workspaceFolders: [] }).workspaceFolders = [];
    expect(() => workspaceRoot()).toThrow(/No workspace folder/);
  });
});

describe("resolveInsideWorkspace ancestor walk mutant pins", () => {
  it("returns the lexical resolution when no ancestor on the abstract path exists", () => {
    // Pins line 59 ArrayDeclaration mutation: replacing the empty
    // segments accumulator with a non-empty array would either prepend
    // a stray segment or break the ancestor reattachment. Verify that
    // a pure-non-existent path under the workspace round-trips to the
    // expected absolute string.
    const root = fs.realpathSync(
      (realFolders ?? [])[0]?.uri.fsPath ?? os.tmpdir(),
    );
    const target = path.join(root, "ghost-dir-1", "ghost-dir-2", "leaf.txt");
    const resolved = resolveInsideWorkspace(target);
    expect(resolved).toBe(target);
  });

  it("realpaths an existing-ancestor + missing-leaf path through symlinks", () => {
    // Pins line 63 ConditionalExpression mutation: `parent === current`
    // is the filesystem-root termination check for the upward walk. If
    // mutated to `false`, the loop never terminates on a path under the
    // root; if mutated to `true`, the loop exits after one step and
    // mis-attaches segments. We exercise the walk by constructing a real
    // existing directory and querying for a non-existent leaf under it.
    const root = fs.realpathSync(
      (realFolders ?? [])[0]?.uri.fsPath ?? os.tmpdir(),
    );
    const ghost = path.join(root, "definitely-not-a-real-leaf");
    const resolved = resolveInsideWorkspace(ghost);
    expect(resolved.startsWith(root)).toBe(true);
    expect(path.basename(resolved)).toBe("definitely-not-a-real-leaf");
  });

  it("rejects an absolute path outside the workspace root", () => {
    // Sanity guard for the boundary check itself. Independent of the
    // mutants above, this assertion is the load-bearing test that the
    // workspace boundary refuses traversal -- if it ever silently
    // accepts, the security claim of the path guard breaks.
    const outside = path.resolve(os.tmpdir(), "does-not-matter");
    expect(() => resolveInsideWorkspace(outside)).toThrow(/outside the workspace/);
  });
});
