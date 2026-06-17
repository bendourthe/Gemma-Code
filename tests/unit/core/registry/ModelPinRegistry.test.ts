import { describe, it, expect, afterEach } from "vitest";

import { ModelPinRegistry } from "../../../../core/registry/ModelPinRegistry.js";
import { InMemorySettingsStore } from "../../../../core/storage/SettingsStore.js";

describe("ModelPinRegistry (core)", () => {
  const originalKeepAlive = process.env.OLLAMA_KEEP_ALIVE;

  afterEach(() => {
    if (originalKeepAlive === undefined) delete process.env.OLLAMA_KEEP_ALIVE;
    else process.env.OLLAMA_KEEP_ALIVE = originalKeepAlive;
  });

  it("hydrate() loads pins from the settings store", async () => {
    const settings = new InMemorySettingsStore();
    await settings.set("nexus.llm.modelPins", ["gemma4:e4b", "qwen2.5-coder:7b"]);
    const reg = new ModelPinRegistry({ settings });
    await reg.hydrate();
    expect(reg.isPinned("gemma4:e4b")).toBe(true);
    expect(reg.isPinned("qwen2.5-coder:7b")).toBe(true);
    expect(reg.isPinned("llama3.1:8b")).toBe(false);
  });

  it("hydrate() is idempotent", async () => {
    const settings = new InMemorySettingsStore();
    await settings.set("nexus.llm.modelPins", ["a"]);
    const reg = new ModelPinRegistry({ settings });
    await reg.hydrate();
    await reg.hydrate();
    expect(reg.snapshot().records.length).toBe(1);
  });

  it("pin / unpin persist to the settings store", async () => {
    const settings = new InMemorySettingsStore();
    const reg = new ModelPinRegistry({ settings });
    await reg.hydrate();
    reg.pin("foo");
    await flush();
    expect(await settings.get<readonly string[]>("nexus.llm.modelPins")).toEqual(["foo"]);
    reg.unpin("foo");
    await flush();
    expect(await settings.get<readonly string[]>("nexus.llm.modelPins")).toEqual([]);
  });

  it("setPinned(true) pins and persists", async () => {
    const settings = new InMemorySettingsStore();
    const reg = new ModelPinRegistry({ settings });
    const record = await reg.setPinned("foo", true);
    expect(record.pinned).toBe(true);
    expect(await settings.get<readonly string[]>("nexus.llm.modelPins")).toEqual(["foo"]);
  });

  it("setPinned(false) unpins (also for an unknown model)", async () => {
    const reg = new ModelPinRegistry();
    const record = await reg.setPinned("foo", false);
    expect(record.pinned).toBe(false);
  });

  it("keepAliveFor honors env override before default", () => {
    process.env.OLLAMA_KEEP_ALIVE = "30m";
    const envReg = new ModelPinRegistry();
    expect(envReg.keepAliveFor("foo")).toBe("30m");
    delete process.env.OLLAMA_KEEP_ALIVE;
    const def = new ModelPinRegistry();
    expect(def.keepAliveFor("foo")).toBe("5m");
  });

  it("keepAliveFor returns -1 for pinned models even when env is set", () => {
    process.env.OLLAMA_KEEP_ALIVE = "30m";
    const reg = new ModelPinRegistry();
    reg.pin("foo");
    expect(reg.keepAliveFor("foo")).toBe(-1);
  });

  it("resolver() returns a function bound to keepAliveFor", () => {
    const reg = new ModelPinRegistry();
    reg.pin("foo");
    const r = reg.resolver();
    expect(r("foo")).toBe(-1);
    expect(r("bar")).toBe("5m");
  });

  it("forget removes the model from in-memory and persisted state", async () => {
    const settings = new InMemorySettingsStore();
    const reg = new ModelPinRegistry({ settings });
    reg.pin("foo");
    await flush();
    expect(reg.forget("foo")).toBe(true);
    await flush();
    expect(await settings.get<readonly string[]>("nexus.llm.modelPins")).toEqual([]);
    expect(reg.forget("foo")).toBe(false);
  });

  it("clear empties the registry and persisted state", async () => {
    const settings = new InMemorySettingsStore();
    const reg = new ModelPinRegistry({ settings });
    reg.pin("a");
    reg.pin("b");
    await flush();
    reg.clear();
    await flush();
    expect(reg.snapshot().records.length).toBe(0);
    expect(await settings.get<readonly string[]>("nexus.llm.modelPins")).toEqual([]);
  });

  it("recordLoad stores last-loaded with pinned=false by default", () => {
    const reg = new ModelPinRegistry({ now: () => 7000 });
    const r = reg.recordLoad("x");
    expect(r.lastLoadedAt).toBe(7000);
    expect(r.pinned).toBe(false);
  });

  it("snapshot returns sorted records", () => {
    const reg = new ModelPinRegistry({ now: () => 1 });
    reg.recordLoad("zeta");
    reg.recordLoad("alpha");
    reg.recordLoad("mu");
    expect(reg.snapshot().records.map((r) => r.model)).toEqual(["alpha", "mu", "zeta"]);
  });

  it("envKeepAlive injection overrides process.env", () => {
    const reg = new ModelPinRegistry({ envKeepAlive: () => "10m" });
    expect(reg.keepAliveFor("foo")).toBe("10m");
  });

  // Panel keep-alive holds (OF008) -----------------------------------------

  it("holdForPanel keeps models resident (-1) during the run and releases after", () => {
    const reg = new ModelPinRegistry({ envKeepAlive: () => undefined });
    const handle = reg.holdForPanel(["a", "b"]);
    expect(handle.models).toEqual(["a", "b"]);
    expect(reg.keepAliveFor("a")).toBe(-1);
    expect(reg.keepAliveFor("b")).toBe(-1);
    expect(reg.isHeldForPanel("a")).toBe(true);
    handle.release();
    expect(reg.keepAliveFor("a")).toBe("5m");
    expect(reg.isHeldForPanel("a")).toBe(false);
  });

  it("a user's explicit pin survives a panel hold and release (-1 preserved)", () => {
    const reg = new ModelPinRegistry({ envKeepAlive: () => undefined });
    reg.pin("a");
    const handle = reg.holdForPanel(["a"]);
    expect(reg.keepAliveFor("a")).toBe(-1);
    handle.release();
    expect(reg.isPinned("a")).toBe(true);
    expect(reg.keepAliveFor("a")).toBe(-1);
  });

  it("holdForPanel ref-counts overlapping holds so one release does not drop another", () => {
    const reg = new ModelPinRegistry({ envKeepAlive: () => undefined });
    const h1 = reg.holdForPanel(["a"]);
    const h2 = reg.holdForPanel(["a"]);
    h1.release();
    expect(reg.isHeldForPanel("a")).toBe(true);
    h2.release();
    expect(reg.isHeldForPanel("a")).toBe(false);
  });

  it("release is idempotent (no ref-count underflow)", () => {
    const reg = new ModelPinRegistry({ envKeepAlive: () => undefined });
    const h1 = reg.holdForPanel(["a"]);
    const h2 = reg.holdForPanel(["a"]);
    h1.release();
    h1.release(); // second release is a no-op
    expect(reg.isHeldForPanel("a")).toBe(true); // h2 still holds
    h2.release();
    expect(reg.isHeldForPanel("a")).toBe(false);
  });

  it("holdForPanel de-duplicates and ignores blank ids", () => {
    const reg = new ModelPinRegistry({ envKeepAlive: () => undefined });
    const handle = reg.holdForPanel(["a", "a", " ", ""]);
    expect(handle.models).toEqual(["a"]);
    expect(reg.keepAliveFor("a")).toBe(-1);
  });

  it("a panel hold honours the env keep-alive only after release", () => {
    const reg = new ModelPinRegistry({ envKeepAlive: () => "30m" });
    const handle = reg.holdForPanel(["a"]);
    expect(reg.keepAliveFor("a")).toBe(-1);
    handle.release();
    expect(reg.keepAliveFor("a")).toBe("30m");
  });

  it("a panel hold does not persist to the settings store", async () => {
    const settings = new InMemorySettingsStore();
    const reg = new ModelPinRegistry({ settings });
    await reg.hydrate();
    const handle = reg.holdForPanel(["a"]);
    await flush();
    expect(
      await settings.get<readonly string[]>("nexus.llm.modelPins"),
    ).toBeUndefined();
    handle.release();
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
