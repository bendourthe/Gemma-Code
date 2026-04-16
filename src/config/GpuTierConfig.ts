import type { GemmaCodeSettings } from "./settings.js";

export enum GpuTier {
  TIER_1 = 1,
  TIER_2 = 2,
  TIER_3 = 3,
}

export interface GpuTierProfile {
  readonly tier: GpuTier;
  readonly maxAgentIterations: number;
  readonly subAgentMaxIterations: number;
  readonly maxConcurrentSubAgents: number;
  readonly compactionThreshold: number;
  readonly contextWindow: number;
  readonly recommendedModel: string;
}

/**
 * Tier 1 (6-8 GB VRAM): E4B model, 128K context, conservative limits.
 * Tier 2 (12-16 GB VRAM): 26B MoE model, 256K context, moderate limits.
 * Tier 3 (24+ GB VRAM): 31B Dense model, 256K context, generous limits.
 */
export const GPU_TIER_PROFILES: Record<GpuTier, GpuTierProfile> = {
  [GpuTier.TIER_1]: {
    tier: GpuTier.TIER_1,
    maxAgentIterations: 25,
    subAgentMaxIterations: 8,
    maxConcurrentSubAgents: 1,
    compactionThreshold: 0.7,
    contextWindow: 131072,
    recommendedModel: "gemma4:e4b",
  },
  [GpuTier.TIER_2]: {
    tier: GpuTier.TIER_2,
    maxAgentIterations: 40,
    subAgentMaxIterations: 12,
    maxConcurrentSubAgents: 2,
    compactionThreshold: 0.8,
    contextWindow: 262144,
    recommendedModel: "gemma4:26b",
  },
  [GpuTier.TIER_3]: {
    tier: GpuTier.TIER_3,
    maxAgentIterations: 60,
    subAgentMaxIterations: 15,
    maxConcurrentSubAgents: 3,
    compactionThreshold: 0.85,
    contextWindow: 262144,
    recommendedModel: "gemma4:31b",
  },
};

/**
 * Infer the GPU tier from the model name string.
 * Falls back to TIER_1 if the model cannot be identified.
 */
export function inferTierFromModelName(modelName: string): GpuTier {
  const lower = modelName.toLowerCase();
  if (lower.includes("31b") || lower.includes("dense")) return GpuTier.TIER_3;
  if (lower.includes("26b") || lower.includes("moe")) return GpuTier.TIER_2;
  if (lower.includes("12b")) return GpuTier.TIER_2;
  // e4b, e2b, or anything else -> TIER_1 (safe default)
  return GpuTier.TIER_1;
}

/**
 * Detect the GPU tier from user settings.
 * Priority: explicit gpuTier setting > model name inference > TIER_1 default.
 */
export function detectGpuTier(settings: GemmaCodeSettings): GpuTier {
  if (settings.gpuTier !== "auto") {
    const tier = Number(settings.gpuTier);
    if (tier === 1 || tier === 2 || tier === 3) return tier as GpuTier;
  }

  // Fall back to model name inference.
  return inferTierFromModelName(settings.modelName);
}

/**
 * Get the effective GPU tier profile, merging tier defaults with user overrides
 * from settings (e.g., maxAgentIterations, subAgentMaxIterations).
 */
export function getEffectiveProfile(
  settings: GemmaCodeSettings,
  detectedTier?: GpuTier,
): GpuTierProfile {
  const tier = detectedTier ?? detectGpuTier(settings);
  const base = GPU_TIER_PROFILES[tier];

  return {
    ...base,
    // Allow user settings to override tier defaults when explicitly set.
    maxAgentIterations:
      settings.maxAgentIterations !== 20 ? settings.maxAgentIterations : base.maxAgentIterations,
    subAgentMaxIterations:
      settings.subAgentMaxIterations !== 10 ? settings.subAgentMaxIterations : base.subAgentMaxIterations,
  };
}
