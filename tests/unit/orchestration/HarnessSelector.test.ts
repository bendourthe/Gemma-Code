import { describe, it, expect } from "vitest";
import {
  DEFAULT_HARNESS_PROFILE,
  HarnessSelector,
  HarnessSessionOverride,
  applyHarnessOverlay,
  defaultHarnessSelector,
  harnessProfileById,
  harnessProfileForTier,
  listHarnessProfiles,
  modelCapabilityTier,
  parseHarnessCommand,
  parseHarnessProfileId,
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

  it("dense entries without MoE fields keep the pre-v1.18 tag-then-vram path", () => {
    expect(modelCapabilityTier({ vramGb: 6, tags: ["advanced"] })).toBe("strong");
    expect(modelCapabilityTier({ vramGb: 40, tags: ["chat"] })).toBe("strong");
    expect(modelCapabilityTier({ vramGb: 8, tags: ["lightweight"] })).toBe("weak");
    expect(modelCapabilityTier({ vramGb: 4, tags: ["chat"] })).toBe("weak");
    expect(modelCapabilityTier({ vramGb: 7, tags: ["coding", "tool-use"] })).toBe("mid");
    expect(modelCapabilityTier({ tags: [] })).toBe("mid");
  });

  it("MoE activeParams drive compute tier while totalParams flag resident footprint", () => {
    const moe = {
      vramGb: 14,
      tags: ["coding"],
      activeParams: 2.4,
      totalParams: 16,
    };
    expect(modelCapabilityTier(moe)).toBe("weak");
    const selector = new HarnessSelector((name) =>
      name === "moe" ? { id: "moe", family: "deepseek", ...moe } : undefined,
    );
    const selection = selector.select("moe");
    expect(selection.modelTier).toBe("weak");
    expect(selection.residentFootprint).toBe("moe");
    expect(defaultHarnessSelector.select("qwen2.5-coder:7b").residentFootprint).toBe("standard");
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
    expect(defaultHarnessSelector.profileForModel("lfm2.5:2.6b").tier).toBe("weak");
    expect(defaultHarnessSelector.profileForModel("lfm2.5:2.6b").id).toBe("lfm-agentic");
  });
});

describe("HarnessSelector -- named family profiles (v1.18 OI-A2)", () => {
  it("lists every named profile as data with generic ids", () => {
    const ids = listHarnessProfiles().map((p) => p.id).sort();
    expect(ids).toEqual([
      "balanced-scaffold",
      "concise-loop",
      "constrained-scaffold",
      "lean-scaffold",
      "lfm-agentic",
      "minimal",
      "plan-first",
      "structured-edit",
    ]);
  });

  it("profile ids, labels, and rationales contain no external harness names", () => {
    const banned = /open\s*interpreter|swe-?agent|codex-fork/i;
    for (const profile of listHarnessProfiles()) {
      expect(profile.id).not.toMatch(banned);
      expect(profile.label).not.toMatch(banned);
      expect(profile.rationale).not.toMatch(banned);
    }
  });

  it("keys qwen to plan-first, deepseek to structured-edit, llama-weak to minimal", () => {
    expect(defaultHarnessSelector.profileForModel("qwen2.5-coder:7b").id).toBe("plan-first");
    expect(defaultHarnessSelector.profileForModel("qwen2.5-coder:7b").tier).toBe("mid");
    expect(defaultHarnessSelector.profileForModel("deepseek-coder:6.7b").id).toBe("structured-edit");
    expect(defaultHarnessSelector.profileForModel("llama3.2:3b").id).toBe("minimal");
    expect(defaultHarnessSelector.profileForModel("llama3.2:3b").tier).toBe("weak");
    expect(defaultHarnessSelector.profileForModel("llama3.3:70b").id).toBe("lean-scaffold");
    expect(defaultHarnessSelector.profileForModel("gemma4:e4b").id).toBe("balanced-scaffold");
  });

  it("keys lfm2.5:2.6b to lfm-agentic and leaves non-LFM profiles unchanged", () => {
    const selection = defaultHarnessSelector.select("lfm2.5:2.6b");
    expect(selection.reason).toBe("family");
    expect(selection.family).toBe("lfm2.5");
    expect(selection.profile.id).toBe("lfm-agentic");
    expect(selection.overlay.toolCallFormat).toBe("lfm-pythonic");
    expect(selection.modelTier).toBe("weak");
    expect(defaultHarnessSelector.profileForModel("qwen2.5-coder:7b").id).toBe("plan-first");
    expect(defaultHarnessSelector.profileForModel("does-not-exist")).toBe(DEFAULT_HARNESS_PROFILE);
    expect(defaultHarnessSelector.overlayForModel("does-not-exist").toolCallFormat).toBeUndefined();
  });

  it("maps an lfm2.5 id without a catalog family row to lfm-agentic", () => {
    const lookup: CatalogLookup = (name) =>
      name === "lfm2.5:8b-a1b" ? { id: "lfm2.5:8b-a1b", vramGb: 8, tags: ["coding"] } : undefined;
    const selector = new HarnessSelector(lookup);
    expect(selector.profileForModel("lfm2.5:8b-a1b").id).toBe("lfm-agentic");
    expect(selector.select("lfm2.5:8b-a1b").reason).toBe("family");
  });

  it("falls back to the tier profile for an unknown family", () => {
    const lookup: CatalogLookup = (name) =>
      name === "odd"
        ? { id: "odd", vramGb: 8, tags: ["coding"], family: "nomic" }
        : undefined;
    const selector = new HarnessSelector(lookup);
    expect(selector.profileForModel("odd").id).toBe("balanced-scaffold");
    expect(selector.select("odd").reason).toBe("tier");
  });

  it("maps a kimi id or tag to concise-loop without a catalog family row", () => {
    const lookup: CatalogLookup = (name) => {
      if (name === "kimi-k2") return { id: "kimi-k2", vramGb: 8, tags: ["coding"] };
      if (name === "tagged") return { id: "x", vramGb: 8, tags: ["kimi", "coding"] };
      return undefined;
    };
    const selector = new HarnessSelector(lookup);
    expect(selector.profileForModel("kimi-k2").id).toBe("concise-loop");
    expect(selector.profileForModel("tagged").id).toBe("concise-loop");
  });

  it("honors a session override and reports reason override", () => {
    const lookup: CatalogLookup = (name) =>
      name === "tiny" ? { id: "tiny", vramGb: 3, tags: ["lightweight"] } : undefined;
    const selector = new HarnessSelector(lookup);
    const selection = selector.select("tiny", "plan-first");
    expect(selection.reason).toBe("override");
    expect(selection.profile.id).toBe("plan-first");
    expect(selection.profile.tier).toBe("weak");
  });
});

