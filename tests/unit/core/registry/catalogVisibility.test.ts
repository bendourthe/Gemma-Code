import { describe, it, expect } from "vitest";
import {
  catalogEntryVisibility,
  isHiddenByVram,
  visibleCatalogEntries,
} from "../../../../core/registry/catalogVisibility.js";

describe("catalogVisibility (v2.1.0 Phase 1)", () => {
  const muse = {
    id: "muse-glimmer:30b",
    hideBelowVramGB: 16,
    minOllamaVersion: "0.32.7",
  };

  it("hides entries below hideBelowVramGB and keeps them on 16 GB+", () => {
    expect(isHiddenByVram(muse, 12)).toBe(true);
    expect(isHiddenByVram(muse, 16)).toBe(false);
    expect(catalogEntryVisibility(muse, { hostVramGb: 12 }).visible).toBe(false);
    expect(catalogEntryVisibility(muse, { hostVramGb: 12 }).reason).toBe("hidden-vram");
    expect(catalogEntryVisibility(muse, { hostVramGb: 24 }).visible).toBe(true);
  });

  it("hides on an older known Ollama version with an update note", () => {
    const result = catalogEntryVisibility(muse, {
      hostVramGb: 24,
      ollamaVersion: "0.32.6",
      requireKnownOllama: true,
    });
    expect(result.visible).toBe(false);
    expect(result.reason).toBe("hidden-ollama");
    expect(result.note).toMatch(/0\.32\.7/);
  });

  it("keeps the row when Ollama version is unknown unless requireKnownOllama is set", () => {
    const installer = catalogEntryVisibility(muse, { hostVramGb: 24, ollamaVersion: null });
    expect(installer.visible).toBe(true);
    expect(installer.note).toMatch(/Update Ollama/);
    const runtime = catalogEntryVisibility(muse, {
      hostVramGb: 24,
      ollamaVersion: null,
      requireKnownOllama: true,
    });
    expect(runtime.visible).toBe(false);
  });

  it("filters a list to visible entries", () => {
    const lightning = {
      id: "nemotron-lightning:30b-a3b",
      hideBelowVramGB: 16,
      minOllamaVersion: "0.32.9",
    };
    const gemma = { id: "gemma4:e4b" };
    const visible = visibleCatalogEntries([muse, lightning, gemma], {
      hostVramGb: 12,
      ollamaVersion: "0.33.0",
    });
    expect(visible.map((e) => e.id)).toEqual(["gemma4:e4b"]);
  });
});
