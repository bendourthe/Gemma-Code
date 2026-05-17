import { describe, expect, it } from "vitest";
import {
  CodingMemorySnapshotRequest,
  CodingSessionCancelRequest,
  CodingSessionEvent,
  CodingSessionListRequest,
  CodingSessionResumeRequest,
  CodingSessionSendMessageRequest,
  CodingSessionStartRequest,
  CodingTraceSubscribeRequest,
  IPC_METHODS,
  METHOD_SCHEMAS,
  MemorySnapshot,
  ModelFamily,
  NotImplementedError,
  TraceEvent,
  isMethod,
} from "../sidecar/src/protocol";

describe("coding protocol", () => {
  it("declares every Phase 3 coding method", () => {
    expect(IPC_METHODS).toContain("coding.session.start");
    expect(IPC_METHODS).toContain("coding.session.sendMessage");
    expect(IPC_METHODS).toContain("coding.session.cancel");
    expect(IPC_METHODS).toContain("coding.session.list");
    expect(IPC_METHODS).toContain("coding.session.resume");
    expect(IPC_METHODS).toContain("coding.memory.snapshot");
    expect(IPC_METHODS).toContain("coding.trace.subscribe");
    expect(IPC_METHODS).toContain("coding.sessions.list");
  });

  it("flags every Phase 3 coding method as implemented", () => {
    const phase3 = [
      "coding.session.start",
      "coding.session.sendMessage",
      "coding.session.cancel",
      "coding.session.list",
      "coding.session.resume",
      "coding.memory.snapshot",
      "coding.trace.subscribe",
      "coding.sessions.list",
    ] as const;
    for (const m of phase3) {
      expect(METHOD_SCHEMAS[m].implemented).toBe(true);
    }
  });

  it("ModelFamily covers the v1.0.0 catalog families", () => {
    expect(ModelFamily.options).toEqual(["gemma", "llama", "qwen", "deepseek"]);
  });

  it("isMethod is exhaustive against IPC_METHODS", () => {
    for (const m of IPC_METHODS) expect(isMethod(m)).toBe(true);
    expect(isMethod("totally.fake")).toBe(false);
  });

  it("NotImplementedError carries the JSON-RPC method-not-found code", () => {
    const err = new NotImplementedError("models.list");
    expect(err.code).toBe(-32601);
    expect(err.message).toContain("models.list");
  });

  describe("request shapes", () => {
    it("CodingSessionStartRequest requires modelId", () => {
      expect(() => CodingSessionStartRequest.parse({})).toThrow();
      expect(CodingSessionStartRequest.parse({ modelId: "gemma4:e4b" })).toEqual({
        modelId: "gemma4:e4b",
      });
    });
    it("CodingSessionSendMessageRequest requires both fields", () => {
      expect(() =>
        CodingSessionSendMessageRequest.parse({ sessionId: "s" }),
      ).toThrow();
      expect(
        CodingSessionSendMessageRequest.parse({ sessionId: "s", message: "m" }),
      ).toEqual({ sessionId: "s", message: "m" });
    });
    it("CodingSessionCancelRequest is sessionId-only", () => {
      expect(() => CodingSessionCancelRequest.parse({})).toThrow();
    });
    it("CodingSessionListRequest accepts the empty object", () => {
      expect(CodingSessionListRequest.parse({})).toEqual({});
    });
    it("CodingSessionResumeRequest mirrors cancel shape", () => {
      expect(CodingSessionResumeRequest.parse({ sessionId: "x" })).toEqual({
        sessionId: "x",
      });
    });
    it("CodingMemorySnapshotRequest accepts optional sessionId", () => {
      expect(CodingMemorySnapshotRequest.parse({})).toEqual({});
      expect(CodingMemorySnapshotRequest.parse({ sessionId: "s" })).toEqual({
        sessionId: "s",
      });
    });
    it("CodingTraceSubscribeRequest accepts optional sessionId", () => {
      expect(CodingTraceSubscribeRequest.parse({})).toEqual({});
    });
  });

  describe("event shapes", () => {
    it("validates token event", () => {
      expect(CodingSessionEvent.parse({ kind: "token", text: "hi" })).toEqual({
        kind: "token",
        text: "hi",
      });
    });
    it("validates toolCallHeader / toolCallArgDelta / toolCallComplete", () => {
      const header = { kind: "toolCallHeader", callId: "c1", name: "fs.read" };
      const delta = { kind: "toolCallArgDelta", callId: "c1", delta: "{a:1" };
      const done = { kind: "toolCallComplete", callId: "c1", result: "ok" };
      expect(CodingSessionEvent.parse(header)).toEqual(header);
      expect(CodingSessionEvent.parse(delta)).toEqual(delta);
      expect(CodingSessionEvent.parse(done)).toEqual(done);
    });
    it("validates done event with optional finishReason", () => {
      expect(CodingSessionEvent.parse({ kind: "done" })).toEqual({ kind: "done" });
      expect(
        CodingSessionEvent.parse({ kind: "done", finishReason: "stop" }),
      ).toEqual({ kind: "done", finishReason: "stop" });
    });
    it("rejects unknown event kinds", () => {
      expect(() =>
        CodingSessionEvent.parse({ kind: "explode", text: "boom" } as unknown),
      ).toThrow();
    });
  });

  it("MemorySnapshot enforces all four layers + anticipated/proposedSkills", () => {
    const snap = {
      layers: { core: [], recent: [], working: [], project: [] },
      anticipated: [],
      proposedSkills: [],
    };
    expect(MemorySnapshot.parse(snap)).toEqual(snap);
    expect(() =>
      MemorySnapshot.parse({
        layers: { core: [], recent: [], working: [] },
        anticipated: [],
        proposedSkills: [],
      }),
    ).toThrow();
  });

  it("TraceEvent restricts kind enum", () => {
    expect(
      TraceEvent.parse({
        id: "1",
        timestamp: "2026-05-17T00:00:00Z",
        kind: "tool",
        summary: "read_file",
      }),
    ).toBeTruthy();
    expect(() =>
      TraceEvent.parse({
        id: "1",
        timestamp: "x",
        kind: "blah",
        summary: "y",
      }),
    ).toThrow();
  });
});
