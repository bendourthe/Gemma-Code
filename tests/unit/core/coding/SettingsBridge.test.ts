import { describe, it, expect } from "vitest";
import {
  buildSettingsGetHandler,
  buildSettingsSetHandler,
  InMemorySettingsStore,
  reconcileSecondaryMirror,
  SETTINGS_GET_METHOD,
  SETTINGS_SET_METHOD,
  type SecondaryMirrorEntry,
} from "../../../../core/coding/SettingsBridge.js";

describe("InMemorySettingsStore", () => {
  it("round-trips get / set", () => {
    const store = new InMemorySettingsStore({ "nexus.foo": "bar" });
    expect(store.get("nexus.foo")).toBe("bar");
    store.set("nexus.foo", 42);
    expect(store.get("nexus.foo")).toBe(42);
  });

  it("snapshot is frozen and shallow-copies the data", () => {
    const store = new InMemorySettingsStore({ "nexus.a": 1 });
    const snap = store.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap["nexus.a"]).toBe(1);
    store.set("nexus.a", 2);
    expect(snap["nexus.a"]).toBe(1); // snapshot is detached.
  });
});

describe("buildSettingsGetHandler", () => {
  it("returns the value for a nexus.* key", () => {
    const store = new InMemorySettingsStore({ "nexus.coding.activeModel": "gemma4:e4b" });
    const get = buildSettingsGetHandler(store);
    expect(get({ key: "nexus.coding.activeModel" })).toEqual({
      key: "nexus.coding.activeModel",
      value: "gemma4:e4b",
    });
  });

  it("returns value=undefined for an unset key", () => {
    const store = new InMemorySettingsStore();
    const get = buildSettingsGetHandler(store);
    expect(get({ key: "nexus.coding.unset" })).toEqual({
      key: "nexus.coding.unset",
      value: undefined,
    });
  });

  it("rejects non-nexus.* keys", () => {
    const store = new InMemorySettingsStore();
    const get = buildSettingsGetHandler(store);
    expect(() => get({ key: "gemma-code.legacy" })).toThrow(/must start with 'nexus.'/);
  });
});

describe("buildSettingsSetHandler", () => {
  it("writes through and echoes the stored value", () => {
    const store = new InMemorySettingsStore();
    const set = buildSettingsSetHandler(store);
    const response = set({ key: "nexus.diffusion.tierOverride", value: "diffusion-high" });
    expect(response.value).toBe("diffusion-high");
    expect(store.get("nexus.diffusion.tierOverride")).toBe("diffusion-high");
  });

  it("rejects non-nexus.* keys", () => {
    const store = new InMemorySettingsStore();
    const set = buildSettingsSetHandler(store);
    expect(() => set({ key: "gemma-code.legacy", value: 1 })).toThrow(/must start with 'nexus.'/);
  });
});

describe("reconcileSecondaryMirror", () => {
  it("applies keys present only in the mirror", () => {
    const store = new InMemorySettingsStore();
    const mirror: SecondaryMirrorEntry[] = [
      { key: "nexus.coding.activeModel", mirrorValue: "qwen2.5-coder:7b" },
      { key: "nexus.unrelated", mirrorValue: 0 },
    ];
    const outcome = reconcileSecondaryMirror(store, mirror);
    expect(outcome.applied).toHaveLength(2);
    expect(store.get("nexus.coding.activeModel")).toBe("qwen2.5-coder:7b");
  });

  it("ignores keys outside the nexus.* namespace", () => {
    const store = new InMemorySettingsStore();
    const outcome = reconcileSecondaryMirror(store, [
      { key: "gemma-code.legacy", mirrorValue: 1 },
    ]);
    expect(outcome.applied).toEqual([]);
    expect(outcome.conflicts).toEqual([]);
    expect(store.get("gemma-code.legacy")).toBeUndefined();
  });

  it("is a no-op when values already agree", () => {
    const store = new InMemorySettingsStore({ "nexus.x": "same" });
    const outcome = reconcileSecondaryMirror(store, [
      { key: "nexus.x", mirrorValue: "same" },
    ]);
    expect(outcome.applied).toEqual([]);
    expect(outcome.conflicts).toEqual([]);
  });

  it("records a conflict when mirror and daemon disagree (daemon value wins)", () => {
    const store = new InMemorySettingsStore({ "nexus.x": "daemon" });
    const outcome = reconcileSecondaryMirror(store, [
      { key: "nexus.x", mirrorValue: "mirror" },
    ]);
    expect(outcome.conflicts).toEqual([
      { key: "nexus.x", mirrorValue: "mirror", daemonValue: "daemon" },
    ]);
    expect(store.get("nexus.x")).toBe("daemon");
  });
});

describe("settings IPC method ids", () => {
  it("exports the canonical method ids", () => {
    expect(SETTINGS_GET_METHOD).toBe("settings.get");
    expect(SETTINGS_SET_METHOD).toBe("settings.set");
  });
});
