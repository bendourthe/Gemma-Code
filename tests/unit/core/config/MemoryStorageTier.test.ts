import { describe, it, expect } from "vitest";
import {
  MEMORY_STORAGE_TIER_CONFIGS,
  DEFAULT_MEMORY_STORAGE_TIER,
  resolveMemoryStorageTier,
  getMemoryStorageTierConfig,
  resolveMemoryStorage,
} from "../../../../core/config/MemoryStorageTier.js";

/**
 * v1.2.0 Phase 4.3 -- MemoryStorageTier policy unit tests.
 *
 * Coverage:
 *   - Defaults
 *   - resolveMemoryStorageTier accepts known ids; falls back on unknown
 *   - getMemoryStorageTierConfig returns the right shape
 *   - resolveMemoryStorage returns active + config
 *   - Pruned config asserts the documented ratio + recall delta
 */

describe("MemoryStorageTier", () => {
  it("defaults to standard tier", () => {
    expect(DEFAULT_MEMORY_STORAGE_TIER).toBe("standard");
  });

  it("exposes both tier configs", () => {
    expect(MEMORY_STORAGE_TIER_CONFIGS.standard).toBeDefined();
    expect(MEMORY_STORAGE_TIER_CONFIGS.pruned).toBeDefined();
    expect(MEMORY_STORAGE_TIER_CONFIGS.standard.id).toBe("standard");
    expect(MEMORY_STORAGE_TIER_CONFIGS.pruned.id).toBe("pruned");
  });

  it("resolveMemoryStorageTier accepts known ids", () => {
    expect(resolveMemoryStorageTier("standard")).toBe("standard");
    expect(resolveMemoryStorageTier("pruned")).toBe("pruned");
  });

  it("resolveMemoryStorageTier falls back to default on unknown", () => {
    expect(resolveMemoryStorageTier("totally-bogus")).toBe(DEFAULT_MEMORY_STORAGE_TIER);
    expect(resolveMemoryStorageTier(null)).toBe(DEFAULT_MEMORY_STORAGE_TIER);
    expect(resolveMemoryStorageTier(undefined)).toBe(DEFAULT_MEMORY_STORAGE_TIER);
    expect(resolveMemoryStorageTier("")).toBe(DEFAULT_MEMORY_STORAGE_TIER);
  });

  it("getMemoryStorageTierConfig returns the right shape", () => {
    const c = getMemoryStorageTierConfig("pruned");
    expect(c.label).toContain("Pruned");
    expect(c.description.length).toBeGreaterThan(20);
    expect(c.storageRatio).toBeGreaterThan(0);
    expect(c.storageRatio).toBeLessThan(1);
    expect(c.recallDeltaPp).toBeGreaterThanOrEqual(0);
  });

  it("getMemoryStorageTierConfig throws for invalid id", () => {
    expect(() => getMemoryStorageTierConfig("bogus" as never)).toThrow();
  });

  it("resolveMemoryStorage returns active + config", () => {
    const r = resolveMemoryStorage("pruned");
    expect(r.active).toBe("pruned");
    expect(r.config.id).toBe("pruned");
  });

  it("resolveMemoryStorage falls back for unknown raw input", () => {
    const r = resolveMemoryStorage("nope");
    expect(r.active).toBe(DEFAULT_MEMORY_STORAGE_TIER);
    expect(r.config.id).toBe(DEFAULT_MEMORY_STORAGE_TIER);
  });

  it("pruned tier documents the documented storage gain (<=20%)", () => {
    expect(MEMORY_STORAGE_TIER_CONFIGS.pruned.storageRatio).toBeLessThanOrEqual(0.2);
  });

  it("pruned tier documents recall delta within the stability gate (<=5pp)", () => {
    expect(MEMORY_STORAGE_TIER_CONFIGS.pruned.recallDeltaPp).toBeLessThanOrEqual(5);
  });

  it("standard tier has 1.0 storage ratio and 0pp recall delta", () => {
    expect(MEMORY_STORAGE_TIER_CONFIGS.standard.storageRatio).toBe(1.0);
    expect(MEMORY_STORAGE_TIER_CONFIGS.standard.recallDeltaPp).toBe(0);
  });
});
