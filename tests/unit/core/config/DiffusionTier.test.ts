import { describe, it, expect } from "vitest";
import {
  DIFFUSION_TIER_CONFIGS,
  classifyDiffusionTier,
  getDiffusionTierConfig,
  resolveDiffusionTier,
  type DiffusionTierId,
} from "../../../../core/config/DiffusionTier.js";

describe("classifyDiffusionTier", () => {
  it.each([
    [0, "diffusion-low"],
    [4, "diffusion-low"],
    [7.5, "diffusion-low"],
    [8, "diffusion-mid"],
    [11.9, "diffusion-mid"],
    [12, "diffusion-high"],
    [16, "diffusion-high"],
    [19.9, "diffusion-high"],
    [20, "diffusion-pro"],
    [24, "diffusion-pro"],
    [80, "diffusion-pro"],
  ] as Array<[number, DiffusionTierId]>)(
    "%d GB classifies as %s",
    (gb, expected) => {
      expect(classifyDiffusionTier(gb)).toBe(expected);
    },
  );

  it("treats negative VRAM as low tier", () => {
    expect(classifyDiffusionTier(-1)).toBe("diffusion-low");
  });
});

describe("getDiffusionTierConfig", () => {
  it("returns each tier's config", () => {
    expect(getDiffusionTierConfig("diffusion-low").id).toBe("diffusion-low");
    expect(getDiffusionTierConfig("diffusion-mid").id).toBe("diffusion-mid");
    expect(getDiffusionTierConfig("diffusion-high").id).toBe("diffusion-high");
    expect(getDiffusionTierConfig("diffusion-pro").id).toBe("diffusion-pro");
  });

  it("throws on an invalid id", () => {
    expect(() => getDiffusionTierConfig("not-a-tier" as DiffusionTierId)).toThrow(
      /Invalid diffusion tier id/,
    );
  });
});

describe("DIFFUSION_TIER_CONFIGS image defaults", () => {
  it("low tier ships SD 1.5 at 512x512", () => {
    const c = DIFFUSION_TIER_CONFIGS["diffusion-low"];
    expect(c.image.model).toBe("sd_1_5");
    expect(c.image.width).toBe(512);
    expect(c.image.height).toBe(512);
    expect(c.image.allowControlNet).toBe(false);
  });

  it("mid tier ships SDXL Turbo at 1024x1024 with single ControlNet", () => {
    const c = DIFFUSION_TIER_CONFIGS["diffusion-mid"];
    expect(c.image.model).toBe("sdxl_turbo");
    expect(c.image.width).toBe(1024);
    expect(c.image.allowControlNet).toBe(true);
    expect(c.image.allowControlNetStacking).toBe(false);
  });

  it("high tier allows ControlNet stacking", () => {
    expect(DIFFUSION_TIER_CONFIGS["diffusion-high"].image.allowControlNetStacking).toBe(true);
  });

  it("pro tier ships Flux + parallel jobs", () => {
    const c = DIFFUSION_TIER_CONFIGS["diffusion-pro"];
    expect(c.image.model).toBe("flux");
    expect(c.parallelJobs).toBe(true);
  });
});

describe("DIFFUSION_TIER_CONFIGS video defaults", () => {
  it("low tier disables video", () => {
    const c = DIFFUSION_TIER_CONFIGS["diffusion-low"];
    expect(c.video.enabled).toBe(false);
    expect(c.video.model).toBeNull();
  });

  it("mid tier ships LTX-Video 4s 480p", () => {
    const c = DIFFUSION_TIER_CONFIGS["diffusion-mid"];
    expect(c.video.model).toBe("ltx_video");
    expect(c.video.clipSeconds).toBe(4);
    expect(c.video.height).toBe(480);
  });

  it("high tier ships LTX-Video 8s 720p", () => {
    const c = DIFFUSION_TIER_CONFIGS["diffusion-high"];
    expect(c.video.clipSeconds).toBe(8);
    expect(c.video.height).toBe(720);
  });

  it("pro tier ships CogVideoX 5B", () => {
    expect(DIFFUSION_TIER_CONFIGS["diffusion-pro"].video.model).toBe("cogvideox_5b");
  });

  it("every tier declares audioConditioning disabled until avatar models land", () => {
    for (const config of Object.values(DIFFUSION_TIER_CONFIGS)) {
      expect(config.video.audioConditioning.enabled).toBe(false);
      expect(config.video.audioConditioning.modes).toEqual([]);
    }
  });
});

describe("resolveDiffusionTier", () => {
  it("returns the detected tier when override is null/undefined", () => {
    const r1 = resolveDiffusionTier(16, null);
    expect(r1.detected).toBe("diffusion-high");
    expect(r1.effective).toBe("diffusion-high");
    expect(r1.overridden).toBe(false);
    const r2 = resolveDiffusionTier(16, undefined);
    expect(r2.effective).toBe("diffusion-high");
  });

  it("uses the override when provided", () => {
    const r = resolveDiffusionTier(16, "diffusion-low");
    expect(r.detected).toBe("diffusion-high");
    expect(r.effective).toBe("diffusion-low");
    expect(r.overridden).toBe(true);
  });

  it("override matching the detected tier is not flagged as overridden", () => {
    const r = resolveDiffusionTier(16, "diffusion-high");
    expect(r.overridden).toBe(false);
  });

  it("ignores an unknown override id and returns the detected tier", () => {
    const r = resolveDiffusionTier(16, "garbage" as DiffusionTierId);
    expect(r.effective).toBe("diffusion-high");
    expect(r.overridden).toBe(false);
  });
});
