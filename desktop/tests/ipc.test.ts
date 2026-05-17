import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearInvokeOverride, ipc, setInvokeOverride } from "../src/lib/ipc";

describe("ipc.call", () => {
  beforeEach(() => {
    clearInvokeOverride();
  });
  afterEach(() => {
    clearInvokeOverride();
  });

  it("returns ipc-unavailable when no invoke is wired", async () => {
    setInvokeOverride(null);
    const r = await ipc.call("ping", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("ipc-unavailable");
  });

  it("returns the resolved value on success", async () => {
    setInvokeOverride(async (cmd, args) => {
      expect(cmd).toBe("ipc_call");
      expect(args).toEqual({ method: "ping", params: {} });
      return { ok: true, pid: 1 };
    });
    const r = await ipc.call("ping", {});
    expect(r).toEqual({ ok: true, value: { ok: true, pid: 1 } });
  });

  it("returns a string error when invoke rejects", async () => {
    setInvokeOverride(vi.fn().mockRejectedValue(new Error("nope")));
    const r = await ipc.call("ping", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("nope");
  });

  it("returns a stringified error when the rejection is not an Error", async () => {
    setInvokeOverride(vi.fn().mockRejectedValue("plain"));
    const r = await ipc.call("ping", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("plain");
  });
});
