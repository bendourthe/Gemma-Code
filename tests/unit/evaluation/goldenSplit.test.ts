import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  parseGoldenTaskYaml,
  toGoldenTaskSpec,
  type GoldenTaskSpec,
} from "../../../modules/coding/evaluation/goldenTaskLoader.js";
import {
  assertNoTestSplit,
  assignDefaultSplits,
  isOptimizerVisible,
  loadOptimizerVisibleTasks,
  loadSplitGoldenTasks,
  optimizerVisibleTasks,
  splitGoldenTasks,
  type SplitGoldenTaskSpec,
} from "../../../modules/coding/evaluation/goldenSplit.js";
import { YAML_GOLDEN_TASK_COUNT } from "../../../modules/coding/evaluation/goldenTasksYaml.generated.js";

/**
 * v1.7.0 Phase 2 (adoption-self-optimizing-skills S4 / SO002) -- unit tests for
 * the train/validation/test split + the held-out contamination guard. The
 * load-bearing acceptance is that the optimizer-facing loader can never return
 * a `test`-split task (the article's anti-contamination requirement).
 */

const TASKS_DIR = path.resolve(__dirname, "..", "..", "..", "tests", "golden", "tasks");

function makeSpec(id: string, category: string, split?: "train" | "validation" | "test"): GoldenTaskSpec {
  return {
    id,
    name: id,
    category,
    description: "d",
    initialState: `snapshots/${id}`,
    expectedFilesChanged: [],
    successCriteria: [],
    maxIterations: 10,
    timeoutSeconds: 120,
    modelTier: "any",
    tags: [],
    ...(split ? { split } : {}),
  };
}

describe("goldenTaskLoader - split field", () => {
  function baseLines(extra: string[] = []): string {
    return [
      "id: t",
      "name: n",
      "category: bug-fix",
      "description: d",
      "initial_state: s",
      ...extra,
    ].join("\n");
  }

  it("parses an explicit split value", () => {
    const spec = toGoldenTaskSpec(parseGoldenTaskYaml(baseLines(["split: validation"])), "f.yaml");
    expect(spec.split).toBe("validation");
  });

  it("leaves split undefined when absent", () => {
    const spec = toGoldenTaskSpec(parseGoldenTaskYaml(baseLines()), "f.yaml");
    expect(spec.split).toBeUndefined();
  });

  it("throws (fail-closed) on an unknown split value", () => {
    expect(() => toGoldenTaskSpec(parseGoldenTaskYaml(baseLines(["split: holdout"])), "f.yaml")).toThrow(
      /'split' must be one of train\|validation\|test/,
    );
  });
});

describe("assignDefaultSplits", () => {
  it("assigns a concrete split to every task and honors explicit ones", () => {
    const tasks = [
      makeSpec("a-01", "alpha"),
      makeSpec("a-02", "alpha"),
      makeSpec("a-03", "alpha"),
      makeSpec("b-01", "beta", "test"), // explicit override
    ];
    const assigned = assignDefaultSplits(tasks);
    for (const t of assigned) expect(["train", "validation", "test"]).toContain(t.split);
    // alpha cycles train -> validation -> test by sorted id.
    const byId = new Map(assigned.map((t) => [t.id, t.split]));
    expect(byId.get("a-01")).toBe("train");
    expect(byId.get("a-02")).toBe("validation");
    expect(byId.get("a-03")).toBe("test");
    // explicit split is preserved.
    expect(byId.get("b-01")).toBe("test");
  });

  it("is deterministic and order-independent in its assignment", () => {
    const tasks = [makeSpec("x-03", "x"), makeSpec("x-01", "x"), makeSpec("x-02", "x")];
    const first = new Map(assignDefaultSplits(tasks).map((t) => [t.id, t.split]));
    const shuffled = [tasks[1]!, tasks[2]!, tasks[0]!];
    const second = new Map(assignDefaultSplits(shuffled).map((t) => [t.id, t.split]));
    expect(second).toEqual(first);
    // Sorted-by-id cycle is stable regardless of input order.
    expect(first.get("x-01")).toBe("train");
    expect(first.get("x-02")).toBe("validation");
    expect(first.get("x-03")).toBe("test");
  });

  it("preserves input order in the returned array", () => {
    const tasks = [makeSpec("z-02", "z"), makeSpec("z-01", "z")];
    expect(assignDefaultSplits(tasks).map((t) => t.id)).toEqual(["z-02", "z-01"]);
  });
});

