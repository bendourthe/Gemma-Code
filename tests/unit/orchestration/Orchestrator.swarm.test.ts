import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../../../modules/coding/orchestration/Orchestrator.js";
import type { CriticReviewer } from "../../../modules/coding/orchestration/CriticAgent.js";
import {
  makeOrchestratorConfig,
  makeMultiResponseOllamaClient,
  makeSubAgentManager,
} from "../../helpers/factories.js";

// v1.5.0 Phase 4 (T011) -- the opt-in swarm flag gates the critic. With
// swarmEnabled off (the default), the orchestrator runs the legacy critic-less
// Plan-and-Execute loop; with it on, every worker's output is reviewed before
// the node is accepted.

const SINGLE_NODE_PLAN = JSON.stringify([
  {
    id: "task_1",
    title: "Implement",
    description: "Write the feature",
    type: "code",
    dependencies: [],
  },
]);

describe("Orchestrator swarm flag (T011)", () => {
  it("ignores an injected critic when swarmEnabled is off (default)", async () => {
    const critic: CriticReviewer = {
      review: vi.fn(async () => ({ approved: false, feedback: "should never run" })),
    };
    const config = makeOrchestratorConfig({
      client: makeMultiResponseOllamaClient([SINGLE_NODE_PLAN]),
      subAgentManager: makeSubAgentManager({ success: true }),
      critic,
    });
    const orch = new Orchestrator(config);

    const result = await orch.execute("Implement the feature", "ctx");

    expect(critic.review).not.toHaveBeenCalled();
    expect(result.dag.getProgress().completed).toBe(1);
  });

  it("gates worker output through the critic when swarmEnabled is on", async () => {
    const critic: CriticReviewer = {
      review: vi.fn(async () => ({ approved: false, feedback: "incomplete" })),
    };
    const config = makeOrchestratorConfig({
      client: makeMultiResponseOllamaClient([SINGLE_NODE_PLAN]),
      subAgentManager: makeSubAgentManager({ success: true }),
      swarmEnabled: true,
      critic,
    });
    const orch = new Orchestrator(config);

    const result = await orch.execute("Implement the feature", "ctx");

    // The worker succeeds but the critic rejects every attempt, so the node is
    // never accepted -- proving the critic gate is live under the swarm flag.
    expect(critic.review).toHaveBeenCalled();
    expect(result.dag.getProgress().completed).toBe(0);
  });

  it("accepts worker output when the critic approves under the swarm flag", async () => {
    const critic: CriticReviewer = {
      review: vi.fn(async () => ({ approved: true, feedback: "looks correct" })),
    };
    const config = makeOrchestratorConfig({
      client: makeMultiResponseOllamaClient([SINGLE_NODE_PLAN]),
      subAgentManager: makeSubAgentManager({ success: true }),
      swarmEnabled: true,
      critic,
    });
    const orch = new Orchestrator(config);

    const result = await orch.execute("Implement the feature", "ctx");

    expect(critic.review).toHaveBeenCalledTimes(1);
    expect(result.dag.getProgress().completed).toBe(1);
  });
});
