import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process BEFORE importing GitSafetyNet so the module binds to our mock.
// Use vi.hoisted() because vi.mock() is hoisted above imports.
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock("child_process", () => ({
  execFile: execFileMock,
  spawn: vi.fn(),
}));

import { classifyAction, ActionRisk } from "../../../modules/coding/guardrails/ActionClassifier.js";
import { GitSafetyNet } from "../../../modules/coding/guardrails/GitSafetyNet.js";
import type { ToolCall } from "../../../src/tools/types.js";

/**
 * End-to-end test of the safety pipeline as it is composed by AgentLoop:
 *
 *   classifyAction -> requiresCheckpoint -> GitSafetyNet.createCheckpoint
 *
 * Every git command is intercepted via vi.spyOn(childProcess, "execFile") so
 * no real repo is touched. The real ActionClassifier and real GitSafetyNet
 * are wired together exactly as AgentLoop.run() wires them (AgentLoop.ts
 * lines 148-151 for the pre-run checkpoint and 260-262 for the per-call
 * destructive checkpoint).
 */

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

interface GitCall {
  args: readonly string[];
}

function queueExecFile(
  responses: Array<{ stdout?: string; error?: Error }>,
): { calls: GitCall[] } {
  const calls: GitCall[] = [];
  let i = 0;

  execFileMock.mockImplementation(
    (
      _cmd: string,
      args: readonly string[] | undefined,
      _opts: unknown,
      callback?: ExecFileCallback,
    ) => {
      calls.push({ args: args ?? [] });
      const resp = responses[i++] ?? { stdout: "" };
      if (callback) {
        if (resp.error) {
          callback(resp.error, "", resp.error.message);
        } else {
          callback(null, resp.stdout ?? "", "");
        }
      }
      return {};
    },
  );

  return { calls };
}

function makeToolCall(tool: string, params: Record<string, unknown> = {}): ToolCall {
  return { id: "call_1", tool: tool as ToolCall["tool"], parameters: params };
}

describe("safety pipeline integration", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    execFileMock.mockReset();
  });

  it("creates a git checkpoint before a DESTRUCTIVE tool call (delete_file)", async () => {
    const { calls } = queueExecFile([
      { stdout: "true\n" }, // rev-parse --is-inside-work-tree
      { stdout: "abc123\n" }, // rev-parse HEAD
      { stdout: "" }, // status --porcelain (clean)
    ]);

    const classification = classifyAction(makeToolCall("delete_file", { path: "x.txt" }));
    expect(classification.risk).toBe(ActionRisk.DESTRUCTIVE);
    expect(classification.requiresCheckpoint).toBe(true);

    const net = new GitSafetyNet("/workspace");
    const checkpoint = classification.requiresCheckpoint
      ? await net.createCheckpoint(`pre-delete_file`)
      : null;

    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.headSha).toBe("abc123");
    expect(calls.map((c) => c.args.slice(0, 2))).toEqual([
      ["rev-parse", "--is-inside-work-tree"],
      ["rev-parse", "HEAD"],
      ["status", "--porcelain"],
    ]);
  });

  it("does NOT create a checkpoint for a REVERSIBLE tool call (read_file)", async () => {
    const { calls } = queueExecFile([]);

    const classification = classifyAction(makeToolCall("read_file", { path: "x.txt" }));
    expect(classification.risk).toBe(ActionRisk.REVERSIBLE);
    expect(classification.requiresCheckpoint).toBe(false);

    const net = new GitSafetyNet("/workspace");
    const checkpoint = classification.requiresCheckpoint
      ? await net.createCheckpoint("pre-read_file")
      : null;

    expect(checkpoint).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("rolls back to the checkpoint via reset --hard + stash pop when a destructive tool fails", async () => {
    const { calls } = queueExecFile([
      { stdout: "true\n" }, // rev-parse --is-inside-work-tree
      { stdout: "def456\n" }, // rev-parse HEAD
      { stdout: " M src/foo.ts\n" }, // status --porcelain (dirty)
      { stdout: "Saved working directory and index state WIP on main: def456 safety\n" }, // stash push
      // Now the simulated "tool fails", rollback begins:
      { stdout: "HEAD is now at def456\n" }, // reset --hard
      { stdout: "" }, // stash pop
    ]);

    const net = new GitSafetyNet("/workspace");
    const checkpoint = await net.createCheckpoint("pre-write_file");
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.stashCreated).toBe(true);

    // Simulate a destructive tool failure: AgentLoop would call rollback here.
    const ok = await net.rollback(checkpoint!);
    expect(ok).toBe(true);

    // The final two git invocations must be reset + stash-pop in that order.
    const lastTwo = calls.slice(-2).map((c) => c.args);
    expect(lastTwo[0]).toEqual(["reset", "--hard", "def456"]);
    expect(lastTwo[1]).toEqual(["stash", "pop"]);
  });

  it("returns null from createCheckpoint when the workspace is not a git repo", async () => {
    queueExecFile([
      { stdout: "false\n" }, // rev-parse --is-inside-work-tree returns "false"
    ]);

    const net = new GitSafetyNet("/not-a-repo");
    const checkpoint = await net.createCheckpoint();
    expect(checkpoint).toBeNull();
  });
});
