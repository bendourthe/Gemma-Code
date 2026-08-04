/**
 * v1.15.0 Phase 4 (Issue 3) -- shared "installed and ready" model feed for the
 * studio model selectors (consumed by Image Studio / Video Lab in Phases 5-6).
 *
 * The chat-style selectors must offer ONLY downloaded-and-ready models and a
 * "Get more models" entry that deep-links to Settings > Models. This module
 * provides the pure filter + the deep-link path so both studios share one rule.
 */

import type { ListedModelDto, ModelType } from "../../pages/settings/modelsTypes";

/** Deep-link that opens Settings on the Models tab (the studios' "Get more models"). */
export const SETTINGS_MODELS_PATH = "/settings?tab=models";

/**
 * Installed-and-ready models for a task type. Only `registry` / `external`
 * (on-disk or Ollama-resident) models are "ready"; a `catalog-only` entry is
 * not installed and must not appear in a studio selector.
 */
export function installedModelsForType(
  models: readonly ListedModelDto[],
  type: ModelType,
): ListedModelDto[] {
  return models.filter(
    (m) => m.installed && m.source !== "catalog-only" && m.type === type,
  );
}
