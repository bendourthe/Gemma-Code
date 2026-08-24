import { describe, it, expect, vi } from "vitest";
import { DAGExecutor } from "../../../modules/coding/orchestration/DAGExecutor.js";
import { TaskDAG } from "../../../modules/coding/orchestration/TaskDAG.js";
import type { TaskNode } from "../../../modules/coding/orchestration/TaskDAG.js";
import type { SubAgentManager } from "../../../modules/coding/agents/SubAgentManager.js";
import type { SubAgentConfig, SubAgentResult } from "../../../modules/coding/agents/types.js";
import { getTierConfig } from "../../../modules/coding/config/HardwareTier.js";
import { EscalationPolicy } from "../../../modules/coding/orchestration/routing/EscalationPolicy.js";
import type { RoutingTurnEvent } from "../../../modules/coding/orchestration/routing/RoutingSignals.js";
import { mockOf } from "../../helpers/factories.js";

function makeNode(over: Partial<TaskNode> & { id: string }): TaskNode {
  return {
    title: over.id,
    description: `Description for ${over.id}`,
    type: "code",
    dependencies: [],
    status: "pending",
    retryCount: 0,
    maxRetries: 0,
    ...over,
  };
}

describe("DAGExecutor adaptive routing", () => {
  it("pins workers to the worker model then escalates after error streaks", async () => {
    const modelsSeen: string[] = [];
    const manager = mockOf<SubAgentManager>({
      run: vi.fn(async (config: SubAgentConfig): Promise<SubAgentResult> => {
        modelsSeen.push(config.modelName ?? "default");
        const fail = modelsSeen.length <= 3;
        return {
          type: "planning",
          success: !fail,
          output: fail ? "" : "ok",
          toolCallCount: 1,
          iterationsUsed: 1,
          error: fail ? "tool failed" : undefined,
        };
      }),
    });

    const events: RoutingTurnEvent[] = [];
    const policy = new EscalationPolicy({ consecutiveToolErrors: 3, cooldownTurns: 0 });
    const dag = new TaskDAG([
      makeNode({ id: "n1" }),
      makeNode({ id: "n2" }),
      makeNode({ id: "n3" }),
      makeNode({ id: "n4" }),
    ]);

    const executor = new DAGExecutor(
      manager,
      getTierConfig(1),
      () => undefined,
      undefined,
      "sess",
      {
        routing: {
          policy,
          models: {
            workerId: "lightning",
            strongId: "muse",
            installed: new Set(["lightning", "muse"]),
          },
          events,
          vramFor: () => 8,
        },
      },
    );

    await executor.execute(dag);
    expect(modelsSeen[0]).toBe("lightning");
    expect(modelsSeen.some((m) => m === "muse")).toBe(true);
  });
});
