/**
 * v1.1.0 Phase 8.2 -- weekly DevAI-Hub auto-sync worker.
 *
 * Exposes a factory that returns an `IdleScheduler.register`-shaped
 * task. The task body runs `DevAIHubSyncer.sync({apply: true})` against
 * the default upstream + skills root. Cadence: 7 days. Idle threshold:
 * 5 minutes. Tests inject a synthetic runner so the syncer's network
 * code is not exercised here.
 *
 * Closes v1.0.0 carryforward `10.P1.HHH` (weekly auto-sync worker).
 */

export const DEVAI_HUB_SYNC_TASK_ID = "nexus.skills.devai-hub-sync";

/** Production cadence: 7 days. */
export const DEVAI_HUB_SYNC_CADENCE_MS = 7 * 24 * 60 * 60_000;

/** Idle threshold: 5 minutes (matches the curator default). */
export const DEVAI_HUB_SYNC_IDLE_MS = 5 * 60_000;

/**
 * Closure executed by the scheduler. Returns nothing -- failures are
 * caught by the scheduler and logged without aborting the tick loop.
 */
export type SyncWorkerRunner = () => Promise<void>;

export interface SyncTaskOptions {
  /** Override the default lazy-loading sync runner (tests). */
  runner?: SyncWorkerRunner;
  /** Override the cadence (tests). Defaults to `DEVAI_HUB_SYNC_CADENCE_MS`. */
  cadenceMs?: number;
  /** Override the idle threshold (tests). Defaults to `DEVAI_HUB_SYNC_IDLE_MS`. */
  idleThresholdMs?: number;
}

export interface DevAIHubSyncTask {
  readonly id: string;
  readonly idleThresholdMs: number;
  readonly cadenceMs: number;
  run(): Promise<void>;
}

/**
 * Build the default production runner. The runner imports the syncer
 * lazily so loading this module does not pull `DevAIHubSyncer` into the
 * sidecar startup graph until the scheduler actually invokes it.
 */
export function defaultSyncRunner(): SyncWorkerRunner {
  return async () => {
    const mod = await import("./NexusHubSyncer.js");
    const syncer = new mod.NexusHubSyncer({});
    await syncer.sync({ apply: true });
  };
}

/**
 * Build the `IdleScheduler.register({...})`-shaped task. The factory
 * accepts an injectable runner so tests can assert "the scheduler fires
 * the worker after 7 days of idle" without touching the network.
 */
export function createDevAIHubSyncTask(opts: SyncTaskOptions = {}): DevAIHubSyncTask {
  const runner = opts.runner ?? defaultSyncRunner();
  return {
    id: DEVAI_HUB_SYNC_TASK_ID,
    idleThresholdMs: opts.idleThresholdMs ?? DEVAI_HUB_SYNC_IDLE_MS,
    cadenceMs: opts.cadenceMs ?? DEVAI_HUB_SYNC_CADENCE_MS,
    run: runner,
  };
}
