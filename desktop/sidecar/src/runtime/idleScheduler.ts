/**
 * v1.0.0 Phase 3.4 -- sidecar-side IdleTimeScheduler bootstrap.
 *
 * Closes `[v0.9.0:10.N.Q]`. The original `IdleTimeScheduler` ships at
 * `src/agents/IdleTimeScheduler.ts` (VS Code-bound) with full unit-test
 * coverage; this module ports the minimum surface needed for the Node
 * sidecar bootstrap and exposes a `bootstrapIdleScheduler()` factory that
 * the daemon entry point calls after Phase 3.1's session manager comes
 * online. The legacy curator-cadence fallback in
 * `modules/coding/tools/AgentLoop.ts` (today still at
 * `src/tools/AgentLoop.ts`) is slated for removal after the engine's
 * physical move; that deletion is tracked in v1.0.0 known-gaps.
 *
 * The scheduler is deliberately constructed with injectable hooks so that
 * the integration test (`tests/idleScheduler.test.ts`) can drive 30-minute
 * synthetic idle windows in under a millisecond.
 */

export interface IdleScheduledTask {
  readonly id: string;
  readonly idleThresholdMs: number;
  readonly cadenceMs: number;
  run(): Promise<void>;
}

export interface IdleActivitySubscription {
  dispose(): void;
}

export interface IdleActivitySource {
  onActivity(listener: () => void): IdleActivitySubscription;
}

export interface IdleSchedulerOptions {
  readonly tickIntervalMs?: number;
  readonly now?: () => number;
  readonly setInterval?: (cb: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  readonly activitySource?: IdleActivitySource | null;
}

const DEFAULT_TICK_MS = 30_000;
export const CURATOR_TASK_ID = "nexus.coding.curator";
export const REFLECT_TASK_ID = "nexus.coding.reflect";
export const CURATOR_IDLE_MS = 5 * 60_000;
export const CURATOR_CADENCE_MS = 12 * 60 * 60_000;
export const REFLECT_IDLE_MS = 10 * 60_000;
export const REFLECT_CADENCE_MS = 24 * 60 * 60_000;

interface TaskState {
  readonly task: IdleScheduledTask;
  lastRunAt: number;
}

export class IdleScheduler {
  private readonly _now: () => number;
  private readonly _setInterval: (cb: () => void, ms: number) => unknown;
  private readonly _clearInterval: (handle: unknown) => void;
  private readonly _tickIntervalMs: number;
  private _tasks = new Map<string, TaskState>();
  private _lastUserActivity: number;
  private _tickHandle: unknown = null;
  private _running = false;
  private _activitySubs: IdleActivitySubscription[] = [];

  constructor(opts: IdleSchedulerOptions = {}) {
    this._now = opts.now ?? Date.now;
    this._setInterval = opts.setInterval ?? ((cb, ms) => setInterval(cb, ms));
    this._clearInterval =
      opts.clearInterval ??
      ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    this._tickIntervalMs = opts.tickIntervalMs ?? DEFAULT_TICK_MS;
    this._lastUserActivity = this._now();

    if (opts.activitySource) {
      this._activitySubs.push(
        opts.activitySource.onActivity(() => this.notifyActivity()),
      );
    }
  }

  register(task: IdleScheduledTask): void {
    if (task.idleThresholdMs < 0 || task.cadenceMs < 0) {
      throw new Error(
        `IdleScheduler.register: negative thresholds rejected (id=${task.id})`,
      );
    }
    this._tasks.set(task.id, { task, lastRunAt: 0 });
  }

  unregister(id: string): void {
    this._tasks.delete(id);
  }

  notifyActivity(): void {
    this._lastUserActivity = this._now();
  }

  lastUserActivityAt(): number {
    return this._lastUserActivity;
  }

  size(): number {
    return this._tasks.size;
  }

  start(): void {
    if (this._tickHandle !== null) return;
    this._tickHandle = this._setInterval(() => {
      void this.tick();
    }, this._tickIntervalMs);
  }

  stop(): void {
    if (this._tickHandle !== null) {
      this._clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
    for (const sub of this._activitySubs) {
      try {
        sub.dispose();
      } catch {
        // best-effort
      }
    }
    this._activitySubs = [];
  }

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
        } catch {
          // failed runs do not advance the cadence cursor
        }
      }
    } finally {
      this._running = false;
    }
  }
}

export interface BootstrapWorkers {
  curator: () => Promise<void>;
  reflect: () => Promise<void>;
}

/**
 * Wire the scheduler with the curator + reflect workers. Tests drive this
 * factory with synthetic workers; the production daemon entry point passes
 * the real `MemoryHub` curator + reflect closures (deferred to a follow-on
 * commit alongside the engine relocation).
 */
export function bootstrapIdleScheduler(
  workers: BootstrapWorkers,
  opts: IdleSchedulerOptions = {},
): IdleScheduler {
  const scheduler = new IdleScheduler(opts);
  scheduler.register({
    id: CURATOR_TASK_ID,
    idleThresholdMs: CURATOR_IDLE_MS,
    cadenceMs: CURATOR_CADENCE_MS,
    run: workers.curator,
  });
  scheduler.register({
    id: REFLECT_TASK_ID,
    idleThresholdMs: REFLECT_IDLE_MS,
    cadenceMs: REFLECT_CADENCE_MS,
    run: workers.reflect,
  });
  return scheduler;
}
