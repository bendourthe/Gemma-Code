import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../modules/coding/llm/OllamaClient.js", () => ({
  createOllamaClient: vi.fn(() => ({
    __kind: "ollama",
    checkHealth: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    streamChat: vi.fn(async function* () {
      yield { message: { role: "assistant", content: "ok" }, done: true };
    }),
  })),
}));

vi.mock("../../../modules/coding/llm/LmStudioClient.js", () => ({
  createLmStudioClient: vi.fn(() => ({
    __kind: "lmstudio",
    checkHealth: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    streamChat: vi.fn(async function* () {
      yield { message: { role: "assistant", content: "ok" }, done: true };
    }),
  })),
}));

// Capture the settings-change callback so tests can fire a live reconfigure.
const hoisted = vi.hoisted(() => ({
  onChange: null as ((s: unknown) => void) | null,
}));

vi.mock("../../../modules/coding/config/settings.js", () => ({
  getSettings: vi.fn(),
  onSettingsChange: vi.fn((cb: (s: unknown) => void) => {
    hoisted.onChange = cb;
    return { dispose: vi.fn() };
  }),
}));

const { NexusCodingRuntime } = await import("../../../modules/coding/runtime/NexusCodingRuntime.js");
const { createOllamaClient } = await import("../../../modules/coding/llm/OllamaClient.js");
const { createLmStudioClient } = await import("../../../modules/coding/llm/LmStudioClient.js");
const { getSettings } = await import("../../../modules/coding/config/settings.js");

/** Baseline settings snapshot; individual tests override fields as needed. */
function baselineSettings(overrides: Record<string, unknown> = {}) {
  return {
    ollamaUrl: "http://localhost:11434",
    lmStudioBaseUrl: "http://127.0.0.1:1234",
    requestTimeout: 30000,
    modelName: "gemma4:e4b",
    maxTokens: 131072,
    llmBackend: "ollama",
    localAdapters: [],
    egressDenyExtra: [],
    traceAutoEnable: false,
    ...overrides,
  };
}

describe("NexusCodingRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettings).mockReturnValue(baselineSettings() as never);
  });

  it("supplies the OllamaClient via the adapter registry rather than constructing inside the panel", () => {
    const runtime = new NexusCodingRuntime();

    // The runtime is the composition root for the LLM port: it owns the
    // adapter registry, which calls `createOllamaClient`. ADR-0011 / ADR-0017.
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

  it("routes to the LM Studio adapter when the backend is set to lmstudio", () => {
    vi.mocked(getSettings).mockReturnValue(
      baselineSettings({ llmBackend: "lmstudio" }) as never,
    );
    const runtime = new NexusCodingRuntime();
    runtime.getOllamaClient();

    expect(createLmStudioClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "http://127.0.0.1:1234",
        timeoutMs: 30000,
      }),
    );
    expect(createOllamaClient).not.toHaveBeenCalled();
  });

  it("discovers and selects a user-registered local adapter by manifest name", () => {
    vi.mocked(getSettings).mockReturnValue(
      baselineSettings({
        llmBackend: "vllm",
        localAdapters: [
          {
            name: "vllm",
            protocol: "openai",
            endpoint: "http://127.0.0.1:8000",
          },
        ],
      }) as never,
    );
    const runtime = new NexusCodingRuntime();
    runtime.getOllamaClient();

    // The custom adapter speaks the OpenAI protocol -> LM Studio factory, using
    // the manifest endpoint (no settings override for a custom adapter).
    expect(createLmStudioClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://127.0.0.1:8000" }),
    );
  });

  it("rebuilds the registry and re-routes when localAdapters change at runtime", () => {
    const runtime = new NexusCodingRuntime();
    const first = runtime.getOllamaClient();
    expect(createOllamaClient).toHaveBeenCalledOnce();

    // Fire a live settings change that registers a custom adapter and selects
    // it. The runtime must rebuild the registry and invalidate the cached
    // client so the next `getOllamaClient` routes to the new adapter.
    expect(hoisted.onChange).toBeTypeOf("function");
    hoisted.onChange?.(
      baselineSettings({
        llmBackend: "vllm",
        localAdapters: [
          { name: "vllm", protocol: "openai", endpoint: "http://127.0.0.1:8000" },
        ],
      }),
    );

    const second = runtime.getOllamaClient();
    expect(second).not.toBe(first);
    expect(createLmStudioClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://127.0.0.1:8000" }),
    );
  });

  it("skips a non-local user manifest and falls back to Ollama", () => {
    vi.mocked(getSettings).mockReturnValue(
      baselineSettings({
        llmBackend: "evil",
        localAdapters: [
          {
            name: "evil",
            protocol: "openai",
            endpoint: "https://exfil.example.com/v1",
          },
        ],
      }) as never,
    );
    const runtime = new NexusCodingRuntime();
    runtime.getOllamaClient();

    // The non-local manifest is rejected at registration, so "evil" is never
    // registered; selection falls back through auto-resolution to Ollama.
    expect(createOllamaClient).toHaveBeenCalledOnce();
    expect(createLmStudioClient).not.toHaveBeenCalled();
  });
});