describe("HarnessSelector -- applyHarnessOverlay (live-path seam)", () => {
  const knobs = {
    promptStyle: "concise" as const,
    thinkingMode: false,
    systemPromptBudgetPercent: 10,
  };

  it("returns the base object by reference when disabled (byte-identical)", () => {
    const overlay = toPromptOverlay(harnessProfileForTier("weak"));
    const result = applyHarnessOverlay(false, knobs, overlay);
    expect(result).toBe(knobs);
  });

  it("spreads the overlay when enabled", () => {
    const overlay = toPromptOverlay(harnessProfileForTier("weak"));
    const result = applyHarnessOverlay(true, knobs, overlay);
    expect(result).toEqual({ ...knobs, ...overlay });
    expect(result).not.toBe(knobs);
  });
});

describe("HarnessSelector -- session override", () => {
  it("applies until model change or clear", () => {
    const session = new HarnessSessionOverride();
    session.set("plan-first", "gemma4:e4b");
    expect(session.peek("gemma4:e4b")).toBe("plan-first");
    expect(session.peek("llama3.2:3b")).toBeNull();
    session.set("minimal", "llama3.2:3b");
    expect(session.peek("llama3.2:3b")).toBe("minimal");
    session.clear();
    expect(session.peek("llama3.2:3b")).toBeNull();
  });
});

describe("HarnessSelector -- parseHarnessCommand", () => {
  it("parses inspect, list, clear, and switch", () => {
    expect(parseHarnessCommand("")).toEqual({ kind: "inspect" });
    expect(parseHarnessCommand("status")).toEqual({ kind: "inspect" });
    expect(parseHarnessCommand("list")).toEqual({ kind: "list" });
    expect(parseHarnessCommand("clear")).toEqual({ kind: "clear" });
    expect(parseHarnessCommand("plan-first")).toEqual({
      kind: "switch",
      profileId: "plan-first",
    });
    expect(parseHarnessCommand("switch minimal")).toEqual({
      kind: "switch",
      profileId: "minimal",
    });
    expect(parseHarnessCommand("nope").kind).toBe("unknown");
  });

  it("parses profile ids case-insensitively", () => {
    expect(parseHarnessProfileId("Plan-First")).toBe("plan-first");
    expect(harnessProfileById("structured-edit")?.id).toBe("structured-edit");
    expect(harnessProfileById("missing")).toBeUndefined();
  });
});
