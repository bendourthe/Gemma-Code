import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  GOLDEN_TASKS,
  validateExpectation,
  detectRegressions,
} from "../../../src/observability/GoldenTaskSuite.js";
import type {
  GoldenTaskResult,
  GoldenTask,
} from "../../../src/observability/GoldenTaskSuite.js";
import type { SessionMetrics } from "../../../src/observability/MetricsCollector.js";
import {
  YAML_GOLDEN_TASK_COUNT,
  YAML_GOLDEN_TASK_IDS,
} from "../../../src/observability/goldenTasksYaml.generated.js";

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function makeMetrics(overrides?: Partial<SessionMetrics>): SessionMetrics {
  return {
    totalDurationMs: 1000,
    toolStepCount: 3,
    llmCallCount: 2,
    retryCount: 0,
    compactionCount: 0,
    humanInterventionCount: 0,
    successRate: 1,
    estimatedTokensUsed: 500,
    subAgentCount: 0,
    ...overrides,
  };
}

function makeResult(
  taskId: string,
  overrides?: Partial<GoldenTaskResult>,
): GoldenTaskResult {
  return {
    taskId,
    passed: true,
    traceId: "trace-1",
    metrics: makeMetrics(),
    failures: [],
    durationMs: 1000,
    ...overrides,
  };
}

// -------------------------------------------------------------------------
// GOLDEN_TASKS constant
// -------------------------------------------------------------------------

describe("GOLDEN_TASKS", () => {
  it("contains 5 in-process smoke tasks", () => {
    // These are the curated in-process tasks. The larger YAML corpus lives
    // under tests/golden/tasks/ and is tracked separately; see the
    // "YAML corpus cross-check" block below.
    expect(GOLDEN_TASKS).toHaveLength(5);
  });

  it("has unique IDs", () => {
    const ids = GOLDEN_TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers expected categories", () => {
    const categories = new Set(GOLDEN_TASKS.map((t) => t.category));
    expect(categories).toContain("file_ops");
    expect(categories).toContain("code_gen");
    expect(categories).toContain("refactor");
    expect(categories).toContain("debug");
    expect(categories).toContain("test_gen");
  });

  it("has valid timeoutMs on all tasks", () => {
    for (const task of GOLDEN_TASKS) {
      expect(task.timeoutMs).toBeGreaterThan(0);
    }
  });
});

// -------------------------------------------------------------------------
// validateExpectation
// -------------------------------------------------------------------------

describe("validateExpectation", () => {
  it("returns no failures when all expectations pass", () => {
    const result = makeResult("t1", { durationMs: 1000 });
    const failures = validateExpectation(result, {
      maxToolCalls: 10,
      maxDurationMs: 5000,
    });
    expect(failures).toEqual([]);
  });

  it("detects tool call count exceeded", () => {
    const result = makeResult("t1", {
      metrics: makeMetrics({ toolStepCount: 15 }),
    });
    const failures = validateExpectation(result, { maxToolCalls: 10 });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Tool calls exceeded");
  });

  it("detects duration exceeded", () => {
    const result = makeResult("t1", { durationMs: 60_000 });
    const failures = validateExpectation(result, { maxDurationMs: 30_000 });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Duration exceeded");
  });

  it("detects mustPass failure", () => {
    const result = makeResult("t1", { passed: false });
    const failures = validateExpectation(result, { mustPass: true });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("mustPass");
  });

  it("reports multiple failures simultaneously", () => {
    const result = makeResult("t1", {
      passed: false,
      durationMs: 100_000,
      metrics: makeMetrics({ toolStepCount: 50 }),
    });
    const failures = validateExpectation(result, {
      maxToolCalls: 10,
      maxDurationMs: 30_000,
      mustPass: true,
    });
    expect(failures).toHaveLength(3);
  });
});

// -------------------------------------------------------------------------
// detectRegressions
// -------------------------------------------------------------------------

describe("detectRegressions", () => {
  it("returns empty array when no previous results", () => {
    const current = [makeResult("t1")];
    expect(detectRegressions([], current)).toEqual([]);
  });

  it("returns empty array when no regressions", () => {
    const prev = [makeResult("t1", { durationMs: 1000 })];
    const curr = [makeResult("t1", { durationMs: 1100 })];
    expect(detectRegressions(prev, curr)).toEqual([]);
  });

  it("detects duration regression beyond threshold", () => {
    const prev = [makeResult("t1", { durationMs: 1000 })];
    const curr = [makeResult("t1", { durationMs: 1500 })]; // 50% increase
    const regressions = detectRegressions(prev, curr, 20);
    expect(regressions).toHaveLength(1);
    expect(regressions[0].field).toBe("durationMs");
    expect(regressions[0].regression).toBe(true);
  });

  it("detects tool step count regression", () => {
    const prev = [
      makeResult("t1", { metrics: makeMetrics({ toolStepCount: 5 }) }),
    ];
    const curr = [
      makeResult("t1", { metrics: makeMetrics({ toolStepCount: 10 }) }),
    ];
    const regressions = detectRegressions(prev, curr, 20);
    expect(regressions.some((r) => r.field === "toolStepCount")).toBe(true);
  });

  it("detects pass-to-fail regression", () => {
    const prev = [makeResult("t1", { passed: true })];
    const curr = [makeResult("t1", { passed: false })];
    const regressions = detectRegressions(prev, curr);
    expect(regressions.some((r) => r.field === "passed")).toBe(true);
  });

  it("ignores tasks without a previous baseline", () => {
    const prev = [makeResult("t1")];
    const curr = [makeResult("t1"), makeResult("t2")];
    const regressions = detectRegressions(prev, curr);
    // t2 has no previous baseline, so no regression reported
    expect(regressions.every((r) => r.taskId !== "t2")).toBe(true);
  });
});

// -------------------------------------------------------------------------
// YAML corpus cross-check
// -------------------------------------------------------------------------

describe("YAML golden-task corpus", () => {
  const tasksDir = resolve(__dirname, "../../../tests/golden/tasks");

  function listYamlFiles(): string[] {
    return readdirSync(tasksDir).filter((name) => name.endsWith(".yaml"));
  }

  it("generated module count matches the YAML file count on disk", () => {
    const onDisk = listYamlFiles().length;
    expect(YAML_GOLDEN_TASK_COUNT).toBe(onDisk);
  });

  it("generated module lists the same number of ids as the count", () => {
    expect(YAML_GOLDEN_TASK_IDS).toHaveLength(YAML_GOLDEN_TASK_COUNT);
  });

  it("every id appears in a file named <id>.yaml", () => {
    const files = new Set(listYamlFiles());
    for (const id of YAML_GOLDEN_TASK_IDS) {
      expect(files).toContain(`${id}.yaml`);
    }
  });

  it("id set has no duplicates", () => {
    const unique = new Set(YAML_GOLDEN_TASK_IDS);
    expect(unique.size).toBe(YAML_GOLDEN_TASK_IDS.length);
  });
});
