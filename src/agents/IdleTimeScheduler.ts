/**
 * v0.9.0 Phase 6.1 -- idle-time scheduler subsystem.
 *
 * Replaces the v0.8.0 approximated edit-trigger gating (used by the curator
 * worker via a 12 h minimum-interval cooldown) with a real timer-driven
 * scheduler shared between any worker that should fire only when the user
 * has been idle long enough to absorb the work.
 *
 * Design:
 *   - The scheduler tracks the wall-clock timestamp of the most recent user
 *     activity (text-document change + active-editor change in VSCode).
 *   - Registered tasks fire when both gates are satisfied:
 *       (a) `now - lastUserActivity >= idleThresholdMs` (idle long enough)
 *       (b) `now - lastRun >= cadenceMs`                (cadence satisfied)
 *   - The scheduler does not touch the LLM; tasks are arbitrary async
 *     callbacks and the scheduler simply awaits them in registration order.
 *
 * Audit / testgaps workers stay on their existing post-N-edits trigger
 * because they ARE edit-driven; only cadence-driven workers (curator +
 * reflect today) register here.
 *
 * The scheduler is constructed with injectable VSCode hooks so tests can
 * drive timers + activity events without a real VSCode runtime.
 */

import { getLogger } from "../../modules/coding/utils/logger.js";
import { formatForLog } from "../../modules/coding/utils/errors.js";

export interface IdleScheduledTask {
  /** Unique key used for registration replacement + debug logging. */
  readonly id: string;
  /** Milliseconds of user inactivity required before the task may fire. */
  readonly idleThresholdMs: number;
  /** Minimum milliseconds between successive runs (cadence gate). */
  readonly cadenceMs: number;
  /**
   * The work itself. Returning a rejected promise is logged but does not
   * crash the scheduler; the cadence cursor is advanced only on a resolved
   * promise so failed runs naturally retry on the next tick.
   */
  run(): Promise<void>;
}

export interface IdleActivitySubscription {
  dispose(): void;
}

export interface IdleActivitySource {
  /** Subscribe to text-document change events. Returns a disposable. */
  onDidChangeTextDocument(listener: () => void): IdleActivitySubscription;
  /** Subscribe to active-editor change events. Returns a disposable. */
  onDidChangeActiveTextEditor(listener: () => void): IdleActivitySubscription;
}

export interface IdleTimeSchedulerOptions {
  /** Tick interval in ms; defaults to 30 s. */
  readonly tickIntervalMs?: number;
  /** Injectable clock; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Injectable timer; defaults to `setInterval` / `clearInterval`. */
  readonly setInterval?: (cb: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  /** Injectable activity source; defaults to a no-op (manual `notifyActivity`). */
  readonly activitySource?: IdleActivitySource | null;
}

const DEFAULT_TICK_MS = 30_000;

interface TaskState {
  readonly task: IdleScheduledTask;
  lastRunAt: number;
}

export class IdleTimeScheduler {
  private readonly _now: () => number;
  private readonly _setInterval: (cb: () => void, ms: number) => unknown;
  private readonly _clearInterval: (handle: unknown) => void;
  private readonly _tickIntervalMs: number;

  private _tasks = new Map<string, TaskState>();
  private _lastUserActivity: number;
  private _tickHandle: unknown = null;
  private _running = false;
  private _activitySubs: IdleActivitySubscription[] = [];

  constructor(options: IdleTimeSchedulerOptions = {}) {
    this._now = options.now ?? Date.now;
    this._setInterval = options.setInterval ?? ((cb, ms) => setInterval(cb, ms));
    this._clearInterval = options.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    this._tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_MS;
    this._lastUserActivity = this._now();

    if (options.activitySource) {
      this._activitySubs.push(
        options.activitySource.onDidChangeTextDocument(() => this.notifyActivity()),
        options.activitySource.onDidChangeActiveTextEditor(() => this.notifyActivity()),
      );
    }
  }

  /** Register (or replace) a task by id. Idempotent. */
  register(task: IdleScheduledTask): void {
    if (task.idleThresholdMs < 0 || task.cadenceMs < 0) {
      throw new Error(
        `IdleTimeScheduler.register: negative thresholds rejected (id=${task.id}).`,
      );
    }
    this._tasks.set(task.id, { task, lastRunAt: 0 });
  }

  /** Remove a task by id. */
  unregister(id: string): void {
    this._tasks.delete(id);
  }

  /** Number of registered tasks (test surface). */
  size(): number {
    return this._tasks.size;
  }

  /** Mark the user as having interacted "now". Resets the idle clock. */
  notifyActivity(): void {
    this._lastUserActivity = this._now();
  }

  /** Epoch ms of the most recent recorded user activity (test surface). */
  lastUserActivityAt(): number {
    return this._lastUserActivity;
  }

  /** Start the periodic tick. Idempotent. */
  start(): void {
    if (this._tickHandle !== null) return;
    this._tickHandle = this._setInterval(() => {
      void this.tick();
    }, this._tickIntervalMs);
  }

  /** Stop the periodic tick + drop activity subscriptions. */
  stop(): void {
    if (this._tickHandle !== null) {
      this._clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
    for (const sub of this._activitySubs) {
      try {
        sub.dispose();
      } catch {
        // ignore -- disposal is best-effort
      }
    }
    this._activitySubs = [];
  }

  /**
   * Evaluate every registered task and run those whose gates are
   * satisfied. Exposed for tests to drive the scheduler deterministically
   * without waiting for `setInterval` to fire.
   */
  async tick(): Promise<void> {
    if (this._running) return;
    this._running = true;
    try {
      const now = this._now();
      const idle = now - this._lastUserActivity;
      for (const state of this._tasks.values()) {
        const { task, lastRunAt } = state;
        if (idle < task.idleThresholdMs) continue;
        if (lastRunAt > 0 && now - lastRunAt < task.cadenceMs) continue;
        try {
          await task.run();
          state.lastRunAt = this._now();
        } catch (err) {
          getLogger().debug(
            `[IdleTimeScheduler] task '${task.id}' threw; cadence cursor not advanced:`,
            formatForLog(err),
          );
        }
      }
    } finally {
      this._running = false;
    }
  }
}
