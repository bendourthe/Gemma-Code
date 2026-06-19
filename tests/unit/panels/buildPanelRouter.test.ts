import { describe, it, expect, vi } from "vitest";
import * as path from "node:path";
import type { LLMClient } from "../../../modules/coding/llm/types.js";

// v1.6.0 adoption-openrouter-fusion Phase 5 (OF011): unit tests for the
// extracted `buildPanelRouter` factory. These cover the OPT-IN / DEFAULT-OFF
// contract (disabled -> null router, byte-identical path), the enabled
// construction + panel-spec provider, the fail-safe degrade on a mis-wired
// catalog, and the GpuDetector-backed default VRAM provider -- the paths that
// were previously uncovered when the construction lived inline in
// ChatPanelBootstrap.

// Mutable GPU stub shared with the hoisted vi.mock factory so the default
// VRAM provider is covered without shelling out to nvidia-smi.
const gpu = vi.hoisted(() => ({
  primary: { freeVramMb: 8192, totalVramMb: 16384 } as
    | { freeVramMb: number; totalVramMb: number }
    | null,
}));

vi.mock("../../../modules/coding/config/GpuDetector.js", () => ({
  getGpuDetector: () => ({ detect: async () => ({ primaryGpu: gpu.primary }) }),
}));

const { buildPanelRouter, defaultFreeVramGB } = await import(
  "../../../src/panels/buildPanelRouter.js"
);
const { PanelRouter } = await import("../../../modules/coding/llm/PanelRouter.js");

const CATALOG_DIR = path.resolve(process.cwd(), "modules", "coding", "skills", "catalog");
const OLLAMA_OPTS = { num_ctx: 4096, temperature: 1, top_p: 0.95, top_k: 64 };

function fakeClient(models: readonly string[]): LLMClient {
  return {
    listModels: vi.fn(async () => models.map((name) => ({ name }))),
    streamChat: vi.fn(),
    checkHealth: vi.fn(async () => true),
    embed: vi.fn(),
    embedBatch: vi.fn(),
  } as unknown as LLMClient;
}

describe("buildPanelRouter (OF011)", () => {
  it("returns a null router + provider when disabled (default-off, byte-identical path)", () => {
    const r = buildPanelRouter({
      enabled: false,
      getClient: () => fakeClient([]),
      modelName: "gemma4:e4b",
      ollamaOptions: OLLAMA_OPTS,
      catalogDir: CATALOG_DIR,
    });
    expect(r.router).toBeNull();
    expect(r.panelSpecProvider).toBeNull();
  });

  it("builds a PanelRouter + panel-spec provider (excluding the primary) when enabled", async () => {
    const r = buildPanelRouter({
      enabled: true,
      getClient: () => fakeClient(["a", "b", "gemma4:e4b"]),
      modelName: "gemma4:e4b",
      ollamaOptions: OLLAMA_OPTS,
      catalogDir: CATALOG_DIR,
      vramProvider: () => 16,
    });
    expect(r.router).toBeInstanceOf(PanelRouter);
    expect(typeof r.panelSpecProvider).toBe("function");
    // The primary model is excluded; the executor de-dupes/caps the rest.
    expect(await r.panelSpecProvider!()).toEqual(["a", "b"]);
  });

  it("degrades to a null router (fail-safe) when construction throws (bad catalog)", () => {
    const r = buildPanelRouter({
      enabled: true,
      getClient: () => fakeClient([]),
      modelName: "m",
      ollamaOptions: OLLAMA_OPTS,
      catalogDir: path.join(process.cwd(), "no", "such", "catalog"),
      vramProvider: () => 16,
    });
    expect(r.router).toBeNull();
    expect(r.panelSpecProvider).toBeNull();
  });

  it("defaultFreeVramGB returns free VRAM in GB when available", async () => {
    gpu.primary = { freeVramMb: 8192, totalVramMb: 16384 };
    expect(await defaultFreeVramGB()).toBe(8);
  });

  it("defaultFreeVramGB falls back to total VRAM when free is unknown", async () => {
    gpu.primary = { freeVramMb: 0, totalVramMb: 16384 };
    expect(await defaultFreeVramGB()).toBe(16);
  });

  it("defaultFreeVramGB returns 0 when no GPU is detected", async () => {
    gpu.primary = null;
    expect(await defaultFreeVramGB()).toBe(0);
  });
});
