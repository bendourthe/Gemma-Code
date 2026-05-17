import { describe, expect, it } from "vitest";
import {
  createHandlerContext,
  dispatch,
  handlers,
  SIDECAR_VERSION,
  SUPPORTED_METHODS,
  type HandlerContext,
} from "../sidecar/src/handlers";
import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";
import { IPC_METHODS, NotImplementedError, isMethod } from "../sidecar/src/protocol";

function makeCtx(): HandlerContext {
  return createHandlerContext(
    { pid: 12345, platform: process.platform },
    new CodingSessionManager({
      now: () => new Date("2026-05-17T11:00:00Z"),
      idFactory: (() => {
        let i = 0;
        return () => `s-${++i}`;
      })(),
    }),
  );
}

describe("sidecar handlers", () => {
  it("ping returns a well-formed response", async () => {
    const reply = await dispatch("ping", {}, makeCtx());
    expect(reply).toMatchObject({
      ok: true,
      pid: 12345,
      version: SIDECAR_VERSION,
      platform: process.platform,
    });
  });

  it("rejects unknown methods", async () => {
    await expect(dispatch("not.a.method", {}, makeCtx())).rejects.toThrow(/UnknownMethod/);
  });

  it("declared-but-unimplemented methods throw NotImplementedError", async () => {
    const ctx = makeCtx();
    const unimplemented = SUPPORTED_METHODS.filter(
      (m) =>
        ![
          "ping",
          "coding.session.start",
          "coding.session.sendMessage",
          "coding.session.cancel",
          "coding.session.list",
          "coding.session.resume",
          "coding.memory.snapshot",
          "coding.trace.subscribe",
          "coding.sessions.list",
          // v1.0.0 Phase 6 wired the diffusion surface.
          "diffusion.health",
          "diffusion.version",
          "diffusion.txt2img",
          "diffusion.img2img",
          "diffusion.inpaint",
          "diffusion.outpaint",
          "diffusion.job.drainEvents",
          "diffusion.workflow.extract",
        ].includes(m),
    );
    for (const m of unimplemented) {
      await expect(dispatch(m, {}, ctx)).rejects.toBeInstanceOf(NotImplementedError);
    }
  });

  it("isMethod is exhaustive against IPC_METHODS", () => {
    for (const m of IPC_METHODS) expect(isMethod(m)).toBe(true);
    expect(isMethod("ping.nope")).toBe(false);
  });

  it("handlers covers every declared method", () => {
    for (const m of IPC_METHODS) expect(typeof handlers[m]).toBe("function");
  });

  describe("coding session lifecycle", () => {
    it("start -> sendMessage -> cancel -> list happy path", async () => {
      const ctx = makeCtx();
      const start = (await dispatch(
        "coding.session.start",
        { modelId: "gemma4:e4b" },
        ctx,
      )) as { sessionId: string; family: string };
      expect(start.sessionId).toBe("s-1");
      expect(start.family).toBe("gemma");

      const send = (await dispatch(
        "coding.session.sendMessage",
        { sessionId: start.sessionId, message: "Hello agent" },
        ctx,
      )) as { sessionId: string; events: { kind: string }[] };
      expect(send.events.map((e) => e.kind)).toEqual([
        "token",
        "toolCallHeader",
        "toolCallArgDelta",
        "toolCallComplete",
        "done",
      ]);

      const cancel = (await dispatch(
        "coding.session.cancel",
        { sessionId: start.sessionId },
        ctx,
      )) as { cancelled: boolean };
      expect(cancel.cancelled).toBe(true);

      const list = (await dispatch("coding.session.list", {}, ctx)) as {
        sessions: { sessionId: string }[];
      };
      expect(list.sessions[0]?.sessionId).toBe(start.sessionId);
    });

    it("resume reflects the current message count", async () => {
      const ctx = makeCtx();
      const start = (await dispatch(
        "coding.session.start",
        { modelId: "qwen2.5-coder:7b" },
        ctx,
      )) as { sessionId: string };
      await dispatch(
        "coding.session.sendMessage",
        { sessionId: start.sessionId, message: "one" },
        ctx,
      );
      const resumed = (await dispatch(
        "coding.session.resume",
        { sessionId: start.sessionId },
        ctx,
      )) as { session: { messageCount: number } };
      expect(resumed.session.messageCount).toBe(1);
    });

    it("rejects malformed start params via the zod schema", async () => {
      await expect(
        dispatch("coding.session.start", { wrong: true }, makeCtx()),
      ).rejects.toThrow();
    });

    it("rejects malformed sendMessage params", async () => {
      await expect(
        dispatch("coding.session.sendMessage", { sessionId: "x" }, makeCtx()),
      ).rejects.toThrow();
    });

    it("sessions.list returns the same data as session.list", async () => {
      const ctx = makeCtx();
      await dispatch("coding.session.start", { modelId: "gemma4:e4b" }, ctx);
      const a = (await dispatch("coding.session.list", {}, ctx)) as {
        sessions: unknown[];
      };
      const b = (await dispatch("coding.sessions.list", {}, ctx)) as {
        sessions: unknown[];
      };
      expect(a).toEqual(b);
    });
  });

  describe("panel handlers", () => {
    it("coding.memory.snapshot returns the full memory layout", async () => {
      const ctx = makeCtx();
      const result = (await dispatch("coding.memory.snapshot", {}, ctx)) as {
        snapshot: {
          layers: Record<string, string[]>;
          anticipated: string[];
          proposedSkills: string[];
        };
      };
      expect(Object.keys(result.snapshot.layers).sort()).toEqual([
        "core",
        "project",
        "recent",
        "working",
      ]);
      expect(Array.isArray(result.snapshot.anticipated)).toBe(true);
      expect(Array.isArray(result.snapshot.proposedSkills)).toBe(true);
    });

    it("coding.trace.subscribe returns redacted summaries", async () => {
      const ctx = makeCtx();
      const result = (await dispatch("coding.trace.subscribe", {}, ctx)) as {
        events: { summary: string }[];
      };
      // Sanity: panel data must not leak AWS keys verbatim.
      const concatenated = result.events.map((e) => e.summary).join(" ");
      expect(concatenated).not.toMatch(/AKIA[0-9A-Z]{16}/);
    });
  });
});
