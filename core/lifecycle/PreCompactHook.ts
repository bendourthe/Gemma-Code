/**
 * v1.4.0 Phase 5 (A8) -- PreCompact work-in-progress detection + checkpoint.
 *
 * Adopts claude-code-harness `hooks.json` PreCompact/PostCompact handlers
 * (re-full): before the agent compacts its context window, warn the operator
 * when there is in-flight work that the compaction might bury, and persist a
 * checkpoint the post-compaction path can restore from.
 *
 * Wiring: this hook subscribes to the EXISTING `lifecycle.context.preCompact`
 * event on the 13-event `HookBus` (see HookBus.ts) -- it does not add a new
 * event kind. On that event it:
 *   1. detects work-in-progress (uncommitted git edits + caller-supplied
 *      in-flight tasks),
 *   2. writes a JSON checkpoint to `<nexusHome>/checkpoints/<sessionId>.json`
 *      capturing the before/after token counts and the WIP snapshot, and
 *   3. when WIP is present, emits a NON-BLOCKING `lifecycle.notification`
 *      (severity "warning") back onto the same bus.
 *
 * The warning is advisory only: emitting a notification does not and cannot
 * cancel the compaction -- the bus is fire-and-forget. The checkpoint is the
 * "PostCompact can restore" half: a post-compaction caller reads it back with
 * `readCompactionCheckpoint(sessionId)` to recover the WIP context the
 * compaction may have summarized away. The hook never throws; a failure in
 * detection, the checkpoint write, or the notification must not take down the
 * daemon's compaction path.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { nexusHome } from "../storage/paths.js";
import type { Disposable } from "../telemetry/TelemetryBus.js";
import type { HookBus, LifecycleContextPreCompactEvent } from "./HookBus.js";

/** A point-in-time snapshot of in-flight work at compaction time. */
export interface WipState {
  /** Repo-relative paths with uncommitted changes (from `git status`). */
  readonly uncommittedFiles: readonly string[];
  /** Caller-supplied descriptions of tasks still running. */
  readonly inFlightTasks: readonly string[];
  /** True when any WIP source is non-empty. */
  readonly hasWip: boolean;
}

/** The persisted, restorable checkpoint written on each PreCompact event. */
export interface CompactionCheckpoint {
  readonly sessionId: string;
  readonly isoTime: string;
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly wip: WipState;
}

export interface PreCompactHookOptions {
  /** Override the nexus-home dir (test injection). */
  readonly homeDir?: string;
  /** Working directory used for the default git-status probe. Default cwd. */
  readonly cwd?: string;
  /** Injected git-status probe; returns `git status --porcelain` text. */
  readonly gitStatus?: (cwd: string) => string;
  /** Injected provider of in-flight task descriptions. Default: none. */
  readonly inFlightTasks?: () => readonly string[];
  /** Injected file writer (test injection). */
  readonly writeFile?: (filePath: string, content: string) => void;
  /** Injected directory creator (test injection). */
  readonly mkdir?: (dirPath: string) => void;
  /** Injected clock (test injection). */
  readonly now?: () => Date;
  /** Cap on how many file paths the warning message lists. Default 10. */
  readonly maxSampleFiles?: number;
}

const DEFAULT_MAX_SAMPLE_FILES = 10;
const CHECKPOINT_DIRNAME = "checkpoints";

/**
 * Default git-status probe. Returns the porcelain output, or "" when the
 * working dir is not a git repo or git is unavailable (both non-fatal).
 */
