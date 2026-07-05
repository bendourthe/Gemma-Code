// Thin wrapper around the Tauri window API used by the frameless custom title
// bar (v1.9.0 T501). Falls back to a no-op implementation when running outside
// Tauri (Vitest, `vite dev:web` in a plain browser) so the title bar renders
// and its buttons stay inert instead of throwing.
//
// Window controls require the `core:window:*` permissions granted in
// `src-tauri/capabilities/default.json`; without that capability the calls
// reject at the IPC boundary.

export interface WindowControls {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
}

let injected: WindowControls | null = null;

/**
 * Test seam. Swap in a stub so unit tests can observe control calls without a
 * live Tauri runtime. Reset with `clearWindowControlsOverride()`.
 */
export function setWindowControlsOverride(controls: WindowControls | null): void {
  injected = controls;
}

export function clearWindowControlsOverride(): void {
  injected = null;
}

function tauriRuntimeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}

const NOOP_CONTROLS: WindowControls = {
  async minimize() {},
  async toggleMaximize() {},
  async close() {},
  async isMaximized() {
    return false;
  },
};

async function currentWindow(): Promise<{
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
} | null> {
  if (!tauriRuntimeAvailable()) return null;
  try {
    const mod = await import("@tauri-apps/api/window");
    if (!mod || typeof mod.getCurrentWindow !== "function") return null;
    return mod.getCurrentWindow();
  } catch {
    return null;
  }
}

const REAL_CONTROLS: WindowControls = {
  async minimize() {
    const win = await currentWindow();
    if (win) await win.minimize();
  },
  async toggleMaximize() {
    const win = await currentWindow();
    if (win) await win.toggleMaximize();
  },
  async close() {
    const win = await currentWindow();
    if (win) await win.close();
  },
  async isMaximized() {
    const win = await currentWindow();
    if (!win) return false;
    return win.isMaximized();
  },
};

/**
 * Resolve the active window controls: an injected test stub if present,
 * otherwise the real Tauri-backed controls (which themselves degrade to a
 * no-op outside a Tauri runtime).
 */
export function getWindowControls(): WindowControls {
  if (injected) return injected;
  if (!tauriRuntimeAvailable()) return NOOP_CONTROLS;
  return REAL_CONTROLS;
}
