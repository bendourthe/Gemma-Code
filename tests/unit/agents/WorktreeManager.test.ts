import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WorktreeManager, type GitRunner } from "../../../modules/coding/agents/WorktreeManager.js";

// Unit tests drive the lifecycle logic through an injected fake GitRunner so
// no real repository is required. The real-git behavior (isolation, cleanup,
// no-collision under parallel dispatch) is covered by the integration suite at
// tests/integration/agents/worktree-isolation.test.ts.

describe("WorktreeManager", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-unit-"));
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it("isAvailable() is true when rev-parse reports inside-work-tree", async () => {
    const git: GitRunner = vi.fn(async (args) =>
      args[0] === "rev-parse" ? "true\n" : null,
    );
    const wm = new WorktreeManager("/repo", git, baseDir);
    expect(await wm.isAvailable()).toBe(true);
  });

  it("isAvailable() is false when rev-parse fails or reports false", async () => {
    const gitNull: GitRunner = vi.fn(async () => null);
    expect(await new WorktreeManager("/repo", gitNull, baseDir).isAvailable()).toBe(false);

    const gitFalse: GitRunner = vi.fn(async () => "false\n");
    expect(await new WorktreeManager("/repo", gitFalse, baseDir).isAvailable()).toBe(false);
  });

  it("create() runs `worktree add --detach <dir> HEAD` and returns a handle", async () => {
    const calls: string[][] = [];
    const git: GitRunner = vi.fn(async (args) => {
      calls.push([...args]);
      return "";
    });
    const wm = new WorktreeManager("/repo", git, baseDir);

    const handle = await wm.create("verification");

    expect(handle).not.toBeNull();
    expect(handle!.path.startsWith(baseDir)).toBe(true);
    const addCall = calls.find((c) => c[0] === "worktree" && c[1] === "add");
    expect(addCall).toEqual(["worktree", "add", "--detach", handle!.path, "HEAD"]);
  });

  it("create() sanitizes the label and produces unique paths per call", async () => {
    const git: GitRunner = vi.fn(async () => "");
    const wm = new WorktreeManager("/repo", git, baseDir);

    const a = await wm.create("sub/agent type!");
    const b = await wm.create("sub/agent type!");

    expect(a!.label).toBe("sub_agent_type_");
    expect(a!.path).not.toBe(b!.path);
  });

  it("create() returns null when `worktree add` fails", async () => {
    const git: GitRunner = vi.fn(async (args) =>
      args[0] === "worktree" && args[1] === "add" ? null : "",
    );
    const wm = new WorktreeManager("/repo", git, baseDir);

    expect(await wm.create("verification")).toBeNull();
  });

  it("cleanupIfUnchanged() removes a clean worktree and returns true", async () => {
    const calls: string[][] = [];
    const git: GitRunner = vi.fn(async (args) => {
      calls.push([...args]);
      return ""; // rev-parse / add / status (clean "") / remove all succeed
    });
    const wm = new WorktreeManager("/repo", git, baseDir);
    const handle = await wm.create("verification");

    const removed = await wm.cleanupIfUnchanged(handle!);

    expect(removed).toBe(true);
    const removeCall = calls.find((c) => c[0] === "worktree" && c[1] === "remove");
    expect(removeCall).toEqual(["worktree", "remove", "--force", handle!.path]);
  });

  it("cleanupIfUnchanged() retains a dirty worktree and returns false (no remove)", async () => {
    const calls: string[][] = [];
    const git: GitRunner = vi.fn(async (args) => {
      calls.push([...args]);
      if (args[0] === "status") return "?? scratch.txt\n"; // dirty
      return "";
    });
    const wm = new WorktreeManager("/repo", git, baseDir);
    const handle = await wm.create("verification");

    const removed = await wm.cleanupIfUnchanged(handle!);

    expect(removed).toBe(false);
    expect(calls.some((c) => c[0] === "worktree" && c[1] === "remove")).toBe(false);
  });

  it("cleanupIfUnchanged() returns false when the status check fails (worktree left in place)", async () => {
    const calls: string[][] = [];
    const git: GitRunner = vi.fn(async (args) => {
      calls.push([...args]);
      if (args[0] === "status") return null; // status failed
      return "";
    });
    const wm = new WorktreeManager("/repo", git, baseDir);
    const handle = await wm.create("verification");

    const removed = await wm.cleanupIfUnchanged(handle!);

    expect(removed).toBe(false);
    expect(calls.some((c) => c[0] === "worktree" && c[1] === "remove")).toBe(false);
  });
});
