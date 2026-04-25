import type { SessionMetrics } from "../observability/MetricsCollector.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GoldenTaskCategory =
  | "file_ops"
  | "code_gen"
  | "refactor"
  | "debug"
  | "test_gen"
  | "multi_file";

export interface GoldenTaskExpectation {
  readonly filesModified?: readonly string[];
  readonly filesCreated?: readonly string[];
  readonly outputContains?: readonly string[];
  readonly maxToolCalls?: number;
  readonly maxDurationMs?: number;
  readonly mustPass?: boolean;
}

export interface GoldenTask {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: GoldenTaskCategory;
  readonly input: string;
  readonly expectedOutcome: GoldenTaskExpectation;
  readonly timeoutMs: number;
}

export interface GoldenTaskResult {
  readonly taskId: string;
  readonly passed: boolean;
  readonly traceId: string;
  readonly metrics: SessionMetrics;
  readonly failures: readonly string[];
  readonly durationMs: number;
}

export interface RegressionReport {
  readonly taskId: string;
  readonly field: string;
  readonly previous: number;
  readonly current: number;
  readonly delta: number;
  readonly regression: boolean;
}

// ---------------------------------------------------------------------------
// Default golden tasks. The full 24-task YAML-driven suite lives under
// `tests/golden/tasks/`; this in-process list is the minimal smoke set used
// when the YAML harness is not loaded (e.g. quick CI checks).
// ---------------------------------------------------------------------------

export const GOLDEN_TASKS: readonly GoldenTask[] = [
  {
    id: "gt-file-read",
    name: "Read and summarize a file",
    description: "Read a source file and produce a one-paragraph summary of its purpose.",
    category: "file_ops",
    input: "Read src/extension.ts and summarize what it does in one paragraph.",
    expectedOutcome: {
      maxToolCalls: 5,
      maxDurationMs: 30_000,
      mustPass: true,
    },
    timeoutMs: 60_000,
  },
  {
    id: "gt-code-gen",
    name: "Create a new TypeScript module with exports",
    description: "Generate a new TypeScript module with at least one exported function and type.",
    category: "code_gen",
    input: "Create a new file src/utils/slug.ts that exports a slugify(text: string): string function.",
    expectedOutcome: {
      filesCreated: ["src/utils/slug.ts"],
      maxToolCalls: 10,
      maxDurationMs: 60_000,
      mustPass: true,
    },
    timeoutMs: 120_000,
  },
  {
    id: "gt-refactor",
    name: "Add error handling to an existing function",
    description: "Wrap an existing function body in try-catch with appropriate error handling.",
    category: "refactor",
    input: "Add error handling to the execute method in src/tools/ToolRegistry.ts.",
    expectedOutcome: {
      filesModified: ["src/tools/ToolRegistry.ts"],
      maxToolCalls: 10,
      maxDurationMs: 60_000,
    },
    timeoutMs: 120_000,
  },
  {
    id: "gt-debug",
    name: "Find and explain a bug in code",
    description: "Analyze a function and identify a potential bug, explaining the issue and fix.",
    category: "debug",
    input: "Look at the deleteOlderThan method in src/observability/TraceStore.ts and explain any edge cases.",
    expectedOutcome: {
      maxToolCalls: 5,
      maxDurationMs: 30_000,
    },
    timeoutMs: 60_000,
  },
  {
    id: "gt-test-gen",
    name: "Generate unit tests for a utility function",
    description: "Write Vitest unit tests for an existing utility function.",
    category: "test_gen",
    input: "Generate unit tests for the computeSessionMetrics method in src/observability/MetricsCollector.ts.",
    expectedOutcome: {
      maxToolCalls: 15,
      maxDurationMs: 90_000,
      mustPass: true,
    },
    timeoutMs: 180_000,
  },
];

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateExpectation(
  result: GoldenTaskResult,
  expectation: GoldenTaskExpectation,
): string[] {
  const failures: string[] = [];

  if (
    expectation.maxToolCalls !== undefined &&
    result.metrics.toolStepCount > expectation.maxToolCalls
  ) {
    failures.push(
      `Tool calls exceeded: ${result.metrics.toolStepCount} > ${expectation.maxToolCalls}`,
    );
  }

  if (
    expectation.maxDurationMs !== undefined &&
    result.durationMs > expectation.maxDurationMs
  ) {
    failures.push(
      `Duration exceeded: ${result.durationMs}ms > ${expectation.maxDurationMs}ms`,
    );
  }

  if (expectation.mustPass === true && !result.passed) {
    failures.push("Task marked mustPass but did not pass.");
  }

  return failures;
}

export function detectRegressions(
  previous: readonly GoldenTaskResult[],
  current: readonly GoldenTaskResult[],
  thresholdPct = 20,
): RegressionReport[] {
  const reports: RegressionReport[] = [];
  const prevMap = new Map(previous.map((r) => [r.taskId, r]));

  for (const curr of current) {
    const prev = prevMap.get(curr.taskId);
    if (!prev) continue;

    const fields: Array<{ field: string; prev: number; curr: number }> = [
      { field: "durationMs", prev: prev.durationMs, curr: curr.durationMs },
      {
        field: "toolStepCount",
        prev: prev.metrics.toolStepCount,
        curr: curr.metrics.toolStepCount,
      },
    ];

    for (const { field, prev: p, curr: c } of fields) {
      if (p === 0) continue;
      const delta = ((c - p) / p) * 100;
      const regression = delta > thresholdPct;
      if (regression) {
        reports.push({
          taskId: curr.taskId,
          field,
          previous: p,
          current: c,
          delta,
          regression,
        });
      }
    }

    // Pass/fail regression
    if (prev.passed && !curr.passed) {
      reports.push({
        taskId: curr.taskId,
        field: "passed",
        previous: 1,
        current: 0,
        delta: -100,
        regression: true,
      });
    }
  }

  return reports;
}
