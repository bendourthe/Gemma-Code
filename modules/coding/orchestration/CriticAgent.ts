/**
 * CriticAgent -- reviews a worker sub-agent's output against its task before the
 * result is accepted (merged) into the DAG.
 *
 * v1.5.0 Phase 4 (item 36, closes the team-orchestration half of v1.4.0
 * `T018.P3.B`): the planner/worker layer already existed (PlannerAgent decomposes
 * a request into a TaskDAG; DAGExecutor dispatches each node to a worker
 * sub-agent). The missing piece of the Planner/Critic/Worker composition is the
 * critic: a second LLM pass that judges whether a completed worker's output
 * actually satisfies the node before the DAGExecutor marks it completed. A
 * rejected node is routed back through the existing reflexion + retry path
 * (the critic feedback becomes the failure context), so persistent rejection
 * fails the node rather than silently merging unreviewed work.
 *
 * The critic is opt-in (constructed only when swarm orchestration is enabled,
 * default off) and adds no concurrent model load: it runs after a worker
 * completes, inside that node's already-bounded execution slot, so it cannot
 * oversubscribe the single-GPU scheduler.
 */

import type {
  OllamaClient,
  OllamaMessage,
  OllamaOptions,
} from "../llm/types.js";
import type { TaskNode } from "./TaskDAG.js";
import { extractJsonFromLlmOutput } from "./utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The critic's verdict on a worker's output. */
export interface CriticVerdict {
  /** True when the output is accepted; false routes the node back to retry. */
  readonly approved: boolean;
  /** Short rationale; surfaced to reflexion as the retry context on rejection. */
  readonly feedback: string;
}

/**
 * Minimal port the DAGExecutor depends on so tests can inject a deterministic
 * fake without a live model. `CriticAgent` is the production LLM-backed
 * implementation.
 */
export interface CriticReviewer {
  review(node: TaskNode, output: string): Promise<CriticVerdict>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CRITIC_SYSTEM_PROMPT = `You are a critic reviewing whether a worker agent's output satisfies its assigned task in a multi-agent coding workflow.

Respond with ONLY a JSON object. No markdown, no explanation, no preamble.

The object must have these fields:
- "approved": boolean -- true if the output adequately completes the task, false if it is wrong, incomplete, off-topic, or failed
- "feedback": string -- one or two sentences. When rejecting, state concretely what is missing or wrong so the worker can fix it on retry. When approving, a brief confirmation.

Be strict but fair: approve work that genuinely addresses the task; reject work that is empty, hallucinated, ignores the task, or leaves the stated goal unmet.

Example response:
{"approved": false, "feedback": "The task asked for token validation but the output only added a logging statement. Add the JWT signature check."}`;

/**
 * Fail-open default. A critic that cannot produce a parseable verdict (model
 * error, malformed JSON) must NOT block otherwise-successful work -- the worker
 * already succeeded; the critic is an additional gate, not a hard dependency.
 */
const FAIL_OPEN_VERDICT: CriticVerdict = {
  approved: true,
  feedback: "Critic produced no parseable verdict; accepting the worker output.",
};

// ---------------------------------------------------------------------------
// Pure parser (unit-tested directly)
// ---------------------------------------------------------------------------

/**
 * Parse the critic's raw model output into a verdict. Tolerant of markdown
 * fences and preamble (reuses `extractJsonFromLlmOutput`). Returns the
 * fail-open verdict when no `{ "approved": ... }` object can be recovered, so a
 * parse failure never blocks a successful worker.
 */
export function parseCriticVerdict(raw: string): CriticVerdict {
  const parsed = extractJsonFromLlmOutput(raw);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>)["approved"] !== "boolean"
  ) {
    return FAIL_OPEN_VERDICT;
  }
  const obj = parsed as Record<string, unknown>;
  const feedback =
    typeof obj["feedback"] === "string" ? (obj["feedback"] as string) : "";
  return { approved: obj["approved"] as boolean, feedback };
}

// ---------------------------------------------------------------------------
// CriticAgent
// ---------------------------------------------------------------------------

export class CriticAgent implements CriticReviewer {
  constructor(
    private readonly _client: OllamaClient,
    private readonly _modelName: string,
    private readonly _ollamaOptions: OllamaOptions,
  ) {}

  async review(node: TaskNode, output: string): Promise<CriticVerdict> {
    const messages: OllamaMessage[] = [
      { role: "system", content: CRITIC_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Task: ${node.title}`,
          node.description,
          ``,
          `Worker output:`,
          output.length > 0 ? output : "(empty)",
          ``,
          `Respond with ONLY the JSON verdict object.`,
        ].join("\n"),
      },
    ];

    const raw = await this._callOllama(messages);
    return parseCriticVerdict(raw);
  }

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
}
