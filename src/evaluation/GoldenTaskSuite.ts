import type { SessionMetrics } from "../observability/MetricsCollector.js";
import {
  defaultFeatureListPath,
  loadFeatureList,
  markPassing,
  saveFeatureList,
  type FeatureList,
} from "./FeatureList.js";

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
// v0.8.0 Phase 2 (item C1) -- feature_list.json stamp wiring.
//
// Maps the in-process golden task ids to the feature_list.json row they
// verify. When a golden task passes we mark the matching feature row as
// `passing` so the file self-updates as the suite runs.
//
// The YAML-driven golden runner (Python -- see ADR-0017) can call the same
// helper via the JSON contract `node -e "require('./out/evaluation/...').stampGoldenTaskPass('gt-file-read', 'feature_list.json')"`.
// ---------------------------------------------------------------------------

const GOLDEN_TASK_TO_FEATURE_ID: Readonly<Record<string, string>> = {
  "gt-file-read": "f005",
  "gt-code-gen": "f002",
  "gt-refactor": "f002",
  "gt-debug": "f002",
  "gt-test-gen": "f002",
};

/**
 * Flip the feature row matching `taskId` to `passing` and persist the list.
 * Returns `true` when a row was updated, `false` when no mapping or feature
 * row exists. Errors (file missing, parse failure) propagate to the caller
 * so the runner can decide whether to fail the suite or warn.
 *
 * `listPath` defaults to the project's `feature_list.json` at the supplied
 * `repoRoot`. The `now` option is exposed for deterministic tests.
 */
export function stampGoldenTaskPass(
  taskId: string,
  repoRoot: string,
  options: { listPath?: string; now?: Date } = {},
): boolean {
  const featureId = GOLDEN_TASK_TO_FEATURE_ID[taskId];
  if (!featureId) return false;
  const listPath = options.listPath ?? defaultFeatureListPath(repoRoot);
  const list: FeatureList = loadFeatureList(listPath);
  const changed = markPassing(list, featureId, { now: options.now });
  if (changed) saveFeatureList(listPath, list);
  return changed;
}

/** Exposed for tests + future runner integrations. */
export function getGoldenTaskFeatureId(taskId: string): string | undefined {
  return GOLDEN_TASK_TO_FEATURE_ID[taskId];
}

