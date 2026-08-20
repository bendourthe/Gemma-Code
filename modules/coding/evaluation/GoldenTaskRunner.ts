// ---------------------------------------------------------------------------
// v1.7.0 Phase 1 (adoption-self-optimizing-skills S1 / SO001) -- TS-native
// golden-task live runner.
//
// Replaces the broken Python `_run_live()` (which posted to the FastAPI
// backend deleted by ADR-0001, so live runs returned "backend call failed").
// For a `GoldenTaskSpec` it: (1) materializes a worktree-isolated copy of the
// snapshot, (2) in live mode drives the Coding-pillar agent loop against the
// task under a per-task timeout, (3) evaluates the resulting workspace against
// the declarative `success_criteria`, and (4) emits a scored `GoldenTaskResult`.
// The dry-run path (snapshot setup + criteria evaluation, no agent) keeps
// working without Ollama for CI.
//
// Boundary: vscode-free. The agent loop and its concrete LLM client are
// vscode-coupled (`ConversationManager`, the logger) and live behind the
// `no-llm-outside-llm-folder` architecture rule, so this runner never imports
// them. It depends on an injected `AgentDriver` -- the same seam the codebase
// already uses for git (`WorktreeManager.GitRunner`) and trace reads
// (`TraceDbReader`). The composition root (desktop / a future CLI) supplies the
// real driver; tests supply a mock. The runner enforces the timeout and owns
// snapshot lifecycle; the driver owns the tool-permission tiers when it runs
// the real loop.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import type { SessionMetrics } from "../observability/MetricsCollector.js";
import type { GoldenTaskResult } from "./GoldenTaskSuite.js";
import type { GoldenTaskSpec } from "./goldenTaskLoader.js";
import {
  allPassed,
  defaultCommandRunner,
  evaluateCriteria,
  type CommandRunner,
  type CriterionOutcome,
} from "./goldenCriteria.js";
import {
  cleanupGoldenSnapshot,
  materializeGoldenSnapshot,
  type GitRunner,
} from "./goldenSnapshot.js";

export type GoldenRunMode = "dry" | "live";

/** What the agent driver reports back after running one task. */
export interface AgentRunOutcome {
  /** Trace id for the run, if the driver instrumented one. */
  readonly traceId?: string;
  /** Session metrics for the run; merged over a zeroed baseline. */
  readonly metrics?: Partial<SessionMetrics>;
  /** Set when the driver itself failed (distinct from a criteria failure). */
  readonly error?: string;
}

/** Context handed to the agent driver for one task run. */
export interface AgentDriverContext {
  readonly task: GoldenTaskSpec;
  /** Absolute path to the isolated working copy the agent should mutate. */
  readonly workdir: string;
  /** Per-task wall-clock budget in milliseconds. */
  readonly timeoutMs: number;
  /** Aborted when the per-task timeout elapses; a cooperative driver should stop. */
  readonly signal: AbortSignal;
}

/**
 * Drives the Coding-pillar agent loop against a prepared task workspace. The
 * real implementation (composition root) wires `AgentLoop` + a concrete
 * `OllamaClient` + the tool registry under the permission tiers; tests inject a
 * mock that mutates the workspace deterministically.
 */
export interface AgentDriver {
  run(ctx: AgentDriverContext): Promise<AgentRunOutcome>;
}

export interface GoldenRunOptions {
  /** "dry" (default): evaluate the untouched snapshot. "live": run the agent. */
  readonly mode?: GoldenRunMode;
  /** Directory holding `<taskId>/` snapshot subdirectories. */
  readonly snapshotRoot: string;
  /** Required in live mode; the agent driver to run the task. */
  readonly driver?: AgentDriver;
  /** Shell runner for command-based criteria (default: a local shell). */
  readonly runCommand?: CommandRunner;
  /** Git runner for snapshot baseline init (default: a local git). */
  readonly gitRunner?: GitRunner;
  /** Parent directory for the throwaway workspace (default: OS temp dir). */
  readonly baseDir?: string;
  /** Initialize a git baseline in the copy (default: true). */
  readonly initGit?: boolean;
  /** Injectable clock for deterministic duration in tests (default: Date.now). */
  readonly now?: () => number;
  /** Retain the workspace after the run for inspection (default: false). */
  readonly keepWorkspace?: boolean;
}

const ZERO_METRICS: SessionMetrics = {
  totalDurationMs: 0,
  toolStepCount: 0,
  llmCallCount: 0,
  retryCount: 0,
  compactionCount: 0,
  humanInterventionCount: 0,
  successRate: 0,
  estimatedTokensUsed: 0,
  subAgentCount: 0,
};

/** A zeroed `SessionMetrics` baseline (exposed for the dry path + tests). */
export function zeroSessionMetrics(): SessionMetrics {
  return { ...ZERO_METRICS };
}

function mergeMetrics(partial: Partial<SessionMetrics> | undefined): SessionMetrics {
  return partial ? { ...ZERO_METRICS, ...partial } : { ...ZERO_METRICS };
}

type TimedResult<T> = { timedOut: true } | { timedOut: false; value: T };

/**
 * Race `factory` against a `timeoutMs` budget. The factory receives an
 * `AbortSignal` so a cooperative driver can stop work when the budget elapses.
 * On timeout the result resolves to `{ timedOut: true }` (the underlying
 * promise is abandoned, not awaited).
 */
