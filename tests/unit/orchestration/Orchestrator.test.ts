import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../../../src/orchestration/Orchestrator.js";
import type { OrchestratorConfig } from "../../../src/orchestration/Orchestrator.js";
import {
  collectMessages,
  makeMultiResponseOllamaClient as makeMultiResponseClient,
  makeOllamaClient,
  makeOrchestratorConfig,
  makeSubAgentManager,
} from "../../helpers/factories.js";

// ---------------------------------------------------------------------------
// Local helpers and constants
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

// Thin wrappers to keep historical call sites readable.
const makeClient = (responseText: string = VALID_PLAN_JSON) =>
  makeOllamaClient(responseText);
const makeSuccessManager = () => makeSubAgentManager({ success: true });
const makeFailureManager = () =>
  makeSubAgentManager({ success: false, error: "Agent failed" });

function makeConfig(
  overrides: Partial<OrchestratorConfig> = {},
): OrchestratorConfig {
  return makeOrchestratorConfig({
    client: makeClient(),
    subAgentManager: makeSuccessManager(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator", () => {
  describe("shouldUseOrchestrator", () => {
    it("return true for complex keywords", () => {
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

    it("return false for simple queries", () => {
      const orch = new Orchestrator(makeConfig());

      expect(orch.shouldUseOrchestrator("What is this function?")).toBe(false);
      expect(orch.shouldUseOrchestrator("Explain the auth module")).toBe(false);
      expect(orch.shouldUseOrchestrator("Show me the config")).toBe(false);
      expect(orch.shouldUseOrchestrator("Help")).toBe(false);
      expect(orch.shouldUseOrchestrator("List all files")).toBe(false);
    });

    it("return true for long requests even without keywords", () => {
      const orch = new Orchestrator(makeConfig());
      const longRequest = "a".repeat(201);
      expect(orch.shouldUseOrchestrator(longRequest)).toBe(true);
    });

    it("return false for short requests without keywords", () => {
      const orch = new Orchestrator(makeConfig());
      expect(orch.shouldUseOrchestrator("Fix the typo")).toBe(false);
    });
  });

  describe("execute", () => {
    it("plan, execute, and return results", async () => {
      const { posted, postMessage } = collectMessages();
      const config = makeConfig({ postMessage });
      const orch = new Orchestrator(config);

      const result = await orch.execute("Implement auth", "src/auth/");

      expect(result.totalTimeMs).toBeGreaterThan(0);
      expect(result.replanCount).toBe(0);
      expect(result.allDags).toHaveLength(1);
      expect(result.summary).toContain("Orchestration Complete");

      // Should have posted DAG visualization.
      const vizMessages = posted.filter(
        (m) => m.type === "dagVisualization",
      );
      expect(vizMessages.length).toBeGreaterThanOrEqual(1);
    });

    it("post DAG progress messages during execution", async () => {
      const { posted, postMessage } = collectMessages();
      const config = makeConfig({ postMessage });
      const orch = new Orchestrator(config);

      await orch.execute("Implement feature", "src/");

      const progressMessages = posted.filter(
        (m) => m.type === "dagProgress",
      );
      expect(progressMessages.length).toBeGreaterThanOrEqual(1);
    });

    it("handle planner failure gracefully with fallback DAG", async () => {
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
