import { describe, it, expect } from "vitest";
import {
  GpuTier,
  GPU_TIER_PROFILES,
  inferTierFromModelName,
  detectGpuTier,
  getEffectiveProfile,
} from "../../../src/config/GpuTierConfig.js";
import type { GemmaCodeSettings } from "../../../src/config/settings.js";

function makeSettings(overrides: Partial<GemmaCodeSettings> = {}): GemmaCodeSettings {
  return {
    ollamaUrl: "http://localhost:11434",
    modelName: "gemma4",
    maxTokens: 131072,
    temperature: 1.0,
    topP: 0.95,
    topK: 64,
    requestTimeout: 60000,
    toolConfirmationMode: "ask",
    maxAgentIterations: 20,
    editMode: "ask",
    thinkingMode: true,
    promptStyle: "concise",
    systemPromptBudgetPercent: 10,
    compactionKeepRecent: 10,
    compactionToolResultsKeep: 8,
    useBackend: true,
    backendPort: 11435,
    pythonPath: "python",
    memoryEnabled: true,
    embeddingModel: "nomic-embed-text",
    memoryAutoSaveInterval: 15,
    memoryMaxEntries: 10000,
    mcpEnabled: false,
    mcpServerMode: "off",
    verificationEnabled: true,
    verificationThreshold: 3,
    subAgentMaxIterations: 10,
    autoDetectGpu: true,
    gpuTierOverride: null,
    maxSessionTokens: 500000,
    maxSessionMinutes: 30,
    permissionOverrides: {},
    gpuTier: "auto",
    ...overrides,
  } as GemmaCodeSettings;
}

describe("GpuTierConfig", () => {
  describe("GPU_TIER_PROFILES", () => {
    it("defines profiles for all three tiers", () => {
      expect(GPU_TIER_PROFILES[GpuTier.TIER_1]).toBeDefined();
      expect(GPU_TIER_PROFILES[GpuTier.TIER_2]).toBeDefined();
      expect(GPU_TIER_PROFILES[GpuTier.TIER_3]).toBeDefined();
    });

    it("tier 1 has more conservative limits than tier 3", () => {
      const t1 = GPU_TIER_PROFILES[GpuTier.TIER_1];
      const t3 = GPU_TIER_PROFILES[GpuTier.TIER_3];

      expect(t1.maxAgentIterations).toBeLessThan(t3.maxAgentIterations);
      expect(t1.subAgentMaxIterations).toBeLessThan(t3.subAgentMaxIterations);
      expect(t1.maxConcurrentSubAgents).toBeLessThan(t3.maxConcurrentSubAgents);
      expect(t1.compactionThreshold).toBeLessThan(t3.compactionThreshold);
    });

    it("all profiles have valid compaction thresholds between 0 and 1", () => {
      for (const profile of Object.values(GPU_TIER_PROFILES)) {
        expect(profile.compactionThreshold).toBeGreaterThan(0);
        expect(profile.compactionThreshold).toBeLessThan(1);
      }
    });
  });

  describe("inferTierFromModelName", () => {
    it("infers TIER_1 for e4b models", () => {
      expect(inferTierFromModelName("gemma4:e4b")).toBe(GpuTier.TIER_1);
    });

    it("infers TIER_2 for 26b models", () => {
      expect(inferTierFromModelName("gemma4:26b")).toBe(GpuTier.TIER_2);
    });

    it("infers TIER_2 for 12b models", () => {
      expect(inferTierFromModelName("gemma4:12b")).toBe(GpuTier.TIER_2);
    });

    it("infers TIER_3 for 31b models", () => {
      expect(inferTierFromModelName("gemma4:31b")).toBe(GpuTier.TIER_3);
    });

    it("falls back to TIER_1 for unknown models", () => {
      expect(inferTierFromModelName("gemma4")).toBe(GpuTier.TIER_1);
      expect(inferTierFromModelName("some-custom-model")).toBe(GpuTier.TIER_1);
    });
  });

  describe("detectGpuTier", () => {
    it("uses explicit gpuTier setting when not auto", () => {
      expect(detectGpuTier(makeSettings({ gpuTier: "2" }))).toBe(GpuTier.TIER_2);
      expect(detectGpuTier(makeSettings({ gpuTier: "3" }))).toBe(GpuTier.TIER_3);
    });

    it("falls back to model name inference in auto mode", () => {
      expect(detectGpuTier(makeSettings({ gpuTier: "auto", modelName: "gemma4:31b" }))).toBe(GpuTier.TIER_3);
    });

    it("returns TIER_1 as the safe default", () => {
      expect(detectGpuTier(makeSettings())).toBe(GpuTier.TIER_1);
    });
  });

  describe("getEffectiveProfile", () => {
    it("returns base tier profile when no user overrides", () => {
      const profile = getEffectiveProfile(makeSettings(), GpuTier.TIER_2);
      expect(profile.tier).toBe(GpuTier.TIER_2);
      expect(profile.maxAgentIterations).toBe(40);
      expect(profile.recommendedModel).toBe("gemma4:26b");
    });

    it("applies user override for maxAgentIterations", () => {
      const profile = getEffectiveProfile(
        makeSettings({ maxAgentIterations: 50 }),
        GpuTier.TIER_1,
      );
      expect(profile.maxAgentIterations).toBe(50);
    });

    it("applies user override for subAgentMaxIterations", () => {
      const profile = getEffectiveProfile(
        makeSettings({ subAgentMaxIterations: 20 }),
        GpuTier.TIER_1,
      );
      expect(profile.subAgentMaxIterations).toBe(20);
    });

    it("auto-detects tier when not explicitly provided", () => {
      const profile = getEffectiveProfile(makeSettings({ modelName: "gemma4:31b" }));
      expect(profile.tier).toBe(GpuTier.TIER_3);
    });
  });
});
