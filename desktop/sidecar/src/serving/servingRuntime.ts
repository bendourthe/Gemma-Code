/**
 * v1.16.0 Phase 1.1 (adoption item A1) -- serving-gateway runtime seam.
 *
 * Owns the gateway + its settings store as one lazily-built unit, mirroring the
 * `ModelsRuntime` pattern (`models/modelsService.ts`) that the `models.*` IPC
 * uses: production builds the real disk-backed thing on first `serving.*` call,
 * tests inject a fake through `HandlerContext.serving`.
 *
 * Keeping the gateway's construction here (rather than in `main.ts`) is
 * deliberate -- `main.ts` is excluded from coverage, so the lifecycle logic lives
 * in a module the test suite can actually reach.
 */

import * as path from "node:path";
import { JsonFileSettingsStore, type SettingsStore } from "../../../../core/storage/SettingsStore.js";
import { nexusHome } from "../../../../core/storage/paths.js";
import { createModelsRuntime, type ModelsRuntime } from "../models/modelsService.js";
import {
  LOCAL_ADAPTERS_KEY,
  resolveServingAdapters,
  type ServingAdapter,
} from "./adapters.js";
import { SERVING_KEYS, type ServingConfig, resolveServingConfig } from "./config.js";
import { ServingGateway, type ServingStatus } from "./gateway.js";

/** The gateway + the settings store the `serving.*` IPC mutates. */
export interface ServingRuntime {
  readonly gateway: ServingGateway;
  readonly settings: SettingsStore;
  /** Re-read settings and reconcile the listener; returns the live status. */
  sync(): Promise<ServingStatus>;
  /** Persist `enabled`, reconcile the listener, return the live status. */
  setEnabled(enabled: boolean): Promise<ServingStatus>;
  status(): Promise<ServingStatus>;
}

export interface CreateServingRuntimeOptions {
  readonly settings?: SettingsStore;
  readonly models?: ModelsRuntime;
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: (message: string) => void;
}

/**
 * Build the serving runtime. The models runtime is resolved lazily on the first
 * model listing so an unreachable Ollama or a missing catalog never blocks
 * gateway startup (the gateway then simply serves an empty model list).
 */
export function createServingRuntime(opts: CreateServingRuntimeOptions = {}): ServingRuntime {
  const settings =
    opts.settings ??
    new JsonFileSettingsStore({ filePath: path.join(nexusHome(), "settings.json") });

  let modelsPromise: Promise<ModelsRuntime> | null = null;
  const resolveModels = async (): Promise<ModelsRuntime> => {
    if (opts.models) return opts.models;
    if (!modelsPromise) modelsPromise = createModelsRuntime();
    return modelsPromise;
  };

  // The user's `nexus.llm.localAdapters` manifests are read once per config sync
  // (not per request) and layered over the built-in Ollama + LM Studio adapters,
  // so a newly registered loopback runtime becomes servable on the next toggle
  // without a sidecar restart.
  let adapters: readonly ServingAdapter[] = resolveServingAdapters(undefined, opts.env);

  const gateway = new ServingGateway({
    listInstalled: async () => {
      try {
        const { service } = await resolveModels();
        return await service.list();
      } catch {
        // No catalog / no disk / no Ollama: serve an empty list rather than a 502.
        return [];
      }
    },
    adapters: () => adapters,
    log: opts.log,
  });

  const readConfig = (): Promise<ServingConfig> =>
    resolveServingConfig({ settings, env: opts.env });

  const refreshAdapters = async (): Promise<void> => {
    try {
      adapters = resolveServingAdapters(await settings.get(LOCAL_ADAPTERS_KEY), opts.env);
    } catch {
      // Unreadable settings: keep the built-ins rather than losing all routing.
    }
  };

  const sync = async (): Promise<ServingStatus> => {
    const config = await readConfig();
    await refreshAdapters();
    await gateway.applyConfig(config);
    return gateway.status(config);
  };

  return {
    gateway,
    settings,
    sync,
    async setEnabled(enabled: boolean): Promise<ServingStatus> {
      await settings.set(SERVING_KEYS.enabled, enabled);
      return sync();
    },
    async status(): Promise<ServingStatus> {
      const config = await readConfig();
      return gateway.status(config);
    },
  };
}
