/**
 * v2.1.0 Phase 5 -- base-model picker. Tier + codingEligible / vision /
 * diffusion flags. Diffusion and non-LLM rows never appear.
 */

import type { ModelSpec } from "../registry/catalog.js";

export interface TuningBaseModel {
  readonly id: string;
  readonly displayName: string;
  readonly codingEligible: boolean;
  readonly vision: boolean;
  readonly requiredVramGB: number | null;
}

export interface FilterTuningBaseModelsOptions {
  readonly hostVramGB: number;
  /** Default true: hide codingEligible: false (SAM2, chat-drafting gens). */
  readonly requireCodingEligible?: boolean;
  /** Default false: hide diffusion generators. */
  readonly allowDiffusion?: boolean;
}

export function filterTuningBaseModels(
  specs: readonly ModelSpec[],
  opts: FilterTuningBaseModelsOptions,
): TuningBaseModel[] {
  const requireCoding = opts.requireCodingEligible ?? true;
  const allowDiffusion = opts.allowDiffusion ?? false;
  const out: TuningBaseModel[] = [];
  for (const spec of specs) {
    if (spec.type !== "llm") continue;
    const codingEligible = spec.codingEligible ?? true;
    if (requireCoding && !codingEligible) continue;
    if (!allowDiffusion && spec.diffusion === true) continue;
    const floor = spec.hideBelowVramGB ?? spec.requiredVramGB ?? 0;
    if (opts.hostVramGB < floor) continue;
    out.push({
      id: spec.id,
      displayName: spec.displayName,
      codingEligible,
      vision: spec.vision === true,
      requiredVramGB: spec.requiredVramGB ?? null,
    });
  }
  return out;
}
