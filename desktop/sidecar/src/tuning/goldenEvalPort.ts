/**
 * v2.1 DF-16 -- sidecar EvalPort backed by GoldenTaskRunner.
 *
 * Lives in the sidecar so `core/tuning` never imports `modules/coding`.
 * CI keeps the equal-score stub unless `NEXUS_TUNING_EVAL=golden`.
 */

import type { EvalPort } from "../../../../core/tuning/evalGate.js";
import {
  runGoldenTask,
  type GoldenRunOptions,
} from "../../../../modules/coding/evaluation/GoldenTaskRunner.js";
import type { GoldenTaskSpec } from "../../../../modules/coding/evaluation/goldenTaskLoader.js";
import { loadOptimizerVisibleTasks } from "../../../../modules/coding/evaluation/goldenSplit.js";

export interface GoldenEvalPortOptions {
  readonly tasksDir?: string;
  readonly snapshotRoot?: string;
  readonly loadTasks?: (dir: string) => readonly GoldenTaskSpec[];
  readonly runTask?: (
    spec: GoldenTaskSpec,
    options: GoldenRunOptions,
  ) => Promise<{ readonly passed: boolean }>;
  readonly limit?: number;
}

export function createGoldenEvalPort(opts: GoldenEvalPortOptions = {}): EvalPort {
  const limit = opts.limit ?? 3;
  const load = opts.loadTasks ?? loadOptimizerVisibleTasks;
  const run = opts.runTask ?? runGoldenTask;
  return {
    async score(_modelId: string): Promise<number> {
      const dir = opts.tasksDir ?? "";
      const tasks = dir ? load(dir).slice(0, limit) : [];
      if (tasks.length === 0) return 0;
      let passed = 0;
      for (const spec of tasks) {
        const result = await run(spec, {
          mode: "dry",
          snapshotRoot: opts.snapshotRoot ?? dir,
        });
        if (result.passed) passed += 1;
      }
      return passed / tasks.length;
    },
  };
}
