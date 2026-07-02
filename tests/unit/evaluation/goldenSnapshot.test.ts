import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  cleanupGoldenSnapshot,
  defaultGitRunner,
  materializeGoldenSnapshot,
  type GitRunner,
} from "../../../modules/coding/evaluation/goldenSnapshot.js";

/**
 * v1.7.0 Phase 1 (adoption-self-optimizing-skills S1 / SO001) -- unit tests for
 * the worktree-isolated snapshot materializer (port of snapshot.py). Git
 * lifecycle is driven through an injected runner so the suite is deterministic
 * and independent of a real git binary.
 */

let sourceDir: string;
let baseDir: string;

beforeEach(async () => {
  sourceDir = await fsp.mkdtemp(path.join(os.tmpdir(), "golden-snap-src-"));
  baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), "golden-snap-base-"));
  await fsp.mkdir(path.join(sourceDir, "src"), { recursive: true });
  await fsp.writeFile(path.join(sourceDir, "src", "index.ts"), "export const x = 1;", "utf8");
  await fsp.writeFile(path.join(sourceDir, "package.json"), "{}", "utf8");
  // Directories that must be pruned from the copy.
  await fsp.mkdir(path.join(sourceDir, "node_modules", "dep"), { recursive: true });
  await fsp.writeFile(path.join(sourceDir, "node_modules", "dep", "index.js"), "//", "utf8");
  await fsp.mkdir(path.join(sourceDir, ".git"), { recursive: true });
  await fsp.writeFile(path.join(sourceDir, ".git", "HEAD"), "ref: refs/heads/main", "utf8");
});

afterEach(async () => {
  await fsp.rm(sourceDir, { recursive: true, force: true });
  await fsp.rm(baseDir, { recursive: true, force: true });
});

/** A git runner that records its calls and succeeds. */
function recordingGitRunner(): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = (args) => {
    calls.push([...args]);
    return "";
  };
  return { runner, calls };
}

describe("materializeGoldenSnapshot", () => {
  it("copies the snapshot into a fresh dir, pruning node_modules and .git", () => {
    const { runner } = recordingGitRunner();
    const ws = materializeGoldenSnapshot(sourceDir, "task-01", { baseDir, gitRunner: runner });
    try {
      expect(ws.taskId).toBe("task-01");
      expect(ws.path.startsWith(baseDir)).toBe(true);
      expect(fs.existsSync(path.join(ws.path, "src", "index.ts"))).toBe(true);
      expect(fs.existsSync(path.join(ws.path, "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(ws.path, "node_modules"))).toBe(false);
      expect(fs.existsSync(path.join(ws.path, ".git"))).toBe(false);
    } finally {
      cleanupGoldenSnapshot(ws);
    }
    expect(fs.existsSync(ws.path)).toBe(false);
  });

  it("initializes a git baseline through the injected runner", () => {
    const { runner, calls } = recordingGitRunner();
    const ws = materializeGoldenSnapshot(sourceDir, "task-02", { baseDir, gitRunner: runner });
    try {
      expect(ws.gitInitialized).toBe(true);
      expect(calls[0]).toEqual(["init", "-q"]);
      expect(calls.some((c) => c[0] === "add")).toBe(true);
      expect(calls.some((c) => c[0] === "commit")).toBe(true);
    } finally {
      cleanupGoldenSnapshot(ws);
    }
  });

  it("reports gitInitialized=false when git init fails (git-less environment)", () => {
    const runner: GitRunner = (args) => (args[0] === "init" ? null : "");
    const ws = materializeGoldenSnapshot(sourceDir, "task-03", { baseDir, gitRunner: runner });
    try {
      expect(ws.gitInitialized).toBe(false);
    } finally {
      cleanupGoldenSnapshot(ws);
    }
  });

  it("reports gitInitialized=false when the commit step fails", () => {
    const runner: GitRunner = (args) => (args[0] === "commit" ? null : "");
    const ws = materializeGoldenSnapshot(sourceDir, "task-03b", { baseDir, gitRunner: runner });
    try {
      expect(ws.gitInitialized).toBe(false);
    } finally {
      cleanupGoldenSnapshot(ws);
    }
  });

  it("skips git initialization when initGit is false", () => {
    const { runner, calls } = recordingGitRunner();
    const ws = materializeGoldenSnapshot(sourceDir, "task-04", { baseDir, gitRunner: runner, initGit: false });
    try {
      expect(ws.gitInitialized).toBe(false);
      expect(calls).toHaveLength(0);
    } finally {
      cleanupGoldenSnapshot(ws);
    }
  });

  it("throws when the snapshot directory does not exist", () => {
    expect(() => materializeGoldenSnapshot(path.join(sourceDir, "nope"), "task-05", { baseDir })).toThrow(
      /snapshot not found/i,
    );
  });
});

describe("cleanupGoldenSnapshot", () => {
  it("is a no-op on an already-removed workspace", () => {
    const ws = materializeGoldenSnapshot(sourceDir, "task-06", { baseDir, initGit: false });
    cleanupGoldenSnapshot(ws);
    expect(() => cleanupGoldenSnapshot(ws)).not.toThrow();
  });
});

describe("defaultGitRunner", () => {
  it("returns a string or null without throwing for a benign invocation", () => {
    const result = defaultGitRunner(["--version"], baseDir);
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("returns null for a failing git invocation", () => {
    const result = defaultGitRunner(["not-a-real-subcommand-xyz"], baseDir);
    expect(result).toBeNull();
  });
});
