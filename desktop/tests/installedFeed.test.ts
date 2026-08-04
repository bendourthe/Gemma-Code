/**
 * v1.15.0 Phase 4 (Issue 3) -- studio installed-models feed helper.
 */

import { describe, it, expect } from "vitest";

import {
  installedModelsForType,
  SETTINGS_MODELS_PATH,
} from "../src/shared/models/installedFeed";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";

const MODELS: ListedModelDto[] = [
  { id: "img-ready", displayName: "Img", type: "image", installed: true, source: "registry" },
  { id: "img-catalog", displayName: "ImgC", type: "image", installed: false, source: "catalog-only" },
  { id: "vid-ready", displayName: "Vid", type: "video", installed: true, source: "external" },
  { id: "llm-ready", displayName: "LLM", type: "llm", installed: true, source: "registry" },
];

describe("installedModelsForType", () => {
  it("returns only installed, ready models of the requested type", () => {
    expect(installedModelsForType(MODELS, "image").map((m) => m.id)).toEqual(["img-ready"]);
  });

  it("excludes catalog-only entries and other types", () => {
    expect(installedModelsForType(MODELS, "video").map((m) => m.id)).toEqual(["vid-ready"]);
    expect(installedModelsForType(MODELS, "audio")).toEqual([]);
  });

  it("exposes the Settings > Models deep-link path", () => {
    expect(SETTINGS_MODELS_PATH).toBe("/settings?tab=models");
  });
});
