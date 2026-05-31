import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../modules/coding/llm/OllamaClient.js", () => ({
  createOllamaClient: vi.fn(() => ({
    checkHealth: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    streamChat: vi.fn(async function* () {
      yield { message: { role: "assistant", content: "ok" }, done: true };
    }),
  })),
}));

vi.mock("../../../modules/coding/config/settings.js", () => ({
  getSettings: vi.fn(() => ({
    ollamaUrl: "http://localhost:11434",
    requestTimeout: 30000,
    modelName: "gemma4:e4b",
    maxTokens: 131072,
  })),
  onSettingsChange: vi.fn(() => ({ dispose: vi.fn() })),
}));

const { NexusCodingRuntime } = await import("../../../modules/coding/runtime/NexusCodingRuntime.js");
const { createOllamaClient } = await import("../../../modules/coding/llm/OllamaClient.js");

describe("NexusCodingRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supplies the OllamaClient via factory rather than constructing inside the panel", () => {
    const runtime = new NexusCodingRuntime();

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
    const runtime = new NexusCodingRuntime();
    const a = runtime.getOllamaClient();
    const b = runtime.getOllamaClient();

    expect(a).toBe(b);
    expect(createOllamaClient).toHaveBeenCalledOnce();
  });

  it("exposes the current settings snapshot via the `settings` getter", () => {
    const runtime = new NexusCodingRuntime();
    expect(runtime.settings.modelName).toBe("gemma4:e4b");
    expect(runtime.settings.ollamaUrl).toBe("http://localhost:11434");
  });

  it("registers a tracer instance for downstream consumers", () => {
    const runtime = new NexusCodingRuntime();
    expect(runtime.tracer).toBeDefined();
  });
});
