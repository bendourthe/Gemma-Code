import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DAGExecutor } from "../../../modules/coding/orchestration/DAGExecutor.js";
import type { SwarmTraceContext } from "../../../modules/coding/orchestration/DAGExecutor.js";
import type { CriticReviewer } from "../../../modules/coding/orchestration/CriticAgent.js";
import { TaskDAG } from "../../../modules/coding/orchestration/TaskDAG.js";
import type { TaskNode } from "../../../modules/coding/orchestration/TaskDAG.js";
import type { SubAgentManager } from "../../../modules/coding/agents/SubAgentManager.js";
import type { SubAgentResult } from "../../../modules/coding/agents/types.js";
import type { SubAgentTraceContext } from "../../../modules/coding/agents/SubAgentSpawner.types.js";
import { Tracer } from "../../../modules/coding/observability/Tracer.js";
import { TraceStore } from "../../../modules/coding/observability/TraceStore.js";
import { flattenSpanForest } from "../../../modules/coding/observability/spanNesting.js";
import { getTierConfig } from "../../../modules/coding/config/HardwareTier.js";
import { mockOf } from "../../helpers/factories.js";

// v1.6.0 Phase 4 (A2) -- when the swarm trace context is wired, the DAGExecutor
// stamps each worker run with the group + planner run and emits a `critic` span
// nested under the worker run it reviews.

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

const noopPost = (): void => {};

describe("DAGExecutor swarm-trace nesting (A2)", () => {
  let store: TraceStore;
  let tracer: Tracer;
  let swarmTrace: SwarmTraceContext;

  beforeEach(() => {
    store = new TraceStore(":memory:");
    tracer = new Tracer();
    tracer.init(store);
    const trace = store.startTrace();
    swarmTrace = {
      tracer,
      traceId: trace.traceId,
      groupId: "group-xyz",
      plannerRunId: trace.rootSpanId,
    };
  });

  afterEach(() => {
    store.close();
  });

  // A mock manager that faithfully simulates SubAgentManager stamping: it reads
  // the trace context it was handed and writes a real sub_agent span, then
  // reports that span as the run id.
  function makeWorkerManager(): SubAgentManager {
    return mockOf<SubAgentManager>({
      run: vi.fn(async (_config, _post, trace?: SubAgentTraceContext): Promise<SubAgentResult> => {
        const runId = trace
          ? tracer.startSpan(
              trace.parentTraceId!,
              "sub_agent_planning",
              "sub_agent",
              trace.parentSpanId,
              {},
              { groupId: trace.groupId ?? null, parentRunId: trace.parentRunId ?? null },
            )
          : "";
        if (runId) tracer.endSpan(runId, "ok");
        return {
          type: "planning",
          success: true,
          output: "done",
          toolCallCount: 1,
          iterationsUsed: 1,
          runId: runId || undefined,
        };
      }),
    });
  }

  it("nests worker under planner and critic under worker in one trace", async () => {
    const critic: CriticReviewer = {
      review: vi.fn(async () => ({ approved: true, feedback: "ok" })),
    };
    const dag = new TaskDAG([makeNode({ id: "a", type: "test", maxRetries: 0 })]);

    const executor = new DAGExecutor(
      makeWorkerManager(),
      getTierConfig(1),
      noopPost,
      undefined,
      undefined,
      { critic, swarmTrace },
    );
    const result = await executor.execute(dag);
    expect(result.nodesCompleted).toBe(1);

    const loaded = store.getTrace(swarmTrace.traceId)!;
    const worker = loaded.spans.find((s) => s.kind === "sub_agent");
    const criticSpan = loaded.spans.find((s) => s.kind === "critic");

    expect(worker).toBeDefined();
    expect(worker!.groupId).toBe("group-xyz");
    expect(worker!.parentRunId).toBe(swarmTrace.plannerRunId);

    expect(criticSpan).toBeDefined();
    expect(criticSpan!.groupId).toBe("group-xyz");
    expect(criticSpan!.parentRunId).toBe(worker!.spanId);
    expect(criticSpan!.attributes.approved).toBe(true);

    // The shared nesting helper renders planner(root) -> worker -> critic.
    const depthBySpan = new Map(
      flattenSpanForest(loaded.spans).map((e) => [e.span.spanId, e.depth]),
    );
    expect(depthBySpan.get(swarmTrace.plannerRunId)).toBe(0);
    expect(depthBySpan.get(worker!.spanId)).toBe(1);
    expect(depthBySpan.get(criticSpan!.spanId)).toBe(2);
  });

  it("marks the critic span errored when the critic rejects", async () => {
    const critic: CriticReviewer = {
      review: vi.fn(async () => ({ approved: false, feedback: "incomplete" })),
    };
    const dag = new TaskDAG([makeNode({ id: "a", type: "test", maxRetries: 0 })]);

    const executor = new DAGExecutor(
      makeWorkerManager(),
      getTierConfig(1),
      noopPost,
      undefined,
      undefined,
      { critic, swarmTrace },
    );
    await executor.execute(dag);

    const loaded = store.getTrace(swarmTrace.traceId)!;
    const criticSpan = loaded.spans.find((s) => s.kind === "critic");
    expect(criticSpan).toBeDefined();
    expect(criticSpan!.status).toBe("error");
    expect(criticSpan!.attributes.approved).toBe(false);
  });

  it("emits no critic span when no swarm trace is wired (default path)", async () => {
    const captured: Array<SubAgentTraceContext | undefined> = [];
    const mgr = mockOf<SubAgentManager>({
      run: vi.fn(async (_c, _p, trace?: SubAgentTraceContext): Promise<SubAgentResult> => {
        captured.push(trace);
        return { type: "planning", success: true, output: "x", toolCallCount: 1, iterationsUsed: 1 };
      }),
    });
    const critic: CriticReviewer = {
      review: vi.fn(async () => ({ approved: true, feedback: "ok" })),
    };
    const dag = new TaskDAG([makeNode({ id: "a", type: "test", maxRetries: 0 })]);

    const executor = new DAGExecutor(mgr, getTierConfig(1), noopPost, undefined, undefined, {
      critic,
    });
    await executor.execute(dag);

    // No swarm trace -> run() got no context and no critic span was recorded
    // (the critic still runs and gates the node, it just is not traced).
    expect(captured).toEqual([undefined]);
    const loaded = store.getTrace(swarmTrace.traceId)!;
    expect(loaded.spans.some((s) => s.kind === "critic")).toBe(false);
    expect(loaded.spans.some((s) => s.kind === "sub_agent")).toBe(false);
    expect(critic.review).toHaveBeenCalledTimes(1);
  });
});
