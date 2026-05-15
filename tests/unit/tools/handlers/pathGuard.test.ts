/**
 * Phase 7.6 mutation-test pinning for [src/tools/handlers/pathGuard.ts](../../../src/tools/handlers/pathGuard.ts).
 *
 * These tests target specific mutants that survived the v0.6.0 Stryker pass
 * on `workspaceRoot()` and the realpath ancestor walk inside
 * `resolveInsideWorkspace()`. Do not delete without re-running mutation
 * testing -- each test below exists to kill a named mutant.
 */

import { describe, it, expect, afterEach, afterAll, beforeAll, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  workspaceRoot,
  resolveInsideWorkspace,
} from "../../../../src/tools/handlers/pathGuard.js";

const realFolders = vscode.workspace.workspaceFolders;

describe("workspaceRoot mutant pins", () => {
  afterEach(() => {
    // Restore the default mock workspaceFolders set up in tests/setup.ts
    // after each test in this describe block. Scoped here (not at file
    // level) so the sibling `resolveInsideWorkspace` describe can install
    // its own workspace pointer in beforeAll without being clobbered
    // between tests.
    (vscode.workspace as { workspaceFolders: typeof realFolders }).workspaceFolders = realFolders;
    vi.restoreAllMocks();
  });

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
  // The default mock workspaceFolders points at MOCK_WORKSPACE_ROOT
  // (`/workspace` on POSIX, `C:\workspace` on Windows), a synthetic path
  // that may not exist on disk -- in particular it does not exist on a
  // fresh Linux CI runner, which makes any `fs.realpathSync` call against
  // it throw ENOENT. The two ancestor-walk pins exercise the real fs walk
  // and therefore need a workspace root that is guaranteed to exist on
  // every platform. The block below stands up a fresh temp directory and
  // points the mocked `workspaceFolders` at it for the lifetime of the
  // describe.
  let realRoot: string;
  let cleanupRoot: string;

  beforeAll(() => {
    cleanupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pathguard-pin-"));
    realRoot = fs.realpathSync(cleanupRoot);
  });

  beforeEach(() => {
    // Re-install the temp-dir workspace pointer before every test. The
    // `vi.restoreAllMocks()` call invoked by other describes in this file
    // (or other test files) can wipe the `workspaceFolders` mock between
    // tests, so the assignment lives here rather than only in beforeAll.
    (vscode.workspace as { workspaceFolders: { uri: { fsPath: string }; name: string; index: number }[] }).workspaceFolders = [
      { uri: { fsPath: realRoot }, name: "workspace", index: 0 },
    ];
  });

  afterAll(() => {
    (vscode.workspace as { workspaceFolders: typeof realFolders }).workspaceFolders = realFolders;
    try {
      fs.rmSync(cleanupRoot, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; CI runners reclaim the temp dir between runs.
    }
  });

  it("returns the lexical resolution when no ancestor on the abstract path exists", () => {
    // Pins line 59 ArrayDeclaration mutation: replacing the empty
    // segments accumulator with a non-empty array would either prepend
    // a stray segment or break the ancestor reattachment. Verify that
    // a pure-non-existent path under the workspace round-trips to the
    // expected absolute string.
    const target = path.join(realRoot, "ghost-dir-1", "ghost-dir-2", "leaf.txt");
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
    const ghost = path.join(realRoot, "definitely-not-a-real-leaf");
    const resolved = resolveInsideWorkspace(ghost);
    expect(resolved.startsWith(realRoot)).toBe(true);
    expect(path.basename(resolved)).toBe("definitely-not-a-real-leaf");
  });

  it("rejects an absolute path outside the workspace root", () => {
    // Sanity guard for the boundary check itself. Independent of the
    // mutants above, this assertion is the load-bearing test that the
    // workspace boundary refuses traversal -- if it ever silently
    // accepts, the security claim of the path guard breaks. The outside
    // path is anchored at a sibling temp dir so it is provably not under
    // `realRoot`.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pathguard-outside-"));
    try {
      const target = path.join(outside, "does-not-matter");
      expect(() => resolveInsideWorkspace(target)).toThrow(/outside the workspace/);
    } finally {
      try {
        fs.rmSync(outside, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });
});
