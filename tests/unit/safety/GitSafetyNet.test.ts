import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitSafetyNet } from "../../../src/safety/GitSafetyNet.js";

// Mock child_process.execFile
vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "child_process";

const mockedExecFile = vi.mocked(execFile);

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

function mockGitCommand(responses: Record<string, string | Error>) {
  mockedExecFile.mockImplementation(
    (_cmd: string, args: readonly string[] | undefined | null, _opts: unknown, cb?: unknown) => {
      const callback = cb as ExecFileCallback;
      const firstArg = (args as string[])?.[0] ?? "";

      // Match on the first git subcommand.
      for (const [key, value] of Object.entries(responses)) {
        if (firstArg === key || (args as string[])?.join(" ").includes(key)) {
          if (value instanceof Error) {
            callback(value, "", "");
          } else {
            callback(null, value, "");
          }
          return undefined as never;
        }
      }
      // Default: success with empty output.
      callback(null, "", "");
      return undefined as never;
    },
  );
}

describe("GitSafetyNet", () => {
  let net: GitSafetyNet;

  beforeEach(() => {
    vi.clearAllMocks();
    net = new GitSafetyNet("/workspace");
  });

  describe("isGitRepo", () => {
    it("returns true for a git repository", async () => {
      mockGitCommand({ "rev-parse": "true\n" });
      expect(await net.isGitRepo()).toBe(true);
    });

    it("returns false when git command fails", async () => {
      mockGitCommand({ "rev-parse": new Error("not a git repo") });
      expect(await net.isGitRepo()).toBe(false);
    });
  });

  describe("createCheckpoint", () => {
    it("creates checkpoint with stash when workspace is dirty", async () => {
      mockGitCommand({
        "--is-inside-work-tree": "true\n",
        "HEAD": "abc123def456\n",
        "--porcelain": " M src/file.ts\n",
        "stash": "Saved working directory\n",
      });

      const checkpoint = await net.createCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.headSha).toBe("abc123def456");
      expect(checkpoint!.stashCreated).toBe(true);
      expect(checkpoint!.timestamp).toBeGreaterThan(0);
    });

    it("creates checkpoint without stash when workspace is clean", async () => {
      mockGitCommand({
        "--is-inside-work-tree": "true\n",
        "HEAD": "abc123def456\n",
        "--porcelain": "",
      });

      const checkpoint = await net.createCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.headSha).toBe("abc123def456");
      expect(checkpoint!.stashCreated).toBe(false);
    });

    it("returns null for non-git workspace", async () => {
      mockGitCommand({ "--is-inside-work-tree": new Error("not a git repo") });

      const checkpoint = await net.createCheckpoint();
      expect(checkpoint).toBeNull();
    });

    it("returns null when HEAD cannot be resolved", async () => {
      mockGitCommand({
        "--is-inside-work-tree": "true\n",
        "HEAD": new Error("ambiguous HEAD"),
      });

      const checkpoint = await net.createCheckpoint();
      expect(checkpoint).toBeNull();
    });
  });

  describe("commitAgentChanges", () => {
    it("stages files and commits with [gemma-code] prefix", async () => {
      mockGitCommand({
        "add": "",
        "--cached": new Error("differences found"), // non-zero exit = staged changes exist
        "commit": "commit abc123\n",
        "HEAD": "abc123newsha\n",
      });

      const sha = await net.commitAgentChanges(["src/a.ts", "src/b.ts"], "implement feature");
      expect(sha).toBe("abc123newsha");

      // Verify commit message includes prefix.
      const commitCall = mockedExecFile.mock.calls.find(
        (c) => (c[1] as string[])?.[0] === "commit",
      );
      expect(commitCall).toBeDefined();
      const commitArgs = commitCall![1] as string[];
      expect(commitArgs).toContain("[gemma-code] implement feature");
    });

    it("returns null when no files provided", async () => {
      const sha = await net.commitAgentChanges([], "empty");
      expect(sha).toBeNull();
      expect(mockedExecFile).not.toHaveBeenCalled();
    });

    it("returns null when git add fails", async () => {
      mockGitCommand({
        "add": new Error("add failed"),
      });

      const sha = await net.commitAgentChanges(["file.ts"], "test");
      expect(sha).toBeNull();
    });
  });

  describe("rollback", () => {
    it("resets to checkpoint SHA", async () => {
      mockGitCommand({
        "reset": "HEAD is now at abc123\n",
      });

      const success = await net.rollback({
        headSha: "abc123",
        stashCreated: false,
        timestamp: Date.now(),
      });
      expect(success).toBe(true);
    });

    it("pops stash when checkpoint had stash", async () => {
      mockGitCommand({
        "reset": "HEAD is now at abc123\n",
        "stash": "Applied stash\n",
      });

      const success = await net.rollback({
        headSha: "abc123",
        stashCreated: true,
        timestamp: Date.now(),
      });
      expect(success).toBe(true);

      // Verify stash pop was called.
      const stashCall = mockedExecFile.mock.calls.find(
        (c) => (c[1] as string[])?.[0] === "stash" && (c[1] as string[])?.[1] === "pop",
      );
      expect(stashCall).toBeDefined();
    });

    it("returns false when reset fails", async () => {
      mockGitCommand({
        "reset": new Error("reset failed"),
      });

      const success = await net.rollback({
        headSha: "abc123",
        stashCreated: false,
        timestamp: Date.now(),
      });
      expect(success).toBe(false);
    });
  });
});
