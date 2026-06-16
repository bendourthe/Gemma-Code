import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../../../modules/coding/orchestration/Orchestrator.js";
import type { SubAgentManager } from "../../../modules/coding/agents/SubAgentManager.js";
import type {
  SubAgentResult,
} from "../../../modules/coding/agents/types.js";
import type { SubAgentTraceContext } from "../../../modules/coding/agents/SubAgentSpawner.types.js";
import type { CriticReviewer } from "../../../modules/coding/orchestration/CriticAgent.js";
import { Tracer } from "../../../modules/coding/observability/Tracer.js";
import { TraceStore } from "../../../modules/coding/observability/TraceStore.js";
import {
  makeOrchestratorConfig,
  makeMultiResponseOllamaClient,
  mockOf,
} from "../../helpers/factories.js";

// v1.6.0 Phase 4 (A2) -- the orchestrator opens one shared trace + group per
// execute() and stamps every sub-run with the planner run + group, so the
// dashboard / export can nest planner -> worker -> critic. Acceptance: prove
// the orchestrator hands each sub-run the group + parent-run ids.

const SINGLE_NODE_PLAN = JSON.stringify([
  {
    id: "task_1",
    title: "Implement",
    description: "Write the feature",
    type: "code",
    dependencies: [],
  },
]);

function makeCapturingSubAgentManager(captured: SubAgentTraceContext[]): SubAgentManager {
  return mockOf<SubAgentManager>({
    run: vi.fn(async (_config, _post, trace?: SubAgentTraceContext): Promise<SubAgentResult> => {
      if (trace) captured.push(trace);
      return {
        type: "planning",
        success: true,
        output: "done",
        toolCallCount: 1,
        iterationsUsed: 1,
        runId: "worker-run-1",
      };
    }),
  });
}

describe("Orchestrator swarm-trace stamping (A2)", () => {
  it("stamps each sub-run with the swarm group and planner run id", async () => {
    const store = new TraceStore(":memory:");
    const tracer = new Tracer();
    tracer.init(store);
    const captured: SubAgentTraceContext[] = [];
    const critic: CriticReviewer = {
      review: vi.fn(async () => ({ approved: true, feedback: "ok" })),
    };

    const config = makeOrchestratorConfig({
      client: makeMultiResponseOllamaClient([SINGLE_NODE_PLAN]),
      subAgentManager: makeCapturingSubAgentManager(captured),
      swarmEnabled: true,
      critic,
      tracer,
    });

    try {
      const result = await new Orchestrator(config).execute("Implement the feature", "ctx");
      expect(result.dag.getProgress().completed).toBe(1);

      // One trace was opened for the dispatch; the planner run is its root span.
      const traces = store.listTraces();
      expect(traces).toHaveLength(1);
      const traceId = traces[0]!.traceId;
      const rootSpanId = store.getTrace(traceId)!.rootSpanId;

      expect(captured.length).toBeGreaterThan(0);
      for (const ctx of captured) {
        expect(ctx.parentTraceId).toBe(traceId);
        expect(ctx.parentRunId).toBe(rootSpanId);
        expect(ctx.parentSpanId).toBe(rootSpanId);
        expect(typeof ctx.groupId).toBe("string");
        expect((ctx.groupId ?? "").length).toBeGreaterThan(0);
      }
      // All sub-runs of one execute() share the same group.
      const groups = new Set(captured.map((c) => c.groupId));
      expect(groups.size).toBe(1);
    } finally {
      store.close();
    }
  });

  it("passes no trace context when no tracer is wired (default path unchanged)", async () => {
    const captured: SubAgentTraceContext[] = [];
    const subAgentManager = mockOf<SubAgentManager>({
      run: vi.fn(async (_config, _post, trace?: SubAgentTraceContext): Promise<SubAgentResult> => {
        captured.push(trace as SubAgentTraceContext);
        return {
          type: "planning",
          success: true,
          output: "done",
          toolCallCount: 1,
          iterationsUsed: 1,
        };
      }),
    });

    const config = makeOrchestratorConfig({
      client: makeMultiResponseOllamaClient([SINGLE_NODE_PLAN]),
      subAgentManager,
      // no tracer, swarm off -> legacy behavior
    });

    await new Orchestrator(config).execute("Implement the feature", "ctx");

    expect(captured.length).toBeGreaterThan(0);
    expect(captured.every((c) => c === undefined)).toBe(true);
  });
});
