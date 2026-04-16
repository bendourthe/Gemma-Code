import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../../../src/orchestration/Orchestrator.js";
import type { OrchestratorConfig } from "../../../src/orchestration/Orchestrator.js";
import type { OllamaClient } from "../../../src/ollama/types.js";
import type { SubAgentManager } from "../../../src/agents/SubAgentManager.js";
import type { SubAgentResult } from "../../../src/agents/types.js";
import type { GpuTierProfile } from "../../../src/config/GpuTierConfig.js";
import { GpuTier } from "../../../src/config/GpuTierConfig.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_PLAN_JSON = JSON.stringify([
  {
    id: "task_1",
    title: "Research",
    description: "Read the code",
    type: "research",
    dependencies: [],
  },
  {
    id: "task_2",
    title: "Implement",
    description: "Write the code",
    type: "code",
    dependencies: ["task_1"],
  },
]);

function makeClient(responseText = VALID_PLAN_JSON): OllamaClient {
  async function* gen() {
    yield { message: { content: responseText, role: "assistant" }, done: true };
  }
  return {
    streamChat: vi.fn().mockReturnValue(gen()),
    checkHealth: vi.fn(),
    listModels: vi.fn(),
  } as unknown as OllamaClient;
}

function makeMultiResponseClient(responses: string[]): OllamaClient {
  let callCount = 0;
  const streamChat = vi.fn(() => {
    const text = responses[callCount++] ?? VALID_PLAN_JSON;
    async function* gen() {
      yield { message: { content: text, role: "assistant" }, done: true };
    }
    return gen();
  });
  return {
    streamChat,
    checkHealth: vi.fn(),
    listModels: vi.fn(),
  } as unknown as OllamaClient;
}

function makeSuccessManager(): SubAgentManager {
  return {
    run: vi.fn().mockResolvedValue({
      type: "planning",
      success: true,
      output: "Task done",
      toolCallCount: 1,
      iterationsUsed: 1,
    } as SubAgentResult),
  } as unknown as SubAgentManager;
}

function makeFailureManager(): SubAgentManager {
  return {
    run: vi.fn().mockResolvedValue({
      type: "planning",
      success: false,
      output: "",
      toolCallCount: 0,
      iterationsUsed: 1,
      error: "Agent failed",
    } as SubAgentResult),
  } as unknown as SubAgentManager;
}

function makeTier1Profile(): GpuTierProfile {
  return {
    tier: GpuTier.TIER_1,
    maxAgentIterations: 25,
    subAgentMaxIterations: 8,
    maxConcurrentSubAgents: 1,
    compactionThreshold: 0.7,
    contextWindow: 131072,
    recommendedModel: "gemma4:e4b",
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

function makeConfig(
  overrides: Partial<OrchestratorConfig> = {},
): OrchestratorConfig {
  const { posted: _, postMessage } = collectMessages();
  return {
    client: makeClient(),
    modelName: "gemma4:e4b",
    ollamaOptions: { num_ctx: 131072 },
    subAgentManager: makeSuccessManager(),
    gpuTierProfile: makeTier1Profile(),
    memoryStore: null,
    postMessage,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator", () => {
  describe("shouldUseOrchestrator", () => {
    it("should return true for complex keywords", () => {
      const orch = new Orchestrator(makeConfig());

      expect(orch.shouldUseOrchestrator("Implement user authentication")).toBe(
        true,
      );
      expect(orch.shouldUseOrchestrator("Refactor the database module")).toBe(
        true,
      );
      expect(orch.shouldUseOrchestrator("Build a new feature for exports")).toBe(
        true,
      );
      expect(
        orch.shouldUseOrchestrator("Migrate from Express to Fastify"),
      ).toBe(true);
    });

    it("should return false for simple queries", () => {
      const orch = new Orchestrator(makeConfig());

      expect(orch.shouldUseOrchestrator("What is this function?")).toBe(false);
      expect(orch.shouldUseOrchestrator("Explain the auth module")).toBe(false);
      expect(orch.shouldUseOrchestrator("Show me the config")).toBe(false);
      expect(orch.shouldUseOrchestrator("Help")).toBe(false);
      expect(orch.shouldUseOrchestrator("List all files")).toBe(false);
    });

    it("should return true for long requests even without keywords", () => {
      const orch = new Orchestrator(makeConfig());
      const longRequest = "a".repeat(201);
      expect(orch.shouldUseOrchestrator(longRequest)).toBe(true);
    });

    it("should return false for short requests without keywords", () => {
      const orch = new Orchestrator(makeConfig());
      expect(orch.shouldUseOrchestrator("Fix the typo")).toBe(false);
    });
  });

  describe("execute", () => {
    it("should plan, execute, and return results", async () => {
      const { posted, postMessage } = collectMessages();
      const config = makeConfig({ postMessage });
      const orch = new Orchestrator(config);

      const result = await orch.execute("Implement auth", "src/auth/");

      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.replanCount).toBe(0);
      expect(result.allDags).toHaveLength(1);
      expect(result.summary).toContain("Orchestration Complete");

      // Should have posted DAG visualization.
      const vizMessages = posted.filter(
        (m) => m.type === "dagVisualization",
      );
      expect(vizMessages.length).toBeGreaterThanOrEqual(1);
    });

    it("should post DAG progress messages during execution", async () => {
      const { posted, postMessage } = collectMessages();
      const config = makeConfig({ postMessage });
      const orch = new Orchestrator(config);

      await orch.execute("Implement feature", "src/");

      const progressMessages = posted.filter(
        (m) => m.type === "dagProgress",
      );
      expect(progressMessages.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle planner failure gracefully with fallback DAG", async () => {
      const client = makeClient("not valid json at all");
      // The planner will fail twice and produce a fallback single-node DAG.
      // But we need multi-response client for retry.
      const multiClient = makeMultiResponseClient([
        "invalid",
        "still invalid",
      ]);
      const { postMessage } = collectMessages();
      const config = makeConfig({
        client: multiClient,
        postMessage,
      });
      const orch = new Orchestrator(config);

      const result = await orch.execute("Do something", "src/");

      // Fallback DAG has 1 node.
      expect(result.dag.getProgress().total).toBe(1);
    });
  });
});
