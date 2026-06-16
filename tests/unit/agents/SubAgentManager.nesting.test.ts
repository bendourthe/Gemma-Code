import { describe, it, expect, beforeEach } from "vitest";
import { SubAgentManager } from "../../../modules/coding/agents/SubAgentManager.js";
import type { SubAgentConfig } from "../../../modules/coding/agents/types.js";
import { PromptBuilder } from "../../../modules/coding/chat/PromptBuilder.js";
import { Tracer } from "../../../modules/coding/observability/Tracer.js";
import { TraceStore } from "../../../modules/coding/observability/TraceStore.js";
import { collectMessages, makeOllamaClient as makeClient } from "../../helpers/factories.js";

// v1.6.0 Phase 4 (A2) -- a sub-agent run stamps the swarm group + parent run
// onto its root span when the orchestrator supplies a trace context, and
// reports its own run id so a follow-on critic can nest under it. Without a
// context (the ReAct path) the span carries neither and starts its own trace.

const baseConfig: SubAgentConfig = {
  type: "verification",
  maxIterations: 5,
  userRequest: "Check the recent changes for bugs.",
  modifiedFiles: ["src/foo.ts"],
  recentToolResults: [],
};

describe("SubAgentManager run-nesting (A2)", () => {
  let promptBuilder: PromptBuilder;
  let store: TraceStore;
  let tracer: Tracer;
  const ollamaOptions = { num_ctx: 131072, temperature: 1.0, top_p: 0.95, top_k: 64 };

  beforeEach(() => {
    promptBuilder = new PromptBuilder();
    store = new TraceStore(":memory:");
    tracer = new Tracer();
    tracer.init(store);
  });

  it("stamps group_id / parent_run_id on the sub_agent span and returns its run id", () => {
    const client = makeClient("No issues found.");
    const manager = new SubAgentManager(client, promptBuilder, null, ollamaOptions, "gemma4", tracer);
    const { postMessage } = collectMessages();
    const trace = store.startTrace();

    return manager
      .run(baseConfig, postMessage, {
        parentTraceId: trace.traceId,
        parentSpanId: trace.rootSpanId,
        groupId: "swarm-group-1",
        parentRunId: trace.rootSpanId,
      })
      .then((result) => {
        expect(result.success).toBe(true);
        expect(result.runId).toBeTruthy();

        const loaded = store.getTrace(trace.traceId);
        const sub = loaded?.spans.find((s) => s.kind === "sub_agent");
        expect(sub).toBeDefined();
        expect(sub!.spanId).toBe(result.runId);
        expect(sub!.groupId).toBe("swarm-group-1");
        expect(sub!.parentRunId).toBe(trace.rootSpanId);
        expect(sub!.parentSpanId).toBe(trace.rootSpanId);
      });
  });

  it("joins the supplied parent trace instead of starting a new one", async () => {
    const client = makeClient("Done.");
    const manager = new SubAgentManager(client, promptBuilder, null, ollamaOptions, "gemma4", tracer);
    const { postMessage } = collectMessages();
    const trace = store.startTrace();

    await manager.run(baseConfig, postMessage, {
      parentTraceId: trace.traceId,
      parentSpanId: trace.rootSpanId,
      groupId: "g",
      parentRunId: trace.rootSpanId,
    });

    // Exactly one trace exists -- the sub-agent did not open its own.
    expect(store.listTraces()).toHaveLength(1);
    const loaded = store.getTrace(trace.traceId);
    expect(loaded!.spans.some((s) => s.kind === "sub_agent")).toBe(true);
  });

  it("leaves nesting null for a context-free (ReAct path) run", async () => {
    const client = makeClient("ok");
    const manager = new SubAgentManager(client, promptBuilder, null, ollamaOptions, "gemma4", tracer);
    const { postMessage } = collectMessages();

    const result = await manager.run(baseConfig, postMessage);

    expect(result.runId).toBeTruthy();
    const sub = store.getSpan(result.runId!);
    expect(sub?.groupId).toBeNull();
    expect(sub?.parentRunId).toBeNull();
  });
});
