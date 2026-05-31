/**
 * Structured input/output contracts for communication between the
 * orchestrator and specialist sub-agents.
 *
 * Each TaskNode type has a typed input contract (what the sub-agent receives)
 * and output contract (what it must return). This replaces free-text
 * SubAgentConfig.userRequest with structured, validated payloads.
 */

import type { TaskNode, TaskNodeType } from "./TaskDAG.js";
import { extractJsonFromLlmOutput } from "./utils.js";

// ---------------------------------------------------------------------------
// Input contracts
// ---------------------------------------------------------------------------

export interface ResearchInput {
  readonly question: string;
  readonly relevantFiles?: readonly string[];
  readonly searchScope?: "codebase" | "web" | "both";
}

export interface CodeTaskInput {
  readonly description: string;
  readonly targetFiles: readonly string[];
  readonly constraints?: readonly string[];
  readonly dependencyResults?: Readonly<Record<string, string>>;
}

export interface TestTaskInput {
  readonly targetFiles: readonly string[];
  readonly testCommand?: string;
  readonly expectedBehavior: string;
}

export interface VerifyTaskInput {
  readonly filesModified: readonly string[];
  readonly originalRequest: string;
  readonly previousResults: readonly string[];
}

export type TaskInput =
  | ResearchInput
  | CodeTaskInput
  | TestTaskInput
  | VerifyTaskInput;

// ---------------------------------------------------------------------------
// Output contracts
// ---------------------------------------------------------------------------

export interface ResearchOutput {
  readonly findings: string;
  readonly references: ReadonlyArray<{
    readonly source: string;
    readonly excerpt: string;
  }>;
  readonly confidence: "high" | "medium" | "low";
}

export interface CodeTaskOutput {
  readonly filesModified: readonly string[];
  readonly summary: string;
  readonly linesChanged: number;
}

export interface TestTaskOutput {
  readonly passed: boolean;
  readonly testOutput: string;
  readonly failureDetails?: string;
}

export interface VerifyTaskOutput {
  readonly approved: boolean;
  readonly issues: ReadonlyArray<{
    readonly file: string;
    readonly line?: number;
    readonly description: string;
    readonly severity: "error" | "warning";
  }>;
}

export type TaskOutput =
  | ResearchOutput
  | CodeTaskOutput
  | TestTaskOutput
  | VerifyTaskOutput;

// ---------------------------------------------------------------------------
// Output schema descriptions (injected into sub-agent prompts)
// ---------------------------------------------------------------------------

const OUTPUT_SCHEMAS: Record<TaskNodeType, string> = {
  research: JSON.stringify(
    {
      findings: "<string: your findings>",
      references: [{ source: "<file or URL>", excerpt: "<relevant excerpt>" }],
      confidence: "high | medium | low",
    },
    null,
    2,
  ),
  code: JSON.stringify(
    {
      filesModified: ["<file path>"],
      summary: "<what was changed>",
      linesChanged: 0,
    },
    null,
    2,
  ),
  test: JSON.stringify(
    {
      passed: true,
      testOutput: "<test runner output>",
      failureDetails: "<optional: failure details>",
    },
    null,
    2,
  ),
  verify: JSON.stringify(
    {
      approved: true,
      issues: [
        {
          file: "<file path>",
          line: 0,
          description: "<issue description>",
          severity: "error | warning",
        },
      ],
    },
    null,
    2,
  ),
};

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Serialize a TaskInput into a structured prompt string that instructs the
 * sub-agent to respond with JSON matching the output schema.
 */
export function buildSubAgentRequest(
  node: TaskNode,
  input: TaskInput,
): string {
  const inputJson = JSON.stringify(input, null, 2);
  const outputSchema = OUTPUT_SCHEMAS[node.type];

  return [
    `## Task: ${node.title}`,
    ``,
    `**Type**: ${node.type}`,
    `**Description**: ${node.description}`,
    ``,
    `### Input`,
    "```json",
    inputJson,
    "```",
    ``,
    `### Required Output Format`,
    `Respond with ONLY a JSON object matching this schema:`,
    "```json",
    outputSchema,
    "```",
    ``,
    `Do not include any text outside the JSON object.`,
  ].join("\n");
}

/**
 * Extract and parse a structured TaskOutput from a sub-agent's raw text output.
 * Returns null if the output cannot be parsed.
 */
export function parseSubAgentResponse(
  type: TaskNodeType,
  rawOutput: string,
): TaskOutput | null {
  const parsed = extractJsonFromLlmOutput(rawOutput);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  switch (type) {
    case "research":
      return _validateResearchOutput(obj);
    case "code":
      return _validateCodeOutput(obj);
    case "test":
      return _validateTestOutput(obj);
    case "verify":
      return _validateVerifyOutput(obj);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Validators (lenient: coerce missing fields to defaults)
// ---------------------------------------------------------------------------

function _validateResearchOutput(
  obj: Record<string, unknown>,
): ResearchOutput | null {
  if (typeof obj["findings"] !== "string") return null;

  const references = Array.isArray(obj["references"])
    ? (obj["references"] as Array<Record<string, unknown>>).map((r) => ({
        source: String(r["source"] ?? ""),
        excerpt: String(r["excerpt"] ?? ""),
      }))
    : [];

  const confidence = ["high", "medium", "low"].includes(
    String(obj["confidence"]),
  )
    ? (String(obj["confidence"]) as "high" | "medium" | "low")
    : "medium";

  return { findings: obj["findings"] as string, references, confidence };
}

function _validateCodeOutput(
  obj: Record<string, unknown>,
): CodeTaskOutput | null {
  if (typeof obj["summary"] !== "string") return null;

  return {
    filesModified: Array.isArray(obj["filesModified"])
      ? (obj["filesModified"] as unknown[]).map(String)
      : [],
    summary: obj["summary"] as string,
    linesChanged:
      typeof obj["linesChanged"] === "number" ? obj["linesChanged"] : 0,
  };
}

function _validateTestOutput(
  obj: Record<string, unknown>,
): TestTaskOutput | null {
  return {
    passed: Boolean(obj["passed"]),
    testOutput: String(obj["testOutput"] ?? ""),
    failureDetails:
      typeof obj["failureDetails"] === "string"
        ? obj["failureDetails"]
        : undefined,
  };
}

function _validateVerifyOutput(
  obj: Record<string, unknown>,
): VerifyTaskOutput | null {
  const issues = Array.isArray(obj["issues"])
    ? (obj["issues"] as Array<Record<string, unknown>>).map((issue) => ({
        file: String(issue["file"] ?? ""),
        line:
          typeof issue["line"] === "number" ? issue["line"] : undefined,
        description: String(issue["description"] ?? ""),
        severity: (
          ["error", "warning"].includes(String(issue["severity"]))
            ? String(issue["severity"])
            : "warning"
        ) as "error" | "warning",
      }))
    : [];

  return { approved: Boolean(obj["approved"]), issues };
}
