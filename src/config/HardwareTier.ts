import type { HardwareTierId, HardwareTierConfig, ModelRecommendation } from "./HardwareTier.types.js";

/**
 * Hardware tier configurations for the three supported VRAM ranges.
 *
 * Tier 2 ("balanced") is designed to match the existing v0.2.0 defaults exactly:
 * maxTokens 131072, 20 iterations, 0.8 compaction threshold, budget 10/3/65/20.
 */
export const TIER_CONFIGS: Record<HardwareTierId, HardwareTierConfig> = {
  1: {
    id: 1,
    name: "constrained",
    vramRange: { min: 0, max: 10240 },
    recommendedModels: [
      {
        modelName: "gemma4:e2b",
        contextWindow: 32768,
        quantization: "Q4_K_M",
        effectiveParams: "2B",
        vramRequired: 4096,
      },
      {
        modelName: "gemma4:e4b",
        contextWindow: 65536,
        quantization: "Q4_0",
        effectiveParams: "4B",
        vramRequired: 6144,
      },
    ],
    maxAgentIterations: 10,
    contextWindow: 32768,
    budgetOverrides: {
      systemPromptPercent: 8,
      memoryPercent: 2,
      conversationPercent: 68,
      responsePercent: 20,
    },
    compactionThreshold: 0.7,
  },
  2: {
    id: 2,
    name: "balanced",
    vramRange: { min: 10240, max: 20480 },
    recommendedModels: [
      {
        modelName: "gemma4:e4b",
        contextWindow: 131072,
        quantization: "FP16",
        effectiveParams: "4B",
        vramRequired: 10240,
      },
      {
        modelName: "gemma4:12b",
        contextWindow: 131072,
        quantization: "Q4_K_M",
        effectiveParams: "12B",
        vramRequired: 12288,
      },
    ],
    maxAgentIterations: 20,
    contextWindow: 131072,
    budgetOverrides: {
      systemPromptPercent: 10,
      memoryPercent: 3,
      conversationPercent: 65,
      responsePercent: 20,
    },
    compactionThreshold: 0.8,
  },
  3: {
    id: 3,
    name: "full",
    vramRange: { min: 20480, max: Infinity },
    recommendedModels: [
      {
        modelName: "gemma4:26b-moe",
        contextWindow: 262144,
        quantization: "Q4_K_M",
        effectiveParams: "26B",
        vramRequired: 20480,
      },
      {
        modelName: "gemma4:31b",
        contextWindow: 262144,
        quantization: "Q4_K_M",
        effectiveParams: "31B",
        vramRequired: 24576,
      },
    ],
    maxAgentIterations: 30,
    contextWindow: 262144,
    budgetOverrides: {
      systemPromptPercent: 10,
      memoryPercent: 5,
      conversationPercent: 60,
      responsePercent: 20,
    },
    compactionThreshold: 0.85,
  },
};

/** Classify VRAM into one of the three hardware tiers. */
export function classifyTier(vramMb: number): HardwareTierId {
  if (vramMb < 10240) return 1;
  if (vramMb < 20480) return 2;
  return 3;
}

/** Get the tier configuration for a given tier ID. Throws on invalid input. */
export function getTierConfig(tierId: HardwareTierId): HardwareTierConfig {
  const config = TIER_CONFIGS[tierId];
  if (!config) {
    throw new Error(`Invalid hardware tier ID: ${String(tierId)}`);
  }
  return config;
}

/**
 * Find the first recommended model for a tier that is installed in Ollama.
 * Matches by model name prefix (e.g. "gemma4:e4b" matches "gemma4:e4b-q4_k_m").
 * Returns null when none of the recommended models are installed.
 */
export function getRecommendedModel(
  tier: HardwareTierConfig,
  installedModels: readonly string[],
): ModelRecommendation | null {
  for (const rec of tier.recommendedModels) {
    const match = installedModels.some(
      (installed) => installed === rec.modelName || installed.startsWith(`${rec.modelName}-`),
    );
    if (match) return rec;
  }
  return null;
}