async function runWithTimeout<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<TimedResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TimedResult<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ timedOut: true });
    }, timeoutMs);
  });
  try {
    const work = factory(controller.signal).then(
      (value): TimedResult<T> => ({ timedOut: false, value }),
    );
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Build the flat `failures` list for a `GoldenTaskResult`. */
function collectFailures(outcomes: readonly CriterionOutcome[], runError: string | undefined): string[] {
  const failures: string[] = [];
  if (runError) failures.push(`agent: ${runError}`);
  for (const o of outcomes) {
    if (!o.passed) {
      const label = o.criterion.description || o.criterion.type;
      failures.push(`${label} (${o.criterion.type} ${o.criterion.target}): ${o.detail}`);
    }
  }
  return failures;
}

/**
 * Run a single golden task and return its scored result. In "dry" mode the
 * agent is not invoked -- criteria are evaluated against the untouched
 * snapshot, which is expected to fail (the signal that the task was never
 * executed). In "live" mode the injected driver runs the agent under the
 * per-task timeout before evaluation.
 *
 * Never throws on a task-level failure: a missing driver, a driver error, or a
 * timeout is recorded in the result's `failures` with `passed: false`. Only an
 * invalid configuration (missing snapshot) surfaces as a thrown error from
 * snapshot materialization.
 */
export async function runGoldenTask(
  spec: GoldenTaskSpec,
  options: GoldenRunOptions,
): Promise<GoldenTaskResult> {
  const mode = options.mode ?? "dry";
  const now = options.now ?? Date.now;
  const runCommand = options.runCommand ?? defaultCommandRunner;
  const timeoutMs = Math.max(1, spec.timeoutSeconds) * 1000;

  const snapshotDir = path.join(options.snapshotRoot, spec.id);
  const workspace = materializeGoldenSnapshot(snapshotDir, spec.id, {
    baseDir: options.baseDir,
    initGit: options.initGit,
    gitRunner: options.gitRunner,
  });

  const start = now();
  let traceId = "";
  let metrics = zeroSessionMetrics();
  let runError: string | undefined;

  try {
    if (mode === "live") {
      if (!options.driver) {
        runError = "no agent driver provided for live mode";
      } else {
        const driver = options.driver;
        const raced = await runWithTimeout(
          (signal) => driver.run({ task: spec, workdir: workspace.path, timeoutMs, signal }),
          timeoutMs,
        );
        if (raced.timedOut) {
          runError = `task timed out after ${timeoutMs}ms`;
        } else {
          traceId = raced.value.traceId ?? "";
          metrics = mergeMetrics(raced.value.metrics);
          runError = raced.value.error;
        }
      }
    }

    const outcomes = await evaluateCriteria(workspace.path, spec.successCriteria, runCommand);
    const durationMs = now() - start;
    const passed = runError === undefined && allPassed(outcomes);

    return {
      taskId: spec.id,
      passed,
      traceId,
      // Surface the measured wall-clock when the driver did not report its own.
      metrics: metrics.totalDurationMs > 0 ? metrics : { ...metrics, totalDurationMs: durationMs },
      failures: collectFailures(outcomes, runError),
      durationMs,
    };
  } finally {
    if (!options.keepWorkspace) cleanupGoldenSnapshot(workspace);
  }
}

/**
 * v1.19.2 -- K3 determinism-across-budget assertion.
 *
 * Same model, two RAM-budget / offload configurations, byte-identical output.
 * Skip-if-absent when no patient-tier adapter is registered on the host (the
 * offload runtime is user-registered, never bundled).
 */
export interface OffloadBudgetConfig {
  readonly id: string;
  readonly peakRssGB: number;
}

export const DEFAULT_DETERMINISM_BUDGETS: readonly [OffloadBudgetConfig, OffloadBudgetConfig] =
  Object.freeze([
    Object.freeze({ id: "laptop", peakRssGB: 8.24 }),
    Object.freeze({ id: "max", peakRssGB: 224 }),
  ]);

export type DeterminismAcrossBudgetResult =
  | { readonly skipped: true; readonly reason: string }
  | {
      readonly skipped: false;
      readonly identical: boolean;
      readonly outputs: readonly [string, string];
      readonly configs: readonly [OffloadBudgetConfig, OffloadBudgetConfig];
    };

/** True when a patient-tier adapter is registered for this process. */
export function isPatientTierAdapterRegistered(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.NEXUS_PATIENT_TIER_ADAPTER?.trim());
}

export async function runDeterminismAcrossBudget(input: {
  readonly adapterRegistered?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly configs?: readonly [OffloadBudgetConfig, OffloadBudgetConfig];
  readonly generate?: (config: OffloadBudgetConfig) => Promise<string>;
}): Promise<DeterminismAcrossBudgetResult> {
  const registered =
    input.adapterRegistered ?? isPatientTierAdapterRegistered(input.env ?? process.env);
  if (!registered) {
    return {
      skipped: true,
      reason: "no patient-tier adapter registered on this host",
    };
  }
  if (!input.generate) {
    return {
      skipped: true,
      reason: "no patient-tier generate function provided",
    };
  }
  const configs = input.configs ?? DEFAULT_DETERMINISM_BUDGETS;
  const first = await input.generate(configs[0]);
  const second = await input.generate(configs[1]);
  return {
    skipped: false,
    identical: first === second,
    outputs: [first, second],
    configs,
  };
}
