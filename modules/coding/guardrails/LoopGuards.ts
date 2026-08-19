import { createHash } from "crypto";
import type { ToolCall } from "../../../src/tools/types.js";
import { LoopDetector } from "./LoopDetector.js";
import type { LoopVerdict } from "./LoopDetector.js";

/**
 * Unified loop-guard layer (v1.19.1 Phase 2.2).
 *
 * Wraps {@link LoopDetector} rather than duplicating its hash window, and adds
 * four named circuit breakers plus a hard iteration ceiling. All thresholds
 * live in {@link DEFAULT_LOOP_GUARDS} so tests and production share one knob.
 *
 * Iteration ceiling justification: local models plus four breakers. 60 is 2x
 * the previous strong-tier session default (30 in HardwareTier id 3) so a long
 * coding task can finish. It is far below Hermes Herald's 500 because a stuck
 * local loop would burn GPU for hours; the other guards (identical-call,
 * no-action, error-burst, bounded queue) are expected to trip first.
 */

export const HARD_AGENT_ITERATION_CEILING = 60;

export type LoopGuardName =
  | "identical-call"
  | "no-action"
  | "error-burst"
  | "bounded-queue"
  | "iteration-ceiling";

export interface LoopGuardsConfig {
  /**
   * Abort after this many consecutive identical tool calls (Atomic N=5).
   * Consecutive, not window-count: five of the same call in a row, even if
   * the LoopDetector window would have already warned.
   */
  readonly identicalCallConsecutive?: number;
  /** Cap consecutive iterations that emit no tool call (Airi no-action). */
  readonly noActionBudget?: number;
  /** Halt after this many consecutive tool errors (Airi error-burst). */
  readonly errorBurst?: number;
  /** In-flight cap. AgentLoop is sequential, so this stays 1. */
  readonly maxExecuting?: number;
  /** Pending actions that may wait behind the in-flight one (Airi 4). */
  readonly maxPending?: number;
  /** Hard iteration ceiling; see HARD_AGENT_ITERATION_CEILING. */
  readonly maxIterations?: number;
}

export const DEFAULT_LOOP_GUARDS: Required<LoopGuardsConfig> = {
  identicalCallConsecutive: 5,
  noActionBudget: 3,
  errorBurst: 4,
  maxExecuting: 1,
  maxPending: 4,
  maxIterations: HARD_AGENT_ITERATION_CEILING,
};

export interface LoopGuardVerdict {
  readonly action: "ok" | "warn" | "halt";
  readonly guard?: LoopGuardName;
  readonly message?: string;
}

export interface QueueAdmitResult {
  readonly admitted: number;
  readonly dropped: number;
  readonly verdict: LoopGuardVerdict;
}

function hashCall(call: ToolCall): string {
  const params = { ...call.parameters } as Record<string, unknown>;
  delete params.id;
  delete params._callId;
  const payload = JSON.stringify({ tool: call.tool, parameters: params });
  return createHash("sha256").update(payload).digest("hex");
}

function halt(guard: LoopGuardName, message: string): LoopGuardVerdict {
  return { action: "halt", guard, message };
}

function warn(guard: LoopGuardName, message: string): LoopGuardVerdict {
  return { action: "warn", guard, message };
}

const OK: LoopGuardVerdict = { action: "ok" };

/**
 * Circuit-breaker bundle for auto-mode AgentLoop runs. Halt reasons are
 * user-facing; callers must leave conversation history in place so the
 * session stays recoverable.
 */
export class LoopGuards {
  private readonly _cfg: Required<LoopGuardsConfig>;
  private readonly _detector: LoopDetector;
  private _lastHash: string | null = null;
  private _identicalStreak = 0;
  private _noActionStreak = 0;
  private _errorStreak = 0;
  private _iterations = 0;

  constructor(config: LoopGuardsConfig = {}, detector?: LoopDetector) {
    this._cfg = { ...DEFAULT_LOOP_GUARDS, ...config };
    this._detector =
      detector ??
      new LoopDetector({
        windowSize: this._cfg.identicalCallConsecutive,
        repeatThreshold: this._cfg.identicalCallConsecutive,
      });
  }

  /** Config snapshot (tests + settings UI). */
  get config(): Required<LoopGuardsConfig> {
    return this._cfg;
  }

  reset(): void {
    this._detector.reset();
    this._lastHash = null;
    this._identicalStreak = 0;
    this._noActionStreak = 0;
    this._errorStreak = 0;
    this._iterations = 0;
  }

