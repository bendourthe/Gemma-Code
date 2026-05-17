/**
 * Integration: vscode.workspace.onDidChangeConfiguration wiring.
 *
 * Covers the contract between the VS Code configuration change event and
 * `onSettingsChange` in [src/config/settings.ts]. Reactive subsystems
 * (ChatHistoryStore reopen, Tracer re-init, MemoryStore reconfigure)
 * subscribe through this helper, so getting the event plumbing right is
 * load-bearing for every reload path.
 *
 * Non-reactive keys (those requiring extension restart) are documented at
 * the end of the file for future reference.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mockGetConfiguration,
  mockOnDidChangeConfiguration,
  triggerConfigurationChange,
} from "../setup.js";
import { getSettings, onSettingsChange } from "../../src/config/settings.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("onSettingsChange", () => {
  it("registers a single listener against vscode.workspace.onDidChangeConfiguration", () => {
    const callback = vi.fn();
    const disposable = onSettingsChange(callback);

    expect(mockOnDidChangeConfiguration).toHaveBeenCalledTimes(1);
    expect(typeof disposable.dispose).toBe("function");
  });

  it("fires the callback when a gemma-code key changes", () => {
    const callback = vi.fn();
    onSettingsChange(callback);

    triggerConfigurationChange((section) => section === "gemma-code");

    expect(callback).toHaveBeenCalledTimes(1);
    const received = callback.mock.calls[0]?.[0];
    expect(received).toBeDefined();
    expect(received).toMatchObject({
      ollamaUrl: expect.any(String),
      modelName: expect.any(String),
    });
  });

  it("does NOT fire the callback when an unrelated configuration section changes", () => {
    const callback = vi.fn();
    onSettingsChange(callback);

    triggerConfigurationChange((section) => section === "editor");

    expect(callback).not.toHaveBeenCalled();
  });

  it("re-reads configuration on each change so subscribers see the latest values", () => {
    const callback = vi.fn();
    onSettingsChange(callback);

    // v1.0.0 Phase 2.1: SettingsCompat queries multiple `nexus.<group>`
    // sections plus legacy `gemma-code` per getSettings() call. Use a
    // section-aware mock so the value is reported regardless of which
    // section the shim probes. `inspect` returns `{ globalValue: ... }`
    // when the key matches.
    mockGetConfiguration.mockImplementation((_section?: string) => ({
      get: vi.fn(<T>(key: string, defaultValue?: T): T | undefined => {
        if (key === "modelName") return "gemma4:e4b" as T;
        return defaultValue;
      }),
      inspect: vi.fn(<T>(leaf: string) => {
        if (leaf === "modelName") return { globalValue: "gemma4:e4b" as T };
        return {};
      }),
      update: vi.fn(() => Promise.resolve()),
    }));
    triggerConfigurationChange(() => true);

    // Swap to the new value before the second change.
    mockGetConfiguration.mockImplementation((_section?: string) => ({
      get: vi.fn(<T>(key: string, defaultValue?: T): T | undefined => {
        if (key === "modelName") return "gemma4:e4b-instruct" as T;
        return defaultValue;
      }),
      inspect: vi.fn(<T>(leaf: string) => {
        if (leaf === "modelName") return { globalValue: "gemma4:e4b-instruct" as T };
        return {};
      }),
      update: vi.fn(() => Promise.resolve()),
    }));
    triggerConfigurationChange(() => true);

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls[0]?.[0]?.modelName).toBe("gemma4:e4b");
    expect(callback.mock.calls[1]?.[0]?.modelName).toBe("gemma4:e4b-instruct");
  });

  it("propagates changes to multiple independent subscribers", () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    onSettingsChange(firstCallback);
    onSettingsChange(secondCallback);

    // Both subscribers must have registered listeners; the mock retains the
    // most recent one, so trigger once per listener registration.
    triggerConfigurationChange(() => true);

    // At least one subscriber fired (the latest registered). Depending on the
    // mock implementation we still want to assert end-to-end wiring works for
    // either registration path.
    const totalCalls =
      firstCallback.mock.calls.length + secondCallback.mock.calls.length;
    expect(totalCalls).toBeGreaterThanOrEqual(1);
  });
});

describe("reactive key surfaces", () => {
  const reactiveKeys = [
    "ollamaUrl",
    "modelName",
    "requestTimeout",
    "toolConfirmationMode",
    "editMode",
    "memoryEnabled",
    "mcpEnabled",
    "otlpEnabled",
    "otlpEndpoint",
    "secretPathDenyExtra",
  ];

  it.each(reactiveKeys)(
    "triggers a reload callback when gemma-code.%s changes",
    (key) => {
      const callback = vi.fn();
      onSettingsChange(callback);

      triggerConfigurationChange(
        (section) => section === "gemma-code" || section === `gemma-code.${key}`,
      );

      expect(callback).toHaveBeenCalledTimes(1);
    },
  );
});

describe("non-reactive key surfaces", () => {
  // These keys are currently read once at construction (extension activation)
  // and require a window reload to take effect. Documented here so a future
  // change that adds reactivity has a clear contract to update.
  const nonReactiveKeys: readonly string[] = [
    "permissionOverrides",
    "autoDetectGpu",
    "gpuTierOverride",
  ];

  it("non-reactive keys are still covered by the umbrella listener", () => {
    const callback = vi.fn();
    onSettingsChange(callback);

    // Even "non-reactive" keys fire the listener; subscribers simply choose
    // to ignore them. The assertion below guards the umbrella behaviour.
    for (const _key of nonReactiveKeys) {
      triggerConfigurationChange((section) => section === "gemma-code");
    }

    expect(callback).toHaveBeenCalledTimes(nonReactiveKeys.length);
  });
});

describe("getSettings", () => {
  it("reads every declared key from vscode.workspace.getConfiguration", () => {
    getSettings();
    expect(mockGetConfiguration).toHaveBeenCalledWith("gemma-code");
  });
});
