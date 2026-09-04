/**
 * v1.15.0 Phase 4 (Issue 3) -- studio installed-models feed helper.
 */

import { describe, it, expect } from "vitest";

import {
  GET_MORE_MODELS_ID,
  installedModelsForType,
  SETTINGS_MODELS_PATH,
} from "../src/shared/models/installedFeed";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";

const MODELS: ListedModelDto[] = [
  {
    id: "img-ready",
    displayName: "Img",
    type: "image",
    installed: true,
    source: "registry",
  },
  {
    id: "img-catalog",
    displayName: "ImgC",
    type: "image",
    installed: false,
    source: "catalog-only",
  },
  {
    id: "vid-ready",
    displayName: "Vid",
    type: "video",
    installed: true,
    source: "external",
  },
  {
    id: "llm-ready",
    displayName: "LLM",
    type: "llm",
    installed: true,
    source: "registry",
  },
];

describe("installedModelsForType", () => {
  it("returns only owned installed models of the requested type", () => {
    expect(
      installedModelsForType(MODELS, "image", new Set(["img-ready"])).map(
        (m) => m.id,
      ),
    ).toEqual(["img-ready"]);
  });

  it("excludes catalog-only entries, other types, and omitted ownership", () => {
    expect(
      installedModelsForType(MODELS, "video", new Set(["vid-ready"])).map(
        (m) => m.id,
      ),
    ).toEqual(["vid-ready"]);
    expect(
      installedModelsForType(MODELS, "audio", new Set(["vid-ready"])),
    ).toEqual([]);
    expect(installedModelsForType(MODELS, "image")).toEqual([]);
  });

  it("exposes the Settings > Models deep-link path", () => {
    expect(SETTINGS_MODELS_PATH).toBe("/settings?tab=models");
    expect(GET_MORE_MODELS_ID).toBe("__get_more_models__");
  });

  it("intersects with an ownership set when one is provided", () => {
    expect(
      installedModelsForType(
        MODELS,
        "llm",
        new Set(["llm-ready", "missing"]),
      ).map((m) => m.id),
    ).toEqual(["llm-ready"]);
  });
});