  /**
   * Count one agent iteration against the hard ceiling. Call at the start of
   * each loop body. Does not replace AgentLoop's own maxIterations clamp;
   * this is the belt that keeps a mis-set setting from running away.
   */
  recordIteration(): LoopGuardVerdict {
    this._iterations += 1;
    if (this._iterations > this._cfg.maxIterations) {
      return halt(
        "iteration-ceiling",
        `Agent loop reached the hard ceiling of ${this._cfg.maxIterations} iterations and stopped. The session is still open; send another message to continue.`,
      );
    }
    return OK;
  }

  /**
   * Record a tool call for the identical-call veto. Consecutive identical
   * payloads abort at N; N-1 warns so the model can vary its approach.
   * Also feeds {@link LoopDetector} so existing window semantics stay intact.
   */
  recordToolCall(call: ToolCall): LoopGuardVerdict {
    this._noActionStreak = 0;
    const digest = hashCall(call);
    if (digest === this._lastHash) {
      this._identicalStreak += 1;
    } else {
      this._identicalStreak = 1;
      this._lastHash = digest;
    }

    const detectorVerdict: LoopVerdict = this._detector.record(call);
    if (this._identicalStreak >= this._cfg.identicalCallConsecutive) {
      return halt(
        "identical-call",
        `Identical-call veto: tool "${call.tool}" was invoked ${this._identicalStreak} times in a row with the same arguments. Terminating this turn. The session is still open.`,
      );
    }
    if (this._identicalStreak === this._cfg.identicalCallConsecutive - 1) {
      return warn(
        "identical-call",
        `Possible loop: tool "${call.tool}" called identically ${this._identicalStreak} times in a row. Vary your approach or the loop will be terminated.`,
      );
    }
    if (detectorVerdict.action === "terminate") {
      return halt(
        "identical-call",
        detectorVerdict.message ??
          `Loop detected on tool "${call.tool}". Terminating this turn. The session is still open.`,
      );
    }
    if (detectorVerdict.action === "warn") {
      return warn("identical-call", detectorVerdict.message ?? "Repeated tool calls detected.");
    }
    return OK;
  }

  /** Count a tool-less thinking turn toward the no-action budget. */
  recordNoAction(): LoopGuardVerdict {
    this._noActionStreak += 1;
    if (this._noActionStreak >= this._cfg.noActionBudget) {
      return halt(
        "no-action",
        `No-action budget exhausted: ${this._noActionStreak} consecutive turns produced no tool call. Terminating this turn. The session is still open.`,
      );
    }
    return OK;
  }

  /** Count a tool outcome toward the error-burst guard. Success resets the streak. */
  recordToolOutcome(success: boolean): LoopGuardVerdict {
    if (success) {
      this._errorStreak = 0;
      return OK;
    }
    this._errorStreak += 1;
    if (this._errorStreak >= this._cfg.errorBurst) {
      return halt(
        "error-burst",
        `Error-burst guard: ${this._errorStreak} consecutive tool errors. Terminating this turn. The session is still open.`,
      );
    }
    return OK;
  }

  /**
   * Cap a batch of pending tool calls at maxExecuting + maxPending. AgentLoop
   * is sequential (maxExecuting=1), so a model that emits 10 calls in one
   * turn keeps the first 5 and is told the rest were dropped.
   */
  admit(pendingCount: number): QueueAdmitResult {
    const cap = this._cfg.maxExecuting + this._cfg.maxPending;
    if (pendingCount <= cap) {
      return { admitted: pendingCount, dropped: 0, verdict: OK };
    }
    const dropped = pendingCount - cap;
    return {
      admitted: cap,
      dropped,
      verdict: warn(
        "bounded-queue",
        `Bounded action queue: keeping ${cap} of ${pendingCount} tool calls this turn (1 executing + ${this._cfg.maxPending} pending). ${dropped} call(s) were dropped; retry them on the next turn if still needed.`,
      ),
    };
  }
}

/** Clamp a requested iteration count to the hard ceiling (never raises it). */
export function clampAgentIterations(requested: number): number {
  if (!Number.isFinite(requested)) return DEFAULT_LOOP_GUARDS.maxIterations;
  return Math.min(Math.max(0, Math.floor(requested)), HARD_AGENT_ITERATION_CEILING);
}
