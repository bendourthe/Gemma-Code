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

  // v2.2.0 Phase 2 (2.2): activeTag no longer swallows IPC failures. Returning
  // null on a dead backend made "cannot reach the backend" indistinguishable
  // from "catalog not synced", so the page offered a Sync button that the same
  // dead backend would have had to service. Null now means ONLY "the backend
  // answered and no catalog version is installed".
  it("activeTag throws when the sidecar is unavailable", async () => {
    setInvokeOverride(null); // no invoke -> ipcCall returns { ok: false }
    await expect(createIpcSkillsClient().activeTag()).rejects.toThrow(/ipc-unavailable/);
  });

  it("activeTag is null when the backend answers with no installed version", async () => {
    stub({ "skills.status": { installedVersion: null, catalogPresent: false, sourceRepo: "x" } });
    expect(await createIpcSkillsClient().activeTag()).toBeNull();
  });

  it("upstreamLatestTag maps skills.upstreamLatest.latestTag", async () => {
    stub({ "skills.upstreamLatest": { latestTag: "v9.9.9" } });
    expect(await createIpcSkillsClient().upstreamLatestTag()).toBe("v9.9.9");
  });

  it("syncNow returns the applied tag + summary", async () => {
    stub({
      "skills.sync": {
        tag: "v9.9.9",
        applied: true,
        alreadyUpToDate: false,
        blocked: false,
        summary: "+2 new, ~1 modified, -0 removed",
      },
    });
    expect(await createIpcSkillsClient().syncNow()).toEqual({
      tag: "v9.9.9",
      applied: true,
      summary: "+2 new, ~1 modified, -0 removed",
    });
  });

  it("syncNow reports 'already up to date'", async () => {
    stub({
      "skills.sync": {
        tag: "v9.9.9",
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

  it("syncNow succeeds when apply advanced the tag with quarantined skills", async () => {
    stub({
      "skills.sync": {
        tag: "v3.21.0",
        applied: true,
        alreadyUpToDate: false,
        blocked: false,
        quarantinedCount: 1,
        summary: "+8 new, ~0 modified, -0 removed; quarantined 1",
      },
    });
    expect(await createIpcSkillsClient().syncNow()).toEqual({
      tag: "v3.21.0",
      applied: true,
      summary: "+8 new, ~0 modified, -0 removed; quarantined 1",
    });
  });

  // v2.2.0 Phase 3 (3.2) closes NHC.P6.B / P6.C: list() and the auto-sync
  // toggle are backed by real IPC. Enable/disable and quarantine approval stay
  // unimplemented server-side, so they still reject rather than shipping dead
  // buttons.
  it("list reads the installed catalog through skills.list", async () => {
    stub({
      "skills.list": {
        skills: [
          {
            id: "nexus-hub/code-quality",
            displayName: "Code Quality",
            path: "/c/SKILL.md",
            provenance: { source: "nexus-hub", tag: "v9.9.9", contentHash: "abc" },
          },
        ],
        error: null,
      },
    });
    const rows = await createIpcSkillsClient().list();
    expect(rows.map((r) => r.id)).toEqual(["nexus-hub/code-quality"]);
  });

  it("list surfaces a catalog parse error instead of rendering an empty page", async () => {
    stub({ "skills.list": { skills: [], error: "bad frontmatter in x/SKILL.md" } });
    await expect(createIpcSkillsClient().list()).rejects.toThrow(/catalog unreadable/);
  });

  it("autoSync reads and writes the persisted setting", async () => {
    stub({ "skills.autoSync.get": { enabled: true }, "skills.autoSync.set": { enabled: false } });
    const c = createIpcSkillsClient();
    expect(await c.autoSyncEnabled()).toBe(true);
    await expect(c.setAutoSyncEnabled(false)).resolves.toBeUndefined();
  });

  it("still rejects the mutations the sidecar cannot perform", async () => {
    const c = createIpcSkillsClient();
    await expect(c.setActive("x", true)).rejects.toThrow();
    await expect(c.approveQuarantined("x")).rejects.toThrow();
  });
});
