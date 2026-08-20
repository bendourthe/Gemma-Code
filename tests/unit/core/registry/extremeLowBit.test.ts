import { describe, it, expect } from "vitest";
import type { ModelSpec } from "../../../../core/registry/catalog.js";
import {
  EXTREME_LOW_BIT_MIN_OLLAMA_VERSION,
  isExtremeLowBitModelVisible,
  isExtremeLowBitQuant,
  isExtremeLowBitSpec,
  parseOllamaVersion,
  runtimeSupportsExtremeLowBit,
  ollamaVersionAtLeast,
} from "../../../../core/registry/extremeLowBit.js";

function spec(overrides: Partial<ModelSpec>): ModelSpec {
  return {
    id: "test/model",
    family: "bitnet",
    name: "model",
    tag: "latest",
    type: "llm",
    displayName: "Test",
    source: { protocol: "ollama" },
    ...overrides,
  } as ModelSpec;
}

describe("extremeLowBit -- quant classification (Q1)", () => {
  it("recognizes BitNet-class ternary / 1-bit quant labels (case-insensitive)", () => {
    expect(isExtremeLowBitQuant("TQ1_0")).toBe(true);
    expect(isExtremeLowBitQuant("q2_0")).toBe(true);
    expect(isExtremeLowBitQuant("ternary")).toBe(true);
  });
  it("does not flag ordinary 4-bit-and-up quants or an absent quant", () => {
    expect(isExtremeLowBitQuant("Q4_K_M")).toBe(false);
    expect(isExtremeLowBitQuant("BF16")).toBe(false);
    expect(isExtremeLowBitQuant(undefined)).toBe(false);
  });

  it("classifies Unsloth UD / MXFP4-style labels as extreme-low-bit (v1.18 LG-A2)", () => {
    expect(isExtremeLowBitQuant("UD-IQ1_S")).toBe(true);
    expect(isExtremeLowBitQuant("UD-IQ1_M")).toBe(true);
    expect(isExtremeLowBitQuant("UD-IQ2_XXS")).toBe(true);
    expect(isExtremeLowBitQuant("ud-iq2_m")).toBe(true);
    expect(isExtremeLowBitQuant("UD-Q2_K_XL")).toBe(true);
    expect(isExtremeLowBitQuant("MXFP4_MOE")).toBe(true);
    expect(isExtremeLowBitQuant("UD-IQ2_XS")).toBe(true);
  });

  it("unknown labels stay fail-closed (not treated as a supported new tier)", () => {
    expect(isExtremeLowBitQuant("Q5_K_M")).toBe(false);
    expect(isExtremeLowBitQuant("mystery-quant")).toBe(false);
    expect(EXTREME_LOW_BIT_MIN_OLLAMA_VERSION).toBe("999.0.0");
    expect(runtimeSupportsExtremeLowBit("0.32.0")).toBe(false);
  });
});

describe("extremeLowBit -- runtime probe (EM007)", () => {
  it("parses a version out of assorted strings", () => {
    expect(parseOllamaVersion("0.32.0")).toEqual([0, 32, 0]);
    expect(parseOllamaVersion("ollama version is 1.2.3")).toEqual([1, 2, 3]);
    expect(parseOllamaVersion(null)).toBeNull();
    expect(parseOllamaVersion("nope")).toBeNull();
  });
  it("is fail-closed: no real Ollama version claims support (threshold unconfirmed)", () => {
    expect(runtimeSupportsExtremeLowBit("0.32.0")).toBe(false);
    expect(runtimeSupportsExtremeLowBit(null)).toBe(false);
    expect(runtimeSupportsExtremeLowBit("garbage")).toBe(false);
  });
  it("returns true only at/above the confirmed threshold", () => {
    expect(runtimeSupportsExtremeLowBit(EXTREME_LOW_BIT_MIN_OLLAMA_VERSION)).toBe(true);
    const [maj] = parseOllamaVersion(EXTREME_LOW_BIT_MIN_OLLAMA_VERSION) ?? [0, 0, 0];
    expect(runtimeSupportsExtremeLowBit(`${maj + 1}.0.0`)).toBe(true);
  });
  it("ollamaVersionAtLeast compares catalog min versions (v2.1.0)", () => {
    expect(ollamaVersionAtLeast("0.32.9", "0.32.9")).toBe(true);
    expect(ollamaVersionAtLeast("0.33.0", "0.32.9")).toBe(true);
    expect(ollamaVersionAtLeast("0.32.8", "0.32.9")).toBe(false);
    expect(ollamaVersionAtLeast(null, "0.32.9")).toBe(false);
    expect(ollamaVersionAtLeast("0.32.7", "nope")).toBe(true);
  });
});

describe("extremeLowBit -- visibility gate (EM008)", () => {
  it("ignores non extreme-low-bit specs (always visible here)", () => {
    const s = spec({ quant: "Q4_K_M" });
    expect(isExtremeLowBitSpec(s)).toBe(false);
    expect(isExtremeLowBitModelVisible(s, false)).toBe(true);
    expect(isExtremeLowBitModelVisible(s, true)).toBe(true);
  });

  it("hides an extreme-low-bit spec when the runtime does not support it", () => {
    const s = spec({ quant: "TQ1_0", benchmark: "https://example.org/bench" });
    expect(isExtremeLowBitSpec(s)).toBe(true);
    expect(isExtremeLowBitModelVisible(s, false)).toBe(false);
  });

  it("surfaces an extreme-low-bit spec only with runtime support AND an independent benchmark", () => {
    const benched = spec({ quant: "TQ1_0", benchmark: "https://example.org/bench" });
    expect(isExtremeLowBitModelVisible(benched, true)).toBe(true);

    const unbenched = spec({ quant: "TQ1_0" });
    expect(isExtremeLowBitModelVisible(unbenched, true)).toBe(false);
  });

  it("never surfaces a blocked (uncorroborated) vendor even when benchmarked + supported", () => {
    const bonsai = spec({
      id: "bonsai-27b",
      quant: "1bit",
      benchmark: "https://prismml.example/claim",
      provenance: "PrismML-Eng",
    });
    expect(isExtremeLowBitModelVisible(bonsai, true)).toBe(false);
  });
});
