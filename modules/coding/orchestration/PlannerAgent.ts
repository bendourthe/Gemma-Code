/**
 * PlannerAgent -- Decomposes a user request into a TaskDAG by calling the LLM.
 *
 * The agent constructs a system prompt instructing the model to produce a JSON
 * array of TaskNode objects with dependency references, then validates the
 * resulting DAG for cycles and referential integrity.
 */

import type {
  OllamaClient,
  OllamaMessage,
  OllamaOptions,
} from "../llm/types.js";
import { TaskDAG } from "./TaskDAG.js";
import type { TaskNode, TaskNodeType } from "./TaskDAG.js";
import { extractJsonFromLlmOutput } from "./utils.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_TYPES: ReadonlySet<string> = new Set<TaskNodeType>([
  "research",
  "code",
  "test",
  "verify",
]);

const PLANNER_SYSTEM_PROMPT = `You are a task planner for a coding assistant. Your job is to decompose a user's coding request into a directed acyclic graph (DAG) of subtasks.

Respond with ONLY a JSON array of task objects. No markdown, no explanation, no preamble.

Each task object must have these fields:
- "id": unique string identifier (e.g. "task_1", "task_2")
- "title": short task title
- "description": detailed description of what to do
- "type": one of "research", "code", "test", "verify"
- "dependencies": array of task IDs this task depends on (empty array if none)

Task types:
- "research": gather information, read files, search codebase
- "code": write or modify code
- "test": run tests or create test files
- "verify": review and validate changes

Rules:
- Tasks must form a DAG (no circular dependencies)
- All dependency IDs must reference other tasks in the array
- Order tasks logically: research before code, code before test, test before verify
- Keep the plan focused and minimal (3-8 tasks for most requests)

Example response:
[
  {"id": "task_1", "title": "Research current implementation", "description": "Read the existing auth module to understand the current patterns", "type": "research", "dependencies": []},
  {"id": "task_2", "title": "Implement token validation", "description": "Add JWT token validation to the auth middleware", "type": "code", "dependencies": ["task_1"]},
  {"id": "task_3", "title": "Write unit tests", "description": "Create tests for the new token validation logic", "type": "test", "dependencies": ["task_2"]},
  {"id": "task_4", "title": "Verify changes", "description": "Review all modified files for correctness and style", "type": "verify", "dependencies": ["task_3"]}
]`;

const RETRY_MESSAGE =
  "Your previous response was not valid JSON. Please respond with ONLY a JSON array of task objects as described. No markdown fences, no explanation -- just the raw JSON array.";

const DEFAULT_MAX_RETRIES = 1;

// ---------------------------------------------------------------------------
// PlannerAgent
// ---------------------------------------------------------------------------

export class PlannerAgent {
  constructor(
    private readonly _client: OllamaClient,
    private readonly _modelName: string,
    private readonly _ollamaOptions: OllamaOptions,
  ) {}

  /**
   * Decompose a user request into a TaskDAG.
   *
   * On parse failure, retries once with a correction message. On second failure,
   * returns a single-node fallback DAG containing the original request.
   */
  async plan(
    userRequest: string,
    codebaseContext: string,
  ): Promise<TaskDAG> {
    const messages: OllamaMessage[] = [
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Context:\n${codebaseContext}\n\nRequest:\n${userRequest}`,
      },
    ];

    // First attempt.
    const firstResponse = await this._callOllama(messages);
    const firstResult = this._parseResponse(firstResponse);
    if (firstResult) return firstResult;

    // Retry with correction.
    messages.push(
      { role: "assistant", content: firstResponse },
      { role: "user", content: RETRY_MESSAGE },
    );

    const secondResponse = await this._callOllama(messages);
    const secondResult = this._parseResponse(secondResponse);
    if (secondResult) return secondResult;

    // Fallback: single-node DAG.
    return this._buildFallbackDAG(userRequest);
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async _callOllama(messages: OllamaMessage[]): Promise<string> {
    const stream = this._client.streamChat({
      model: this._modelName,
      messages,
      stream: true,
      options: this._ollamaOptions,
    });

    let result = "";
    for await (const chunk of stream) {
      result += chunk.message.content ?? "";
    }
    return result;
  }

  private _parseResponse(raw: string): TaskDAG | null {
    const parsed = extractJsonFromLlmOutput(raw);
    if (!Array.isArray(parsed)) return null;

    try {
      const nodes = parsed.map((item: unknown) =>
        this._normalizeNode(item),
      );
      return new TaskDAG(nodes);
    } catch {
      return null;
    }
  }

  private _normalizeNode(item: unknown): TaskNode {
    if (typeof item !== "object" || item === null) {
      throw new Error("Task node must be an object");
    }

    const raw = item as Record<string, unknown>;

    const id = String(raw["id"] ?? "");
    const title = String(raw["title"] ?? "");
    const description = String(raw["description"] ?? "");
    const type = String(raw["type"] ?? "code");
    const dependencies = Array.isArray(raw["dependencies"])
      ? raw["dependencies"].map(String)
      : [];

    if (!id) throw new Error("Task node missing id");
    if (!VALID_TYPES.has(type)) throw new Error(`Invalid task type: ${type}`);

    return {
      id,
      title,
      description,
      type: type as TaskNodeType,
      dependencies,
      status: "pending",
      retryCount: 0,
      maxRetries: DEFAULT_MAX_RETRIES,
    };
  }

  private _buildFallbackDAG(userRequest: string): TaskDAG {
    return new TaskDAG([
      {
        id: "fallback_1",
        title: "Execute request",
        description: userRequest,
        type: "code",
        dependencies: [],
        status: "pending",
        retryCount: 0,
        maxRetries: DEFAULT_MAX_RETRIES,
      },
    ]);
  }
}
