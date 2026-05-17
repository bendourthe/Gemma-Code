import { describe, expect, it } from "vitest";
import {
  SIDECAR_MODELS,
  lookupModel,
  requireModel,
} from "../sidecar/src/coding/models";
import {
  FRONTEND_MODELS,
  DEFAULT_MODEL_ID,
} from "../src/modules/coding/models";

describe("model catalog mirrors", () => {
  it("frontend + sidecar catalogs cover the same ids", () => {
    const frontendIds = FRONTEND_MODELS.map((m) => m.id).sort();
    const sidecarIds = SIDECAR_MODELS.map((m) => m.id).sort();
    expect(frontendIds).toEqual(sidecarIds);
  });

  it("frontend + sidecar agree on display name and family", () => {
    for (const f of FRONTEND_MODELS) {
      const s = lookupModel(f.id);
      expect(s).toBeDefined();
      expect(s?.displayName).toBe(f.displayName);
      expect(s?.family).toBe(f.family);
    }
  });

  it("DEFAULT_MODEL_ID is one of the catalog entries", () => {
    expect(FRONTEND_MODELS.find((m) => m.id === DEFAULT_MODEL_ID)).toBeDefined();
  });

  it("requireModel throws on unknown ids", () => {
    expect(() => requireModel("not-a-model")).toThrow(/Unknown model id/);
  });

  it("covers each ModelFamily at least once", () => {
    const families = new Set(SIDECAR_MODELS.map((m) => m.family));
    expect(families).toEqual(new Set(["gemma", "llama", "qwen", "deepseek"]));
  });
});
