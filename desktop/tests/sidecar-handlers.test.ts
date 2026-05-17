import { describe, expect, it } from "vitest";
import { dispatch, handlers, SIDECAR_VERSION, SUPPORTED_METHODS } from "../sidecar/src/handlers";
import { IPC_METHODS, NotImplementedError, isMethod } from "../sidecar/src/protocol";

const ctx = { pid: 12345, platform: process.platform };

describe("sidecar handlers", () => {
  it("ping returns a well-formed response", async () => {
    const reply = await dispatch("ping", {}, ctx);
    expect(reply).toMatchObject({
      ok: true,
      pid: 12345,
      version: SIDECAR_VERSION,
      platform: ctx.platform,
    });
  });

  it("rejects unknown methods", async () => {
    await expect(dispatch("not.a.method", {}, ctx)).rejects.toThrow(/UnknownMethod/);
  });

  it("declared-but-unimplemented methods throw NotImplementedError", async () => {
    const unimplemented = SUPPORTED_METHODS.filter((m) => m !== "ping");
    for (const m of unimplemented) {
      await expect(dispatch(m, {}, ctx)).rejects.toBeInstanceOf(NotImplementedError);
    }
  });

  it("isMethod is exhaustive against IPC_METHODS", () => {
    for (const m of IPC_METHODS) {
      expect(isMethod(m)).toBe(true);
    }
    expect(isMethod("ping.nope")).toBe(false);
  });

  it("handlers covers every declared method", () => {
    for (const m of IPC_METHODS) {
      expect(typeof handlers[m]).toBe("function");
    }
  });
});
