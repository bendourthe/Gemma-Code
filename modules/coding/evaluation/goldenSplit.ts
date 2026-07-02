// ---------------------------------------------------------------------------
// v1.7.0 Phase 2 (adoption-self-optimizing-skills S4 / SO002) -- golden-task
// train/validation/test split + the held-out contamination guard.
//
// The article's anti-contamination requirement is that the optimizer is never
// shown the `test` split: it rolls out `train`, gates on `validation`, and the
// `test` split is reserved as an untouched final judge. This module assigns a
// deterministic default split by category (so every split stays representative
// across task families) when a task does not pin one explicitly, and exposes
// the single loader the optimizer code path is allowed to call -- one that
// can never return a `test`-split task (`optimizerVisibleTasks`, guarded by
// `assertNoTestSplit`).
//
// Boundary: vscode-free, no outbound, no logging (mirrors the rest of
// `modules/coding/evaluation/`). Depends only on the sibling loader.
// ---------------------------------------------------------------------------

import {
  loadAllGoldenTasks,
  type GoldenSplit,
  type GoldenTaskSpec,
} from "./goldenTaskLoader.js";

export type { GoldenSplit } from "./goldenTaskLoader.js";

/** A {@link GoldenTaskSpec} with its split resolved to a concrete value. */
export type SplitGoldenTaskSpec = GoldenTaskSpec & { readonly split: GoldenSplit };

/** The three splits, partitioned. */
export interface SplitGoldenTasks {
  readonly train: readonly SplitGoldenTaskSpec[];
  readonly validation: readonly SplitGoldenTaskSpec[];
  readonly test: readonly SplitGoldenTaskSpec[];
}

/**
 * The splits the optimizer code path is permitted to read. The `test` split is
 * deliberately excluded -- it is the held-out, contamination-guarded final
 * judge.
 */
export const OPTIMIZER_VISIBLE_SPLITS: readonly GoldenSplit[] = ["train", "validation"];

/** True when `split` is one the optimizer may read (i.e. not `test`). */
export function isOptimizerVisible(split: GoldenSplit): boolean {
  return split !== "test";
}

// Round-robin order used to default-assign within each category. Starting at
// `train` keeps it the largest split (it gets every category's first task),
// `validation` second, and `test` the smallest -- the conventional 1-of-3
// held-out shape, applied per category so each split spans task families.
const SPLIT_CYCLE: readonly GoldenSplit[] = ["train", "validation", "test"];

/**
 * Resolve a concrete split for every task. A task that declares `split`
 * explicitly keeps it; the rest are assigned deterministically by category
 * (tasks sorted by id, then cycled train -> validation -> test) so each split
 * is representative across categories regardless of input order.
 */
export function assignDefaultSplits(tasks: readonly GoldenTaskSpec[]): SplitGoldenTaskSpec[] {
  const byCategory = new Map<string, GoldenTaskSpec[]>();
  for (const task of tasks) {
    const group = byCategory.get(task.category) ?? [];
    group.push(task);
    byCategory.set(task.category, group);
  }

  const resolved = new Map<string, GoldenSplit>();
  for (const group of byCategory.values()) {
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    let cursor = 0;
    for (const task of sorted) {
      if (task.split !== undefined) {
        resolved.set(task.id, task.split);
        continue;
      }
      resolved.set(task.id, SPLIT_CYCLE[cursor % SPLIT_CYCLE.length]!);
      cursor++;
    }
  }

  // Preserve the caller's input order; only the split is newly resolved.
  return tasks.map((task) => ({ ...task, split: resolved.get(task.id)! }));
}

/** Partition tasks into their three splits (defaults assigned as needed). */
export function splitGoldenTasks(tasks: readonly GoldenTaskSpec[]): SplitGoldenTasks {
  const train: SplitGoldenTaskSpec[] = [];
  const validation: SplitGoldenTaskSpec[] = [];
  const test: SplitGoldenTaskSpec[] = [];
  for (const task of assignDefaultSplits(tasks)) {
    if (task.split === "train") train.push(task);
    else if (task.split === "validation") validation.push(task);
    else test.push(task);
  }
  return { train, validation, test };
}

/**
 * Contamination guard: throw if any `test`-split task is present. Used as
 * defense-in-depth inside the optimizer-facing loader so a future change that
 * accidentally lets a test task through fails loudly rather than silently
 * leaking the held-out split into the optimization loop.
 */
export function assertNoTestSplit(tasks: readonly SplitGoldenTaskSpec[]): void {
  const leaked = tasks.filter((task) => task.split === "test").map((task) => task.id);
  if (leaked.length > 0) {
    throw new Error(
      `held-out contamination guard: test-split tasks must never reach the optimizer (${leaked.join(", ")})`,
    );
  }
}

/**
 * The ONLY task list the optimizer code path may consume: train + validation,
 * never test. The explicit `assertNoTestSplit` re-checks the filtered result so
 * the guarantee is enforced, not merely intended.
 */
export function optimizerVisibleTasks(tasks: readonly GoldenTaskSpec[]): SplitGoldenTaskSpec[] {
  const visible = assignDefaultSplits(tasks).filter((task) => isOptimizerVisible(task.split));
  assertNoTestSplit(visible);
  return visible;
}

/** Load the full corpus from disk and partition it into its three splits. */
export function loadSplitGoldenTasks(tasksDir: string): SplitGoldenTasks {
  return splitGoldenTasks(loadAllGoldenTasks(tasksDir));
}

/**
 * Load only the optimizer-visible tasks (train + validation) from disk. This is
 * the loader the optimizer must use; it can never return a `test`-split task.
 */
export function loadOptimizerVisibleTasks(tasksDir: string): SplitGoldenTaskSpec[] {
  return optimizerVisibleTasks(loadAllGoldenTasks(tasksDir));
}
