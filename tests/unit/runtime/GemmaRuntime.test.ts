import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/llm/OllamaClient.js", () => ({
  createOllamaClient: vi.fn(() => ({
    checkHealth: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    streamChat: vi.fn(async function* () {
      yield { message: { role: "assistant", content: "ok" }, done: true };
    }),
  })),
}));

vi.mock("../../../src/config/settings.js", () => ({
  getSettings: vi.fn(() => ({
    ollamaUrl: "http://localhost:11434",
    requestTimeout: 30000,
    modelName: "gemma4:e4b",
    maxTokens: 131072,
  })),
  onSettingsChange: vi.fn(() => ({ dispose: vi.fn() })),
}));

const { GemmaRuntime } = await import("../../../src/runtime/GemmaRuntime.js");
const { createOllamaClient } = await import("../../../src/llm/OllamaClient.js");

describe("GemmaRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supplies the OllamaClient via factory rather than constructing inside the panel", () => {
    const runtime = new GemmaRuntime();

    // The runtime is the composition root for the LLM port: it owns the
    // `createOllamaClient` call. ADR-0011 codifies this pattern.
    const client = runtime.getOllamaClient();

    expect(client).toBeDefined();
    expect(createOllamaClient).toHaveBeenCalledOnce();
    expect(createOllamaClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "http://localhost:11434",
        timeoutMs: 30000,
      }),
    );
  });

  it("returns the same OllamaClient instance on repeated calls when inputs are unchanged", () => {
    const runtime = new GemmaRuntime();
    const a = runtime.getOllamaClient();
    const b = runtime.getOllamaClient();

    expect(a).toBe(b);
    expect(createOllamaClient).toHaveBeenCalledOnce();
  });

  it("exposes the current settings snapshot via the `settings` getter", () => {
    const runtime = new GemmaRuntime();
    expect(runtime.settings.modelName).toBe("gemma4:e4b");
    expect(runtime.settings.ollamaUrl).toBe("http://localhost:11434");
  });

  it("registers a tracer instance for downstream consumers", () => {
    const runtime = new GemmaRuntime();
    expect(runtime.tracer).toBeDefined();
  });
});
