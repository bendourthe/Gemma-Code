import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockGetConfiguration,
  mockOnDidChangeConfiguration,
  triggerConfigurationChange,
} from "../../setup.js";

// Import after the vscode mock is established (setup.ts runs first).
const { getSettings, onSettingsChange, _setSettingsCompatForTesting } =
  await import("../../../modules/coding/config/settings.js");

describe("getSettings()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _setSettingsCompatForTesting(null);
  });

  it("returns correctly typed defaults when no config values are set", () => {
    mockGetConfiguration.mockReturnValue({
      get: vi.fn(<T>(_key: string, defaultValue?: T): T | undefined => defaultValue),
      inspect: vi.fn(() => ({})),
      update: vi.fn(() => Promise.resolve()),
    });

    const settings = getSettings();

    expect(settings.ollamaUrl).toBe("http://localhost:11434");
    expect(settings.modelName).toBe("gemma4:e4b");
    expect(settings.maxTokens).toBe(131072);
    expect(settings.temperature).toBe(1.0);
    expect(settings.topP).toBe(0.95);
    expect(settings.topK).toBe(64);
    expect(settings.thinkingMode).toBe(true);
    expect(settings.promptStyle).toBe("concise");
    expect(settings.systemPromptBudgetPercent).toBe(10);
    expect(settings.requestTimeout).toBe(60000);
    expect(settings.memoryEnabled).toBe(true);
    expect(settings.embeddingModel).toBe("nomic-embed-text");
    expect(settings.memoryMaxEntries).toBe(10000);
    expect(settings.mcpEnabled).toBe(false);
    expect(settings.mcpServerMode).toBe("off");
    expect(settings.autoDetectGpu).toBe(true);
    expect(settings.execSandbox).toBe(false);
    expect(settings.gpuTierOverride).toBeNull();
  });

  it("returns user-configured nexus.* values when they are set", () => {
    // The compat shim reads via `inspect()` -- report explicit globalValue
    // entries for the keys the test cares about and return empty for the rest.
    const explicit: Record<string, unknown> = {
      "nexus.llm:ollamaUrl": "http://192.168.1.5:11434",
      "nexus.llm:modelName": "gemma4:latest",
      "nexus.llm:maxTokens": 4096,
      "nexus.llm:temperature": 0.7,
      "nexus.llm:requestTimeout": 30000,
    };
    mockGetConfiguration.mockImplementation((section?: string) => ({
      get: vi.fn(<T>(_key: string, defaultValue?: T): T | undefined => defaultValue),
      inspect: vi.fn(<T>(leaf: string) => {
        const key = `${section ?? ""}:${leaf}`;
        if (key in explicit) {
          return { globalValue: explicit[key] as T };
        }
        return {};
      }),
      update: vi.fn(() => Promise.resolve()),
    }));

    const settings = getSettings();

    expect(settings.ollamaUrl).toBe("http://192.168.1.5:11434");
    expect(settings.modelName).toBe("gemma4:latest");
    expect(settings.maxTokens).toBe(4096);
    expect(settings.temperature).toBe(0.7);
    expect(settings.requestTimeout).toBe(30000);
  });

  it("reads via the nexus.* configuration namespace", () => {
    mockGetConfiguration.mockReturnValue({
      get: vi.fn(<T>(_key: string, defaultValue?: T): T | undefined => defaultValue),
      inspect: vi.fn(() => ({})),
      update: vi.fn(() => Promise.resolve()),
    });

    getSettings();

    // At least one canonical sub-section was queried.
    expect(mockGetConfiguration).toHaveBeenCalledWith("nexus.llm");
    expect(mockGetConfiguration).toHaveBeenCalledWith("nexus.coding");
    expect(mockGetConfiguration).toHaveBeenCalledWith("nexus.memory");
  });
});

describe("onSettingsChange()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _setSettingsCompatForTesting(null);
  });

  it("calls the callback when the nexus section changes", () => {
    const callback = vi.fn();
    onSettingsChange(callback);

    triggerConfigurationChange((section) => section === "nexus");

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        ollamaUrl: expect.any(String),
        modelName: expect.any(String),
        maxTokens: expect.any(Number),
        temperature: expect.any(Number),
        requestTimeout: expect.any(Number),
      }),
    );
  });

  it("also calls the callback when the legacy gemma-code section changes", () => {
    const callback = vi.fn();
    onSettingsChange(callback);

    triggerConfigurationChange((section) => section === "gemma-code");

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does NOT call the callback when an unrelated config section changes", () => {
    const callback = vi.fn();
    onSettingsChange(callback);

    triggerConfigurationChange((section) => section === "editor");

    expect(callback).not.toHaveBeenCalled();
  });

  it("returns a disposable that stops listening when disposed", () => {
    const callback = vi.fn();
    const disposable = onSettingsChange(callback);

    disposable.dispose();

    expect(mockOnDidChangeConfiguration).toHaveBeenCalledTimes(1);
  });
});
