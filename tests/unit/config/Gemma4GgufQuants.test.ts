import { describe, it, expect } from "vitest";
import {
  GEMMA4_GGUF_QUANTS,
  GEMMA4_GGUF_MODEL_ID,
  GEMMA4_GGUF_OLLAMA_BASE,
  GEMMA4_GGUF_CONTEXT_WINDOW,
  GEMMA4_GGUF_MULTIMODAL,
  GEMMA4_GGUF_DEFAULT_QUANT,
  selectGemma4GgufQuant,
  gemma4GgufQuantsForTier,
} from "../../../modules/coding/config/Gemma4GgufQuants.js";
import { classifyTier } from "../../../modules/coding/config/HardwareTier.js";

describe("Gemma4Gguf constants", () => {
  it("records the 256K context window and native multimodal flag", () => {
    expect(GEMMA4_GGUF_CONTEXT_WINDOW).toBe(262_144);
    expect(GEMMA4_GGUF_MULTIMODAL).toBe(true);
  });

  it("matches the catalog id and the Unsloth Ollama base reference", () => {
    expect(GEMMA4_GGUF_MODEL_ID).toBe("gemma-4-12b-it-gguf");
    expect(GEMMA4_GGUF_OLLAMA_BASE).toBe("hf.co/unsloth/gemma-4-12b-it-GGUF");
  });

  it("exposes a default quant that exists in the ladder", () => {
    expect(GEMMA4_GGUF_DEFAULT_QUANT).toBe("Q4_K_XL");
    expect(GEMMA4_GGUF_QUANTS.some((q) => q.quant === GEMMA4_GGUF_DEFAULT_QUANT)).toBe(true);
  });
});

describe("GEMMA4_GGUF_QUANTS ladder", () => {
  it("carries the full Unsloth Dynamic-2.0 quant ladder with published disk sizes", () => {
    const byQuant = new Map(GEMMA4_GGUF_QUANTS.map((q) => [q.quant, q]));
    expect([...byQuant.keys()]).toEqual(["IQ2_M", "Q3_K", "Q4_K_XL", "Q5_K", "Q6_K", "BF16"]);
    expect(byQuant.get("IQ2_M")?.diskSizeGB).toBeCloseTo(4.21, 2);
    expect(byQuant.get("Q4_K_XL")?.diskSizeGB).toBeCloseTo(7.37, 2);
    expect(byQuant.get("Q6_K")?.diskSizeGB).toBeCloseTo(10.7, 1);
    expect(byQuant.get("BF16")?.diskSizeGB).toBeCloseTo(23.8, 1);
  });

  it("builds the Ollama ref as `<base>:<quant>`", () => {
    for (const q of GEMMA4_GGUF_QUANTS) {
      expect(q.ollamaRef).toBe(`hf.co/unsloth/gemma-4-12b-it-GGUF:${q.quant}`);
    }
  });

  it("maps every quant to the tier classifyTier derives from its VRAM", () => {
    for (const q of GEMMA4_GGUF_QUANTS) {
      expect(q.hardwareTier).toBe(classifyTier(q.minVramMb));
    }
  });

  it("spreads quants across all three hardware tiers", () => {
    const tierOf = (quant: string) =>
      GEMMA4_GGUF_QUANTS.find((q) => q.quant === quant)?.hardwareTier;
    expect(tierOf("IQ2_M")).toBe(1);
    expect(tierOf("Q3_K")).toBe(1);
    expect(tierOf("Q4_K_XL")).toBe(2);
    expect(tierOf("Q5_K")).toBe(2);
    expect(tierOf("Q6_K")).toBe(2);
    expect(tierOf("BF16")).toBe(3);
  });

  it("lists quants per tier via gemma4GgufQuantsForTier", () => {
    expect(gemma4GgufQuantsForTier(1).map((q) => q.quant)).toEqual(["IQ2_M", "Q3_K"]);
    expect(gemma4GgufQuantsForTier(3).map((q) => q.quant)).toEqual(["BF16"]);
  });
});

describe("selectGemma4GgufQuant (hardware-aware picker)", () => {
  it.each([
    [6_144, "IQ2_M"],
    [8_192, "Q3_K"],
    [10_240, "Q4_K_XL"],
    [12_288, "Q5_K"],
    [16_384, "Q6_K"],
    [30_000, "BF16"],
    [131_072, "BF16"],
  ] as Array<[number, string]>)(
    "picks the largest quant that fits %d MB VRAM (%s)",
    (vramMb, expected) => {
      expect(selectGemma4GgufQuant(vramMb).quant).toBe(expected);
    },
  );

  it("falls back to the smallest quant when nothing fits the VRAM budget", () => {
    expect(selectGemma4GgufQuant(2_048).quant).toBe("IQ2_M");
    expect(selectGemma4GgufQuant(0).quant).toBe("IQ2_M");
  });
});
