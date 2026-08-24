import { describe, expect, it } from "vitest";

import {
  defaultMemoryBudget,
  mergeMemoryBudget,
  validateMemoryBudget,
} from "../../../../core/config/diffusionBudget.js";

describe("diffusion memory budget", () => {
  it("derives defaults from each DiffusionTier", () => {
    expect(defaultMemoryBudget("diffusion-low").layerStreaming).toBe(true);
    expect(defaultMemoryBudget("diffusion-pro").maxCacheVramGB).toBeGreaterThan(
      defaultMemoryBudget("diffusion-low").maxCacheVramGB,
    );
  });

  it("older configs omit knobs and keep tier defaults", () => {
    expect(mergeMemoryBudget("diffusion-mid", undefined)).toEqual(defaultMemoryBudget("diffusion-mid"));
  });

  it("rejects a VRAM cap below the model minimum unless streaming is on", () => {
    const tight = {
      maxCacheVramGB: 3,
      maxCacheRamGB: 8,
      workingMemReserveGB: 1,
      layerStreaming: false,
    };
    const blocked = validateMemoryBudget({ budget: tight, modelMinVramGB: 6 });
    expect(blocked.ok).toBe(false);
    expect(blocked.errors.join(" ")).toMatch(/below the model minimum/);
    const streamed = validateMemoryBudget({
      budget: { ...tight, layerStreaming: true },
      modelMinVramGB: 6,
    });
    expect(streamed.ok).toBe(true);
  });

  it("warns when layer streaming is on a slow disk", () => {
    const result = validateMemoryBudget({
      budget: defaultMemoryBudget("diffusion-low"),
      modelMinVramGB: 1,
      diskSequentialMBps: 40,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/thrash/);
  });

  it("rejects non-positive cache caps", () => {
    const result = validateMemoryBudget({
      budget: {
        maxCacheVramGB: 0,
        maxCacheRamGB: 8,
        workingMemReserveGB: 1,
        layerStreaming: true,
      },
      modelMinVramGB: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/non-negative/);
  });
});
