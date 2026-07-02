// ---------------------------------------------------------------------------
// v1.7.0 Phase 1 (adoption-self-optimizing-skills S1 / SO001) -- declarative
// success-criteria evaluator for the golden task suite.
//
// This is the TS-native port of `tests/golden/framework/evaluator.py`. It
// evaluates a worked-on workspace directory against the declarative
// `success_criteria` documented in `tests/golden/README.md`. It is the
// feedback signal the optimization loop (Phases 2-4) depends on, and it
// re-enables live golden runs that the Python `_run_live()` lost when the
// FastAPI backend was deleted by ADR-0001.
//
// Boundary: this module is strictly vscode-free so it can run in a plain-Node
// CLI / Vitest context (the same constraint that forced the v1.6.0 A4
// `TraceDbReader`). It performs no logging and no outbound call. Command-based
// criteria run through an injected `CommandRunner` so unit tests stay
// deterministic and cross-platform; the default runner shells out locally.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The eight criterion kinds documented in `tests/golden/README.md`. The live
 * corpus uses `file_contains`, `output_contains`, and `file_exists`; the
 * remaining five are ported for completeness so the optimizer loop can score
 * any task the harness can declare.
 */
export type GoldenCriterionType =
  | "file_contains"
  | "file_exists"
  | "file_deleted"
  | "test_passes"
  | "lint_passes"
  | "diff_matches"
  | "output_contains"
  | "no_errors";

/** A single declarative pass/fail criterion for a golden task. */
export interface GoldenSuccessCriterion {
  readonly type: GoldenCriterionType;
  /** File path (file_* types) or shell command (*_passes / output_contains / no_errors). */
  readonly target: string;
  /** Regex (literal fallback) to match. Ignored for file_exists / file_deleted. */
  readonly pattern?: string;
  /** Human-readable description, surfaced in failure messages. */
  readonly description?: string;
}

/** The outcome of evaluating one criterion. */
export interface CriterionOutcome {
  readonly criterion: GoldenSuccessCriterion;
  readonly passed: boolean;
  /** Diagnostic detail (matched pattern, command exit code, missing path). */
  readonly detail: string;
}

/** Captured result of running a shell command for a command-based criterion. */
export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/**
 * Runs a shell command in `cwd` and returns its captured result. Injected so
 * unit tests can drive the command-based criteria deterministically without
 * spawning real shells (and without depending on unix tools like `grep` that
 * are absent on Windows CI). The default runner shells out locally.
 */
export type CommandRunner = (command: string, cwd: string) => CommandResult | Promise<CommandResult>;

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Default command runner: a local shell with a hard timeout, mirroring the
 * Python evaluator's `subprocess.run(..., shell=True, timeout=60)`. Never
 * throws -- a missing binary, non-zero exit, or timeout is surfaced as a
 * `CommandResult` so a single misbehaving criterion never aborts evaluation.
 */
export function defaultCommandRunner(command: string, cwd: string): CommandResult {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout: DEFAULT_COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER,
  });
  const timedOut = result.error !== undefined && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  // `status` is null when the process was killed (e.g. by the timeout) or
  // failed to spawn; treat that as a non-zero exit so command-success
  // criteria fail closed.
  const code = result.status ?? (timedOut ? 124 : -1);
  return {
    code,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut,
  };
}

/**
 * Match `pattern` against `text` as a multiline regex, falling back to a
 * literal substring search when the pattern is not a valid regex. Mirrors the
 * Python evaluator's `re.search(..., re.MULTILINE)` with a `pattern in content`
 * fallback. An empty pattern matches any text.
 */
function matchesPattern(pattern: string, text: string): boolean {
  if (pattern.length === 0) return true;
  try {
    return new RegExp(pattern, "m").test(text);
  } catch {
    return text.includes(pattern);
  }
}

function evalFileExists(workdir: string, criterion: GoldenSuccessCriterion): CriterionOutcome {
  const p = path.join(workdir, criterion.target);
  const exists = fs.existsSync(p);
  return { criterion, passed: exists, detail: `path ${p}` };
}

