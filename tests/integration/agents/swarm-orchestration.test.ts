import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WorktreeManager } from "../../../modules/coding/agents/WorktreeManager.js";
import { SubAgentManager } from "../../../modules/coding/agents/SubAgentManager.js";
import { PromptBuilder } from "../../../modules/coding/chat/PromptBuilder.js";
import { DAGExecutor } from "../../../modules/coding/orchestration/DAGExecutor.js";
import { TaskDAG } from "../../../modules/coding/orchestration/TaskDAG.js";
import type { TaskNode } from "../../../modules/coding/orchestration/TaskDAG.js";
import { getTierConfig } from "../../../modules/coding/config/HardwareTier.js";
import { makeMultiResponseOllamaClient, collectMessages } from "../../helpers/factories.js";

// v1.5.0 Phase 4 (T010, closes v1.4.0 T018.P3.A): production-path proof that a
// write-capable DAG node, dispatched through a real SubAgentManager wired with a
// real WorktreeManager, runs its run_terminal mutations inside an isolated git
// worktree -- never on the shared workspace -- when the DAGExecutor's
// isolateWrites flag is on. Exercises real `git worktree` + real run_terminal
// child processes against a throwaway repo.

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function initRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-repo-"));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Swarm Orchestration Test"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(repo, "README.md"), "seed\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "seed"]);
  return repo;
}

function makeBaseDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "swarm-base-"));
}

function rmrf(...dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

function writeFileCmd(name: string, content: string): string {
  return `node -e "require('fs').writeFileSync('${name}','${content}')"`;
}

function verifyNode(id: string): TaskNode {
  // "verify" maps to the verification sub-agent type -- the only write-capable
  // (run_terminal-bearing) agent type, so it is the one the DAGExecutor isolates.
  return {
    id,
    title: id,
    description: `task ${id}`,
    type: "verify",
    dependencies: [],
    status: "pending",
    retryCount: 0,
    maxRetries: 0,
  };
}

const OLLAMA_OPTS = { num_ctx: 131072, temperature: 1, top_p: 0.95, top_k: 64 };

describe("integration: swarm orchestration dispatches write-capable nodes in worktrees (T010)", () => {
  it("dispatches a write-capable node into an isolated worktree, leaving the shared workspace untouched", async () => {
    const repo = initRepo();
    const baseDir = makeBaseDir();
    try {
      const wm = new WorktreeManager(repo, undefined, baseDir);
      const writeCall =
        `<|tool_call>call:run_terminal{command:<|"|>${writeFileCmd("swarm.txt", "S")}<|"|>}<tool_call|>`;
      const client = makeMultiResponseOllamaClient([writeCall, "Done."]);
      const sam = new SubAgentManager(client, new PromptBuilder(), null, OLLAMA_OPTS, "gemma4");
      sam.setWorktreeManager(wm);

      const dag = new TaskDAG([verifyNode("v")]);
      const { postMessage } = collectMessages();
      const executor = new DAGExecutor(
        sam,
        getTierConfig(1),
        postMessage,
        undefined,
        undefined,
        { isolateWrites: true },
      );

      const result = await executor.execute(dag);

      expect(result.nodesCompleted).toBe(1);
      // The shared workspace was never mutated.
      expect(fs.existsSync(path.join(repo, "swarm.txt"))).toBe(false);
      // The write landed inside the (retained, dirty) worktree.
      const subdirs = fs.readdirSync(baseDir);
      expect(subdirs.length).toBe(1);
      expect(
        fs.readFileSync(path.join(baseDir, subdirs[0]!, "swarm.txt"), "utf8"),
      ).toBe("S");
    } finally {
      rmrf(repo, baseDir);
    }
  });

  it("removes the isolation worktree when the dispatched node leaves it unchanged", async () => {
    const repo = initRepo();
    const baseDir = makeBaseDir();
    try {
      const wm = new WorktreeManager(repo, undefined, baseDir);
      // The sub-agent makes no tool call, so its worktree stays clean.
      const client = makeMultiResponseOllamaClient(["No changes needed.", "Done."]);
      const sam = new SubAgentManager(client, new PromptBuilder(), null, OLLAMA_OPTS, "gemma4");
      sam.setWorktreeManager(wm);

      const dag = new TaskDAG([verifyNode("v")]);
      const { postMessage } = collectMessages();
      const executor = new DAGExecutor(
        sam,
        getTierConfig(1),
        postMessage,
        undefined,
        undefined,
        { isolateWrites: true },
      );

      await executor.execute(dag);

      // A clean worktree is removed by cleanupIfUnchanged.
      expect(fs.readdirSync(baseDir).length).toBe(0);
    } finally {
      rmrf(repo, baseDir);
    }
  });
});