function defaultGitStatus(cwd: string): string {
  try {
    return execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

/**
 * Parse `git status --porcelain` output into the list of changed paths.
 * Strips the two-column status code, handles quoted paths, and resolves
 * the `old -> new` rename form to the new path. Pure.
 */
export function parseGitStatus(porcelain: string): string[] {
  const out: string[] = [];
  for (const raw of porcelain.split(/\r?\n/)) {
    if (!raw || raw.trim().length === 0) continue;
    // Porcelain v1: "XY <path>" or "XY <old> -> <new>".
    let rest = raw.slice(3);
    const arrow = rest.indexOf(" -> ");
    if (arrow !== -1) rest = rest.slice(arrow + 4);
    rest = rest.trim();
    // Unquote git's C-style quoting for paths with special chars.
    if (rest.startsWith('"') && rest.endsWith('"')) {
      rest = rest.slice(1, -1);
    }
    if (rest.length > 0) out.push(rest);
  }
  return out;
}

/**
 * Detect work-in-progress from uncommitted git edits and any caller-supplied
 * in-flight tasks. Never throws: a failing git probe degrades to "no
 * uncommitted files" rather than aborting the compaction path.
 */
export function detectWip(opts: PreCompactHookOptions = {}): WipState {
  const cwd = opts.cwd ?? process.cwd();
  const gitStatus = opts.gitStatus ?? defaultGitStatus;
  const inFlightTasksFn = opts.inFlightTasks ?? (() => []);

  let uncommittedFiles: string[] = [];
  try {
    uncommittedFiles = parseGitStatus(gitStatus(cwd));
  } catch {
    uncommittedFiles = [];
  }
  let inFlightTasks: readonly string[] = [];
  try {
    inFlightTasks = inFlightTasksFn();
  } catch {
    inFlightTasks = [];
  }

  return {
    uncommittedFiles,
    inFlightTasks,
    hasWip: uncommittedFiles.length > 0 || inFlightTasks.length > 0,
  };
}

/** Build the checkpoint from a PreCompact event and a WIP snapshot. Pure. */
export function buildCheckpoint(
  event: LifecycleContextPreCompactEvent,
  wip: WipState,
  isoTime: string,
): CompactionCheckpoint {
  return {
    sessionId: event.sessionId,
    isoTime,
    beforeTokens: event.beforeTokens,
    afterTokens: event.afterTokens,
    wip,
  };
}

/** Render the non-blocking warning message for a WIP snapshot. Pure. */
export function renderWipWarning(
  wip: WipState,
  maxSampleFiles: number = DEFAULT_MAX_SAMPLE_FILES,
): string {
  const parts: string[] = [];
  parts.push(
    "Context compaction is about to run with work in progress; recent detail may be summarized away.",
  );
  if (wip.uncommittedFiles.length > 0) {
    const sample = wip.uncommittedFiles.slice(0, maxSampleFiles);
    const more = wip.uncommittedFiles.length - sample.length;
    parts.push(
      `Uncommitted edits (${wip.uncommittedFiles.length}): ${sample.join(", ")}${more > 0 ? `, +${more} more` : ""}.`,
    );
  }
  if (wip.inFlightTasks.length > 0) {
    parts.push(`In-flight tasks (${wip.inFlightTasks.length}): ${wip.inFlightTasks.join("; ")}.`);
  }
  parts.push("A checkpoint was saved; post-compaction restore is available.");
  return parts.join(" ");
}

/** Absolute path of the checkpoint file for a session. */
export function checkpointPath(sessionId: string, homeDir: string = nexusHome()): string {
  return path.join(homeDir, CHECKPOINT_DIRNAME, `${sessionId}.json`);
}

/**
 * Read back the checkpoint persisted on the matching PreCompact event. This
 * is the PostCompact restore primitive: a post-compaction caller invokes it
 * to recover the WIP context the compaction may have buried. Returns `null`
 * when no checkpoint exists or it cannot be parsed (never throws).
 */
export function readCompactionCheckpoint(
  sessionId: string,
  opts: { homeDir?: string; readFile?: (p: string) => string } = {},
): CompactionCheckpoint | null {
  const home = opts.homeDir ?? nexusHome();
  const readFile = opts.readFile ?? ((p) => fs.readFileSync(p, "utf-8"));
  try {
    const raw = readFile(checkpointPath(sessionId, home));
    const parsed = JSON.parse(raw) as CompactionCheckpoint;
    if (!parsed || typeof parsed.sessionId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Subscribe the PreCompact WIP hook to a `HookBus`. Returns a `Disposable`
 * that unsubscribes on dispose. On every `lifecycle.context.preCompact`
 * event the hook persists a checkpoint and, when WIP is present, emits a
 * non-blocking `lifecycle.notification` warning. The compaction is never
 * blocked or delayed: the bus is fire-and-forget and every failure mode is
 * swallowed.
 */
export function attachPreCompactWipHook(
  bus: HookBus,
  opts: PreCompactHookOptions = {},
): Disposable {
  const home = opts.homeDir ?? nexusHome();
  const writeFile = opts.writeFile ?? ((p, c) => fs.writeFileSync(p, c, "utf-8"));
  const mkdir = opts.mkdir ?? ((d) => fs.mkdirSync(d, { recursive: true }));
  const now = opts.now ?? (() => new Date());
  const maxSampleFiles = opts.maxSampleFiles ?? DEFAULT_MAX_SAMPLE_FILES;

  return bus.on("lifecycle.context.preCompact", (event) => {
    try {
      const wip = detectWip(opts);
      const checkpoint = buildCheckpoint(event, wip, now().toISOString());

      // Persist the checkpoint regardless of WIP so the post-compaction path
      // always has a token-context anchor to restore from.
      try {
        const dir = path.join(home, CHECKPOINT_DIRNAME);
        mkdir(dir);
        writeFile(checkpointPath(event.sessionId, home), JSON.stringify(checkpoint, null, 2));
      } catch {
        // Checkpoint persistence is best-effort; fall through to the warning.
      }

      // Warn only when there is in-flight work to flag. The notification is
      // advisory: it cannot and must not cancel the compaction.
      if (wip.hasWip) {
        bus.emit({
          kind: "lifecycle.notification",
          notificationKind: "context.preCompact.wip",
          message: renderWipWarning(wip, maxSampleFiles),
          severity: "warning",
        });
      }
    } catch {
      // The hook MUST NOT take down the daemon's compaction path.
    }
  });
}
