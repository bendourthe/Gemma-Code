/**
 * v1.16.0 Phase 5 (A4) -- catalog discovery helpers.
 */

import { describe, expect, it } from "vitest";

import {
  filterCatalog,
  modelFitsHost,
  sourceLabel,
} from "../src/shared/models/modelLibrary";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";

const MODELS: ListedModelDto[] = [
  {
    id: "gemma4:e4b",
    displayName: "Gemma 4 E4B",
    family: "gemma4",
    type: "llm",
    installed: true,
    source: "registry",
    vramGB: 6,
    tags: ["recommended"],
  },
  {
    id: "qwen2.5-coder:7b",
    displayName: "Qwen 2.5 Coder 7B",
    family: "qwen",
    type: "llm",
    installed: false,
    source: "catalog-only",
    vramGB: 7,
  },
  {
    id: "unlimited-ocr",
    displayName: "Unlimited-OCR 3B",
    family: "unlimited-ocr",
    type: "document",
    installed: false,
    source: "catalog-only",
    vramGB: 12,
  },
  {
    id: "external:comfyui:dreamshaper",
    displayName: "dreamshaper.safetensors",
    family: "checkpoints",
    type: "image",
    installed: true,
    source: "external",
    vramGB: 8,
  },
];

describe("modelFitsHost", () => {
  it("returns true when the catalog VRAM is at or under the host", () => {
    expect(modelFitsHost(MODELS[0]!, 8)).toBe(true);
    expect(modelFitsHost(MODELS[0]!, 6)).toBe(true);
  });

  it("returns false when the catalog VRAM exceeds the host", () => {
    expect(modelFitsHost(MODELS[2]!, 8)).toBe(false);
  });

  it("returns null when either side is unknown", () => {
    expect(modelFitsHost({ ...MODELS[0]!, vramGB: undefined }, 8)).toBeNull();
    expect(modelFitsHost(MODELS[0]!, null)).toBeNull();
    expect(modelFitsHost(MODELS[0]!, undefined)).toBeNull();
  });
});

describe("filterCatalog", () => {
  it("filters by installed / available / external source", () => {
    expect(filterCatalog(MODELS, { source: "installed" }).map((m) => m.id)).toEqual(["gemma4:e4b"]);
    expect(filterCatalog(MODELS, { source: "available" }).map((m) => m.id)).toEqual([
      "qwen2.5-coder:7b",
      "unlimited-ocr",
    ]);
    expect(filterCatalog(MODELS, { source: "external" }).map((m) => m.id)).toEqual([
      "external:comfyui:dreamshaper",
    ]);
  });

  it("filters by type and free-text (name, type, tags)", () => {
    expect(filterCatalog(MODELS, { type: "document" }).map((m) => m.id)).toEqual(["unlimited-ocr"]);
    expect(filterCatalog(MODELS, { query: "recommended" }).map((m) => m.id)).toEqual(["gemma4:e4b"]);
    expect(filterCatalog(MODELS, { query: "document" }).map((m) => m.id)).toEqual(["unlimited-ocr"]);
  });

  it("filters by tier-fit against host VRAM", () => {
    expect(filterCatalog(MODELS, { tierFit: "fits", hostVramGB: 8 }).map((m) => m.id)).toEqual([
      "gemma4:e4b",
      "qwen2.5-coder:7b",
      "external:comfyui:dreamshaper",
    ]);
    expect(filterCatalog(MODELS, { tierFit: "over-budget", hostVramGB: 8 }).map((m) => m.id)).toEqual([
      "unlimited-ocr",
    ]);
  });

  it("composes source + type + query", () => {
    expect(
      filterCatalog(MODELS, { source: "available", type: "llm", query: "qwen" }).map((m) => m.id),
    ).toEqual(["qwen2.5-coder:7b"]);
  });
});

describe("sourceLabel", () => {
  it("maps the three registry sources to UI labels", () => {
    expect(sourceLabel("registry")).toBe("Installed");
    expect(sourceLabel("catalog-only")).toBe("Available");
    expect(sourceLabel("external")).toBe("External");
  });
});
