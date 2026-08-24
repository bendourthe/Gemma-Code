import { describe, expect, it } from "vitest";
import { ModelCatalog } from "../../core/registry/ModelCatalog";
import {
  SIDECAR_MODELS,
  lookupModel,
  requireModel,
} from "../sidecar/src/coding/models";
import {
  FRONTEND_MODELS,
  DEFAULT_MODEL_ID,
} from "../src/modules/coding/models";

// v1.1.0 Phase 2 (sub-task 2.3 / closes 1.9.P1.E) -- the sidecar + frontend
// catalogs are now derived from `core/registry/ModelCatalog`, so the test
// asserts positional equality against the canonical source instead of the
// older "two mirrors stay in sync" formulation.

describe("model catalog (derived from core/registry/ModelCatalog)", () => {
  const canonicalIds = ModelCatalog.listLlm().map((m) => m.id);

  it("sidecar view exposes the same ids in the same order as the canonical catalog", () => {
    expect(SIDECAR_MODELS.map((m) => m.id)).toEqual(canonicalIds);
  });

  it("frontend view exposes the same ids in the same order as the canonical catalog", () => {
    expect(FRONTEND_MODELS.map((m) => m.id)).toEqual(canonicalIds);
  });

  it("sidecar + frontend agree on display name and family for every entry", () => {
    for (const f of FRONTEND_MODELS) {
      const s = lookupModel(f.id);
      expect(s).toBeDefined();
      expect(s?.displayName).toBe(f.displayName);
      expect(s?.family).toBe(f.family);
    }
  });

  it("sidecar projection preserves promptFormat + toolFormat from the canonical catalog", () => {
    for (const canonical of ModelCatalog.listLlm()) {
      const s = lookupModel(canonical.id);
      expect(s?.promptFormat).toBe(canonical.promptFormat);
      expect(s?.toolFormat).toBe(canonical.toolFormat);
    }
  });

  it("DEFAULT_MODEL_ID is one of the catalog entries", () => {
    expect(FRONTEND_MODELS.find((m) => m.id === DEFAULT_MODEL_ID)).toBeDefined();
  });

  it("requireModel throws on unknown ids", () => {
    expect(() => requireModel("not-a-model")).toThrow(/Unknown model id/);
    expect(() => requireModel("not-a-model")).toThrow(/Known aliases/);
  });

  it("requireModel resolves gemma-4-12b-it-gguf via alias to gemma4:12b", () => {
    const fromCatalog = requireModel("gemma-4-12b-it-gguf");
    const fromTag = requireModel("gemma4:12b");
    expect(fromCatalog).toEqual(fromTag);
    expect(fromCatalog.id).toBe("gemma4:12b");
    expect(fromCatalog.codingAvailable).toBe(false);
  });

  it("requireModel still accepts coding id gemma4:e4b", () => {
    const entry = requireModel("gemma4:e4b");
    expect(entry.id).toBe("gemma4:e4b");
    expect(entry.codingAvailable).toBe(true);
  });

  it("covers each ModelFamily at least once", () => {
    const families = new Set(SIDECAR_MODELS.map((m) => m.family));
    expect(families).toEqual(new Set(["gemma", "llama", "qwen", "deepseek", "lfm2.5", "hermes", "muse-glimmer", "nemotron-lightning", "gpt-oss"]));
  });
});
