import { describe, it, expect, vi } from "vitest";
import {
  decidePanelRoute,
  MIN_PANEL_SIZE,
  PANEL_ROUTING_SHIPPED_DEFAULT,
  PanelRouter,
  type PanelRouteInput,
} from "../../../modules/coding/llm/PanelRouter.js";
import {
  PanelExecutor,
  type LLMClientFactory,
} from "../../../modules/coding/orchestration/PanelExecutor.js";
import type {
  FusionResult,
  PanelCandidate,
  PanelJudge,
} from "../../../modules/coding/orchestration/FusionAgent.js";
import { makeOllamaClient } from "../../helpers/factories.js";

// v1.6.0 adoption-openrouter-fusion Phase 4 (OF011 + OF012). The opt-in
// budget-panel routing heuristic: escalate a reliability-flagged task to a
// small-model panel only when the opt-in switch is on. Default off until the
// local A/B (OF010) measures a net win.

const BASE: PanelRouteInput = {
  task: "Refactor the auth module safely.",
  highReliability: true,
  singleModel: "gemma4:e4b",
  panelSpec: ["gemma4:e4b", "qwen2.5-coder:3b", "llama3.2:3b"],
};

function makeFakeJudge(): PanelJudge {
  return {
    fuse: vi.fn(
      async (_task: string, candidates: readonly PanelCandidate[]): Promise<FusionResult> => ({
        fusedOutput: "## Fused answer\nok",
        schemaValid: true,
        judgeModel: "judge",
        fusedCandidateCount: candidates.filter((c) => c.ok).length,
      }),
    ),
  };
}

function makeExecutor(): { executor: PanelExecutor; factory: ReturnType<typeof vi.fn> } {
  const factory = vi.fn<Parameters<LLMClientFactory>, ReturnType<LLMClientFactory>>(
    (id) => makeOllamaClient(`answer-${id}`),
  );
  const executor = new PanelExecutor({ clientFactory: factory, judge: makeFakeJudge() });
  return { executor, factory };
}

describe("decidePanelRoute -- pure heuristic (OF011)", () => {
  it("routes to the panel when enabled, flagged, and the panel is large enough", () => {
    const decision = decidePanelRoute(BASE, { enabled: true });
    expect(decision.kind).toBe("panel");
    if (decision.kind === "panel") {
      expect(decision.panel).toEqual([
        "gemma4:e4b",
        "qwen2.5-coder:3b",
        "llama3.2:3b",
      ]);
    }
  });

  it("routes to the single model when panel routing is disabled (default opt-in)", () => {
    const decision = decidePanelRoute(BASE, { enabled: false });
    expect(decision.kind).toBe("single");
    if (decision.kind === "single") {
      expect(decision.model).toBe("gemma4:e4b");
      expect(decision.reason).toContain("disabled");
    }
  });

  it("routes to the single model when the task is not flagged for higher reliability", () => {
    const decision = decidePanelRoute(
      { ...BASE, highReliability: false },
      { enabled: true },
    );
    expect(decision.kind).toBe("single");
    if (decision.kind === "single") expect(decision.reason).toContain("not flagged");
  });

  it("routes to the single model when fewer than two distinct panelists exist", () => {
    const decision = decidePanelRoute(
      { ...BASE, panelSpec: ["gemma4:e4b", "gemma4:e4b", "  "] },
      { enabled: true },
    );
    expect(decision.kind).toBe("single");
    if (decision.kind === "single") expect(decision.reason).toContain("too small");
  });

  it("honours a raised minimum panel size", () => {
    const decision = decidePanelRoute(BASE, { enabled: true, minPanelSize: 4 });
    expect(decision.kind).toBe("single");
  });

  it("floors the minimum panel size at MIN_PANEL_SIZE", () => {
    expect(MIN_PANEL_SIZE).toBe(2);
    // minPanelSize 1 is floored to 2, so a single distinct model is still "single".
    const decision = decidePanelRoute(
      { ...BASE, panelSpec: ["only:1"] },
      { enabled: true, minPanelSize: 1 },
    );
    expect(decision.kind).toBe("single");
  });

  it("ships opt-in (default off) until a measured A/B win", () => {
    expect(PANEL_ROUTING_SHIPPED_DEFAULT).toBe(false);
  });
});

describe("PanelRouter.route -- delegation (OF011)", () => {
  it("runs the panel through the executor on a panel decision", async () => {
    const { executor, factory } = makeExecutor();
    const router = new PanelRouter({ executor, config: { enabled: true } });

    const result = await router.route(BASE);

    expect(result.decision.kind).toBe("panel");
    expect(result.run).not.toBeNull();
    expect(result.run?.fusion.schemaValid).toBe(true);
    // All three distinct panelists were dispatched.
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it("returns a single decision with no run when disabled, never touching the executor", async () => {
    const { executor, factory } = makeExecutor();
    const router = new PanelRouter({ executor, config: { enabled: false } });

    const result = await router.route(BASE);

    expect(result.decision.kind).toBe("single");
    expect(result.run).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it("exposes decide() without running anything", () => {
    const { executor, factory } = makeExecutor();
    const router = new PanelRouter({ executor, config: { enabled: true } });

    const decision = router.decide(BASE);

    expect(decision.kind).toBe("panel");
    expect(factory).not.toHaveBeenCalled();
  });
});
