import { describe, it, expect } from "vitest";
import {
  conservativeResidentVramGb,
  isMoeResident,
} from "../../../../core/registry/moeFootprint.js";

describe("moeFootprint (v1.18.0 Phase 3 LG-A3)", () => {
  it("prefers explicit vramGb and never substitutes activeParams", () => {
    expect(conservativeResidentVramGb({ vramGb: 14, activeParams: 2.4, totalParams: 16 })).toBe(14);
    expect(conservativeResidentVramGb({ activeParams: 2.4 })).toBeUndefined();
    expect(conservativeResidentVramGb({ totalParams: 16 })).toBe(16 * 0.6);
  });

  it("flags MoE resident when total exceeds active", () => {
    expect(isMoeResident({ activeParams: 2.4, totalParams: 16 })).toBe(true);
    expect(isMoeResident({ vramGb: 7 })).toBe(false);
    expect(isMoeResident({ activeParams: 8, totalParams: 8 })).toBe(false);
  });
});
