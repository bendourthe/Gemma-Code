import { describe, it, expect } from "vitest";
import { EscalationPolicy } from "../../../../modules/coding/orchestration/routing/EscalationPolicy.js";
import type { RoutingModels } from "../../../../modules/coding/orchestration/routing/EscalationPolicy.js";
import type { RoutingTurnEvent } from "../../../../modules/coding/orchestration/routing/RoutingSignals.js";

const MODELS: RoutingModels = {
  workerId: "lightning",
  strongId: "muse",
  installed: new Set(["lightning", "muse"]),
};

describe("routing soak (swap budget)", () => {
  it("keeps swap count within budget across a long session", () => {
    const policy = new EscalationPolicy({ swapBudget: 4, cooldownTurns: 2, minTurnsOnModel: 2 });
    const events: RoutingTurnEvent[] = [];
    let swaps = 0;
    let previous = "lightning";
    for (let turn = 1; turn <= 80; turn += 1) {
      const burst = turn % 11 === 0;
      if (burst) {
        events.push({
          sessionId: "soak",
          turn,
          role: "worker",
          toolName: "edit",
          toolError: true,
        });
      } else {
        events.push({
          sessionId: "soak",
          turn,
          role: "worker",
          toolName: "edit",
          fileMutated: true,
        });
      }
      const d = policy.acknowledge(
        policy.decide({
          sessionId: "soak",
          turn,
          role: "worker",
          events,
          models: MODELS,
        }),
      );
      if (d.modelId !== previous) swaps += 1;
      previous = d.modelId;
    }
    expect(swaps).toBeLessThanOrEqual(4);
    expect(policy.state("soak")?.swapCount ?? 0).toBeLessThanOrEqual(4);
  });
});
