import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_MAX_PANEL_SIZE,
  PanelExecutor,
  type LLMClientFactory,
  type PanelModelResolver,
} from "../../../modules/coding/orchestration/PanelExecutor.js";
import type {
  FusionResult,
  PanelCandidate,
  PanelJudge,
} from "../../../modules/coding/orchestration/FusionAgent.js";
import type {
  OllamaChatChunk,
  OllamaClient,
} from "../../../modules/coding/llm/types.js";
import { makeOllamaClient } from "../../helpers/factories.js";

// v1.6.0 adoption-openrouter-fusion Phase 2 (OF004 + OF005 + OF006). PanelExecutor
// fans one prompt across N distinct registry models (sequential MVP), collects
// labeled candidates, and fuses survivors through the judge. F5: panelists get
// no per-panelist tool grant. Mock LLM clients only -- no live model.

/** A client whose streamChat throws on iteration (a dead panelist). */
function makeFailingClient(): OllamaClient {
  async function* gen(): AsyncGenerator<OllamaChatChunk> {
    throw new Error("model crashed");
  }
  return {
    checkHealth: vi.fn(async () => true),
    listModels: vi.fn(async () => []),
    streamChat: vi.fn(() => gen()),
  };
}

/** A fake judge that records its fuse() args and returns a fixed result. */
function makeFakeJudge(): {
  judge: PanelJudge;
  fuse: ReturnType<typeof vi.fn>;
} {
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

/** Factory that lazily mints one recording client per distinct model id. */
function makeFactory(
  overrides: Record<string, OllamaClient> = {},
): { factory: LLMClientFactory; clients: Map<string, OllamaClient> } {
  const clients = new Map<string, OllamaClient>();
  const factory: LLMClientFactory = (id) => {
    if (overrides[id]) {
      clients.set(id, overrides[id]);
      return overrides[id];
    }
    let client = clients.get(id);
    if (!client) {
      client = makeOllamaClient(`answer-${id}`);
      clients.set(id, client);
    }
    return client;
  };
  return { factory, clients };
}

describe("PanelExecutor.run -- distinct-model dispatch (OF004)", () => {
  it("fans the same prompt across >= 2 distinct models and collects labeled candidates", async () => {
    const { factory, clients } = makeFactory();
    const { judge } = makeFakeJudge();
    const exec = new PanelExecutor({ clientFactory: factory, judge });

    const result = await exec.run("solve X", ["m1", "m2"]);

    // Both dispatched with the SAME prompt.
    const req1 = vi.mocked(clients.get("m1")!.streamChat).mock.calls[0]![0];
    const req2 = vi.mocked(clients.get("m2")!.streamChat).mock.calls[0]![0];
    expect(req1.model).toBe("m1");
    expect(req2.model).toBe("m2");
    expect(req1.messages[0]!.content).toBe("solve X");
    expect(req2.messages[0]!.content).toBe("solve X");

    // Both candidates labeled and collected.
    expect(result.candidates).toEqual([
      { model: "m1", answer: "answer-m1", ok: true },
      { model: "m2", answer: "answer-m2", ok: true },
    ]);
    expect(result.dispatched).toEqual(["m1", "m2"]);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("invokes the judge over the collected candidates", async () => {
    const { factory } = makeFactory();
    const { judge, fuse } = makeFakeJudge();
    const exec = new PanelExecutor({ clientFactory: factory, judge });

    const result = await exec.run("solve X", ["m1", "m2"]);

    expect(fuse).toHaveBeenCalledTimes(1);
    expect(fuse).toHaveBeenCalledWith("solve X", [
      { model: "m1", answer: "answer-m1", ok: true },
      { model: "m2", answer: "answer-m2", ok: true },
    ]);
    expect(result.fusion.schemaValid).toBe(true);
    expect(result.fusion.fusedCandidateCount).toBe(2);
  });

  it("de-duplicates the panel to distinct model ids", async () => {
    const { factory, clients } = makeFactory();
    const { judge } = makeFakeJudge();
    const exec = new PanelExecutor({ clientFactory: factory, judge });

    const result = await exec.run("p", ["m1", "m1", "m2"]);

    expect(result.dispatched).toEqual(["m1", "m2"]);
    expect(result.candidates).toHaveLength(2);
    expect(vi.mocked(clients.get("m1")!.streamChat)).toHaveBeenCalledTimes(1);
  });

  it("dispatches sequentially in panel order (single-GPU MVP)", async () => {
    const { factory, clients } = makeFactory();
    const { judge } = makeFakeJudge();
    const exec = new PanelExecutor({ clientFactory: factory, judge });

    await exec.run("p", ["m1", "m2", "m3"]);

    const order1 = vi.mocked(clients.get("m1")!.streamChat).mock.invocationCallOrder[0]!;
    const order2 = vi.mocked(clients.get("m2")!.streamChat).mock.invocationCallOrder[0]!;
    const order3 = vi.mocked(clients.get("m3")!.streamChat).mock.invocationCallOrder[0]!;
    expect(order1).toBeLessThan(order2);
    expect(order2).toBeLessThan(order3);
  });

  it("forwards the panel sampling options to each panelist", async () => {
    const { factory, clients } = makeFactory();
    const { judge } = makeFakeJudge();
    const exec = new PanelExecutor({
      clientFactory: factory,
      judge,
      panelOptions: { temperature: 0.2, num_ctx: 4096 },
    });

    await exec.run("p", ["m1"]);

    const req = vi.mocked(clients.get("m1")!.streamChat).mock.calls[0]![0];
    expect(req.options).toEqual({ temperature: 0.2, num_ctx: 4096 });
  });
});

describe("PanelExecutor.run -- tool isolation (OF005 / F5)", () => {
  it("grants panelists no per-panelist tools", async () => {
    const { factory, clients } = makeFactory();
    const { judge } = makeFakeJudge();
    const exec = new PanelExecutor({ clientFactory: factory, judge });

    await exec.run("p", ["m1", "m2"]);

    for (const id of ["m1", "m2"]) {
      const req = vi.mocked(clients.get(id)!.streamChat).mock.calls[0]![0];
      expect(req.tools).toBeUndefined();
    }
  });
});

describe("PanelExecutor.run -- resilience and gating (OF006)", () => {
  it("survives a single panelist failing and still fuses the survivors", async () => {
    const { factory } = makeFactory({ m1: makeFailingClient() });
    const { judge, fuse } = makeFakeJudge();
    const exec = new PanelExecutor({ clientFactory: factory, judge });

    const result = await exec.run("p", ["m1", "m2"]);

    expect(result.candidates[0]).toEqual({
      model: "m1",
      answer: "",
      ok: false,
      error: expect.stringContaining("crashed"),
    });
    expect(result.candidates[1]).toEqual({ model: "m2", answer: "answer-m2", ok: true });
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    // The judge still ran over both candidates (it filters usable internally).
    expect(fuse).toHaveBeenCalledTimes(1);
    expect(result.fusion.fusedCandidateCount).toBe(1);
  });

  it("drops models the resolver rejects and records them as skipped", async () => {
    const { factory, clients } = makeFactory();
    const { judge } = makeFakeJudge();
    const resolver: PanelModelResolver = { isUsable: (id) => id !== "bad" };
    const exec = new PanelExecutor({ clientFactory: factory, judge, modelResolver: resolver });

    const result = await exec.run("p", ["good", "bad"]);

    expect(result.dispatched).toEqual(["good"]);
    expect(result.skipped).toEqual(["bad"]);
    expect(clients.has("bad")).toBe(false);
  });

  it("enforces the hard panel-size cap, recording the overflow as skipped", async () => {
    const { factory } = makeFactory();
    const { judge } = makeFakeJudge();
    const exec = new PanelExecutor({ clientFactory: factory, judge, maxPanelSize: 2 });

    const result = await exec.run("p", ["m1", "m2", "m3"]);

    expect(result.dispatched).toEqual(["m1", "m2"]);
    expect(result.skipped).toEqual(["m3"]);
  });

  it("exposes a default panel-size cap", () => {
    expect(DEFAULT_MAX_PANEL_SIZE).toBeGreaterThanOrEqual(1);
  });

  it("throws when the panel is empty after de-duplication", async () => {
    const { factory } = makeFactory();
    const { judge } = makeFakeJudge();
    const exec = new PanelExecutor({ clientFactory: factory, judge });
    await expect(exec.run("p", ["   ", ""])).rejects.toThrow(/empty/);
  });

  it("throws when the resolver rejects every model", async () => {
    const { factory } = makeFactory();
    const { judge } = makeFakeJudge();
    const resolver: PanelModelResolver = { isUsable: () => false };
    const exec = new PanelExecutor({ clientFactory: factory, judge, modelResolver: resolver });
    await expect(exec.run("p", ["m1", "m2"])).rejects.toThrow(/empty/);
  });
});
