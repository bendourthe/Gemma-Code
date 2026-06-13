import { describe, it, expect, vi } from "vitest";
import { DAGExecutor } from "../../../modules/coding/orchestration/DAGExecutor.js";
import type { CriticReviewer } from "../../../modules/coding/orchestration/CriticAgent.js";
import { TaskDAG } from "../../../modules/coding/orchestration/TaskDAG.js";
import type { TaskNode } from "../../../modules/coding/orchestration/TaskDAG.js";
import type { SubAgentManager } from "../../../modules/coding/agents/SubAgentManager.js";
import type { SubAgentConfig, SubAgentResult } from "../../../modules/coding/agents/types.js";
import { getTierConfig } from "../../../modules/coding/config/HardwareTier.js";
import { mockOf } from "../../helpers/factories.js";

// v1.5.0 Phase 4 -- the swarm-orchestration extensions to the DAGExecutor:
//   T010 (closes v1.4.0 T018.P3.A): write-capable nodes are dispatched with
//        `isolate: true` when isolateWrites is on.
//   T011 (closes the team-orchestration half of v1.4.0 T018.P3.B): a critic
//        gates each worker's output before the node is accepted.

function makeNode(overrides: Partial<TaskNode> & { id: string }): TaskNode {
  return {
    title: overrides.id,
    description: `Description for ${overrides.id}`,
    type: "code",
    dependencies: [],
    status: "pending",
    retryCount: 0,
    maxRetries: 1,
    ...overrides,
  };
}

function success(): SubAgentResult {
  return {
    type: "verification",
    success: true,
    output: "Task completed",
    toolCallCount: 1,
    iterationsUsed: 1,
  };
}

const noopPost = (): void => {};

describe("DAGExecutor write-capable isolation (T010)", () => {
  it("sets isolate:true for write-capable nodes and leaves read-only nodes unisolated", async () => {
    const captured: SubAgentConfig[] = [];
    const runFn = vi.fn(async (c: SubAgentConfig) => {
      captured.push(c);
      return success();
    });
    const mgr = mockOf<SubAgentManager>({ run: runFn });

    const dag = new TaskDAG([
      makeNode({ id: "r", type: "research" }), // -> research (read-only)
      makeNode({ id: "t", type: "test", dependencies: ["r"] }), // -> verification (write-capable)
      makeNode({ id: "v", type: "verify", dependencies: ["t"] }), // -> verification (write-capable)
    ]);

    const executor = new DAGExecutor(
      mgr,
      getTierConfig(1),
      noopPost,
      undefined,
      undefined,
      { isolateWrites: true },
    );
    await executor.execute(dag);

    const byType = new Map(captured.map((c) => [c.type, c]));
    expect(byType.get("research")?.isolate).toBeUndefined();
    expect(byType.get("verification")?.isolate).toBe(true);
  });

  it("never isolates any node when isolateWrites is off (default)", async () => {
    const captured: SubAgentConfig[] = [];
    const runFn = vi.fn(async (c: SubAgentConfig) => {
      captured.push(c);
      return success();
    });
    const mgr = mockOf<SubAgentManager>({ run: runFn });

    const dag = new TaskDAG([
      makeNode({ id: "t", type: "test" }),
      makeNode({ id: "v", type: "verify" }),
    ]);

    const executor = new DAGExecutor(mgr, getTierConfig(3), noopPost);
    await executor.execute(dag);

    expect(captured.length).toBe(2);
    expect(captured.every((c) => c.isolate === undefined)).toBe(true);
  });
});

