/**
 * v1.16.0 Phase 1.6 (adoption item A1) -- ipcServingClient tests.
 *
 * Uses the ipc.ts `setInvokeOverride` seam to stub the Tauri bridge and assert
 * the client maps the sidecar `serving.*` responses to the settings surface.
 */

import { afterEach, describe, expect, it } from "vitest";

import { clearInvokeOverride, setInvokeOverride } from "../src/lib/ipc";
import { createIpcServingClient } from "../src/pages/settings/ipcServingClient";

afterEach(() => clearInvokeOverride());

const STATUS = {
  enabled: true,
  running: true,
  host: "127.0.0.1",
  port: 11500,
  baseUrl: "http://127.0.0.1:11500/v1",
  token: "tok",
};

function stub(handler: (method: string, params: Record<string, unknown>) => unknown): void {
  setInvokeOverride(async (_cmd, args) => {
    const a = args as { method: string; params: Record<string, unknown> };
    return handler(a.method, a.params);
  });
}

describe("createIpcServingClient", () => {
  it("status maps serving.status", async () => {
    stub((m) => {
      if (m === "serving.status") return STATUS;
      throw new Error(m);
    });
    expect(await createIpcServingClient().status()).toEqual(STATUS);
  });

  it("setEnabled sends the flag to serving.setEnabled", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    stub((method, params) => {
      calls.push({ method, params });
      return STATUS;
    });
    await createIpcServingClient().setEnabled(true);
    expect(calls).toContainEqual({ method: "serving.setEnabled", params: { enabled: true } });
  });

  it("acpStatus maps acp.status", async () => {
    const acp = {
      enabled: true,
      running: true,
      host: "127.0.0.1",
      port: 11500,
      endpoint: "http://127.0.0.1:11500/acp",
      token: "tok",
    };
    stub((m) => {
      if (m === "acp.status") return acp;
      throw new Error(m);
    });
    expect(await createIpcServingClient().acpStatus()).toEqual(acp);
  });

  it("setAcpEnabled sends the flag to acp.setEnabled", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    stub((method, params) => {
      calls.push({ method, params });
      return {
        enabled: true,
        running: true,
        host: "127.0.0.1",
        port: 11500,
        endpoint: "http://127.0.0.1:11500/acp",
        token: "tok",
      };
    });
    await createIpcServingClient().setAcpEnabled(true);
    expect(calls).toContainEqual({ method: "acp.setEnabled", params: { enabled: true } });
  });

  it("surfaces an IPC failure as a thrown Error", async () => {
    setInvokeOverride(async () => {
      throw new Error("sidecar down");
    });
    await expect(createIpcServingClient().status()).rejects.toThrow(/sidecar down/);
  });
});
