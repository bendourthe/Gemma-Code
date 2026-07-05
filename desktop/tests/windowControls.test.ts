import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearWindowControlsOverride,
  getWindowControls,
  setWindowControlsOverride,
  type WindowControls,
} from "../src/lib/windowControls";

// Mock the Tauri window module so the REAL_CONTROLS path can be exercised
// without a live Tauri runtime.
vi.mock("@tauri-apps/api/window", () => {
  const win = {
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(true),
  };
  return { getCurrentWindow: vi.fn(() => win) };
});

type TauriWindow = typeof window & { __TAURI_INTERNALS__?: unknown };

afterEach(() => {
  clearWindowControlsOverride();
  delete (window as TauriWindow).__TAURI_INTERNALS__;
  vi.clearAllMocks();
});

describe("windowControls override seam", () => {
  it("returns the injected controls when an override is set", () => {
    const stub: WindowControls = {
      minimize: vi.fn().mockResolvedValue(undefined),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(false),
    };
    setWindowControlsOverride(stub);
    expect(getWindowControls()).toBe(stub);
  });

  it("clears the override back to the default resolver", () => {
    setWindowControlsOverride({
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(),
    } as unknown as WindowControls);
    clearWindowControlsOverride();
    // Without a Tauri runtime the default resolver returns the no-op controls.
    const controls = getWindowControls();
    expect(typeof controls.minimize).toBe("function");
  });
});

describe("windowControls outside a Tauri runtime (no-op)", () => {
  it("isMaximized resolves false and the mutators do not throw", async () => {
    const controls = getWindowControls();
    await expect(controls.isMaximized()).resolves.toBe(false);
    await expect(controls.minimize()).resolves.toBeUndefined();
    await expect(controls.toggleMaximize()).resolves.toBeUndefined();
    await expect(controls.close()).resolves.toBeUndefined();
  });
});

describe("windowControls with a Tauri runtime (real path)", () => {
  it("delegates each control to the current window", async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    const controls = getWindowControls();

    await controls.minimize();
    await controls.toggleMaximize();
    await controls.close();
    await expect(controls.isMaximized()).resolves.toBe(true);

    const mod = await import("@tauri-apps/api/window");
    const win = (mod.getCurrentWindow as unknown as () => Record<string, ReturnType<typeof vi.fn>>)();
    expect(win.minimize).toHaveBeenCalledTimes(1);
    expect(win.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(win.close).toHaveBeenCalledTimes(1);
    expect(win.isMaximized).toHaveBeenCalledTimes(1);
  });
});
