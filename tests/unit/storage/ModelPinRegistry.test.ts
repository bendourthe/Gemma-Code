import { describe, it, expect, afterEach } from "vitest";
import { ModelPinRegistry } from "../../../src/storage/ModelPinRegistry.js";

describe("ModelPinRegistry", () => {
  const originalKeepAlive = process.env.OLLAMA_KEEP_ALIVE;

  afterEach(() => {
    if (originalKeepAlive === undefined) {
      delete process.env.OLLAMA_KEEP_ALIVE;
    } else {
      process.env.OLLAMA_KEEP_ALIVE = originalKeepAlive;
    }
  });

  it("recordLoad stores the model with pinned=false by default", () => {
    const reg = new ModelPinRegistry({ now: () => 1000 });
    const record = reg.recordLoad("gemma4:e4b");
    expect(record.model).toBe("gemma4:e4b");
    expect(record.lastLoadedAt).toBe(1000);
    expect(record.pinned).toBe(false);
  });

  it("recordLoad preserves the existing pin state on re-load", () => {
    const reg = new ModelPinRegistry({ now: () => 1000 });
    reg.pin("foo");
    const reloaded = reg.recordLoad("foo");
    expect(reloaded.pinned).toBe(true);
  });

  it("pin / unpin transition the model's pinned flag", () => {
    const reg = new ModelPinRegistry();
    reg.recordLoad("foo");
    reg.pin("foo");
    expect(reg.isPinned("foo")).toBe(true);
    reg.unpin("foo");
    expect(reg.isPinned("foo")).toBe(false);
  });

  it("keepAliveFor returns -1 for pinned models", () => {
    const reg = new ModelPinRegistry();
    reg.pin("foo");
    expect(reg.keepAliveFor("foo")).toBe(-1);
  });

  it("keepAliveFor honors OLLAMA_KEEP_ALIVE env for unpinned models", () => {
    process.env.OLLAMA_KEEP_ALIVE = "30m";
    const reg = new ModelPinRegistry();
    expect(reg.keepAliveFor("foo")).toBe("30m");
  });

  it("keepAliveFor defaults to 5m when no env is set", () => {
    delete process.env.OLLAMA_KEEP_ALIVE;
    const reg = new ModelPinRegistry();
    expect(reg.keepAliveFor("foo")).toBe("5m");
  });

  it("snapshot returns sorted records", () => {
    const reg = new ModelPinRegistry({ now: () => 1000 });
    reg.recordLoad("zeta");
    reg.recordLoad("alpha");
    reg.recordLoad("mu");
    const snap = reg.snapshot();
    expect(snap.records.map((r) => r.model)).toEqual(["alpha", "mu", "zeta"]);
  });

  it("forget removes a model entirely", () => {
    const reg = new ModelPinRegistry();
    reg.recordLoad("foo");
    expect(reg.forget("foo")).toBe(true);
    expect(reg.get("foo")).toBeUndefined();
  });
});
