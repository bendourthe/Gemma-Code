import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../../src/orchestration/PlannerAgent.js";
import type { OllamaClient } from "../../../src/ollama/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(responseText: string): OllamaClient {
  async function* gen() {
    yield { message: { content: responseText, role: "assistant" }, done: true };
  }
  return {
    streamChat: vi.fn().mockReturnValue(gen()),
    checkHealth: vi.fn(),
    listModels: vi.fn(),
  } as unknown as OllamaClient;
}

function makeMultiClient(responses: string[]): OllamaClient {
  let callCount = 0;
  const streamChat = vi.fn(() => {
    const text = responses[callCount++] ?? "";
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

const VALID_JSON_RESPONSE = JSON.stringify([
  {
    id: "task_1",
    title: "Research",
    description: "Read the code",
    type: "research",
    dependencies: [],
  },
  {
    id: "task_2",
    title: "Code",
    description: "Write the code",
    type: "code",
    dependencies: ["task_1"],
  },
  {
    id: "task_3",
    title: "Test",
    description: "Run tests",
    type: "test",
    dependencies: ["task_2"],
  },
]);

const FENCED_JSON_RESPONSE = `Here is the plan:

\`\`\`json
${VALID_JSON_RESPONSE}
\`\`\`

That should work!`;

const ollamaOptions = { num_ctx: 131072, temperature: 1.0 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlannerAgent", () => {
  describe("plan", () => {
    it("should parse a clean JSON response into a TaskDAG", async () => {
      const client = makeClient(VALID_JSON_RESPONSE);
      const agent = new PlannerAgent(client, "gemma4:e4b", ollamaOptions);

      const dag = await agent.plan("Implement auth", "src/auth/");

      const progress = dag.getProgress();
      expect(progress.total).toBe(3);
      expect(progress.pending).toBe(3);

      const nodes = dag.getNodes();
      expect(nodes[0]!.type).toBe("research");
      expect(nodes[1]!.dependencies).toEqual(["task_1"]);
    });

    it("should extract JSON from markdown fences", async () => {
      const client = makeClient(FENCED_JSON_RESPONSE);
      const agent = new PlannerAgent(client, "gemma4:e4b", ollamaOptions);

      const dag = await agent.plan("Implement auth", "src/auth/");
      expect(dag.getProgress().total).toBe(3);
    });

    it("should retry once on parse failure and succeed on second attempt", async () => {
      const client = makeMultiClient([
        "I cannot produce JSON right now, sorry!",
        VALID_JSON_RESPONSE,
      ]);
      const agent = new PlannerAgent(client, "gemma4:e4b", ollamaOptions);

      const dag = await agent.plan("Implement auth", "src/auth/");
      expect(dag.getProgress().total).toBe(3);
      expect(client.streamChat).toHaveBeenCalledTimes(2);
    });

    it("should return fallback single-node DAG after two parse failures", async () => {
      const client = makeMultiClient([
        "Not valid JSON",
        "Still not valid JSON",
      ]);
      const agent = new PlannerAgent(client, "gemma4:e4b", ollamaOptions);

      const dag = await agent.plan("Fix the bug", "src/");
      expect(dag.getProgress().total).toBe(1);

      const nodes = dag.getNodes();
      expect(nodes[0]!.id).toBe("fallback_1");
      expect(nodes[0]!.description).toBe("Fix the bug");
    });

    it("should reject cyclic DAGs from the LLM and fall through to retry", async () => {
      const cyclicResponse = JSON.stringify([
        {
          id: "a",
          title: "A",
          description: "A",
          type: "code",
          dependencies: ["b"],
        },
        {
          id: "b",
          title: "B",
          description: "B",
          type: "code",
          dependencies: ["a"],
        },
      ]);
      const client = makeMultiClient([cyclicResponse, VALID_JSON_RESPONSE]);
      const agent = new PlannerAgent(client, "gemma4:e4b", ollamaOptions);

      const dag = await agent.plan("Build feature", "src/");
      // First attempt is cyclic -> rejected -> retry with valid response.
      expect(dag.getProgress().total).toBe(3);
      expect(client.streamChat).toHaveBeenCalledTimes(2);
    });

    it("should handle empty array from LLM gracefully", async () => {
      const client = makeClient("[]");
      const agent = new PlannerAgent(client, "gemma4:e4b", ollamaOptions);

      const dag = await agent.plan("Do something", "src/");
      // Empty array is a valid DAG with 0 nodes.
      expect(dag.getProgress().total).toBe(0);
    });

    it("should set maxRetries to 1 and retryCount to 0 on all nodes", async () => {
      const client = makeClient(VALID_JSON_RESPONSE);
      const agent = new PlannerAgent(client, "gemma4:e4b", ollamaOptions);

      const dag = await agent.plan("Build feature", "src/");
      for (const node of dag.getNodes()) {
        expect(node.maxRetries).toBe(1);
        expect(node.retryCount).toBe(0);
      }
    });

    it("should handle invalid node types by rejecting the response", async () => {
      const invalidType = JSON.stringify([
        {
          id: "task_1",
          title: "Bad",
          description: "Bad type",
          type: "unknown_type",
          dependencies: [],
        },
      ]);
      const client = makeMultiClient([invalidType, VALID_JSON_RESPONSE]);
      const agent = new PlannerAgent(client, "gemma4:e4b", ollamaOptions);

      const dag = await agent.plan("Build feature", "src/");
      // Invalid type -> retry -> valid response.
      expect(dag.getProgress().total).toBe(3);
    });
  });
});
