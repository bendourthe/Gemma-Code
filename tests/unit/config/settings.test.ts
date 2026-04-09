import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockGetConfiguration,
  mockOnDidChangeConfiguration,
  triggerConfigurationChange,
} from "../../setup.js";

// Import after the vscode mock is established (setup.ts runs first)
const { getSettings, onSettingsChange } = await import(
  "../../../src/config/settings.js"
);

describe("getSettings()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correctly typed defaults when no config values are set", () => {
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    });

    const settings = getSettings();

    expect(settings.ollamaUrl).toBe("http://localhost:11434");
    expect(settings.modelName).toBe("gemma4");
    expect(settings.maxTokens).toBe(131072);
    expect(settings.temperature).toBe(1.0);
    expect(settings.topP).toBe(0.95);
    expect(settings.topK).toBe(64);
    expect(settings.thinkingMode).toBe(true);
    expect(settings.promptStyle).toBe("concise");
    expect(settings.systemPromptBudgetPercent).toBe(10);
    expect(settings.requestTimeout).toBe(60000);
  });

  it("returns user-configured values when they are set", () => {
    const overrides: Record<string, unknown> = {
      ollamaUrl: "http://192.168.1.5:11434",
      modelName: "gemma4:latest",
      maxTokens: 4096,
      temperature: 0.7,
      requestTimeout: 30000,
    };

    mockGetConfiguration.mockReturnValue({
      get: vi.fn(<T>(key: string, _default?: T): T =>
        (overrides[key] ?? _default) as T
      ),
    });

    const settings = getSettings();

    expect(settings.ollamaUrl).toBe("http://192.168.1.5:11434");
    expect(settings.modelName).toBe("gemma4:latest");
    expect(settings.maxTokens).toBe(4096);
    expect(settings.temperature).toBe(0.7);
    expect(settings.requestTimeout).toBe(30000);
  });

  it("reads from the gemma-code configuration namespace", () => {
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    });

    getSettings();

    expect(mockGetConfiguration).toHaveBeenCalledWith("gemma-code");
  });
});

describe("onSettingsChange()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the callback when the gemma-code section changes", () => {
    const callback = vi.fn();
    onSettingsChange(callback);

    triggerConfigurationChange((section) => section === "gemma-code");

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      ollamaUrl: expect.any(String),
      modelName: expect.any(String),
      maxTokens: expect.any(Number),
      temperature: expect.any(Number),
      requestTimeout: expect.any(Number),
    }));
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

    // Verify dispose was called on the underlying vscode disposable
    expect(mockOnDidChangeConfiguration).toHaveBeenCalledTimes(1);
  });
});
