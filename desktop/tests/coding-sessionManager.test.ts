import { describe, expect, it } from "vitest";
import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";

function makeMgr(): CodingSessionManager {
  let counter = 0;
  return new CodingSessionManager({
    now: () => new Date("2026-05-17T11:00:00Z"),
    idFactory: () => `sess-${++counter}`,
  });
}

describe("CodingSessionManager", () => {
  it("starts a session, returning a stable id + ISO createdAt + resolved family", () => {
    const mgr = makeMgr();
    const reply = mgr.start({ modelId: "qwen2.5-coder:7b" });
    expect(reply).toEqual({
      sessionId: "sess-1",
      modelId: "qwen2.5-coder:7b",
      family: "qwen",
      createdAt: "2026-05-17T11:00:00.000Z",
    });
    expect(mgr.size()).toBe(1);
  });

  it("rejects unknown model ids", () => {
    const mgr = makeMgr();
    expect(() => mgr.start({ modelId: "totally-fake" })).toThrow(/Unknown model id/);
  });

  it("uses the supplied title (trimmed), falling back to a derived label", () => {
    const mgr = makeMgr();
    const a = mgr.start({ modelId: "gemma4:e4b", title: "  Refactor PromptBuilder  " });
    const b = mgr.start({ modelId: "gemma4:e4b" });
    const list = mgr.list().sessions;
    expect(list.find((s) => s.sessionId === a.sessionId)?.title).toBe(
      "Refactor PromptBuilder",
    );
    expect(list.find((s) => s.sessionId === b.sessionId)?.title).toMatch(/^Session /);
  });

  it("sendMessage emits the full event union and increments messageCount", async () => {
    const mgr = makeMgr();
    const { sessionId } = mgr.start({ modelId: "llama3.1:8b" });
    const events = await mgr.sendMessage(sessionId, "Hello agent");
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual([
      "token",
      "toolCallHeader",
      "toolCallArgDelta",
      "toolCallComplete",
      "done",
    ]);
    expect(mgr.list().sessions[0]?.messageCount).toBe(1);
  });

  it("sendMessage carries the family name through to the tool result payload", async () => {
    const mgr = makeMgr();
    const { sessionId } = mgr.start({ modelId: "deepseek-coder:6.7b" });
    const events = await mgr.sendMessage(sessionId, "ping");
    const complete = events.find((e) => e.kind === "toolCallComplete");
    if (complete?.kind !== "toolCallComplete") throw new Error("missing complete event");
    expect(complete.result).toContain("deepseek");
  });

  it("cancel reports the first-cancel flag and is idempotent afterwards", () => {
    const mgr = makeMgr();
    const { sessionId } = mgr.start({ modelId: "gemma4:e4b" });
    const first = mgr.cancel(sessionId);
    expect(first).toEqual({ sessionId, cancelled: true });
    const second = mgr.cancel(sessionId);
    expect(second).toEqual({ sessionId, cancelled: false });
  });

  it("cancel / sendMessage / resume reject unknown sessionIds", async () => {
    const mgr = makeMgr();
    expect(() => mgr.cancel("nope")).toThrow(/unknown sessionId/);
    await expect(mgr.sendMessage("nope", "m")).rejects.toThrow(/unknown sessionId/);
    expect(() => mgr.resume("nope")).toThrow(/unknown sessionId/);
  });

  it("list returns a summary per live session", async () => {
    const mgr = makeMgr();
    const a = mgr.start({ modelId: "gemma4:e4b" });
    const b = mgr.start({ modelId: "qwen2.5:7b" });
    await mgr.sendMessage(a.sessionId, "m1");
    const list = mgr.list().sessions.map((s) => s.sessionId).sort();
    expect(list).toEqual([a.sessionId, b.sessionId].sort());
  });

  it("resume returns the current session summary", async () => {
    const mgr = makeMgr();
    const a = mgr.start({ modelId: "qwen2.5:7b" });
    await mgr.sendMessage(a.sessionId, "first");
    await mgr.sendMessage(a.sessionId, "second");
    const { session } = mgr.resume(a.sessionId);
    expect(session.messageCount).toBe(2);
    expect(session.family).toBe("qwen");
  });

  it("uses a default id factory and clock when none are injected", () => {
    const mgr = new CodingSessionManager();
    const reply = mgr.start({ modelId: "gemma4:e4b" });
    expect(reply.sessionId).toMatch(/[0-9a-f-]{8,}/);
    expect(reply.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
