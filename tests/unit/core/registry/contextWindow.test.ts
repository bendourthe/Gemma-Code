import { describe, expect, it } from "vitest";

import {
  catalogContextFromSpec,
  formatContextChip,
  formatContextWindowK,
  formatContextWindowValue,
  parseContextWindow,
} from "../../../../core/registry/contextWindow.js";

describe("parseContextWindow", () => {
  it("returns a positive integer", () => {
    expect(parseContextWindow(128000)).toBe(128_000);
    expect(parseContextWindow("32000")).toBe(32_000);
  });

  it("returns null for missing, zero, or junk instead of inventing 128k", () => {
    expect(parseContextWindow(undefined)).toBeNull();
    expect(parseContextWindow(null)).toBeNull();
    expect(parseContextWindow(0)).toBeNull();
    expect(parseContextWindow("not-a-window")).toBeNull();
    expect(parseContextWindow(true)).toBeNull();
  });
});

describe("formatContextWindowK / formatContextChip", () => {
  it("renders 128000 as 128k without the word in", () => {
    expect(formatContextWindowK(128000)).toBe("128k");
    expect(formatContextChip({ contextWindow: 128000 })).toBe("Context: 128k");
    expect(formatContextChip({ contextWindow: 128000 })).not.toMatch(/\bin\b/);
  });

  it("renders a split in/out pair as Nk / Mk", () => {
    expect(
      formatContextWindowValue({ contextWindowIn: 32000, contextWindowOut: 8000 }),
    ).toBe("32k / 8k");
    expect(
      formatContextChip({ contextWindowIn: 32000, contextWindowOut: 8000 }),
    ).toBe("Context: 32k / 8k");
  });

  it("omits the chip when both windows are null", () => {
    expect(formatContextChip({ contextWindow: null, contextWindowIn: null })).toBeNull();
    expect(formatContextChip({})).toBeNull();
  });
});

describe("catalogContextFromSpec", () => {
  it("does not copy a default 128000 onto a null catalog row", () => {
    expect(catalogContextFromSpec({ contextWindow: null }, "sana-1.6b-4k")).toEqual({
      contextWindow: null,
      contextWindowIn: null,
      contextWindowOut: null,
    });
  });
});
