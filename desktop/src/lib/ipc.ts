// Thin wrapper around the Tauri `ipc_call` command. Falls back to a no-op
// implementation when running outside Tauri (Vitest, Storybook).

import { type Method } from "../../sidecar/src/protocol";

export interface IpcResult<T> {
  ok: true;
  value: T;
}

export interface IpcError {
  ok: false;
  message: string;
}

export type IpcReply<T> = IpcResult<T> | IpcError;

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

let injectedInvoke: InvokeFn | null = null;

/**
 * Test seam. Allows unit tests to swap in a stub Tauri `invoke`. Resets to
 * the real one via `clearInvokeOverride()`.
 */
export function setInvokeOverride(fn: InvokeFn | null): void {
  injectedInvoke = fn;
}

export function clearInvokeOverride(): void {
  injectedInvoke = null;
}

function tauriRuntimeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}

async function resolveInvoke(): Promise<InvokeFn | null> {
  if (injectedInvoke) return injectedInvoke;
  if (!tauriRuntimeAvailable()) return null;
  try {
    const mod = await import("@tauri-apps/api/core");
    if (!mod || typeof mod.invoke !== "function") return null;
    return mod.invoke as InvokeFn;
  } catch {
    return null;
  }
}

export async function ipcCall<T = unknown>(
  method: Method,
  params: Record<string, unknown> = {},
): Promise<IpcReply<T>> {
  const invoke = await resolveInvoke();
  if (!invoke) {
    return { ok: false, message: "ipc-unavailable" };
  }
  try {
    const value = (await invoke("ipc_call", { method, params })) as T;
    return { ok: true, value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

/**
 * v2.2.0 Phase 2 (2.2): invoke a Tauri command OTHER than `ipc_call` (the
 * sidecar JSON-RPC bridge). Used by `sidecar_status` / `sidecar_restart`,
 * which must answer even when the sidecar itself is down -- routing them
 * through `ipc_call` would make them fail for exactly the reason we need to
 * report. Returns `ipc-unavailable` outside Tauri (dev, Vitest, Storybook).
 */
export async function invokeCommand<T = unknown>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<IpcReply<T>> {
  const invoke = await resolveInvoke();
  if (!invoke) {
    return { ok: false, message: "ipc-unavailable" };
  }
  try {
    const value = (await invoke(command, args)) as T;
    return { ok: true, value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

export const ipc = {
  call: ipcCall,
  invoke: invokeCommand,
};
