import { describe, expect, it } from "vitest";
import {
  queuedStageEvent,
  type QueuedStageSources,
} from "../sidecar/src/diffusion/queuedStage";

// v2.4.8 follow-up (2026-09-07): a studio job parked behind another module
// used to read "Loading model..." for twenty minutes at 0% GPU. drainEvents
// now names the wait instead of leaving the silence to be misread.
function sources(opts: {
  active?: { id: string; moduleId: string } | null;
  queued?: string[];
  states?: Record<string, string>;
}): QueuedStageSources {
  return {
    scheduler: {
      snapshot: () => ({
        active: opts.active ?? null,
        queued: (opts.queued ?? []).map((id) => ({ id })),
      }),
    },
    queue: {
      get: (id) => {
        const state = opts.states?.[id];
        return state ? { state } : undefined;
      },
    },
  };
}

describe("queuedStageEvent", () => {
  it("is silent without a studio runtime", () => {
    expect(queuedStageEvent(undefined, "job-1")).toBeNull();
  });

  it("names the module holding the GPU while the job waits in the scheduler", () => {
    const studio = sources({
      active: { id: "chat-turn-9", moduleId: "chat" },
      queued: ["job-1"],
      states: { "job-1": "running" },
    });
    expect(queuedStageEvent(studio, "job-1")).toEqual({
      kind: "progress",
      jobId: "job-1",
      stage: "queued",
      blockedBy: "chat",
    });
  });

  it("reports queued without a holder while the job waits for the studio pump", () => {
    const studio = sources({ states: { "job-1": "queued" } });
    expect(queuedStageEvent(studio, "job-1")).toEqual({
      kind: "progress",
      jobId: "job-1",
      stage: "queued",
    });
  });

  it("stays silent once the runtime owns the job", () => {
    const studio = sources({
      active: { id: "job-1", moduleId: "image" },
      states: { "job-1": "running" },
    });
    expect(queuedStageEvent(studio, "job-1")).toBeNull();
  });

  it("stays silent for a job that is neither queued nor waiting", () => {
    const studio = sources({ states: { "job-1": "done" } });
    expect(queuedStageEvent(studio, "job-1")).toBeNull();
    expect(queuedStageEvent(sources({}), "unknown")).toBeNull();
  });
});
