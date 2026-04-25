import { describe, it, expect, vi, beforeEach } from "vitest";
import { DAGExecutor } from "../../../src/orchestration/DAGExecutor.js";
import type { DAGExecutionResult, ReflexionEngineInterface } from "../../../src/orchestration/DAGExecutor.js";
import { TaskDAG } from "../../../src/orchestration/TaskDAG.js";
import type { TaskNode } from "../../../src/orchestration/TaskDAG.js";
import type { SubAgentManager } from "../../../src/agents/SubAgentManager.js";
import type { SubAgentConfig, SubAgentResult } from "../../../src/agents/types.js";
import type { HardwareTierConfig } from "../../../src/config/HardwareTier.types.js";
import { getTierConfig } from "../../../src/config/HardwareTier.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";
import { mockOf } from "../../helpers/factories.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeTier1Profile(): HardwareTierConfig {
  return getTierConfig(1);
}

function makeTier3Profile(): HardwareTierConfig {
  return getTierConfig(3);
}

function makeSuccessResult(type = "planning"): SubAgentResult {
  return {
    type: type as SubAgentResult["type"],
    success: true,
    output: "Task completed successfully",
    toolCallCount: 2,
    iterationsUsed: 1,
  };
}

function makeFailureResult(type = "planning"): SubAgentResult {
  return {
    type: type as SubAgentResult["type"],
    success: false,
    output: "",
    toolCallCount: 0,
    iterationsUsed: 1,
    error: "Something went wrong",
  };
}

