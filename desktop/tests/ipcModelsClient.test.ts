/**
 * v1.15.0 Phase 4 (Issue 3) -- ipcModelsClient tests.
 *
 * Uses the ipc.ts `setInvokeOverride` seam to stub the Tauri bridge and assert
 * the client maps the sidecar `models.*` responses to the ModelsSettings surface.
 */

import { describe, it, expect, afterEach } from "vitest";

import { setInvokeOverride, clearInvokeOverride } from "../src/lib/ipc";
import { createIpcModelsClient } from "../src/pages/settings/ipcModelsClient";
import type { InstallProgressDto } from "../src/pages/settings/modelsTypes";

afterEach(() => clearInvokeOverride());

function stub(handler: (method: string, params: Record<string, unknown>) => unknown): void {
  setInvokeOverride(async (_cmd, args) => {
    const a = args as { method: string; params: Record<string, unknown> };
    return handler(a.method, a.params);
  });
}

describe("createIpcModelsClient", () => {
  it("list maps models.list", async () => {
    stub((m) => {
      if (m === "models.list") {
        return { models: [{ id: "a", displayName: "A", installed: true, source: "registry" }] };
      }
      throw new Error(m);
    });
    expect(await createIpcModelsClient().list()).toEqual([
      { id: "a", displayName: "A", installed: true, source: "registry" },
    ]);
  });

  it("remove calls models.remove with the id", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    stub((method, params) => {
      calls.push({ method, params });
      return { ok: true };
    });
    await createIpcModelsClient().remove("gemma-4-12b-it-gguf");
    expect(calls).toContainEqual({
      method: "models.remove",
      params: { id: "gemma-4-12b-it-gguf" },
    });
  });

  it("diskUsage maps models.diskUsage", async () => {
    stub((m) => {
      if (m === "models.diskUsage") return { usedBytes: 42, freeBytes: null };
      throw new Error(m);
    });
    expect(await createIpcModelsClient().diskUsage()).toEqual({ usedBytes: 42, freeBytes: null });
  });

  it("list throws when the sidecar is unavailable", async () => {
    setInvokeOverride(null);
    await expect(createIpcModelsClient().list()).rejects.toThrow(/ipc-unavailable/);
  });

  it("install streams progress then resolves on the terminal complete", async () => {
    stub((method) => {
      if (method === "models.install") return { jobId: "job-1" };
      if (method === "models.install.drainEvents") {
        return {
          events: [
            { kind: "progress", id: "m", bytes: 50, total: 100 },
            { kind: "complete", id: "m" },
          ],
          done: true,
        };
      }
      throw new Error(method);
    });
    const progress: InstallProgressDto[] = [];
    const handle = createIpcModelsClient().install("m", (p) => progress.push(p));
    await handle.done;
    expect(progress).toEqual([{ id: "m", bytes: 50, total: 100 }]);
  });
});