function evalFileDeleted(workdir: string, criterion: GoldenSuccessCriterion): CriterionOutcome {
  const p = path.join(workdir, criterion.target);
  const exists = fs.existsSync(p);
  return { criterion, passed: !exists, detail: `path ${p}` };
}

function evalFileContains(workdir: string, criterion: GoldenSuccessCriterion): CriterionOutcome {
  const p = path.join(workdir, criterion.target);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    return { criterion, passed: false, detail: `file missing: ${p}` };
  }
  const content = fs.readFileSync(p, "utf8");
  const pattern = criterion.pattern ?? "";
  return {
    criterion,
    passed: matchesPattern(pattern, content),
    detail: `pattern ${JSON.stringify(pattern)} in ${path.basename(p)}`,
  };
}

async function evalOutputContains(
  workdir: string,
  criterion: GoldenSuccessCriterion,
  runCommand: CommandRunner,
): Promise<CriterionOutcome> {
  const result = await runCommand(criterion.target, workdir);
  if (result.timedOut) {
    return { criterion, passed: false, detail: "command timed out" };
  }
  const combined = result.stdout + result.stderr;
  const pattern = criterion.pattern ?? "";
  return {
    criterion,
    passed: matchesPattern(pattern, combined),
    detail: `command exit=${result.code}`,
  };
}

async function evalCommandSucceeds(
  workdir: string,
  criterion: GoldenSuccessCriterion,
  runCommand: CommandRunner,
): Promise<CriterionOutcome> {
  const result = await runCommand(criterion.target, workdir);
  if (result.timedOut) {
    return { criterion, passed: false, detail: "command timed out" };
  }
  return { criterion, passed: result.code === 0, detail: `exit=${result.code}` };
}

async function evalDiffMatches(
  workdir: string,
  criterion: GoldenSuccessCriterion,
  runCommand: CommandRunner,
): Promise<CriterionOutcome> {
  // Diff matching is approximate (as in the Python evaluator): run `git diff`
  // and regex-match its output against the pattern.
  const result = await runCommand("git diff", workdir);
  if (result.timedOut) {
    return { criterion, passed: false, detail: "command timed out" };
  }
  const combined = result.stdout + result.stderr;
  const pattern = criterion.pattern ?? "";
  return {
    criterion,
    passed: matchesPattern(pattern, combined),
    detail: `git diff exit=${result.code}`,
  };
}

/**
 * Evaluate every criterion against `workdir` and return one outcome per
 * criterion (order-preserving). Unknown criterion kinds resolve to a failed
 * outcome rather than throwing, so a malformed task degrades to a recorded
 * failure instead of aborting a batch run.
 */
export async function evaluateCriteria(
  workdir: string,
  criteria: readonly GoldenSuccessCriterion[],
  runCommand: CommandRunner = defaultCommandRunner,
): Promise<CriterionOutcome[]> {
  const outcomes: CriterionOutcome[] = [];
  for (const criterion of criteria) {
    switch (criterion.type) {
      case "file_exists":
        outcomes.push(evalFileExists(workdir, criterion));
        break;
      case "file_deleted":
        outcomes.push(evalFileDeleted(workdir, criterion));
        break;
      case "file_contains":
        outcomes.push(evalFileContains(workdir, criterion));
        break;
      case "output_contains":
        outcomes.push(await evalOutputContains(workdir, criterion, runCommand));
        break;
      case "test_passes":
      case "lint_passes":
      case "no_errors":
        outcomes.push(await evalCommandSucceeds(workdir, criterion, runCommand));
        break;
      case "diff_matches":
        outcomes.push(await evalDiffMatches(workdir, criterion, runCommand));
        break;
      default:
        outcomes.push({
          criterion,
          passed: false,
          detail: `unknown criteria type: ${String((criterion as GoldenSuccessCriterion).type)}`,
        });
    }
  }
  return outcomes;
}

/** True when every criterion in the list passed. An empty list passes. */
export function allPassed(outcomes: readonly CriterionOutcome[]): boolean {
  return outcomes.every((o) => o.passed);
}
