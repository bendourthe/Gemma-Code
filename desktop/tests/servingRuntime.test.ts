/**
 * v1.16.0 Phase 1.6 (adoption item A1) -- serving runtime + `serving.*` IPC.
 *
 * Asserts the settings-to-listener reconciliation the desktop toggle depends on,
 * and that the two IPC handlers route to the injected runtime rather than
 * building the real disk-backed one.
 */

import { afterEach, describe, expect, it } from "vitest";

import { InMemorySettingsStore } from "../../core/storage/SettingsStore";
import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";
import { createHandlerContext, dispatch } from "../sidecar/src/handlers";
import { SERVING_KEYS } from "../sidecar/src/serving/config";
import { createServingRuntime, type ServingRuntime } from "../sidecar/src/serving/servingRuntime";
import type { ServingStatusResponseT } from "../sidecar/src/protocol";

const runtimes: ServingRuntime[] = [];

function makeRuntime(settings = new InMemorySettingsStore()): ServingRuntime {
  const runtime = createServingRuntime({
    settings,
    // Port 0 so the OS assigns a free ephemeral port; host stays loopback.
    env: { NEXUS_SERVING_PORT: "0" },
    models: {
      service: { list: async () => [] },
      installer: {},
    } as unknown as Parameters<typeof createServingRuntime>[0]["models"],
    log: () => {},
  });
  runtimes.push(runtime);
  return runtime;
}

afterEach(async () => {
  while (runtimes.length > 0) {
    await runtimes.pop()?.gateway.stop();
  }
});

describe("createServingRuntime", () => {
  it("reports disabled-and-not-running by default", async () => {
    const status = await makeRuntime().status();
    expect(status.enabled).toBe(false);
    expect(status.running).toBe(false);
  });

  it("mints and reports a token even while disabled, so the UI can show it", async () => {
    const status = await makeRuntime().status();
    expect(status.token.length).toBeGreaterThan(0);
  });

  it("sync() opens no listener while the opt-in is off", async () => {
    const runtime = makeRuntime();
    const status = await runtime.sync();
    expect(status.running).toBe(false);
    expect(runtime.gateway.boundPort).toBeNull();
  });

  it("setEnabled(true) persists the opt-in and starts listening", async () => {
    const settings = new InMemorySettingsStore();
    const runtime = makeRuntime(settings);
    const status = await runtime.setEnabled(true);
    expect(status.enabled).toBe(true);
    expect(status.running).toBe(true);
    expect(await settings.get<boolean>(SERVING_KEYS.enabled)).toBe(true);
    expect(runtime.gateway.boundPort).toBeGreaterThan(0);
  });

  it("setEnabled(false) stops the listener and persists the opt-out", async () => {
    const settings = new InMemorySettingsStore();
    const runtime = makeRuntime(settings);
    await runtime.setEnabled(true);
    const status = await runtime.setEnabled(false);
    expect(status.running).toBe(false);
    expect(runtime.gateway.running).toBe(false);
    expect(await settings.get<boolean>(SERVING_KEYS.enabled)).toBe(false);
  });

  it("restores a persisted enabled state on sync (relaunch path)", async () => {
    const settings = new InMemorySettingsStore();
    await settings.set(SERVING_KEYS.enabled, true);
    const runtime = makeRuntime(settings);
    expect((await runtime.sync()).running).toBe(true);
  });

  it("serves an empty model list rather than failing when models are unavailable", async () => {
    const runtime = createServingRuntime({
      settings: new InMemorySettingsStore(),
      env: { NEXUS_SERVING_PORT: "0" },
      models: {
        service: {
          list: async () => {
            throw new Error("no catalog");
          },
        },
        installer: {},
      } as unknown as Parameters<typeof createServingRuntime>[0]["models"],
      log: () => {},
    });
    runtimes.push(runtime);
    await runtime.setEnabled(true);
    const res = await fetch(`http://127.0.0.1:${runtime.gateway.boundPort}/v1/models`, {
      headers: { authorization: `Bearer ${(await runtime.status()).token}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { data: unknown[] }).toEqual({ object: "list", data: [] });
  });
});

describe("serving.* IPC handlers", () => {
  function ctxWith(runtime: ServingRuntime) {
    return createHandlerContext(
      { pid: 1, platform: process.platform },
      new CodingSessionManager(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      runtime,
    );
  }

  it("serving.status returns the injected runtime's status", async () => {
    const runtime = makeRuntime();
    const reply = (await dispatch("serving.status", {}, ctxWith(runtime))) as ServingStatusResponseT;
    expect(reply.enabled).toBe(false);
    expect(reply.baseUrl).toContain("http://127.0.0.1:");
  });

  it("serving.setEnabled toggles the gateway through the runtime", async () => {
    const runtime = makeRuntime();
    const on = (await dispatch(
      "serving.setEnabled",
      { enabled: true },
      ctxWith(runtime),
    )) as ServingStatusResponseT;
    expect(on.running).toBe(true);

    const off = (await dispatch(
      "serving.setEnabled",
      { enabled: false },
      ctxWith(runtime),
    )) as ServingStatusResponseT;
    expect(off.running).toBe(false);
  });

  it("serving.setEnabled rejects a non-boolean payload", async () => {
    await expect(
      dispatch("serving.setEnabled", { enabled: "yes" }, ctxWith(makeRuntime())),
    ).rejects.toThrow();
  });
});
