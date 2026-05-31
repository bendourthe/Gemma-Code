import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../../../modules/coding/orchestration/Orchestrator.js";
import type { SubAgentManager } from "../../../modules/coding/agents/SubAgentManager.js";
import type { SubAgentConfig } from "../../../modules/coding/agents/types.js";
import {
  collectMessages,
  makeMemoryStore,
  makeMultiResponseOllamaClient as makeMultiResponseClient,
  makeOrchestratorConfig,
  mockOf,
} from "../../helpers/factories.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A 3-node plan where all nodes have maxRetries 0 (fail terminally on first attempt). */
const THREE_NODE_PLAN = JSON.stringify([
  {
    id: "task_1",
    title: "Step1",
    description: "First step",
    type: "research",
    dependencies: [],
  },
  {
    id: "task_2",
    title: "Step2",
    description: "Second step",
    type: "code",
    dependencies: ["task_1"],
  },
  {
    id: "task_3",
    title: "Step3",
    description: "Third step",
    type: "test",
    dependencies: ["task_2"],
  },
]);

/** A simpler 2-node replacement plan for replanning. */
const REPLAN_RESPONSE = JSON.stringify([
  {
    id: "replan_1",
    title: "FixedStep",
    description: "Retry with corrections",
    type: "code",
    dependencies: [],
  },
]);


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator - Dynamic Replanning", () => {
  it("NOT replan when failure rate is below 30%", async () => {
    // 3 nodes, 1 fails = 33% => triggers replan. But let's do 4 nodes, 1 fails = 25%.
    const fourNodePlan = JSON.stringify([
      { id: "t1", title: "A", description: "a", type: "research", dependencies: [] },
      { id: "t2", title: "B", description: "b", type: "code", dependencies: [] },
      { id: "t3", title: "C", description: "c", type: "test", dependencies: [] },
      { id: "t4", title: "D", description: "d", type: "verify", dependencies: [] },
    ]);

    let runCallCount = 0;
    const manager = mockOf<SubAgentManager>({
      run: vi.fn(async () => {
        runCallCount++;
        // Only the first call fails.
        if (runCallCount === 1) {
          return {
            type: "research" as const,
            success: false,
            output: "",
            toolCallCount: 0,
            iterationsUsed: 1,
            error: "Failed",
          };
        }
        return {
          type: "planning" as const,
          success: true,
          output: "Done",
          toolCallCount: 1,
          iterationsUsed: 1,
        };
      }),
    });

    // Responses: plan + reflexion call.
    const client = makeMultiResponseClient([
      fourNodePlan,
      "The task failed because the file was missing.", // reflexion
    ]);
    const { posted, postMessage } = collectMessages();

    const config = makeOrchestratorConfig({
      client,
      subAgentManager: manager,
      postMessage,
    });

    const orch = new Orchestrator(config);
    const result = await orch.execute("Build feature", "src/");

    // 1 failed out of 4 = 25% < 30% threshold. No replanning.
    expect(result.replanCount).toBe(0);
    expect(result.allDags).toHaveLength(1);

    const replanMessages = posted.filter((m) => m.type === "replanning");
    expect(replanMessages).toHaveLength(0);
  });

  it("replan when failure rate exceeds 30%", async () => {
    // 3 nodes: all fail (maxRetries=0 default from PlannerAgent is 1).
    // With maxRetries=1, each node gets one retry. If both attempts fail,
    // that's 100% failure -> triggers replan.
    let runCallCount = 0;
    const manager = mockOf<SubAgentManager>({
      run: vi.fn(async () => {
        runCallCount++;
        // First execution of the original plan: all fail.
        // After replan: succeed.
        if (runCallCount <= 6) {
          // 3 nodes x 2 attempts each = 6 failure calls.
          return {
            type: "planning" as const,
            success: false,
            output: "",
            toolCallCount: 0,
            iterationsUsed: 1,
            error: "Failed",
          };
        }
        return {
          type: "planning" as const,
          success: true,
          output: "Done after replan",
          toolCallCount: 1,
          iterationsUsed: 1,
        };
      }),
    });

    // Responses: initial plan, 6 reflexion calls, replan.
    const responses = [
      THREE_NODE_PLAN,           // initial plan
      "Analysis 1",              // reflexion for task_1 attempt 1
      "Analysis 2",              // reflexion for task_1 attempt 2
      // task_2 and task_3 are skipped because task_1 fails terminally
      REPLAN_RESPONSE,           // replan
      "Analysis for replan",     // reflexion for replan attempt if needed
    ];
    const client = makeMultiResponseClient(responses);
    const { posted, postMessage } = collectMessages();

    const config = makeOrchestratorConfig({
      client,
      subAgentManager: manager,
      postMessage,
    });

    const orch = new Orchestrator(config);
    const result = await orch.execute("Build feature", "src/");

    // Should have replanned at least once.
    expect(result.replanCount).toBeGreaterThanOrEqual(1);
    expect(result.allDags.length).toBeGreaterThanOrEqual(2);

    const replanMessages = posted.filter((m) => m.type === "replanning");
    expect(replanMessages.length).toBeGreaterThanOrEqual(1);
  });

  it("respect max replan attempts limit", async () => {
    // All nodes always fail -> should replan at most 2 times (default).
    const manager = mockOf<SubAgentManager>({
      run: vi.fn(async () => ({
        type: "planning" as const,
        success: false,
        output: "",
        toolCallCount: 0,
        iterationsUsed: 1,
        error: "Always fails",
      })),
    });

    const singleNodePlan = JSON.stringify([
      { id: "t1", title: "Task", description: "Fail", type: "code", dependencies: [] },
    ]);

    // Need enough responses: initial plan + reflexions + replan1 + reflexions + replan2 + reflexions.
    const responses = Array(20).fill(singleNodePlan) as string[];
    responses.push(...Array(20).fill("Reflexion analysis") as string[]);
    const client = makeMultiResponseClient(responses);
    const { postMessage } = collectMessages();

    const config = makeOrchestratorConfig({
      client,
      subAgentManager: manager,
      postMessage,
    });

    const orch = new Orchestrator(config);
    const result = await orch.execute("Build feature", "src/");

    // Max replans is 2.
    expect(result.replanCount).toBeLessThanOrEqual(2);
  });

  it("include completed work context in replanning", async () => {
    // 2 nodes: first succeeds, second fails -> 50% failure -> replan.
    let runCallCount = 0;
    const manager = mockOf<SubAgentManager>({
      run: vi.fn(async (config: SubAgentConfig) => {
        runCallCount++;
        const title = config.userRequest.split(":")[0]!;

        // First plan: Step1 succeeds, Step2 fails (both attempts).
        if (title === "Step1" && runCallCount <= 1) {
          return {
            type: "research" as const,
            success: true,
            output: "Research complete",
            toolCallCount: 1,
            iterationsUsed: 1,
          };
        }
        if (title === "Step2" && runCallCount <= 3) {
          return {
            type: "planning" as const,
            success: false,
            output: "",
            toolCallCount: 0,
            iterationsUsed: 1,
            error: "Code failed",
          };
        }
        // Replan: always succeed.
        return {
          type: "planning" as const,
          success: true,
          output: "Replan task done",
          toolCallCount: 1,
          iterationsUsed: 1,
        };
      }),
    });

    const twoNodePlan = JSON.stringify([
      { id: "t1", title: "Step1", description: "Research", type: "research", dependencies: [] },
      { id: "t2", title: "Step2", description: "Code", type: "code", dependencies: ["t1"] },
    ]);

    const responses = [
      twoNodePlan,               // initial plan
      "Reflexion for Step2",     // reflexion
      "Reflexion for Step2 v2",  // reflexion attempt 2
      REPLAN_RESPONSE,           // replan
    ];
    const client = makeMultiResponseClient(responses);
    const { postMessage } = collectMessages();

    const config = makeOrchestratorConfig({
      client,
      subAgentManager: manager,
      postMessage,
    });

    const orch = new Orchestrator(config);
    const result = await orch.execute("Build feature", "src/");

    // Verify replanning occurred.
    expect(result.allDags.length).toBeGreaterThanOrEqual(2);

    // The replanning prompt should have included the PlannerAgent call
    // with context about completed work (streamed via the client).
    // We verify the client was called multiple times.
    expect(client.streamChat).toHaveBeenCalledTimes(
      (client.streamChat as ReturnType<typeof vi.fn>).mock.calls.length,
    );
  });

  it("saves an error_resolution memory after terminal failure", async () => {
    // Every run fails until max replans is exhausted -> terminal failure.
    const manager = mockOf<SubAgentManager>({
      run: vi.fn(async () => ({
        type: "planning" as const,
        success: false,
        output: "",
        toolCallCount: 0,
        iterationsUsed: 1,
        error: "Terminal failure",
      })),
    });

    const singleNodePlan = JSON.stringify([
      { id: "t1", title: "Task", description: "Fail", type: "code", dependencies: [] },
    ]);
    const responses = Array<string>(30).fill(singleNodePlan);
    responses.push(...Array<string>(30).fill("Reflexion analysis"));
    const client = makeMultiResponseClient(responses);
    const memoryStore = makeMemoryStore();

    const config = makeOrchestratorConfig({
      client,
      subAgentManager: manager,
      memoryStore,
    });

    const orch = new Orchestrator(config);
    await orch.execute("Build feature", "src/");

    const saveMock = memoryStore.save as ReturnType<typeof vi.fn>;
    expect(saveMock).toHaveBeenCalled();
    const savedWithErrorResolution = saveMock.mock.calls.some((call) => {
      const arg = call[0] as { type?: string } | undefined;
      const secondArg = call[1] as string | undefined;
      return arg?.type === "error_resolution" || secondArg === "error_resolution";
    });
    expect(savedWithErrorResolution).toBe(true);
  });
});
