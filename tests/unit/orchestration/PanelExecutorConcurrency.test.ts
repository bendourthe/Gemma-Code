import { describe, it, expect, vi } from "vitest";
import {
  PanelExecutor,
  type LLMClientFactory,
  type PanelScheduler,
} from "../../../modules/coding/orchestration/PanelExecutor.js";
import type {
  FusionResult,
  PanelCandidate,
  PanelJudge,
} from "../../../modules/coding/orchestration/FusionAgent.js";
import type {
  PanelJob,
  PanelKeepAliveCoordinator,
  PanelMemberResult,
  PanelRunOutcome,
} from "../../../core/scheduler/GpuScheduler.js";
import { makeOllamaClient } from "../../helpers/factories.js";

// v1.6.0 adoption-openrouter-fusion Phase 4 (OF011, closing OF007.P3.A). When a
// GPU-scheduler concurrency backend is supplied, PanelExecutor.run routes the
// fan-out through enqueuePanel and maps the scheduler's per-member results back
// into labeled candidates. Fake scheduler -- the real-scheduler concurrency
// behaviour is covered in tests/integration/orchestration/PanelRouting.test.ts.

function makeFakeJudge(): { judge: PanelJudge; fuse: ReturnType<typeof vi.fn> } {
  const fuse = vi.fn(
    async (_task: string, candidates: readonly PanelCandidate[]): Promise<FusionResult> => ({
      fusedOutput: "## Fused answer\nok",
      schemaValid: true,
      judgeModel: "judge",
      fusedCandidateCount: candidates.filter((c) => c.ok).length,
    }),
  );
  return { judge: { fuse }, fuse };
}

function makeFactory(): { factory: LLMClientFactory } {
  const factory: LLMClientFactory = (id) => makeOllamaClient(`answer-${id}`);
  return { factory };
}

/**
 * A fake scheduler that runs each admitted member (so the panelists are really
 * dispatched), applies an optional cap, and can force a member result to be
 * non-`ok` to exercise the executor's defensive mapping path.
 */
function makeFakeScheduler(
  config: { cap?: number; forceFailModelIds?: readonly string[] } = {},
): { scheduler: PanelScheduler; jobs: PanelJob[] } {
  const jobs: PanelJob[] = [];
  const scheduler: PanelScheduler = {
    async enqueuePanel(job: PanelJob) {
      jobs.push(job);
      const cap = Math.max(1, config.cap ?? job.maxPanelSize ?? job.members.length);
      const admitted = job.members.slice(0, cap);
      const droppedByCap = job.members.slice(cap).map((member) => member.modelId);
      const hold =
        job.keepAlive?.holdForPanel(admitted.map((member) => member.modelId)) ?? null;
      const results: PanelMemberResult[] = [];
      try {
        for (const member of admitted) {
          if ((config.forceFailModelIds ?? []).includes(member.modelId)) {
            results.push({ modelId: member.modelId, ok: false, error: "forced failure" });
            continue;
          }
          const value = await member.run(new AbortController().signal);
          results.push({ modelId: member.modelId, ok: true, value });
        }
      } finally {
        hold?.release();
      }
      const outcome: PanelRunOutcome = {
        mode: "concurrent",
        admitted: admitted.map((member) => member.modelId),
        droppedByCap,
        reservedVramGB: admitted.reduce((sum, member) => sum + member.estimatedVramGB, 0),
        freeVramGB: 99,
        results,
      };
      return { completion: Promise.resolve(outcome) };
    },
  };
  return { scheduler, jobs };
}

describe("PanelExecutor.run -- concurrency backend (OF011 / OF007.P3.A)", () => {
  it("dispatches the panel through enqueuePanel and fuses the mapped candidates", async () => {
    const { factory } = makeFactory();
    const { judge, fuse } = makeFakeJudge();
    const { scheduler, jobs } = makeFakeScheduler();
    const exec = new PanelExecutor({
      clientFactory: factory,
      judge,
      concurrency: { scheduler, vramFor: () => 4 },
    });

    const result = await exec.run("solve X", ["m1", "m2"]);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.jobType).toBe("fusion-panel");
    expect(result.candidates).toEqual([
      { model: "m1", answer: "answer-m1", ok: true },
      { model: "m2", answer: "answer-m2", ok: true },
    ]);
    expect(result.dispatched).toEqual(["m1", "m2"]);
    expect(result.succeeded).toBe(2);
    expect(fuse).toHaveBeenCalledWith("solve X", result.candidates);
  });

  it("carries per-model VRAM estimates and defaults the module/priority", async () => {
    const { factory } = makeFactory();
    const { judge } = makeFakeJudge();
    const { scheduler, jobs } = makeFakeScheduler();
    const vram: Record<string, number> = { m1: 3, m2: 5 };
    const exec = new PanelExecutor({
      clientFactory: factory,
      judge,
      concurrency: { scheduler, vramFor: (id) => vram[id] ?? 0 },
    });

    await exec.run("p", ["m1", "m2"]);

    const job = jobs[0]!;
    expect(job.moduleId).toBe("coding");
    expect(job.priority).toBe("foreground");
    expect(job.members.map((member) => member.estimatedVramGB)).toEqual([3, 5]);
  });

  it("forwards the module, priority, and co-residency cap overrides", async () => {
    const { factory } = makeFactory();
    const { judge } = makeFakeJudge();
    const { scheduler, jobs } = makeFakeScheduler({ cap: 2 });
    const exec = new PanelExecutor({
      clientFactory: factory,
      judge,
      concurrency: {
        scheduler,
        vramFor: () => 2,
        moduleId: "chat",
        priority: "background",
        maxPanelSize: 2,
      },
    });

    const result = await exec.run("p", ["m1", "m2", "m3"]);

    const job = jobs[0]!;
    expect(job.moduleId).toBe("chat");
    expect(job.priority).toBe("background");
    expect(job.maxPanelSize).toBe(2);
    // The scheduler's cap dropped m3, which surfaces as skipped, never fused.
    expect(result.dispatched).toEqual(["m1", "m2"]);
    expect(result.skipped).toContain("m3");
    expect(result.candidates).toHaveLength(2);
  });

  it("holds keep-alive for the admitted panel when a coordinator is supplied", async () => {
    const { factory } = makeFactory();
    const { judge } = makeFakeJudge();
    const { scheduler } = makeFakeScheduler();
    const release = vi.fn();
    const holdForPanel = vi.fn(
      (models: readonly string[]): { release(): void } => ({ release }),
    );
    const keepAlive: PanelKeepAliveCoordinator = { holdForPanel };
    const exec = new PanelExecutor({
      clientFactory: factory,
      judge,
      concurrency: { scheduler, vramFor: () => 4, keepAlive },
    });

    await exec.run("p", ["m1", "m2"]);

    expect(holdForPanel).toHaveBeenCalledWith(["m1", "m2"]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("maps a non-ok scheduler member result to a failed candidate (defensive path)", async () => {
    const { factory } = makeFactory();
    const { judge } = makeFakeJudge();
    const { scheduler } = makeFakeScheduler({ forceFailModelIds: ["m2"] });
    const exec = new PanelExecutor({
      clientFactory: factory,
      judge,
      concurrency: { scheduler, vramFor: () => 4 },
    });

    const result = await exec.run("p", ["m1", "m2"]);

    expect(result.candidates[0]).toEqual({ model: "m1", answer: "answer-m1", ok: true });
    expect(result.candidates[1]).toEqual({
      model: "m2",
      answer: "",
      ok: false,
      error: "forced failure",
    });
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });
});
