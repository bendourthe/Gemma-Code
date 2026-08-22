/**
 * v1.0.0 Phase 5.6 -- coding-side composition root.
 *
 * Phase 3.4 stood up `idleScheduler.ts` next to this file; Phase 5.6
 * formalises the bootstrap as a single factory that returns the wired
 * components needed by the streaming pipeline + Settings UI:
 *
 *   - SettingsStore (JSON-file backed at `<.nexus>/settings.json`)
 *   - ModelPinRegistry (hydrated from `nexus.llm.modelPins`)
 *   - KeepAliveResolver (the bridge into `src/chat/StreamingPipeline.ts`'s
 *     existing optional callback)
 *
 * v1.1.0 Phase 8 adds two opt-in surfaces:
 *   - SkillsReloader -- fs.watch the nexus-hub-version.json sentinel under
 *     ~/.nexus-ai/catalog so a successful `nexus skills sync --apply`
 *     hot-reloads the catalog (closes 10.P1.GGG).
 *   - Nexus-Hub auto-sync worker -- registered with the IdleScheduler
 *     under `nexus.skills.autoSync.nexus-hub` (closes 10.P1.HHH).
 *
 * v1.10.0 Phase 4 runs a one-shot, guarded cleanup of the legacy
 * `~/.nexus/skills/devai-hub/` catalog cache on bootstrap.
 *
 * Closes [v0.9.0:10.N.A] ModelPinRegistry wiring.
 */

import * as path from "node:path";

import { ModelPinRegistry } from "../../../../core/registry/ModelPinRegistry.js";
import { catalogRoot } from "../../../../core/storage/paths.js";
import {
  JsonFileSettingsStore,
  type SettingsStore,
} from "../../../../core/storage/SettingsStore.js";
import {
  SkillsReloader,
  type ReloadableCatalog,
} from "../../../../core/skills/SkillsReloader.js";
import {
  createNexusHubSyncTask,
  NEXUS_HUB_SYNC_TASK_ID,
  NEXUS_HUB_AUTO_SYNC_SETTING_KEY,
  type SyncWorkerRunner,
} from "../../../../core/skills/NexusHubAutoSync.js";
import { migrateLegacyCatalogCleanup } from "../../../../core/skills/migrateLegacyCatalog.js";
import type { IdleScheduler } from "./idleScheduler.js";

export interface CodingBootstrapOptions {
  /** Absolute path to the Nexus home directory (`~/.nexus`). */
  readonly nexusHome: string;
  /** Override the settings file path (defaults to `<nexusHome>/settings.json`). */
  readonly settingsPath?: string;
  /** Pre-built settings store (tests). */
  readonly settings?: SettingsStore;
  /**
   * Optional skill catalog to hot-reload when the Hub catalog version manifest
   * changes. Omit to skip the file-watcher attachment (tests + headless
   * sidecars that have no catalog yet).
   */
  readonly skillCatalog?: ReloadableCatalog;
  /**
   * Root of the isolated Hub catalog subtree the reloader watches. Defaults to
   * `~/.nexus-ai/catalog` (the global catalog). Injectable for tests.
   */
  readonly catalogRoot?: string;
  /**
   * Idle scheduler used to register the weekly Nexus-Hub auto-sync worker.
   * Omit to skip the registration.
   */
  readonly idleScheduler?: IdleScheduler;
  /**
   * Inject a sync runner for tests. Defaults to a closure that lazy-loads
   * `NexusHubSyncer` and runs `sync({apply: true})`.
   */
  readonly syncRunner?: SyncWorkerRunner;
  /** Override the cadence for the auto-sync worker (tests). Defaults to 7 days. */
  readonly autoSyncCadenceMs?: number;
  /** Override the idle threshold for the auto-sync worker (tests). Defaults to 5 minutes. */
  readonly autoSyncIdleMs?: number;
}

export interface CodingBootstrap {
  readonly settings: SettingsStore;
  readonly modelPins: ModelPinRegistry;
  /**
   * Bound resolver for `StreamingPipeline`'s `resolveKeepAlive` constructor
   * argument. Returning `null` from the caller's perspective is equivalent
   * to "no override"; this resolver always returns a value once hydrated.
   */
  readonly keepAliveResolver: (model: string) => number | string | null;
  /** Active SkillsReloader when a catalog was supplied; null otherwise. */
  readonly skillsReloader: SkillsReloader | null;
  /** True when the Nexus-Hub auto-sync worker was registered with the IdleScheduler. */
  readonly autoSyncRegistered: boolean;
  /** True when the one-shot legacy `~/.nexus/skills/devai-hub/` cleanup removed the cache this run. */
  readonly legacyCatalogMigrated: boolean;
}

const AUTO_SYNC_SETTING_KEY = NEXUS_HUB_AUTO_SYNC_SETTING_KEY;
const LEGACY_AUTO_SYNC_SETTING_KEY = "nexus.skills.autoSync.devai-hub";

export async function bootstrapCoding(opts: CodingBootstrapOptions): Promise<CodingBootstrap> {
  const settings =
    opts.settings ??
    new JsonFileSettingsStore({
      filePath: opts.settingsPath ?? path.join(opts.nexusHome, "settings.json"),
    });
  const modelPins = new ModelPinRegistry({ settings });
  await modelPins.hydrate();

  // v1.10.0 Phase 4: one-shot, guarded cleanup of the legacy
  // `~/.nexus/skills/devai-hub/` catalog cache (best-effort; never blocks boot).
  let legacyCatalogMigrated = false;
  try {
    legacyCatalogMigrated = migrateLegacyCatalogCleanup(opts.nexusHome).removedLegacyCatalog;
  } catch {
    legacyCatalogMigrated = false;
  }

  let skillsReloader: SkillsReloader | null = null;
  if (opts.skillCatalog) {
    skillsReloader = new SkillsReloader({
      catalogRoot: opts.catalogRoot ?? catalogRoot(),
      catalog: opts.skillCatalog,
    });
    skillsReloader.start();
  }

  let autoSyncRegistered = false;
  if (opts.idleScheduler) {
    // Read the new key; one-shot migrate the legacy key's value forward so an
    // existing opt-in survives the `devai-hub` -> `nexus-hub` setting rename.
    let enabled = await settings.get<boolean>(AUTO_SYNC_SETTING_KEY);
    if (enabled === undefined) {
      const legacy = await settings.get<boolean>(LEGACY_AUTO_SYNC_SETTING_KEY);
      if (legacy !== undefined) {
        await settings.set(AUTO_SYNC_SETTING_KEY, legacy);
        enabled = legacy;
      }
    }
    if (enabled === true) {
      opts.idleScheduler.register(
        createNexusHubSyncTask({
          runner: opts.syncRunner,
          cadenceMs: opts.autoSyncCadenceMs,
          idleThresholdMs: opts.autoSyncIdleMs,
        }),
      );
      autoSyncRegistered = true;
    } else {
      // Make sure a stale registration is cleared when the setting flips off.
      opts.idleScheduler.unregister(NEXUS_HUB_SYNC_TASK_ID);
    }
  }

  return {
    settings,
    modelPins,
    keepAliveResolver: (model) => modelPins.keepAliveFor(model),
    skillsReloader,
    autoSyncRegistered,
    legacyCatalogMigrated,
  };
}

export { AUTO_SYNC_SETTING_KEY };
