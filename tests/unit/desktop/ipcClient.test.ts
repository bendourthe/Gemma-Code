import { describe, it, expect } from "vitest";
import {
  NoopIpcClient,
  createInProcessIpcClient,
} from "../../../src/desktop/ipcClient.js";

describe("NoopIpcClient", () => {
  it("rejects every call with a deterministic 'daemon unavailable' reason", async () => {
    const client = new NoopIpcClient();
    await expect(client.call("any.method", {})).rejects.toThrow(
      /Nexus daemon IPC client not wired/,
    );
  });

  it("returns an inert subscription", () => {
    const client = new NoopIpcClient();
    const sub = client.subscribe("any.channel", () => {});
    expect(sub).toBeDefined();
    expect(typeof sub.dispose).toBe("function");
    // Disposing twice is idempotent (no throw).
    sub.dispose();
    sub.dispose();
  });

  it("after close(), calls still reject with the same shape", async () => {
    const client = new NoopIpcClient();
    client.close();
    await expect(client.call("any.method")).rejects.toThrow(
      /Nexus daemon IPC client not wired/,
    );
  });
});

describe("createInProcessIpcClient", () => {
  it("dispatches calls to the matching handler", async () => {
    const client = createInProcessIpcClient({
      "models.list": (params) => ({ ok: true, params }),
    });
    const result = (await client.call("models.list", { type: "text" })) as {
      ok: boolean;
      params: { type: string };
    };
    expect(result.ok).toBe(true);
    expect(result.params.type).toBe("text");
  });

  it("rejects when no handler is registered for the method", async () => {
    const client = createInProcessIpcClient({});
    await expect(client.call("unknown.method")).rejects.toThrow(
      /No handler registered/,
    );
  });

  it("awaits async handlers and surfaces thrown errors verbatim", async () => {
    const client = createInProcessIpcClient({
      "echo.async": async (params) => params,
      "throws.async": async () => {
        throw new Error("boom");
      },
    });
    expect(await client.call("echo.async", "hi")).toBe("hi");
    await expect(client.call("throws.async")).rejects.toThrow("boom");
  });

  it("fans subscription events out to every listener", () => {
    const client = createInProcessIpcClient({});
    const log1: number[] = [];
    const log2: number[] = [];
    client.subscribe<number>("ticks", (n) => log1.push(n));
    client.subscribe<number>("ticks", (n) => log2.push(n));
    const n = client.emit("ticks", 7);
    expect(n).toBe(2);
    expect(log1).toEqual([7]);
    expect(log2).toEqual([7]);
  });

  it("dispose() removes a listener without affecting siblings", () => {
    const client = createInProcessIpcClient({});
    const log1: string[] = [];
    const log2: string[] = [];
    const sub1 = client.subscribe<string>("notifications", (s) => log1.push(s));
    client.subscribe<string>("notifications", (s) => log2.push(s));

    client.emit("notifications", "first");
    sub1.dispose();
    client.emit("notifications", "second");

    expect(log1).toEqual(["first"]);
    expect(log2).toEqual(["first", "second"]);
  });

  it("isolates listener throws so the fan-out continues", () => {
    const client = createInProcessIpcClient({});
    const log: string[] = [];
    client.subscribe<string>("ev", () => {
      throw new Error("listener error");
    });
    client.subscribe<string>("ev", (s) => log.push(s));
    const n = client.emit("ev", "hello");
    // The first listener threw and was excluded from the count.
    expect(n).toBe(1);
    expect(log).toEqual(["hello"]);
  });

  it("after close(), call rejects and emit yields zero listeners", async () => {
    const client = createInProcessIpcClient({ ping: () => "pong" });
    client.close();
    await expect(client.call("ping")).rejects.toThrow(/closed/);
    const log: number[] = [];
    // subscribe() after close() throws.
    expect(() => client.subscribe("ev", (n: number) => log.push(n))).toThrow(
      /closed/,
    );
    expect(client.emit("ev", 1)).toBe(0);
  });
});
