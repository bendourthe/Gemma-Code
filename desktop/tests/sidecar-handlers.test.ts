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
          // v1.15.0 Phase 4 wired the Settings > Models registry surface.
          "models.list",
          "models.install",
          "models.remove",
          "models.diskUsage",
          "models.install.drainEvents",
          "models.install.cancel",
          // v1.16.0 Phase 1 wired the local serving-gateway control surface.
          "serving.status",
          "serving.setEnabled",
          // v1.18.0 Phase 5 wired ACP on the shared control surface.
          "acp.status",
          "acp.setEnabled",
          // v1.16.0 Phase 2 wired per-model inference analytics.
          "metrics.inference",
          // v1.16.0 Phase 3 wired the document-OCR surface.
          "ocr.health",
          "ocr.parseDocument",
          "ocr.job.drainEvents",
          "ocr.job.cancel",
          // v2.0.0 Phase 1 wired local STT/TTS.
          "audio.health",
          "audio.transcribe",
          "audio.speak",
          "coding.session.start",
          "coding.session.sendMessage",
          "coding.session.cancel",
          "coding.session.list",
          "coding.session.resume",
          "coding.memory.snapshot",
          "coding.trace.subscribe",
          "coding.sessions.list",
          // v1.7.0 wired the Local Chatbot Explorer surface.
          "chat.session.start",
          "chat.session.sendMessage",
          "memory.episodic.record",
          "memory.episodic.search",
          // v1.5.0 Phase 5 wired the credential-vault surface.
          "credentials.status",
          "credentials.list",
          "credentials.set",
          "credentials.delete",
          // v1.0.0 Phase 6 wired the diffusion surface.
          "diffusion.health",
          "diffusion.version",
          "diffusion.txt2img",
          "diffusion.img2img",
          "diffusion.inpaint",
          "diffusion.outpaint",
          "diffusion.segment",
          "diffusion.job.drainEvents",
          "diffusion.workflow.extract",
          // v1.0.0 Phase 7 wired the video surface.
          "diffusion.video.text2video",
          "diffusion.video.image2video",
          "diffusion.video.audio2video",
          "diffusion.video.workflow.extract",
          "generation.queue.list",
          "generation.queue.enqueue",
          "generation.queue.cancel",
          "generation.queue.reorder",
          "generation.queue.pendingCount",
          "generation.scheduler.snapshot",
          // v2.1.0 Phase 5 wired the Unsloth Core fine-tuning pillar.
          "tuning.status",
          "tuning.provision",
          "tuning.preflight",
          "tuning.dataset.build",
          "tuning.job.start",
          "tuning.job.list",
          "tuning.job.cancel",
          "tuning.models.list",
          // v2.1.0 Phase 6 wired the signed local audit log.
          "audit.list",
          "audit.status",
          "media.sampleVideoFrames",
          "coding.parseDocument.status",
          "coding.parseDocument.setEnabled",
          // v2.2.0 Phase 2 (2.4) wired real GPU telemetry (poll-based; the
          // telemetry.subscribe push channel stays unimplemented).
          "gpu.sample",
          // v2.2.0 Phase 3 wired real skills listing, the auto-sync setting,
          // and hub command discovery for the Agentic composer.
          "skills.list",
          "skills.autoSync.get",
          "skills.autoSync.set",
          "commands.list",
          // v2.2.0 Phase 5 wired chat persistence and auto-titling.
          "chat.explorer.tree",
          "chat.explorer.createFolder",
          "chat.explorer.renameFolder",
          "chat.explorer.moveFolder",
          "chat.explorer.deleteFolder",
          "chat.explorer.createChat",
          "chat.explorer.renameChat",
          "chat.explorer.moveChat",
          "chat.explorer.deleteChat",
          "chat.explorer.setPersona",
          "chat.explorer.appendMessage",
          "chat.explorer.listMessages",
          "chat.explorer.search",
          "chat.generateTitle",
          // v2.2.0 Phase 8 (DF-16) wired local data export / import.
          "data.categories",
          "data.export",
          "data.import",
          // v1.10.0 Phase 6 wired the Nexus-Hub catalog sync + update detection.
          "skills.sync",
          "skills.status",
          "skills.upstreamLatest",
          // v1.12.0 EM.P2.A wired the skill-optimizer preview/apply surface.
          "skills.optimize.preview",
          "skills.optimize.apply",
          // v1.18.0 Phase 3 wired per-tool MCP registry deny.
          "mcp.registry.list",
          "mcp.registry.setToolDenied",
          "mcp.list",
          "mcp.invoke",
          // v1.18.0 Phase 4 wired the ask inbox + local scheduler.
          "ask.inbox.list",
          "ask.inbox.approve",
          "ask.inbox.deny",
          "ask.inbox.pendingCount",
          "ask.scheduler.list",
          "ask.scheduler.setEnabled",
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

  it("routes episodic record and search through the injected chat-memory seam", async () => {
    const recorded: Array<{ id: string; content: string }> = [];
    const ctx = makeCtx();
    ctx.chatMemory = {
      record: async (input) => {
        recorded.push({ id: input.id, content: input.content });
        return { ok: true };
      },
      search: async (input) => ({
        hits: [
          {
            id: "m1",
            content: `matched ${input.query}`,
            source: "chat-turn",
            capturedAt: "2026-08-23T00:00:00.000Z",
            scopeId: input.scopeId ?? null,
          },
        ],
      }),
    };
    expect(
      await dispatch(
        "memory.episodic.record",
        { id: "turn-1", content: "remember me", source: "chat-turn", scopeId: "work" },
        ctx,
      ),
    ).toEqual({ ok: true });
    expect(recorded).toEqual([{ id: "turn-1", content: "remember me" }]);
    expect(
      await dispatch(
        "memory.episodic.search",
        { query: "remember", limit: 3, scopeId: "work" },
        ctx,
      ),
    ).toEqual({
      hits: [
        {
          id: "m1",
          content: "matched remember",
          source: "chat-turn",
          capturedAt: "2026-08-23T00:00:00.000Z",
          scopeId: "work",
        },
      ],
    });
  });

  it("models.* route to the injected runtime (v1.15.0 Phase 4)", async () => {
    const removed: string[] = [];
    const ctx = makeCtx();
    ctx.models = {
      service: {
        list: async () => [
          { id: "a", displayName: "A", installed: true, source: "registry" },
        ],
        remove: async (id: string) => {
          removed.push(id);
        },
        diskUsage: async () => ({ usedBytes: 5, freeBytes: null }),
      },
      installer: {
        start: (id: string) => `job:${id}`,
        drain: () => ({ events: [{ kind: "complete", id: "a" }], done: true }),
        cancel: () => {},
      },
      // v2.2.0 Phase 1 (1.1): models.list surfaces catalog health.
      catalogStatus: "ok",
    } as unknown as HandlerContext["models"];

    expect(await dispatch("models.list", {}, ctx)).toEqual(
      expect.objectContaining({
        models: [{ id: "a", displayName: "A", installed: true, source: "registry" }],
        catalogStatus: "ok",
      }),
    );
    expect(await dispatch("models.diskUsage", {}, ctx)).toEqual({
      usedBytes: 5,
      freeBytes: null,
    });
    expect(await dispatch("models.install", { id: "a" }, ctx)).toEqual({ jobId: "job:a" });
    expect(await dispatch("models.install.drainEvents", { jobId: "job:a" }, ctx)).toEqual({
      events: [{ kind: "complete", id: "a" }],
      done: true,
    });
    expect(await dispatch("models.remove", { id: "a" }, ctx)).toEqual({ ok: true });
    expect(removed).toEqual(["a"]);
    expect(await dispatch("models.install.cancel", { jobId: "job:a" }, ctx)).toEqual({
      ok: true,
    });
  });

  it("mcp.registry.list returns a servers array (v1.18.0 Phase 3)", async () => {
    const listed = (await dispatch("mcp.registry.list", {}, makeCtx())) as {
      servers: unknown[];
    };
    expect(Array.isArray(listed.servers)).toBe(true);
  });

  it("mcp.list returns exposed registry tools and mcp.invoke is fail-closed", async () => {
    const listed = (await dispatch("mcp.list", {}, makeCtx())) as { tools: unknown[] };
    expect(Array.isArray(listed.tools)).toBe(true);
    const invoked = (await dispatch(
      "mcp.invoke",
      { name: "demo/tool", args: {} },
      makeCtx(),
    )) as { ok: boolean; error: string | null };
    expect(invoked.ok).toBe(false);
    expect(invoked.error).toMatch(/no stdio harness/i);
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

  describe("video handlers", () => {
    function videoCtx(): HandlerContext {
      const runtime = makeCtx().diffusion;
      // The default in-memory runtime needs a stubbed response for the
      // two video methods so `buildVideoJobRequest` resolves cleanly.
      (runtime as unknown as {
        setResponse: (method: string, value: unknown) => void;
      }).setResponse("diffusion.video.text2video", {
        ok: true,
        offloadStrategy: "model_cpu_offload",
        extra: { frameCount: 96 },
      });
      (runtime as unknown as {
        setResponse: (method: string, value: unknown) => void;
      }).setResponse("diffusion.video.image2video", {
        ok: true,
        offloadStrategy: "sequential_cpu_offload",
      });
      (runtime as unknown as {
        setResponse: (method: string, value: unknown) => void;
      }).setResponse("diffusion.video.audio2video", {
        ok: true,
        offloadStrategy: "sequential_cpu_offload",
      });
      return createHandlerContext(
        { pid: 1, platform: process.platform },
        new CodingSessionManager(),
        runtime,
        {
          ffmpegPath: "ffmpeg",
          ffprobePath: "ffprobe",
          // Stub spawn that always emits an empty ffprobe JSON.
          spawnFn: ((command: string) => {
            const emitter = new (require("node:events").EventEmitter)();
            emitter.stdout = new (require("node:events").EventEmitter)();
            emitter.stderr = new (require("node:events").EventEmitter)();
            queueMicrotask(() => {
              if (command.endsWith("ffprobe") || command === "ffprobe") {
                emitter.stdout.emit(
                  "data",
                  Buffer.from(JSON.stringify({ format: { tags: {} } })),
                );
              }
              emitter.emit("close", 0);
            });
            return emitter as unknown as ReturnType<typeof import("node:child_process").spawn>;
          }) as typeof import("node:child_process").spawn,
        },
      );
    }

    it("diffusion.video.text2video returns a job envelope", async () => {
      const ctx = videoCtx();
      const result = (await dispatch(
        "diffusion.video.text2video",
        {
          modelId: "ltx-video",
          prompt: "fox",
          width: 854,
          height: 480,
          durationSeconds: 4,
          fps: 24,
          steps: 30,
          cfgScale: 3.5,
          seed: 7,
        },
        ctx,
      )) as { jobId: string; mode: string; offloadStrategy?: string };
      expect(result.jobId).toMatch(/^video-/);
      expect(result.mode).toBe("text2video");
      // Offload strategy arrives on drainEvents after pumpOnce, not on accept.
    });

    it("diffusion.video.image2video requires sourceImage", async () => {
      await expect(
        dispatch(
          "diffusion.video.image2video",
          {
            modelId: "svd",
            prompt: "fox",
            width: 854,
            height: 480,
            durationSeconds: 4,
            fps: 24,
            steps: 30,
            cfgScale: 3.5,
            seed: 7,
          },
          videoCtx(),
        ),
      ).rejects.toThrow();
    });

    it("diffusion.video.image2video accepts a sourceImage", async () => {
      const ctx = videoCtx();
      const result = (await dispatch(
        "diffusion.video.image2video",
        {
          modelId: "svd",
          prompt: "fox",
          width: 854,
          height: 480,
          durationSeconds: 4,
          fps: 24,
          steps: 30,
          cfgScale: 3.5,
          seed: 7,
          sourceImage: "data:image/png;base64,AAAA",
        },
        ctx,
      )) as { mode: string };
      expect(result.mode).toBe("image2video");
    });

    it("diffusion.video.audio2video requires confirmation and a photo plus audio", async () => {
      await expect(
        dispatch(
          "diffusion.video.audio2video",
          {
            modelId: "longcat-video-avatar-1.5",
            prompt: "talk",
            width: 854,
            height: 480,
            durationSeconds: 4,
            fps: 24,
            steps: 30,
            cfgScale: 3.5,
            seed: 7,
            sourceImage: "data:image/png;base64,AAAA",
            sourceAudio: "data:audio/wav;base64,BBBB",
          },
          videoCtx(),
        ),
      ).rejects.toThrow();
    });

    it("diffusion.video.audio2video accepts a confirmed diffusion-pro request", async () => {
      const ctx = videoCtx();
      const result = (await dispatch(
        "diffusion.video.audio2video",
        {
          modelId: "longcat-video-avatar-1.5",
          prompt: "talk",
          width: 854,
          height: 480,
          durationSeconds: 4,
          fps: 24,
          steps: 30,
          cfgScale: 3.5,
          seed: 7,
          sourceImage: "data:image/png;base64,AAAA",
          sourceAudio: "data:audio/wav;base64,BBBB",
          confirmLocalAvatar: true,
          diffusionTier: "diffusion-pro",
          vramGB: 24,
          weightRepo: "meituan-longcat/LongCat-Video-Avatar-1.5",
        },
        ctx,
      )) as { mode: string; provenance?: { neverLeftDevice?: boolean } };
      expect(result.mode).toBe("audio2video");
      expect(result.provenance?.neverLeftDevice).toBe(true);
    });

    it("diffusion.video.workflow.extract returns null when ffprobe finds no comment", async () => {
      const ctx = videoCtx();
      const result = (await dispatch(
        "diffusion.video.workflow.extract",
        { mp4Path: "/tmp/x.mp4" },
        ctx,
      )) as { workflow: unknown | null };
      expect(result.workflow).toBeNull();
    });

    it("diffusion.video.workflow.extract rejects an empty path", async () => {
      await expect(
        dispatch(
          "diffusion.video.workflow.extract",
          { mp4Path: "" },
          videoCtx(),
        ),
      ).rejects.toThrow();
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
