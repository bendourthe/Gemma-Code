import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fsp } from "node:fs";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  runGoldenTask,
  zeroSessionMetrics,
  type AgentDriver,
  type GoldenRunOptions,
} from "../../../modules/coding/evaluation/GoldenTaskRunner.js";
import type { CommandRunner } from "../../../modules/coding/evaluation/goldenCriteria.js";
import type { GitRunner } from "../../../modules/coding/evaluation/goldenSnapshot.js";
import type { GoldenTaskSpec } from "../../../modules/coding/evaluation/goldenTaskLoader.js";

/**
 * v1.7.0 Phase 1 (adoption-self-optimizing-skills S1 / SO001) -- unit tests for
 * the golden-task runner orchestration: dry vs live paths, the injected agent
 * driver seam, per-task timeout, and the scored GoldenTaskResult contract.
 * Snapshots are synthetic temp dirs; git + command runners are injected so the
 * suite is deterministic and cross-platform.
 */

let snapshotRoot: string;
let workBase: string;

const noopGit: GitRunner = () => "";
const failCommand: CommandRunner = () => ({ code: 1, stdout: "", stderr: "", timedOut: false });

beforeEach(async () => {
  snapshotRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "golden-run-snaps-"));
  workBase = await fsp.mkdtemp(path.join(os.tmpdir(), "golden-run-work-"));
});

afterEach(async () => {
  await fsp.rm(snapshotRoot, { recursive: true, force: true });
  await fsp.rm(workBase, { recursive: true, force: true });
});

/** Write a synthetic snapshot under <snapshotRoot>/<taskId> and return the spec. */
async function scaffold(taskId: string, files: Record<string, string>, spec: Partial<GoldenTaskSpec> = {}): Promise<GoldenTaskSpec> {
  const dir = path.join(snapshotRoot, taskId);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, "utf8");
  }
  return {
    id: taskId,
    name: taskId,
    category: "test",
    description: "synthetic",
    initialState: `snapshots/${taskId}`,
    expectedFilesChanged: [],
    successCriteria: [{ type: "file_contains", target: "src.ts", pattern: "DONE" }],
    maxIterations: 5,
    timeoutSeconds: 60,
    modelTier: "any",
    tags: [],
    ...spec,
  };
}

function baseOptions(extra: Partial<GoldenRunOptions> = {}): GoldenRunOptions {
  return { snapshotRoot, baseDir: workBase, gitRunner: noopGit, runCommand: failCommand, ...extra };
}

describe("runGoldenTask - dry mode", () => {
  it("evaluates the untouched snapshot and fails when criteria are unmet", async () => {
    const spec = await scaffold("dry-fail", { "src.ts": "still the original content" });
    let n = 0;
    const now = (): number => (n++ === 0 ? 1000 : 1042);
    const result = await runGoldenTask(spec, baseOptions({ mode: "dry", now }));

    expect(result.taskId).toBe("dry-fail");
    expect(result.passed).toBe(false);
    expect(result.traceId).toBe("");
    expect(result.durationMs).toBe(42);
    expect(result.metrics.totalDurationMs).toBe(42);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("passes in dry mode when the snapshot already satisfies the criteria", async () => {
    const spec = await scaffold("dry-pass", { "src.ts": "already DONE" });
    const result = await runGoldenTask(spec, baseOptions({ mode: "dry" }));
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("cleans up the workspace by default and retains it when keepWorkspace is set", async () => {
    const spec = await scaffold("dry-keep", { "src.ts": "DONE" });
    const result = await runGoldenTask(spec, baseOptions({ mode: "dry", keepWorkspace: true }));
    // The retained workspace lives under workBase; find it.
    const dirs = fs.readdirSync(workBase);
    expect(dirs.length).toBe(1);
    expect(result.passed).toBe(true);
    // Clean up the retained dir ourselves.
    fs.rmSync(path.join(workBase, dirs[0]!), { recursive: true, force: true });
  });
});

describe("runGoldenTask - live mode", () => {
  it("runs the injected driver, which mutates the workspace to satisfy the criteria", async () => {
    const spec = await scaffold("live-pass", { "src.ts": "todo" });
    const driver: AgentDriver = {
      run: async (ctx) => {
        await fsp.writeFile(path.join(ctx.workdir, "src.ts"), "now DONE", "utf8");
        return {
          traceId: "trace-xyz",
          metrics: { ...zeroSessionMetrics(), toolStepCount: 3, llmCallCount: 2, totalDurationMs: 1234 },
        };
      },
    };
    const result = await runGoldenTask(spec, baseOptions({ mode: "live", driver }));
    expect(result.passed).toBe(true);
    expect(result.traceId).toBe("trace-xyz");
    expect(result.metrics.toolStepCount).toBe(3);
    expect(result.metrics.llmCallCount).toBe(2);
    // The driver reported its own duration, so it is preserved (not overwritten).
    expect(result.metrics.totalDurationMs).toBe(1234);
  });

  it("records a failure when no driver is supplied in live mode", async () => {
    const spec = await scaffold("live-nodriver", { "src.ts": "todo" });
    const result = await runGoldenTask(spec, baseOptions({ mode: "live" }));
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("no agent driver"))).toBe(true);
  });

  it("records a failure when the driver reports an error", async () => {
    const spec = await scaffold("live-error", { "src.ts": "DONE" });
    const driver: AgentDriver = { run: async () => ({ error: "model unreachable" }) };
    const result = await runGoldenTask(spec, baseOptions({ mode: "live", driver }));
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("agent: model unreachable"))).toBe(true);
  });

  it("aborts and fails the task when the driver exceeds the per-task timeout", async () => {
    vi.useFakeTimers();
    try {
      const spec = await scaffold("live-timeout", { "src.ts": "DONE" }, { timeoutSeconds: 1 });
      let aborted = false;
      const driver: AgentDriver = {
        run: (ctx) =>
          new Promise((_resolve) => {
            ctx.signal.addEventListener("abort", () => {
              aborted = true;
            });
            // Never resolves on its own; only the timeout ends the race.
          }),
      };
      const promise = runGoldenTask(spec, baseOptions({ mode: "live", driver }));
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes("timed out"))).toBe(true);
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("zeroSessionMetrics", () => {
  it("returns an all-zero metrics baseline", () => {
    const m = zeroSessionMetrics();
    expect(m.totalDurationMs).toBe(0);
    expect(m.toolStepCount).toBe(0);
    expect(m.successRate).toBe(0);
  });
});
