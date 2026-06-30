import { describe, it, expect } from "vitest";
import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadGoldenTask } from "../../../modules/coding/evaluation/goldenTaskLoader.js";
import {
  runGoldenTask,
  zeroSessionMetrics,
  type AgentDriver,
} from "../../../modules/coding/evaluation/GoldenTaskRunner.js";

/**
 * v1.7.0 Phase 1 (adoption-self-optimizing-skills S1 / SO001) -- end-to-end
 * integration of the golden-task runner against the real corpus + snapshots.
 *
 * Two paths, both Ollama-free (CI-safe):
 *   1. Dry path: evaluate the untouched snapshot. Expected to fail (the signal
 *      that the task was never executed) -- exactly the v0.6.0 dry-mode
 *      semantics, now in TS.
 *   2. Mock-live path: an injected driver mutates the isolated workspace to
 *      satisfy the criteria, proving the live path materialize -> run ->
 *      evaluate -> score round-trip against a real snapshot.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SNAPSHOTS_ROOT = path.join(REPO_ROOT, "tests", "golden", "snapshots");
const TASKS_DIR = path.join(REPO_ROOT, "tests", "golden", "tasks");

describe("golden runner end-to-end (dry path)", () => {
  it("materializes a real snapshot and reports failure for the untouched tree", async () => {
    const spec = loadGoldenTask(path.join(TASKS_DIR, "multi-file-rename-01.yaml"));
    const result = await runGoldenTask(spec, { mode: "dry", snapshotRoot: SNAPSHOTS_ROOT });

    expect(result.taskId).toBe("multi-file-rename-01");
    // The snapshot still uses the old name, so the rename criteria fail.
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("golden runner end-to-end (mock-live path)", () => {
  it("runs an injected driver that creates the expected file and passes the criteria", async () => {
    const spec = loadGoldenTask(path.join(TASKS_DIR, "testgen-unit-function-01.yaml"));
    // The task asks for tests/math.test.ts covering `add` and `divide`.
    const driver: AgentDriver = {
      run: async (ctx) => {
        const target = path.join(ctx.workdir, "tests", "math.test.ts");
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(
          target,
          [
            "import { test } from 'node:test';",
            "import { add, divide } from '../src/math.ts';",
            "test('add', () => { add(1, 2); });",
            "test('divide', () => { divide(6, 2); });",
          ].join("\n"),
          "utf8",
        );
        return { traceId: "mock-live", metrics: { ...zeroSessionMetrics(), toolStepCount: 1, llmCallCount: 1 } };
      },
    };

    const result = await runGoldenTask(spec, { mode: "live", snapshotRoot: SNAPSHOTS_ROOT, driver });

    expect(result.taskId).toBe("testgen-unit-function-01");
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.traceId).toBe("mock-live");
    expect(result.metrics.toolStepCount).toBe(1);
  });

  it("uses a caller-provided baseDir for the throwaway workspace", async () => {
    const spec = loadGoldenTask(path.join(TASKS_DIR, "testgen-unit-function-01.yaml"));
    const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), "golden-e2e-base-"));
    try {
      const driver: AgentDriver = { run: async () => ({ traceId: "noop" }) };
      const result = await runGoldenTask(spec, {
        mode: "live",
        snapshotRoot: SNAPSHOTS_ROOT,
        baseDir,
        driver,
      });
      // Driver did not create the file, so the create-test criteria fail.
      expect(result.passed).toBe(false);
      // The workspace was cleaned up afterward (default keepWorkspace=false).
      const remaining = await fsp.readdir(baseDir);
      expect(remaining).toHaveLength(0);
    } finally {
      await fsp.rm(baseDir, { recursive: true, force: true });
    }
  });
});
