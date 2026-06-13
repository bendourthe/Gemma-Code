import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ReadFileTool, ListDirectoryTool } from "../../../src/tools/handlers/filesystem.js";
import { WorktreeManager } from "../../../modules/coding/agents/WorktreeManager.js";
import { SubAgentManager } from "../../../modules/coding/agents/SubAgentManager.js";
import { PromptBuilder } from "../../../modules/coding/chat/PromptBuilder.js";
import type { SubAgentConfig } from "../../../modules/coding/agents/types.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";
import { makeMultiResponseOllamaClient } from "../../helpers/factories.js";
import { mockFs } from "../../setup.js";

// v1.5.0 Phase 4 (T012, closes the read-tool half of v1.4.0 T018.P3.B): the
// read tools accept an optional worktree root so a worktree-isolated sub-agent
// observes its own in-worktree writes. These tests delegate the mocked
// `vscode.workspace.fs` reads to real disk so the rooting is exercised
// end-to-end against real files.

afterEach(() => {
  mockFs.readFile.mockReset();
  mockFs.readDirectory.mockReset();
});

function delegateFsReadToDisk(): void {
  mockFs.readFile.mockImplementation(
    async (uri: { fsPath: string }) => new Uint8Array(fs.readFileSync(uri.fsPath)),
  );
}

describe("read-tool worktree rooting (T012)", () => {
  it("read_file rooted at a worktree resolves and reads the in-worktree file", async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wt-read-"));
    try {
      fs.writeFileSync(path.join(worktree, "parity.txt"), "PARITY");
      delegateFsReadToDisk();

      const rooted = new ReadFileTool(null, [], null, worktree);
      const res = await rooted.execute({ path: "parity.txt", _callId: "r" });

      expect(res.success).toBe(true);
      expect(res.output).toContain("PARITY");
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("read_file without a root override resolves against the workspace, not the worktree", async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wt-read-"));
    try {
      fs.writeFileSync(path.join(worktree, "parity.txt"), "PARITY");
      delegateFsReadToDisk();

      // No override: resolution falls back to the (file-less) mock workspace
      // root, so the worktree's parity.txt is not found -- proving the override
      // is what re-bases the read onto the worktree.
      const unrooted = new ReadFileTool();
      const res = await unrooted.execute({ path: "parity.txt", _callId: "r" });

      expect(res.success).toBe(false);
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("list_directory rooted at a worktree lists the in-worktree entries", async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wt-list-"));
    try {
      fs.writeFileSync(path.join(worktree, "alpha.txt"), "a");
      fs.writeFileSync(path.join(worktree, "beta.txt"), "b");
      mockFs.readDirectory.mockImplementation(async (uri: { fsPath: string }) =>
        fs.readdirSync(uri.fsPath).map((name) => [name, 1] as [string, number]),
      );

      const rooted = new ListDirectoryTool(null, [], worktree);
      const res = await rooted.execute({ path: ".", recursive: false, _callId: "l" });

      expect(res.success).toBe(true);
      expect(res.output).toContain("alpha.txt");
      expect(res.output).toContain("beta.txt");
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end: a worktree-isolated sub-agent writes a file via run_terminal then
// reads it back via read_file and sees its own write.
// ---------------------------------------------------------------------------

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function initRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "wt-parity-repo-"));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Read Rooting Test"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(repo, "README.md"), "seed\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "seed"]);
  return repo;
}

describe("integration: write-then-read parity inside an isolated worktree (T012)", () => {
  it("a worktree-isolated sub-agent reads back its own run_terminal write", async () => {
    const repo = initRepo();
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-parity-base-"));
    try {
      delegateFsReadToDisk();
      const wm = new WorktreeManager(repo, undefined, baseDir);

      const writeCall =
        `<|tool_call>call:run_terminal{command:<|"|>node -e "require('fs').writeFileSync('parity.txt','PARITY')"<|"|>}<tool_call|>`;
      const readCall = `<|tool_call>call:read_file{path:<|"|>parity.txt<|"|>}<tool_call|>`;
      const client = makeMultiResponseOllamaClient([writeCall, readCall, "Done."]);
      const sam = new SubAgentManager(
        client,
        new PromptBuilder(),
        null,
        { num_ctx: 131072, temperature: 1, top_p: 0.95, top_k: 64 },
        "gemma4",
      );
      sam.setWorktreeManager(wm);

      const collected: ExtensionToWebviewMessage[] = [];
      const postMessage = (m: ExtensionToWebviewMessage): void => {
        collected.push(m);
      };

      const config: SubAgentConfig = {
        type: "verification",
        maxIterations: 4,
        userRequest: "write then read parity.txt",
        modifiedFiles: [],
        recentToolResults: [],
        isolate: true,
      };
      await sam.run(config, postMessage);

      // The read_file tool result, surfaced via postMessage, carries the
      // worker's own in-worktree write -- proving write-then-read parity.
      const readResult = collected.find(
        (m) => m.type === "toolResult" && JSON.stringify(m).includes("PARITY"),
      );
      expect(readResult).toBeDefined();
      // And the shared workspace never received the write.
      expect(fs.existsSync(path.join(repo, "parity.txt"))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