function collectMessages(): {
  posted: ExtensionToWebviewMessage[];
  postMessage: (m: ExtensionToWebviewMessage) => void;
} {
  const posted: ExtensionToWebviewMessage[] = [];
  const postMessage = (m: ExtensionToWebviewMessage) => posted.push(m);
  return { posted, postMessage };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DAGExecutor", () => {
  let mockManager: SubAgentManager;
  let runFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    runFn = vi.fn().mockResolvedValue(makeSuccessResult());
    mockManager = mockOf<SubAgentManager>({ run: runFn });
  });

  describe("sequential execution (TIER_1)", () => {
    it("execute a linear DAG node by node", async () => {
      const dag = new TaskDAG([
        makeNode({ id: "a", type: "research" }),
        makeNode({ id: "b", type: "code", dependencies: ["a"] }),
        makeNode({ id: "c", type: "test", dependencies: ["b"] }),
      ]);

      const { postMessage } = collectMessages();
      const executor = new DAGExecutor(
        mockManager,
        makeTier1Profile(),
        postMessage,
      );

      const result = await executor.execute(dag);

      expect(result.nodesCompleted).toBe(3);
      expect(result.nodesFailed).toBe(0);
      expect(result.nodesSkipped).toBe(0);
      expect(runFn).toHaveBeenCalledTimes(3);

      // Verify execution order: a, then b, then c.
      const calls = runFn.mock.calls as Array<[SubAgentConfig, unknown]>;
      expect(calls[0]![0].type).toBe("research");
      expect(calls[1]![0].type).toBe("planning"); // "code" maps to "planning"
      expect(calls[2]![0].type).toBe("verification"); // "test" maps to "verification"
    });
  });

  describe("parallel execution (TIER_3)", () => {
    it("execute independent nodes in parallel", async () => {
      const executionOrder: string[] = [];
      let resolveA: (() => void) | undefined;
      let resolveB: (() => void) | undefined;

      runFn.mockImplementation(async (config: SubAgentConfig) => {
        const title = config.userRequest.split(":")[0]!;
        executionOrder.push(`start:${title}`);

        if (title === "a") {
          await new Promise<void>((r) => { resolveA = r; });
        } else if (title === "b") {
          await new Promise<void>((r) => { resolveB = r; });
        }

        executionOrder.push(`end:${title}`);
        return makeSuccessResult();
      });

      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b" }),
        makeNode({ id: "c", dependencies: ["a", "b"] }),
      ]);

      const { postMessage } = collectMessages();
      const executor = new DAGExecutor(
        mockManager,
        makeTier3Profile(),
        postMessage,
      );

      const executePromise = executor.execute(dag);

      // Deterministically wait for both independent nodes to start.
      await vi.waitFor(() => {
        expect(executionOrder).toContain("start:a");
        expect(executionOrder).toContain("start:b");
      });

      // Resolve both.
      resolveA?.();
      resolveB?.();

      await executePromise;

      expect(executionOrder).toContain("end:a");
      expect(executionOrder).toContain("end:b");
      // c should run after both a and b complete.
      expect(executionOrder).toContain("start:c");
    });
  });

  describe("failure handling", () => {
    it("skip dependents when a node fails terminally", async () => {
      runFn.mockImplementation(async (config: SubAgentConfig) => {
        const title = config.userRequest.split(":")[0]!;
        if (title === "a") return makeFailureResult();
        return makeSuccessResult();
      });

      const dag = new TaskDAG([
        makeNode({ id: "a", maxRetries: 0 }),
        makeNode({ id: "b", dependencies: ["a"] }),
        makeNode({ id: "c", dependencies: ["b"] }),
        makeNode({ id: "d" }), // independent, should still succeed
      ]);

      const { postMessage } = collectMessages();
      const executor = new DAGExecutor(
        mockManager,
        makeTier1Profile(),
        postMessage,
      );

      const result = await executor.execute(dag);

      expect(result.nodesFailed).toBe(1);
      expect(result.nodesSkipped).toBe(2); // b and c skipped
      expect(result.nodesCompleted).toBe(1); // d completed
    });

    it("retry a node when maxRetries > retryCount", async () => {
      let callCount = 0;
      runFn.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return makeFailureResult();
        return makeSuccessResult();
      });

      const dag = new TaskDAG([
        makeNode({ id: "a", maxRetries: 2 }),
      ]);

      const { postMessage } = collectMessages();
      const executor = new DAGExecutor(
        mockManager,
        makeTier1Profile(),
        postMessage,
      );

      const result = await executor.execute(dag);

      expect(result.nodesCompleted).toBe(1);
      expect(result.nodesFailed).toBe(0);
      expect(runFn).toHaveBeenCalledTimes(2); // first attempt fails, retry succeeds
    });
  });

  describe("progress messages", () => {
    it("post dagProgress messages after each node completes", async () => {
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b" }),
      ]);

      const { posted, postMessage } = collectMessages();
      const executor = new DAGExecutor(
        mockManager,
        makeTier1Profile(),
        postMessage,
      );

      await executor.execute(dag);

      const progressMessages = posted.filter(
        (m) => m.type === "dagProgress",
      );
      expect(progressMessages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("deadlock detection", () => {
    it("terminate when no nodes are ready and none are running", async () => {
      // Create a DAG where all nodes depend on a failed node.
      runFn.mockResolvedValue(makeFailureResult());

      const dag = new TaskDAG([
        makeNode({ id: "a", maxRetries: 0 }),
        makeNode({ id: "b", dependencies: ["a"] }),
      ]);

      const { postMessage } = collectMessages();
      const executor = new DAGExecutor(
        mockManager,
        makeTier1Profile(),
        postMessage,
      );

      const result = await executor.execute(dag);

      // Should not hang. a fails, b gets skipped.
      expect(result.nodesFailed).toBe(1);
      expect(result.nodesSkipped).toBe(1);
    });
  });

  describe("reflexion integration", () => {
    it("invoke reflexion engine on failure and use context on retry", async () => {
      let callCount = 0;
      runFn.mockImplementation(async (config: SubAgentConfig) => {
        callCount++;
        if (callCount === 1) return makeFailureResult();
        // On retry, memoryContext should be set.
        expect(config.memoryContext).toContain("Previous Attempt Failures");
        return makeSuccessResult();
      });

      const mockReflexion: ReflexionEngineInterface = {
        reflect: vi.fn().mockResolvedValue({
          taskId: "a",
          analysis: "The file was missing. Do not assume files exist.",
          constraints: ["Do not assume files exist."],
          timestamp: Date.now(),
        }),
        storeReflection: vi.fn().mockResolvedValue(undefined),
        buildRetryContext: vi.fn().mockReturnValue(
          "## Previous Attempt Failures\n\n- Attempt 1: The file was missing.",
        ),
      };

      const dag = new TaskDAG([makeNode({ id: "a", maxRetries: 2 })]);

      const { postMessage } = collectMessages();
      const executor = new DAGExecutor(
        mockManager,
        makeTier1Profile(),
        postMessage,
        mockReflexion,
      );

      const result = await executor.execute(dag);

      expect(result.nodesCompleted).toBe(1);
      expect(mockReflexion.reflect).toHaveBeenCalledTimes(1);
      expect(mockReflexion.storeReflection).toHaveBeenCalledTimes(1);
      expect(mockReflexion.buildRetryContext).toHaveBeenCalledTimes(1);
    });
  });

  describe("node type mapping", () => {
    it("map task types to correct sub-agent types", async () => {
      const dag = new TaskDAG([
        makeNode({ id: "a", type: "research" }),
        makeNode({ id: "b", type: "code", dependencies: ["a"] }),
        makeNode({ id: "c", type: "test", dependencies: ["b"] }),
        makeNode({ id: "d", type: "verify", dependencies: ["c"] }),
      ]);

      const { postMessage } = collectMessages();
      const executor = new DAGExecutor(
        mockManager,
        makeTier1Profile(),
        postMessage,
      );

      await executor.execute(dag);

      const calls = runFn.mock.calls as Array<[SubAgentConfig, unknown]>;
      expect(calls[0]![0].type).toBe("research");
      expect(calls[1]![0].type).toBe("planning");
      expect(calls[2]![0].type).toBe("verification");
      expect(calls[3]![0].type).toBe("verification");
    });
  });
});
