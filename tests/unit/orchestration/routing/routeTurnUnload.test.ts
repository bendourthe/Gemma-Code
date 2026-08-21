import { describe, it, expect } from "vitest";
import { EscalationPolicy } from "../../../../modules/coding/orchestration/routing/EscalationPolicy.js";
import { routeTurn } from "../../../../modules/coding/orchestration/routing/routeTurn.js";
import type { RoutingTurnEvent } from "../../../../modules/coding/orchestration/routing/RoutingSignals.js";

const MODELS = {
  workerId: "nemotron-lightning:30b-a3b",
  strongId: "muse-glimmer:30b",
  installed: new Set(["nemotron-lightning:30b-a3b", "muse-glimmer:30b"]),
};

function errors(n: number): RoutingTurnEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    sessionId: "s",
    turn: i + 1,
    role: "worker" as const,
    toolName: "edit",
    toolError: true,
  }));
}

describe("routeTurn unload", () => {
  it("evicts the worker after an honored swap with keepWorkerResident false", () => {
    const policy = new EscalationPolicy();
    policy.acknowledge(
      policy.decide({
        sessionId: "s",
        turn: 1,
        role: "worker",
        events: [],
        models: MODELS,
      }),
    );
    const evicted: string[] = [];
    const d = routeTurn(
      policy,
      {
        sessionId: "s",
        turn: 4,
        role: "worker",
        events: errors(3),
        models: MODELS,
        vramFor: () => 8,
        onEvictWorker: (id) => {
          evicted.push(id);
        },
      },
      {
        evaluateRoutingSwap: () => ({
          outcome: "honored",
          keepWorkerResident: false,
          reason: "evict-worker-for-strong",
        }),
      },
    );
    expect(d.swapOutcome).toBe("honored");
    expect(d.modelId).toBe(MODELS.strongId);
    expect(evicted).toEqual([MODELS.workerId]);
  });
});
