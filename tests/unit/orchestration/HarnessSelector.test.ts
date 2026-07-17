import { describe, it, expect } from "vitest";
import {
  DEFAULT_HARNESS_PROFILE,
  HarnessSelector,
  defaultHarnessSelector,
  harnessProfileForTier,
  modelCapabilityTier,
  toPromptOverlay,
  type CatalogLookup,
} from "../../../modules/coding/orchestration/HarnessSelector.js";

describe("HarnessSelector -- modelCapabilityTier (H1)", () => {
  it("classifies an 'advanced' tag as strong regardless of vram", () => {
    expect(modelCapabilityTier({ vramGb: 6, tags: ["advanced"] })).toBe("strong");
  });

  it("classifies a large vram (>= 20) with no tier tag as strong", () => {
    expect(modelCapabilityTier({ vramGb: 40, tags: ["chat"] })).toBe("strong");
  });

  it("classifies a 'lightweight' tag as weak", () => {
    expect(modelCapabilityTier({ vramGb: 8, tags: ["lightweight"] })).toBe("weak");
  });

  it("classifies a small vram (<= 4) with no tier tag as weak", () => {
    expect(modelCapabilityTier({ vramGb: 4, tags: ["chat"] })).toBe("weak");
  });

  it("classifies a mid-range vram with neutral tags as mid", () => {
    expect(modelCapabilityTier({ vramGb: 7, tags: ["coding", "tool-use"] })).toBe("mid");
  });

  it("falls back to mid when no size signal is present at all", () => {
    expect(modelCapabilityTier({ tags: [] })).toBe("mid");
    expect(modelCapabilityTier({ vramGb: undefined, tags: undefined as unknown as string[] })).toBe(
      "mid",
    );
  });

  it("lets the 'advanced' tag win over 'lightweight' (strong checked first)", () => {
    expect(modelCapabilityTier({ vramGb: 3, tags: ["lightweight", "advanced"] })).toBe("strong");
  });
});

describe("HarnessSelector -- profiles (H1)", () => {
  it("returns a distinct profile per tier", () => {
    expect(harnessProfileForTier("weak")).toMatchObject({
      tier: "weak",
      promptStyle: "detailed",
      thinkingMode: true,
    });
    expect(harnessProfileForTier("mid")).toMatchObject({ tier: "mid", promptStyle: "concise" });
    expect(harnessProfileForTier("strong")).toMatchObject({
      tier: "strong",
      thinkingMode: false,
    });
  });

  it("gives the weak profile a larger guidance budget than the strong profile", () => {
    expect(harnessProfileForTier("weak").systemPromptBudgetPercent).toBeGreaterThan(
      harnessProfileForTier("strong").systemPromptBudgetPercent,
    );
  });

  it("uses the mid profile as the default", () => {
    expect(DEFAULT_HARNESS_PROFILE).toBe(harnessProfileForTier("mid"));
  });

  it("projects a profile down to exactly the overlay keys", () => {
    const overlay = toPromptOverlay(harnessProfileForTier("weak"));
    expect(overlay).toEqual({
      promptStyle: "detailed",
      thinkingMode: true,
      systemPromptBudgetPercent: harnessProfileForTier("weak").systemPromptBudgetPercent,
    });
    expect(Object.keys(overlay).sort()).toEqual([
      "promptStyle",
      "systemPromptBudgetPercent",
      "thinkingMode",
    ]);
  });
});

describe("HarnessSelector -- selection (H1)", () => {
  const lookup: CatalogLookup = (name) => {
    const table: Record<string, { id: string; vramGb: number; tags: string[] }> = {
      big: { id: "big", vramGb: 40, tags: ["advanced"] },
      tiny: { id: "tiny", vramGb: 3, tags: ["lightweight"] },
      normal: { id: "normal", vramGb: 7, tags: ["coding"] },
    };
    return table[name];
  };

  it("selects the tier profile for a known model", () => {
    const selector = new HarnessSelector(lookup);
    expect(selector.profileForModel("big").tier).toBe("strong");
    expect(selector.profileForModel("tiny").tier).toBe("weak");
    expect(selector.profileForModel("normal").tier).toBe("mid");
  });

  it("falls back to the default profile for an unprofiled model", () => {
    const selector = new HarnessSelector(lookup);
    expect(selector.profileForModel("does-not-exist")).toBe(DEFAULT_HARNESS_PROFILE);
  });

  it("overlayForModel returns the projected overlay of the selected profile", () => {
    const selector = new HarnessSelector(lookup);
    expect(selector.overlayForModel("tiny")).toEqual(
      toPromptOverlay(harnessProfileForTier("weak")),
    );
  });

  it("the default selector resolves real catalog ids to sensible tiers", () => {
    expect(defaultHarnessSelector.profileForModel("llama3.3:70b").tier).toBe("strong");
    expect(defaultHarnessSelector.profileForModel("llama3.2:3b").tier).toBe("weak");
    expect(defaultHarnessSelector.profileForModel("qwen2.5-coder:7b").tier).toBe("mid");
  });
});