describe("splitGoldenTasks + assertNoTestSplit", () => {
  it("partitions tasks into the three splits", () => {
    const tasks = [
      makeSpec("a-01", "alpha"),
      makeSpec("a-02", "alpha"),
      makeSpec("a-03", "alpha"),
    ];
    const { train, validation, test } = splitGoldenTasks(tasks);
    expect(train.map((t) => t.id)).toEqual(["a-01"]);
    expect(validation.map((t) => t.id)).toEqual(["a-02"]);
    expect(test.map((t) => t.id)).toEqual(["a-03"]);
  });

  it("throws when a test-split task is present", () => {
    const withTest: SplitGoldenTaskSpec[] = [{ ...makeSpec("t-01", "x"), split: "test" }];
    expect(() => assertNoTestSplit(withTest)).toThrow(/contamination guard/);
  });

  it("does not throw for train/validation-only lists", () => {
    const visible: SplitGoldenTaskSpec[] = [
      { ...makeSpec("a-01", "x"), split: "train" },
      { ...makeSpec("a-02", "x"), split: "validation" },
    ];
    expect(() => assertNoTestSplit(visible)).not.toThrow();
  });

  it("isOptimizerVisible excludes only the test split", () => {
    expect(isOptimizerVisible("train")).toBe(true);
    expect(isOptimizerVisible("validation")).toBe(true);
    expect(isOptimizerVisible("test")).toBe(false);
  });
});

describe("optimizerVisibleTasks - contamination guard", () => {
  it("never returns a test-split task", () => {
    const tasks = [
      makeSpec("a-01", "alpha"),
      makeSpec("a-02", "alpha"),
      makeSpec("a-03", "alpha"), // -> test
    ];
    const visible = optimizerVisibleTasks(tasks);
    expect(visible.every((t) => t.split !== "test")).toBe(true);
    expect(visible.map((t) => t.id).sort()).toEqual(["a-01", "a-02"]);
  });
});

describe("split over the real corpus", () => {
  it("partitions the full corpus with non-empty, representative splits", () => {
    const { train, validation, test } = loadSplitGoldenTasks(TASKS_DIR);
    const total = train.length + validation.length + test.length;
    expect(total).toBe(YAML_GOLDEN_TASK_COUNT);

    // Every split is non-empty (the held-out test split must exist to be meaningful).
    expect(train.length).toBeGreaterThan(0);
    expect(validation.length).toBeGreaterThan(0);
    expect(test.length).toBeGreaterThan(0);

    // The three splits are disjoint and cover every task exactly once.
    const ids = [...train, ...validation, ...test].map((t) => t.id);
    expect(new Set(ids).size).toBe(total);

    // The test split spans multiple categories (representative, not one family).
    const testCategories = new Set(test.map((t) => t.category));
    expect(testCategories.size).toBeGreaterThan(1);
  });

  it("makes the test split unreachable from the optimizer loader", () => {
    const { test } = loadSplitGoldenTasks(TASKS_DIR);
    const visible = loadOptimizerVisibleTasks(TASKS_DIR);
    const visibleIds = new Set(visible.map((t) => t.id));
    const testIds = test.map((t) => t.id);

    expect(testIds.length).toBeGreaterThan(0); // the guard is meaningful
    expect(visible.every((t) => t.split !== "test")).toBe(true);
    for (const id of testIds) expect(visibleIds.has(id)).toBe(false);
  });
});
