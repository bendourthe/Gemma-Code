/**
 * v1.18.0 Phase 5 (OI-A3) -- shared control-surface contract.
 *
 * Locks the mount API the v1.16 serving gateway and the ACP agent both use:
 * loopback bind, bearer auth before any protocol handler, health unauthenticated.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  CONTROL_SURFACE_ACP_PATH,
  CONTROL_SURFACE_MOUNTS,
  CONTROL_SURFACE_OPENAI_PREFIX,
} from "../sidecar/src/controlSurface/contract";
import { LoopbackHttpServer } from "../sidecar/src/controlSurface/loopbackServer";
import { acpEndpoint } from "../sidecar/src/acp/config";
import { ServingBindError, assertLoopbackHost, checkBearerToken } from "../sidecar/src/serving/guard";
import { ServingGateway } from "../sidecar/src/serving/gateway";

describe("control-surface contract", () => {
  it("names the two mounts the v1.16 gateway and ACP share", () => {
    expect(CONTROL_SURFACE_MOUNTS).toEqual(["serving", "acp"]);
    expect(CONTROL_SURFACE_ACP_PATH).toBe("/acp");
    expect(CONTROL_SURFACE_OPENAI_PREFIX).toBe("/v1");
  });

  it("brackets IPv6 hosts in the ACP endpoint URL", () => {
    expect(acpEndpoint("::1", 11500)).toBe("http://[::1]:11500/acp");
  });

  it("exposes the loopback + bearer primitives serving already tests", () => {
    expect(() => assertLoopbackHost("127.0.0.1")).not.toThrow();
    expect(() => assertLoopbackHost("0.0.0.0")).toThrow(ServingBindError);
    expect(() => checkBearerToken({ authorization: "Bearer secret" }, "secret")).not.toThrow();
    expect(() => checkBearerToken({}, "secret")).toThrow(/API key/i);
  });

  it("ServingGateway mounts on a LoopbackHttpServer instance", () => {
    const gateway = new ServingGateway({ listInstalled: async () => [], log: () => {} });
    expect(gateway.surface).toBeInstanceOf(LoopbackHttpServer);
  });
});

describe("LoopbackHttpServer", () => {
  const started: LoopbackHttpServer[] = [];

  afterEach(async () => {
    while (started.length > 0) {
      await started.pop()?.stop();
    }
  });

  it("refuses a non-loopback bind before listen", async () => {
    const server = new LoopbackHttpServer({ log: () => {} });
    await expect(
      server.start({ host: "0.0.0.0", port: 0, token: "t", listen: true }),
    ).rejects.toThrow(ServingBindError);
    expect(server.running).toBe(false);
  });

  it("rejects unauthenticated requests before any mount runs", async () => {
    const server = new LoopbackHttpServer({ log: () => {} });
    let mounted = false;
    server.mount(async () => {
      mounted = true;
      return true;
    });
    started.push(server);
    await server.start({ host: "127.0.0.1", port: 0, token: "secret", listen: true });
    const res = await fetch(`http://127.0.0.1:${server.boundPort}/anything`);
    expect(res.status).toBe(401);
    expect(mounted).toBe(false);
  });

  it("serves /health without a token", async () => {
    const server = new LoopbackHttpServer({ log: () => {} });
    started.push(server);
    await server.start({ host: "127.0.0.1", port: 0, token: "secret", listen: true });
    const res = await fetch(`http://127.0.0.1:${server.boundPort}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("does not bind when listen is false", async () => {
    const server = new LoopbackHttpServer({ log: () => {} });
    started.push(server);
    await server.start({ host: "127.0.0.1", port: 0, token: "secret", listen: false });
    expect(server.running).toBe(false);
    expect(server.boundPort).toBeNull();
  });

  it("applyConfig stops the listener when listen flips off", async () => {
    const server = new LoopbackHttpServer({ log: () => {} });
    started.push(server);
    await server.start({ host: "127.0.0.1", port: 0, token: "secret", listen: true });
    expect(server.running).toBe(true);
    await server.applyConfig({ host: "127.0.0.1", port: 0, token: "secret", listen: false });
    expect(server.running).toBe(false);
  });
});
