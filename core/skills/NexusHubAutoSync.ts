/**
 * v1.1.0 Phase 8.2 -- weekly Nexus-Hub auto-sync worker.
 * v1.10.0 Phase 4 -- renamed from `DevAIHubAutoSync`; task id + setting key move
 * from the `devai-hub` namespace to `nexus-hub`.
 *
 * Exposes a factory that returns an `IdleScheduler.register`-shaped task. The
 * task body runs `NexusHubSyncer.sync({apply: true})` against the default
 * upstream + catalog root. Cadence: 7 days. Idle threshold: 5 minutes. Tests
 * inject a synthetic runner so the syncer's network code is not exercised here.
 *
 * Closes v1.0.0 carryforward `10.P1.HHH` (weekly auto-sync worker).
 */

export const NEXUS_HUB_SYNC_TASK_ID = "nexus.skills.nexus-hub-sync";

/**
 * v2.2.0 Phase 3 (3.2): the persisted opt-in key, exported so the sidecar's
 * `skills.autoSync.*` IPC and `codingBootstrap` agree on ONE key. The Settings
 * toggle previously reported a hardcoded `false` and wrote nowhere (NHC.P6.C).
 */
export const NEXUS_HUB_AUTO_SYNC_SETTING_KEY = "nexus.skills.autoSync.nexus-hub";

/** Production cadence: 7 days. */
export const NEXUS_HUB_SYNC_CADENCE_MS = 7 * 24 * 60 * 60_000;

/** Idle threshold: 5 minutes (matches the curator default). */
export const NEXUS_HUB_SYNC_IDLE_MS = 5 * 60_000;

/**
 * Closure executed by the scheduler. Returns nothing -- failures are caught by
 * the scheduler and logged without aborting the tick loop.
 */
export type SyncWorkerRunner = () => Promise<void>;

export interface SyncTaskOptions {
  /** Override the default lazy-loading sync runner (tests). */
  runner?: SyncWorkerRunner;
  /** Override the cadence (tests). Defaults to `NEXUS_HUB_SYNC_CADENCE_MS`. */
  cadenceMs?: number;
  /** Override the idle threshold (tests). Defaults to `NEXUS_HUB_SYNC_IDLE_MS`. */
  idleThresholdMs?: number;
}

export interface NexusHubSyncTask {
  readonly id: string;
  readonly idleThresholdMs: number;
  readonly cadenceMs: number;
  run(): Promise<void>;
}

/**
 * Build the default production runner. The runner imports the syncer lazily so
 * loading this module does not pull `NexusHubSyncer` into the sidecar startup
 * graph until the scheduler actually invokes it.
 */
export function defaultSyncRunner(): SyncWorkerRunner {
  return async () => {
    const mod = await import("./NexusHubSyncer.js");
    const syncer = new mod.NexusHubSyncer({});
    await syncer.sync({ apply: true });
  };
}

/**
 * Build the `IdleScheduler.register({...})`-shaped task. The factory accepts an
 * injectable runner so tests can assert "the scheduler fires the worker after 7
 * days of idle" without touching the network.
 */
export function createNexusHubSyncTask(opts: SyncTaskOptions = {}): NexusHubSyncTask {
  const runner = opts.runner ?? defaultSyncRunner();
  return {
    id: NEXUS_HUB_SYNC_TASK_ID,
    idleThresholdMs: opts.idleThresholdMs ?? NEXUS_HUB_SYNC_IDLE_MS,
    cadenceMs: opts.cadenceMs ?? NEXUS_HUB_SYNC_CADENCE_MS,
    run: runner,
  };
}
