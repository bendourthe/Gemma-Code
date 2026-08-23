/**
 * Cover settings IPC adapters that previously sat at 0-33% function coverage
 * and pulled the Shell Build functions gate below 80%.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { clearInvokeOverride, setInvokeOverride } from "../src/lib/ipc";
import * as chatIpc from "../src/modules/chat/ipcChatExplorerClient";
import { createIpcAskInboxClient } from "../src/pages/inbox/ipcAskInboxClient";
import { createIpcAuditClient } from "../src/pages/settings/ipcAuditClient";
import { createIpcCredentialsClient } from "../src/pages/settings/ipcCredentialsClient";
import { createIpcFineTuningClient } from "../src/pages/settings/ipcFineTuningClient";
import { createIpcMcpRegistryClient } from "../src/pages/settings/ipcMcpRegistryClient";
import { createIpcSkillOptimizerClient } from "../src/pages/settings/ipcSkillOptimizerClient";
import {
  createDataTransferClient,
  defaultExportPath,
} from "../src/pages/settings/dataTransferClient";
import type { TuningJobDto, TuningStatusDto } from "../src/pages/settings/fineTuningTypes";

afterEach(() => {
  clearInvokeOverride();
  vi.restoreAllMocks();
});

function stub(handler: (method: string, params: Record<string, unknown>) => unknown): void {
  setInvokeOverride(async (_cmd, args) => {
    const a = args as { method: string; params: Record<string, unknown> };
    return handler(a.method, a.params ?? {});
  });
}

const TUNING_STATUS: TuningStatusDto = {
  supported: true,
  reason: "ok",
  provisionStatus: "ready",
  provisionError: null,
  vramGB: 24,
  gpuVendor: "nvidia",
  osFamily: "linux",
  pins: [],
};

const TUNING_JOB: TuningJobDto = {
  id: "j1",
  baseModelId: "base",
  datasetId: "d1",
  datasetPath: "/d",
  state: "queued",
  error: null,
  checkpointPath: null,
  exportPath: null,
  evalDelta: null,
  createdAt: "t0",
  updatedAt: "t0",
};

describe("createIpcCredentialsClient", () => {
  it("maps status, listKeys, setSecret, and deleteSecret", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    stub((method, params) => {
      calls.push({ method, params });
      if (method === "credentials.status") return { available: true };
      if (method === "credentials.list") return { keys: ["HF_TOKEN"] };
      if (method === "credentials.set") return { ok: true };
      if (method === "credentials.delete") return { removed: true };
      throw new Error(method);
    });
    const client = createIpcCredentialsClient();
    expect(await client.status()).toEqual({ available: true });
    expect(await client.listKeys("huggingface")).toEqual(["HF_TOKEN"]);
    await client.setSecret("huggingface", "HF_TOKEN", "x");
    expect(await client.deleteSecret("huggingface", "HF_TOKEN")).toBe(true);
    expect(calls.map((c) => c.method)).toEqual([
      "credentials.status",
      "credentials.list",
      "credentials.set",
      "credentials.delete",
    ]);
  });

  it("treats an unreachable sidecar as keychain unavailable", async () => {
    setInvokeOverride(null);
    expect(await createIpcCredentialsClient().status()).toEqual({ available: false });
  });

  it("throws when listKeys cannot reach the sidecar", async () => {
    setInvokeOverride(null);
    await expect(createIpcCredentialsClient().listKeys("huggingface")).rejects.toThrow(
      /ipc-unavailable/,
    );
  });
});

describe("createIpcAuditClient", () => {
  it("maps audit.list and audit.status", async () => {
    stub((method, params) => {
      if (method === "audit.list") {
        expect(params).toEqual({ actor: "app" });
        return {
          events: [
            {
              id: 1,
              ts: "t",
              actor: "app",
              pillar: "chat",
              kind: "send",
              trusted: true,
            },
          ],
        };
      }
      if (method === "audit.status") {
        return { eventCount: 4, droppedCount: 0, vaultAvailable: true };
      }
      throw new Error(method);
    });
    const client = createIpcAuditClient();
    expect(await client.list({ actor: "app" })).toHaveLength(1);
    expect(await client.status()).toEqual({
      eventCount: 4,
      droppedCount: 0,
      vaultAvailable: true,
    });
  });
});

describe("createIpcMcpRegistryClient", () => {
  it("lists servers and sets tool deny", async () => {
    const server = {
      name: "files",
      source: "user" as const,
      policyVerdict: "allow" as const,
      policyReason: "",
      tools: [],
    };
    stub((method, params) => {
      if (method === "mcp.registry.list") return { servers: [server] };
      if (method === "mcp.registry.setToolDenied") {
        expect(params).toEqual({ serverName: "files", toolName: "rm", denied: true });
        return { ok: true, reason: "", servers: [server] };
      }
      throw new Error(method);
    });
    const client = createIpcMcpRegistryClient();
    expect(await client.list()).toEqual([server]);
    expect(await client.setToolDenied("files", "rm", true)).toMatchObject({ ok: true });
  });
});

describe("createIpcSkillOptimizerClient", () => {
  it("previews with options and applies a proposal", async () => {
    const proposal = {
      id: "p1",
      skillId: "s1",
      skillPath: "/skills/s1",
      diff: "+ foo",
    };
    stub((method, params) => {
      if (method === "skills.optimize.preview") {
        expect(params).toEqual({ skillId: "s1", model: "gemma4:e4b", maxRounds: 2 });
        return { token: "tok", proposals: [proposal] };
      }
      if (method === "skills.optimize.apply") {
        expect(params).toEqual({ token: "tok", proposalId: "p1" });
        return { applied: true, skillPath: "/skills/s1" };
      }
      throw new Error(method);
    });
    const client = createIpcSkillOptimizerClient();
    expect(await client.preview("s1", { model: "gemma4:e4b", maxRounds: 2 })).toEqual({
      token: "tok",
      proposals: [proposal],
    });
    expect(await client.apply("tok", "p1")).toEqual({
      applied: true,
      skillPath: "/skills/s1",
    });
  });
});

describe("createIpcFineTuningClient remaining methods", () => {
  it("maps provision, preflight, jobs, and base models", async () => {
    const startInput = { baseModelId: "base", datasetId: "d1", datasetPath: "/d" };
    stub((method, params) => {
      if (method === "tuning.provision") return { ...TUNING_STATUS, ok: true };
      if (method === "tuning.preflight") return { ok: true, message: "ready" };
      if (method === "tuning.job.list") return { jobs: [TUNING_JOB] };
      if (method === "tuning.job.start") {
        expect(params).toEqual(startInput);
        return { job: TUNING_JOB };
      }
      if (method === "tuning.job.cancel") {
        expect(params).toEqual({ id: "j1" });
        return { job: { ...TUNING_JOB, state: "interrupted" } };
      }
      if (method === "tuning.models.list") {
        expect(params).toEqual({ hostVramGB: 16 });
        return {
          models: [
            {
              id: "base",
              displayName: "Base",
              codingEligible: true,
              vision: false,
              requiredVramGB: 16,
            },
          ],
        };
      }
      throw new Error(method);
    });
    const client = createIpcFineTuningClient();
    expect((await client.provision()).ok).toBe(true);
    expect(await client.preflight()).toEqual({ ok: true, message: "ready" });
    expect(await client.listJobs()).toEqual([TUNING_JOB]);
    expect(await client.startJob(startInput)).toEqual(TUNING_JOB);
    expect(await client.cancelJob("j1")).toMatchObject({ state: "interrupted" });
    expect(await client.listBaseModels(16)).toEqual([
      {
        id: "base",
        displayName: "Base",
        codingEligible: true,
        vision: false,
        requiredVramGB: 16,
      },
    ]);
  });
});

describe("createDataTransferClient", () => {
  it("returns null outside Tauri", () => {
    expect(createDataTransferClient()).toBeNull();
  });

  it("stamps a timestamp into the default export path", () => {
    expect(defaultExportPath(new Date("2026-08-23T12:00:00.000Z"))).toBe(
      "nexus-export-2026-08-23-12-00-00.tar.gz",
    );
  });

  it("maps categories, export, and import when Tauri is present", async () => {
    vi.spyOn(chatIpc, "tauriAvailable").mockReturnValue(true);
    stub((method, params) => {
      if (method === "data.categories") {
        return { categories: [{ id: "chats", label: "Chats", description: "Conversations." }] };
      }
      if (method === "data.export") {
        expect(params.includeCredentials).toBe(false);
        return { path: "out.tar.gz", bytes: 12, empty: [] };
      }
      if (method === "data.import" && params.dryRun === true) {
        return { applied: ["chats"], skipped: [] };
      }
      if (method === "data.import" && params.dryRun === false) {
        return { applied: ["chats"], backupPath: "bak.tar.gz" };
      }
      throw new Error(method);
    });
    const client = createDataTransferClient();
    expect(client).not.toBeNull();
    expect(await client!.categories()).toEqual([
      { id: "chats", label: "Chats", description: "Conversations." },
    ]);
    expect(
      await client!.export({ categories: ["chats"], includeCredentials: false }),
    ).toEqual({ path: "out.tar.gz", bytes: 12, empty: [] });
    expect(await client!.importDryRun("/in.tar.gz")).toEqual({
      applied: ["chats"],
      skipped: [],
    });
    expect(await client!.importApply("/in.tar.gz")).toEqual({
      applied: ["chats"],
      backupPath: "bak.tar.gz",
    });
  });
});

describe("createIpcAskInboxClient", () => {
  it("maps list, decisions, pending count, and schedules", async () => {
    const ask = {
      id: "a1",
      state: "pending" as const,
      runMode: "headless" as const,
      createdAt: 1,
      expiresAt: 2,
      toolName: "write_file",
      summary: "write?",
      detail: "d",
      args: {},
      risk: "confirm",
      classificationReason: "writes",
      parkedTier: 1,
      runId: "r1",
    };
    const schedule = { id: "morning-brief", name: "Morning brief", enabled: false, kind: "daily" as const };
    stub((method, params) => {
      if (method === "ask.inbox.list") {
        expect(params).toEqual({ state: "pending" });
        return { asks: [ask] };
      }
      if (method === "ask.inbox.approve") return { ok: true, reason: "ok" };
      if (method === "ask.inbox.deny") return { ok: true, reason: "no" };
      if (method === "ask.inbox.pendingCount") return { pending: 3 };
      if (method === "ask.scheduler.list") return { schedules: [schedule] };
      if (method === "ask.scheduler.setEnabled") {
        expect(params).toEqual({ id: "morning-brief", enabled: true });
        return { ok: true };
      }
      throw new Error(method);
    });
    const client = createIpcAskInboxClient();
    expect(await client.list("pending")).toEqual([ask]);
    expect(await client.approve("a1")).toEqual({ ok: true, reason: "ok" });
    expect(await client.deny("a1")).toEqual({ ok: true, reason: "no" });
    expect(await client.pendingCount()).toBe(3);
    expect(await client.listSchedules()).toEqual([schedule]);
    expect(await client.setScheduleEnabled("morning-brief", true)).toEqual({ ok: true });
  });

  it("returns 0 pending when the sidecar is unreachable", async () => {
    setInvokeOverride(null);
    expect(await createIpcAskInboxClient().pendingCount()).toBe(0);
  });
});
