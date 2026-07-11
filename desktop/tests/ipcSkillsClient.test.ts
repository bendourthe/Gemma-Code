/**
 * v1.10.0 Phase 6 (T036) -- ipcSkillsClient tests.
 *
 * Uses the ipc.ts `setInvokeOverride` seam to stub the Tauri bridge and assert
 * the client maps the sidecar `skills.*` responses to the SkillsSettings surface.
 */

import { describe, it, expect, afterEach } from "vitest";
import { setInvokeOverride, clearInvokeOverride } from "../src/lib/ipc";
import { createIpcSkillsClient } from "../src/pages/settings/ipcSkillsClient";

afterEach(() => clearInvokeOverride());

function stub(responses: Record<string, unknown>): void {
  setInvokeOverride(async (_cmd, args) => {
    const method = (args as { method: string }).method;
    if (method in responses) return responses[method];
    throw new Error(`unexpected method ${method}`);
  });
}

describe("createIpcSkillsClient", () => {
  it("activeTag maps skills.status.installedVersion", async () => {
    stub({
      "skills.status": {
        installedVersion: "v3.11.1",
        catalogPresent: true,
        sourceRepo: "bendourthe/Nexus-Hub",
      },
    });
    expect(await createIpcSkillsClient().activeTag()).toBe("v3.11.1");
  });

  it("activeTag is null when the sidecar is unavailable", async () => {
    setInvokeOverride(null); // no invoke -> ipcCall returns { ok: false }
    expect(await createIpcSkillsClient().activeTag()).toBeNull();
  });

  it("upstreamLatestTag maps skills.upstreamLatest.latestTag", async () => {
    stub({ "skills.upstreamLatest": { latestTag: "v3.12.0" } });
    expect(await createIpcSkillsClient().upstreamLatestTag()).toBe("v3.12.0");
  });

  it("syncNow returns the applied tag + summary", async () => {
    stub({
      "skills.sync": {
        tag: "v3.12.0",
        applied: true,
        alreadyUpToDate: false,
        blocked: false,
        summary: "+2 new, ~1 modified, -0 removed",
      },
    });
    expect(await createIpcSkillsClient().syncNow()).toEqual({
      tag: "v3.12.0",
      applied: true,
      summary: "+2 new, ~1 modified, -0 removed",
    });
  });

  it("syncNow reports 'already up to date'", async () => {
    stub({
      "skills.sync": {
        tag: "v3.12.0",
        applied: false,
        alreadyUpToDate: true,
        blocked: false,
        summary: "+0 new, ~0 modified, -0 removed",
      },
    });
    expect((await createIpcSkillsClient().syncNow()).summary).toBe("already up to date");
  });

  it("syncNow throws when the injection scanner blocks", async () => {
    stub({
      "skills.sync": {
        tag: "v9",
        applied: false,
        alreadyUpToDate: false,
        blocked: true,
        summary: "+1 new",
      },
    });
    await expect(createIpcSkillsClient().syncNow()).rejects.toThrow(
      /blocked by the injection scanner/,
    );
  });

  it("is a read-only surface: list is empty, mutations reject", async () => {
    const c = createIpcSkillsClient();
    expect(await c.list()).toEqual([]);
    expect(await c.autoSyncEnabled()).toBe(false);
    await expect(c.setActive("x", true)).rejects.toThrow();
    await expect(c.approveQuarantined("x")).rejects.toThrow();
  });
});