describe("DAGExecutor critic gate (T011)", () => {
  it("completes a node when the critic approves the worker output", async () => {
    const mgr = mockOf<SubAgentManager>({ run: vi.fn(async () => success()) });
    const critic: CriticReviewer = {
      review: vi.fn(async () => ({ approved: true, feedback: "ok" })),
    };
    const dag = new TaskDAG([makeNode({ id: "a", type: "test", maxRetries: 0 })]);

    const executor = new DAGExecutor(
      mgr,
      getTierConfig(1),
      noopPost,
      undefined,
      undefined,
      { critic },
    );
    const result = await executor.execute(dag);

    expect(result.nodesCompleted).toBe(1);
    expect(result.nodesFailed).toBe(0);
    expect(critic.review).toHaveBeenCalledTimes(1);
  });

  it("fails a node when the critic rejects and no retries remain", async () => {
    const mgr = mockOf<SubAgentManager>({ run: vi.fn(async () => success()) });
    const critic: CriticReviewer = {
      review: vi.fn(async () => ({ approved: false, feedback: "missing the check" })),
    };
    const dag = new TaskDAG([makeNode({ id: "a", type: "test", maxRetries: 0 })]);

    const executor = new DAGExecutor(
      mgr,
      getTierConfig(1),
      noopPost,
      undefined,
      undefined,
      { critic },
    );
    const result = await executor.execute(dag);

    expect(result.nodesCompleted).toBe(0);
    expect(result.nodesFailed).toBe(1);
  });

  it("re-runs a critic-rejected node and accepts it once the critic approves", async () => {
    const mgr = mockOf<SubAgentManager>({ run: vi.fn(async () => success()) });
    let reviewCount = 0;
    const critic: CriticReviewer = {
      review: vi.fn(async () =>
        reviewCount++ === 0
          ? { approved: false, feedback: "fix the edge case" }
          : { approved: true, feedback: "ok now" },
      ),
    };
    const dag = new TaskDAG([makeNode({ id: "a", type: "test", maxRetries: 2 })]);

    const executor = new DAGExecutor(
      mgr,
      getTierConfig(1),
      noopPost,
      undefined,
      undefined,
      { critic },
    );
    const result = await executor.execute(dag);

    expect(result.nodesCompleted).toBe(1);
    expect(critic.review).toHaveBeenCalledTimes(2);
  });

  it("fails open (accepts the output) when the critic throws", async () => {
    const mgr = mockOf<SubAgentManager>({ run: vi.fn(async () => success()) });
    const critic: CriticReviewer = {
      review: vi.fn(async () => {
        throw new Error("model unavailable");
      }),
    };
    const dag = new TaskDAG([makeNode({ id: "a", type: "test", maxRetries: 0 })]);

    const executor = new DAGExecutor(
      mgr,
      getTierConfig(1),
      noopPost,
      undefined,
      undefined,
      { critic },
    );
    const result = await executor.execute(dag);

    expect(result.nodesCompleted).toBe(1);
  });

  it("never dispatches more concurrent workers than the GPU tier allows, even with isolation + critic on", async () => {
    // Comparison Section 9.1 / N4: the worker count is a scheduling abstraction
    // bounded by the GPU scheduler's serving capacity -- extra workers queue,
    // they do not oversubscribe. Tier 3 allows 3 concurrent sub-agents.
    const tier = getTierConfig(3);
    let inFlight = 0;
    let peak = 0;
    const mgr = mockOf<SubAgentManager>({
      run: vi.fn(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return success();
      }),
    });
    const critic: CriticReviewer = {
      review: vi.fn(async () => ({ approved: true, feedback: "ok" })),
    };
    // Eight independent write-capable nodes are all ready at once.
    const dag = new TaskDAG(
      Array.from({ length: 8 }, (_, i) => makeNode({ id: `n${i}`, type: "verify" })),
    );

    const executor = new DAGExecutor(mgr, tier, noopPost, undefined, undefined, {
      isolateWrites: true,
      critic,
    });
    const result = await executor.execute(dag);

    expect(result.nodesCompleted).toBe(8);
    expect(peak).toBeLessThanOrEqual(tier.maxConcurrentSubAgents);
    expect(peak).toBeGreaterThan(1); // genuinely ran in parallel, just bounded
  });

  it("does not run a critic on a node whose worker failed", async () => {
    const mgr = mockOf<SubAgentManager>({
      run: vi.fn(async () => ({
        type: "verification" as const,
        success: false,
        output: "",
        toolCallCount: 0,
        iterationsUsed: 1,
        error: "worker failed",
      })),
    });
    const critic: CriticReviewer = { review: vi.fn(async () => ({ approved: true, feedback: "" })) };
    const dag = new TaskDAG([makeNode({ id: "a", type: "test", maxRetries: 0 })]);

    const executor = new DAGExecutor(
      mgr,
      getTierConfig(1),
      noopPost,
      undefined,
      undefined,
      { critic },
    );
    const result = await executor.execute(dag);

    expect(result.nodesFailed).toBe(1);
    expect(critic.review).not.toHaveBeenCalled();
  });
});
