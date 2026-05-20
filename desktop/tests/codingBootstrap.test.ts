import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  AUTO_SYNC_SETTING_KEY,
  bootstrapCoding,
} from "../sidecar/src/runtime/codingBootstrap";
import { InMemorySettingsStore } from "../../core/storage/SettingsStore";
import { IdleScheduler } from "../sidecar/src/runtime/idleScheduler";
import { DEVAI_HUB_SYNC_TASK_ID } from "../../core/skills/DevAIHubAutoSync";

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

  it("attaches SkillsReloader when a catalog is supplied", async () => {
    const reloads: number[] = [];
    const catalog = {
      reload(): Promise<void> {
        reloads.push(Date.now());
        return Promise.resolve();
      },
    };
    const boot = await bootstrapCoding({
      nexusHome: root,
      skillCatalog: catalog,
    });
    expect(boot.skillsReloader).not.toBeNull();
    boot.skillsReloader?.stop();
  });

  it("does not attach SkillsReloader when no catalog is supplied", async () => {
    const boot = await bootstrapCoding({ nexusHome: root });
    expect(boot.skillsReloader).toBeNull();
  });

  it("registers the DevAI-Hub auto-sync worker when the setting is true", async () => {
    const settings = new InMemorySettingsStore();
    await settings.set(AUTO_SYNC_SETTING_KEY, true);
    const scheduler = new IdleScheduler({ now: () => 0 });
    let runs = 0;
    const boot = await bootstrapCoding({
      nexusHome: root,
      settings,
      idleScheduler: scheduler,
      syncRunner: async () => {
        runs += 1;
      },
    });
    expect(boot.autoSyncRegistered).toBe(true);
    expect(scheduler.size()).toBe(1);
    // We do not exercise the cadence here -- DevAIHubAutoSync.test.ts owns
    // that assertion; here we just confirm registration.
    void runs;
  });

  it("skips registration when the auto-sync setting is unset", async () => {
    const scheduler = new IdleScheduler({ now: () => 0 });
    const boot = await bootstrapCoding({
      nexusHome: root,
      idleScheduler: scheduler,
    });
    expect(boot.autoSyncRegistered).toBe(false);
    expect(scheduler.size()).toBe(0);
  });

  it("unregisters a stale worker when the setting flips to false", async () => {
    const settings = new InMemorySettingsStore();
    const scheduler = new IdleScheduler({ now: () => 0 });
    await settings.set(AUTO_SYNC_SETTING_KEY, true);
    await bootstrapCoding({
      nexusHome: root,
      settings,
      idleScheduler: scheduler,
      syncRunner: async () => {},
    });
    expect(scheduler.size()).toBe(1);
    await settings.set(AUTO_SYNC_SETTING_KEY, false);
    const boot2 = await bootstrapCoding({
      nexusHome: root,
      settings,
      idleScheduler: scheduler,
    });
    expect(boot2.autoSyncRegistered).toBe(false);
    expect(scheduler.size()).toBe(0);
    // Direct constant access matches the well-known id.
    expect(DEVAI_HUB_SYNC_TASK_ID).toBe("nexus.skills.devai-hub-sync");
  });
});
