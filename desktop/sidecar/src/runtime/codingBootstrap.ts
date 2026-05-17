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
 * Closes [v0.9.0:10.N.A] ModelPinRegistry wiring.
 */

import * as path from "node:path";

import { ModelPinRegistry } from "../../../../core/registry/ModelPinRegistry.js";
import {
  JsonFileSettingsStore,
  type SettingsStore,
} from "../../../../core/storage/SettingsStore.js";

export interface CodingBootstrapOptions {
  /** Absolute path to the Nexus home directory (`~/.nexus`). */
  readonly nexusHome: string;
  /** Override the settings file path (defaults to `<nexusHome>/settings.json`). */
  readonly settingsPath?: string;
  /** Pre-built settings store (tests). */
  readonly settings?: SettingsStore;
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
}

export async function bootstrapCoding(opts: CodingBootstrapOptions): Promise<CodingBootstrap> {
  const settings =
    opts.settings ??
    new JsonFileSettingsStore({
      filePath: opts.settingsPath ?? path.join(opts.nexusHome, "settings.json"),
    });
  const modelPins = new ModelPinRegistry({ settings });
  await modelPins.hydrate();
  return {
    settings,
    modelPins,
    keepAliveResolver: (model) => modelPins.keepAliveFor(model),
  };
}
