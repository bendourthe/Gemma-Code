import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { bootstrapCoding } from "../sidecar/src/runtime/codingBootstrap";
import { InMemorySettingsStore } from "../../core/storage/SettingsStore";

describe("bootstrapCoding", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-bs-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns a hydrated ModelPinRegistry + keepAliveResolver", async () => {
    const settings = new InMemorySettingsStore();
    await settings.set("nexus.llm.modelPins", ["gemma4:e4b"]);
    const boot = await bootstrapCoding({ nexusHome: root, settings });
    expect(boot.modelPins.isPinned("gemma4:e4b")).toBe(true);
    expect(boot.keepAliveResolver("gemma4:e4b")).toBe(-1);
    expect(boot.keepAliveResolver("other")).toBe("5m");
  });

  it("creates a JsonFileSettingsStore when none is injected", async () => {
    const boot = await bootstrapCoding({ nexusHome: root });
    await boot.modelPins.setPinned("foo", true);
    const settingsFile = path.join(root, "settings.json");
    const body = await fs.readFile(settingsFile, "utf8");
    expect(JSON.parse(body)["nexus.llm.modelPins"]).toEqual(["foo"]);
  });
});
