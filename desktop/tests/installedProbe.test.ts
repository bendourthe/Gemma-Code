/**
 * v1.15.0 Phase 4 (Issue 3) -- registry/Ollama/weights reconciliation (pure).
 */

import { describe, it, expect } from "vitest";

import { markInstalledFromProbe, ollamaTagForSpec } from "../../core/registry/installedProbe";
import type { CatalogFile } from "../../core/registry/catalog";
import type { ListedModel } from "../../core/registry/NexusModelRegistry";

const CATALOG = {
  models: [
    { id: "gemma-4-12b-it-gguf", source: { protocol: "ollama", url: "ollama://gemma4:12b" } },
    { id: "realvisxl-v5", source: { protocol: "huggingface", url: "https://hf/x" } },
    { id: "nomic-embed-text", source: { protocol: "ollama", url: "ollama://nomic-embed-text:latest" } },
    {
      id: "lfm2.5:2.6b",
      source: { protocol: "ollama", url: "ollama://hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M" },
    },
  ],
} as unknown as CatalogFile;

function catalogOnly(id: string): ListedModel {
  return { id, displayName: id, installed: false, source: "catalog-only" } as ListedModel;
}

describe("ollamaTagForSpec", () => {
  it("extracts the tag from an ollama:// url", () => {
    expect(
      ollamaTagForSpec({ source: { protocol: "ollama", url: "ollama://gemma4:12b" } }),
    ).toBe("gemma4:12b");
  });

  it("returns null for a non-ollama spec or a non-ollama:// url", () => {
    expect(ollamaTagForSpec({ source: { protocol: "huggingface", url: "https://x" } })).toBeNull();
    expect(ollamaTagForSpec(undefined)).toBeNull();
    expect(ollamaTagForSpec({ source: { protocol: "ollama", url: "gemma4:12b" } })).toBeNull();
  });

  it("extracts an hf.co GGUF pull target (v1.19.0 Phase 1)", () => {
    expect(
      ollamaTagForSpec({
        source: { protocol: "ollama", url: "ollama://hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M" },
      }),
    ).toBe("hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M");
  });
});

describe("markInstalledFromProbe", () => {
  it("flips catalog-only entries present in Ollama or the weights tree", () => {
    const listed = [
      catalogOnly("gemma-4-12b-it-gguf"),
      catalogOnly("realvisxl-v5"),
      catalogOnly("nomic-embed-text"),
    ];
    const out = markInstalledFromProbe(listed, CATALOG, {
      ollamaTags: new Set(["gemma4:12b"]),
      weightsIds: new Set(["realvisxl-v5"]),
    });
    const byId = Object.fromEntries(out.map((m) => [m.id, m]));
    expect(byId["gemma-4-12b-it-gguf"]).toMatchObject({ installed: true, source: "registry" });
    expect(byId["realvisxl-v5"]).toMatchObject({ installed: true, source: "registry" });
    expect(byId["nomic-embed-text"]).toMatchObject({ installed: false, source: "catalog-only" });
  });

  it("flips LFM when Ollama reports the official GGUF tag (v1.19.0 Phase 1)", () => {
    const out = markInstalledFromProbe([catalogOnly("lfm2.5:2.6b")], CATALOG, {
      ollamaTags: new Set(["hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M"]),
      weightsIds: new Set(),
    });
    expect(out[0]).toMatchObject({ installed: true, source: "registry" });
  });

  it("leaves already-installed registry / external entries untouched", () => {
    const reg = { id: "x", displayName: "X", installed: true, source: "registry" } as ListedModel;
    const ext = { id: "y", displayName: "Y", installed: true, source: "external" } as ListedModel;
    const out = markInstalledFromProbe([reg, ext], CATALOG, {
      ollamaTags: new Set(),
      weightsIds: new Set(),
    });
    expect(out).toEqual([reg, ext]);
  });
});
