import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AskInbox, JsonFileAskInboxStore } from "../../../modules/coding/autonomy/AskInbox.js";
import { PermissionTier } from "../../../modules/coding/runtime/headlessGuards.js";

describe("AskInbox", () => {
  it("parks a headless ask with classifier context", async () => {
    const inbox = new AskInbox({ idFactory: () => "ask-1" });
    const parked = await inbox.park({
      toolName: "write_file",
      summary: "Run write_file?",
      detail: "tier CONFIRM",
      args: { path: "a.ts", content: "x" },
      runMode: "headless",
      runId: "run-1",
      sessionId: "sess-1",
    });
    expect(parked.id).toBe("ask-1");
    expect(parked.state).toBe("pending");
    expect(parked.parkedTier).toBe(PermissionTier.CONFIRM);
    expect(parked.toolName).toBe("write_file");
    expect(parked.args.path).toBe("a.ts");
    expect(parked.runId).toBe("run-1");
    expect(await inbox.pendingCount()).toBe(1);
  });

  it("approve replays and unblocks the waiter", async () => {
    const inbox = new AskInbox({ idFactory: () => "ask-2" });
    const waiting = inbox.parkAndWait({
      toolName: "write_file",
      summary: "Run write_file?",
      args: { path: "a.ts", content: "x" },
      runMode: "headless",
      runId: "run-2",
    });
    const pending = await inbox.list("pending");
    expect(pending).toHaveLength(1);
    const result = await inbox.approve(pending[0].id);
    expect(result.ok).toBe(true);
    expect(result.executed).toBe(false);
    expect(result.replay?.allowed).toBe(true);
    expect(await waiting).toBe("approved");
    expect(await inbox.pendingCount()).toBe(0);
  });

  it("deny fails safe and unblocks the waiter", async () => {
    const inbox = new AskInbox();
    const waiting = inbox.parkAndWait({
      toolName: "write_file",
      summary: "Run write_file?",
      args: { path: "a.ts" },
      runMode: "scheduled",
      runId: "run-3",
    });
    const pending = await inbox.list("pending");
    await inbox.deny(pending[0].id);
    expect(await waiting).toBe("denied");
  });

  it("expiry fails safe", async () => {
    let now = 1_000;
    const inbox = new AskInbox({ now: () => now, ttlMs: 10 });
    const ask = await inbox.park({
      toolName: "write_file",
      summary: "Run write_file?",
      args: { path: "a.ts" },
      runMode: "headless",
      runId: "run-4",
    });
    const waiting = inbox.waitForDecision(ask.id);
    await Promise.resolve();
    expect((await inbox.get(ask.id))?.state).toBe("pending");
    now = 1_020;
    expect(await inbox.sweepExpired()).toBe(1);
    expect(await waiting).toBe("expired");
    expect(await inbox.pendingCount()).toBe(0);
  });

  it("approve without a live waiter fails safe and does not execute", async () => {
    const inbox = new AskInbox({ idFactory: () => "orphan" });
    await inbox.park({
      toolName: "write_file",
      summary: "Run write_file?",
      args: { path: "a.ts", content: "x" },
      runMode: "headless",
      runId: "run-5",
    });
    const result = await inbox.approve("orphan");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/session gone/i);
    expect(result.executed).toBe(false);
    const listed = await inbox.list();
    expect(listed[0].state).toBe("denied");
  });

  it("persists pending asks to a JSON file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nexus-ask-inbox-"));
    const filePath = join(dir, "ask-inbox.json");
    try {
      const first = new AskInbox({
        store: new JsonFileAskInboxStore(filePath),
        idFactory: () => "disk-1",
      });
      await first.park({
        toolName: "write_file",
        summary: "Run write_file?",
        args: { path: "a.ts" },
        runMode: "headless",
        runId: "run-6",
      });
      const raw = await readFile(filePath, "utf8");
      expect(raw).toContain("disk-1");
      const second = new AskInbox({ store: new JsonFileAskInboxStore(filePath) });
      expect(await second.pendingCount()).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
