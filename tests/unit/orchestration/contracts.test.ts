import { describe, it, expect } from "vitest";
import {
  buildSubAgentRequest,
  parseSubAgentResponse,
} from "../../../src/orchestration/contracts.js";
import type {
  ResearchInput,
  CodeTaskInput,
  TestTaskInput,
  VerifyTaskInput,
  ResearchOutput,
  CodeTaskOutput,
  TestTaskOutput,
  VerifyTaskOutput,
} from "../../../src/orchestration/contracts.js";
import type { TaskNode } from "../../../src/orchestration/TaskDAG.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  type: TaskNode["type"],
  id = "task_1",
): TaskNode {
  return {
    id,
    title: `Test task ${id}`,
    description: `Description for ${id}`,
    type,
    dependencies: [],
    status: "pending",
    retryCount: 0,
    maxRetries: 1,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("contracts", () => {
  describe("buildSubAgentRequest", () => {
    it("should serialize a research input into a structured prompt", () => {
      const node = makeNode("research");
      const input: ResearchInput = {
        question: "How does the auth module work?",
        relevantFiles: ["src/auth/handler.ts"],
        searchScope: "codebase",
      };

      const prompt = buildSubAgentRequest(node, input);

      expect(prompt).toContain("## Task: Test task task_1");
      expect(prompt).toContain("**Type**: research");
      expect(prompt).toContain("How does the auth module work?");
      expect(prompt).toContain("### Required Output Format");
      expect(prompt).toContain("findings");
    });

    it("should serialize a code task input", () => {
      const node = makeNode("code");
      const input: CodeTaskInput = {
        description: "Add validation to user input",
        targetFiles: ["src/api/users.ts"],
        constraints: ["Do not modify tests"],
      };

      const prompt = buildSubAgentRequest(node, input);

      expect(prompt).toContain("**Type**: code");
      expect(prompt).toContain("Add validation to user input");
      expect(prompt).toContain("filesModified");
    });

    it("should serialize a test task input", () => {
      const node = makeNode("test");
      const input: TestTaskInput = {
        targetFiles: ["src/auth/handler.ts"],
        testCommand: "npm test",
        expectedBehavior: "All auth tests pass",
      };

      const prompt = buildSubAgentRequest(node, input);

      expect(prompt).toContain("**Type**: test");
      expect(prompt).toContain("npm test");
      expect(prompt).toContain("passed");
    });

    it("should serialize a verify task input", () => {
      const node = makeNode("verify");
      const input: VerifyTaskInput = {
        filesModified: ["src/api/users.ts"],
        originalRequest: "Add input validation",
        previousResults: ["Validation added successfully"],
      };

      const prompt = buildSubAgentRequest(node, input);

      expect(prompt).toContain("**Type**: verify");
      expect(prompt).toContain("approved");
    });
  });

  describe("parseSubAgentResponse", () => {
    describe("research", () => {
      it("should parse a valid research output", () => {
        const output: ResearchOutput = {
          findings: "The auth module uses JWT tokens",
          references: [
            { source: "src/auth/handler.ts", excerpt: "jwt.verify()" },
          ],
          confidence: "high",
        };

        const result = parseSubAgentResponse(
          "research",
          JSON.stringify(output),
        );

        expect(result).not.toBeNull();
        const r = result as ResearchOutput;
        expect(r.findings).toBe("The auth module uses JWT tokens");
        expect(r.references).toHaveLength(1);
        expect(r.confidence).toBe("high");
      });

      it("should extract from markdown fences", () => {
        const output = {
          findings: "Found in fenced block",
          references: [],
          confidence: "medium",
        };
        const raw = `Here are my findings:\n\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``;

        const result = parseSubAgentResponse("research", raw);
        expect(result).not.toBeNull();
        expect((result as ResearchOutput).findings).toBe("Found in fenced block");
      });

      it("should default confidence to medium when missing", () => {
        const raw = JSON.stringify({
          findings: "Some findings",
          references: [],
        });

        const result = parseSubAgentResponse("research", raw) as ResearchOutput;
        expect(result.confidence).toBe("medium");
      });
    });

    describe("code", () => {
      it("should parse a valid code output", () => {
        const output: CodeTaskOutput = {
          filesModified: ["src/api/users.ts"],
          summary: "Added validation",
          linesChanged: 15,
        };

        const result = parseSubAgentResponse(
          "code",
          JSON.stringify(output),
        ) as CodeTaskOutput;

        expect(result.filesModified).toEqual(["src/api/users.ts"]);
        expect(result.summary).toBe("Added validation");
        expect(result.linesChanged).toBe(15);
      });

      it("should default linesChanged to 0 when missing", () => {
        const raw = JSON.stringify({
          summary: "Changes made",
          filesModified: [],
        });

        const result = parseSubAgentResponse("code", raw) as CodeTaskOutput;
        expect(result.linesChanged).toBe(0);
      });
    });

    describe("test", () => {
      it("should parse a valid test output", () => {
        const output: TestTaskOutput = {
          passed: true,
          testOutput: "5 tests passed",
        };

        const result = parseSubAgentResponse(
          "test",
          JSON.stringify(output),
        ) as TestTaskOutput;

        expect(result.passed).toBe(true);
        expect(result.testOutput).toBe("5 tests passed");
        expect(result.failureDetails).toBeUndefined();
      });

      it("should include failure details when present", () => {
        const output: TestTaskOutput = {
          passed: false,
          testOutput: "1 test failed",
          failureDetails: "Expected 200 but got 404",
        };

        const result = parseSubAgentResponse(
          "test",
          JSON.stringify(output),
        ) as TestTaskOutput;

        expect(result.passed).toBe(false);
        expect(result.failureDetails).toBe("Expected 200 but got 404");
      });
    });

    describe("verify", () => {
      it("should parse a valid verify output", () => {
        const output: VerifyTaskOutput = {
          approved: true,
          issues: [],
        };

        const result = parseSubAgentResponse(
          "verify",
          JSON.stringify(output),
        ) as VerifyTaskOutput;

        expect(result.approved).toBe(true);
        expect(result.issues).toEqual([]);
      });

      it("should parse issues with all fields", () => {
        const output: VerifyTaskOutput = {
          approved: false,
          issues: [
            {
              file: "src/api/users.ts",
              line: 42,
              description: "Missing null check",
              severity: "error",
            },
          ],
        };

        const result = parseSubAgentResponse(
          "verify",
          JSON.stringify(output),
        ) as VerifyTaskOutput;

        expect(result.approved).toBe(false);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]!.severity).toBe("error");
      });
    });

    describe("invalid input", () => {
      it("should return null for non-JSON input", () => {
        expect(
          parseSubAgentResponse("research", "This is not JSON"),
        ).toBeNull();
      });

      it("should return null for an array instead of object", () => {
        expect(
          parseSubAgentResponse("research", "[1, 2, 3]"),
        ).toBeNull();
      });

      it("should return null for research output missing findings", () => {
        expect(
          parseSubAgentResponse(
            "research",
            JSON.stringify({ confidence: "high" }),
          ),
        ).toBeNull();
      });

      it("should return null for code output missing summary", () => {
        expect(
          parseSubAgentResponse(
            "code",
            JSON.stringify({ filesModified: [] }),
          ),
        ).toBeNull();
      });
    });
  });
});
