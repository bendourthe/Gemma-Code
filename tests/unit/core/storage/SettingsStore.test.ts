import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  InMemorySettingsStore,
  JsonFileSettingsStore,
} from "../../../../core/storage/SettingsStore.js";

describe("InMemorySettingsStore", () => {
  it("get / set / delete round-trip", async () => {
    const s = new InMemorySettingsStore();
    expect(await s.get("k")).toBeUndefined();
    await s.set("k", { a: 1 });
    expect(await s.get<{ a: number }>("k")).toEqual({ a: 1 });
    await s.delete("k");
    expect(await s.get("k")).toBeUndefined();
  });

  it("entries surfaces all keys", async () => {
    const s = new InMemorySettingsStore();
    await s.set("a", 1);
    await s.set("b", "two");
    expect(s.entries().sort()).toEqual([
      ["a", 1],
      ["b", "two"],
    ]);
  });
});

describe("JsonFileSettingsStore", () => {
  let tmp: string;
  let filePath: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-settings-"));
    filePath = path.join(tmp, "nested", "settings.json");
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns undefined when the file does not exist", async () => {
    const s = new JsonFileSettingsStore({ filePath });
    expect(await s.get("k")).toBeUndefined();
  });

  it("creates the file on first set and persists across instances", async () => {
    const a = new JsonFileSettingsStore({ filePath });
    await a.set("nexus.llm.modelPins", ["gemma4:e4b", "qwen2.5-coder:7b"]);
    const b = new JsonFileSettingsStore({ filePath });
    expect(await b.get<readonly string[]>("nexus.llm.modelPins")).toEqual([
      "gemma4:e4b",
      "qwen2.5-coder:7b",
    ]);
  });

  it("delete is a no-op when the key is absent", async () => {
    const s = new JsonFileSettingsStore({ filePath });
    await s.delete("missing");
    expect(await s.get("missing")).toBeUndefined();
  });

  it("delete removes an existing key from disk", async () => {
    const s = new JsonFileSettingsStore({ filePath });
    await s.set("k", 42);
    await s.delete("k");
    const fresh = new JsonFileSettingsStore({ filePath });
    expect(await fresh.get("k")).toBeUndefined();
  });
});
