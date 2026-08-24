/**
 * Exercise mock settings clients whose leftover methods sat well below
 * the Shell Build functions floor.
 */

import { describe, expect, it } from "vitest";

import { createMockModelsClient } from "../src/pages/settings/mockModelsClient";
import { createMockSkillOptimizerClient } from "../src/pages/settings/mockSkillOptimizerClient";
import { createMockSkillsClient } from "../src/pages/settings/mockSkillsClient";

describe("createMockSkillOptimizerClient", () => {
  it("returns an empty preview and a no-op apply", async () => {
    const client = createMockSkillOptimizerClient();
    expect(await client.preview("s1")).toEqual({ token: "mock", proposals: [] });
    expect(await client.apply("mock", "p1")).toEqual({ applied: false, skillPath: "" });
  });
});

describe("createMockSkillsClient", () => {
  it("lists sample skills and applies in-memory mutations", async () => {
    const client = createMockSkillsClient();
    expect((await client.list()).length).toBeGreaterThan(0);
    expect(await client.activeTag()).toBe("v1.3.2");
    expect(await client.upstreamLatestTag()).toBe("v1.4.0");
    expect(await client.autoSyncEnabled()).toBe(false);
    await client.setAutoSyncEnabled(true);
    expect(await client.autoSyncEnabled()).toBe(true);
    const sync = await client.syncNow();
    expect(sync.applied).toBe(true);
    await client.setActive("writing-editing", false);
    expect((await client.list()).find((s) => s.id === "writing-editing")?.active).toBe(false);
    await client.approveQuarantined("writing-editing");
    await client.setDivergedPreference?.("Code Quality", "user");
  });
});

describe("createMockModelsClient", () => {
  it("lists, reports disk usage, installs, cancels, and removes", async () => {
    const client = createMockModelsClient();
    const listed = await client.list();
    expect(listed.length).toBeGreaterThan(0);
    const usage = await client.diskUsage();
    expect(usage.usedBytes).toBeGreaterThanOrEqual(0);
    const id = listed[0]!.id;
    const handle = client.install(id, () => {});
    handle.cancel();
    await expect(handle.done).rejects.toThrow(/cancelled/);
    await client.remove(id);
  });
});
