import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WorktreeManager } from "../../../modules/coding/agents/WorktreeManager.js";
import { RunTerminalTool } from "../../../src/tools/handlers/terminal.js";
import { SubAgentManager } from "../../../modules/coding/agents/SubAgentManager.js";
import { PromptBuilder } from "../../../modules/coding/chat/PromptBuilder.js";
import {
  makeMultiResponseOllamaClient,
  collectMessages,
} from "../../helpers/factories.js";
import type { SubAgentConfig } from "../../../modules/coding/agents/types.js";

// Integration coverage for v1.4.0 Phase 6 (A10): worktree-isolated parallel
// sub-agent execution. These tests exercise real `git worktree` operations and
// real `run_terminal` child processes against a throwaway repository, proving
// the acceptance criterion end-to-end: two parallel write-capable sub-agents do
// not collide when isolation is enabled, and the worktree is removed when left
// unchanged.

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** Initialize a throwaway git repo with a single seed commit so HEAD exists. */
function initRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "wt-iso-repo-"));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Worktree Isolation Test"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(repo, "README.md"), "seed\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "seed"]);
  return repo;
}

function makeBaseDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wt-iso-base-"));
}

function rmrf(...dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

/**
 * Cross-platform file-writing command. `node` is on PATH in the test runner and
 * is allowlisted by the terminal guard; the double-quoted -e script and the
 * single-quoted JS string literals parse identically under cmd.exe and POSIX
 * shells, and the relative path resolves against the spawn cwd (the worktree).
 */
function writeFileCmd(name: string, content: string): string {
  return `node -e "require('fs').writeFileSync('${name}','${content}')"`;
}

describe("integration: worktree-isolated parallel sub-agent execution (A10)", () => {
  it("creates a detached worktree from HEAD and removes it when left unchanged", async () => {
    const repo = initRepo();
    const baseDir = makeBaseDir();
    try {
      const wm = new WorktreeManager(repo, undefined, baseDir);
      expect(await wm.isAvailable()).toBe(true);

      const handle = await wm.create("verification");
      expect(handle).not.toBeNull();
      expect(fs.existsSync(handle!.path)).toBe(true);
      // The worktree is a real checkout of HEAD: the seed file is present.
      expect(fs.existsSync(path.join(handle!.path, "README.md"))).toBe(true);

      const removed = await wm.cleanupIfUnchanged(handle!);
      expect(removed).toBe(true);
      expect(fs.existsSync(handle!.path)).toBe(false);
    } finally {
      rmrf(repo, baseDir);
    }
  });

  it("retains a worktree the sub-agent modified", async () => {
    const repo = initRepo();
    const baseDir = makeBaseDir();
    try {
      const wm = new WorktreeManager(repo, undefined, baseDir);
      const handle = await wm.create("verification");
      fs.writeFileSync(path.join(handle!.path, "scratch.txt"), "dirty\n");

      const removed = await wm.cleanupIfUnchanged(handle!);
      expect(removed).toBe(false);
      expect(fs.existsSync(handle!.path)).toBe(true);
    } finally {
      rmrf(repo, baseDir);
    }
  });

  it("two parallel write-capable run_terminal executions in separate worktrees do not collide", async () => {
    const repo = initRepo();
    const baseDir = makeBaseDir();
    try {
      const wm = new WorktreeManager(repo, undefined, baseDir);
      const a = await wm.create("agent-a");
      const b = await wm.create("agent-b");
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();

      // RunTerminalTool rooted at each worktree; env-scrub and compression off
      // for a deterministic, side-effect-free spawn.
      const termA = new RunTerminalTool(undefined, false, undefined, false, [], a!.path);
      const termB = new RunTerminalTool(undefined, false, undefined, false, [], b!.path);

      const [ra, rb] = await Promise.all([
        termA.execute({ command: writeFileCmd("collision.txt", "A"), _callId: "a" }),
        termB.execute({ command: writeFileCmd("collision.txt", "B"), _callId: "b" }),
      ]);
      expect(ra.success).toBe(true);
      expect(rb.success).toBe(true);

      // Each worktree holds its own content; neither clobbered the other.
      expect(fs.readFileSync(path.join(a!.path, "collision.txt"), "utf8")).toBe("A");
      expect(fs.readFileSync(path.join(b!.path, "collision.txt"), "utf8")).toBe("B");
      // The shared workspace was never touched.
      expect(fs.existsSync(path.join(repo, "collision.txt"))).toBe(false);
    } finally {
      rmrf(repo, baseDir);
    }
  });

  it("SubAgentManager.run with isolate routes the sub-agent's run_terminal into a worktree", async () => {
    const repo = initRepo();
    const baseDir = makeBaseDir();
    try {
      const wm = new WorktreeManager(repo, undefined, baseDir);
      // Fake LLM: first turn issues a run_terminal write, second turn ends.
      const toolCall =
        `<|tool_call>call:run_terminal{command:<|"|>${writeFileCmd("marker.txt", "D")}<|"|>}<tool_call|>`;
      const client = makeMultiResponseOllamaClient([toolCall, "Done."]);
      const manager = new SubAgentManager(
        client,
        new PromptBuilder(),
        null,
        { num_ctx: 131072, temperature: 1, top_p: 0.95, top_k: 64 },
        "gemma4",
      );
      manager.setWorktreeManager(wm);
      const { postMessage } = collectMessages();

      const config: SubAgentConfig = {
        type: "verification",
        maxIterations: 3,
        userRequest: "write a marker file",
        modifiedFiles: [],
        recentToolResults: [],
        isolate: true,
      };
      const result = await manager.run(config, postMessage);

      expect(result.toolCallCount).toBe(1);
      // The write landed inside the (retained, dirty) worktree, not the workspace.
      expect(fs.existsSync(path.join(repo, "marker.txt"))).toBe(false);
      const subdirs = fs.readdirSync(baseDir);
      expect(subdirs.length).toBe(1);
      const worktreePath = path.join(baseDir, subdirs[0]!);
      expect(fs.readFileSync(path.join(worktreePath, "marker.txt"), "utf8")).toBe("D");
    } finally {
      rmrf(repo, baseDir);
    }
  });

  it("falls back to the shared workspace when isolation is requested but no manager is wired", async () => {
    // No WorktreeManager set: isolate:true must degrade gracefully rather than
    // throw. The run proceeds on the shared workspace (run_terminal would target
    // the mocked workspace root, which does not exist on disk, so the spawn
    // fails -- but the sub-agent run itself completes and reports a result).
    const client = makeMultiResponseOllamaClient(["No worktree needed.", "Done."]);
    const manager = new SubAgentManager(
      client,
      new PromptBuilder(),
      null,
      { num_ctx: 131072, temperature: 1, top_p: 0.95, top_k: 64 },
      "gemma4",
    );
    const { postMessage } = collectMessages();

    const config: SubAgentConfig = {
      type: "verification",
      maxIterations: 2,
      userRequest: "no tool calls",
      modifiedFiles: [],
      recentToolResults: [],
      isolate: true,
    };
    const result = await manager.run(config, postMessage);

    expect(result.success).toBe(true);
    expect(result.output).toContain("No worktree needed.");
  });
});
