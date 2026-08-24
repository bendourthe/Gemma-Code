import { describe, expect, it } from "vitest";

import { AskInbox } from "../../modules/coding/autonomy/AskInbox.js";
import { AgentRunScheduler } from "../../modules/coding/autonomy/AgentRunScheduler.js";
import { createHandlerContext, dispatch } from "../sidecar/src/handlers";
import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";
import { METHOD_SCHEMAS } from "../sidecar/src/protocol";

function makeCtx() {
  const askInbox = new AskInbox({ idFactory: () => "h1" });
  const scheduler = new AgentRunScheduler({
    inbox: askInbox,
    workspacePath: "/tmp/ws",
    runHeadless: async () => undefined,
    createCheckpoint: async () => null,
  });
  const ctx = createHandlerContext(
    { pid: 1, platform: process.platform },
    new CodingSessionManager(),
  );
  ctx.askInbox = askInbox;
  ctx.scheduler = scheduler;
  return ctx;
}

describe("ask inbox IPC handlers", () => {
  it("flags Phase 4 methods as implemented", () => {
    for (const method of [
      "ask.inbox.list",
      "ask.inbox.approve",
      "ask.inbox.deny",
      "ask.inbox.pendingCount",
      "ask.scheduler.list",
      "ask.scheduler.setEnabled",
    ] as const) {
      expect(METHOD_SCHEMAS[method].implemented).toBe(true);
    }
  });

  it("lists, denies, and reports pending count", async () => {
    const ctx = makeCtx();
    await ctx.askInbox!.park({
      toolName: "write_file",
      summary: "Run write_file?",
      args: { path: "a.ts" },
      runMode: "headless",
      runId: "run-1",
    });
    const listed = (await dispatch("ask.inbox.list", {}, ctx)) as { asks: { id: string }[] };
    expect(listed.asks).toHaveLength(1);
    const count = (await dispatch("ask.inbox.pendingCount", {}, ctx)) as { pending: number };
    expect(count.pending).toBe(1);
    const denied = (await dispatch("ask.inbox.deny", { id: "h1" }, ctx)) as { ok: boolean };
    expect(denied.ok).toBe(true);
    const after = (await dispatch("ask.inbox.pendingCount", {}, ctx)) as { pending: number };
    expect(after.pending).toBe(0);
  });

  it("lists the morning-brief schedule and can enable it", async () => {
    const ctx = makeCtx();
    const listed = (await dispatch("ask.scheduler.list", {}, ctx)) as {
      schedules: { id: string; enabled: boolean }[];
    };
    expect(listed.schedules.some((s) => s.id === "morning-brief" && s.enabled === false)).toBe(true);
    const updated = (await dispatch("ask.scheduler.setEnabled", { id: "morning-brief", enabled: true }, ctx)) as {
      ok: boolean;
      schedule?: { enabled: boolean };
    };
    expect(updated.ok).toBe(true);
    expect(updated.schedule?.enabled).toBe(true);
  });
});
