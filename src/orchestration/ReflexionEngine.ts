/**
 * ReflexionEngine -- Generates textual self-reflections when sub-agent tasks
 * fail, stores them in episodic memory, and builds retry context to improve
 * subsequent attempts.
 *
 * Implements the Reflexion pattern: on failure, analyze the root cause, extract
 * negative constraints, and inject them into the next retry's context.
 */

import type {
  OllamaClient,
  OllamaMessage,
  OllamaOptions,
} from "../ollama/types.js";
import type { MemoryStore } from "../storage/MemoryStore.js";
import type { TaskNode } from "./TaskDAG.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Reflection {
  readonly taskId: string;
  readonly analysis: string;
  readonly constraints: readonly string[];
  readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONSTRAINT_PATTERN =
  /(?:^|\.\s+)((?:Do not|Avoid|Instead|Make sure|Ensure)[^.]+\.)/gi;

// ---------------------------------------------------------------------------
// ReflexionEngine
// ---------------------------------------------------------------------------

export class ReflexionEngine {
  constructor(
    private readonly _client: OllamaClient,
    private readonly _modelName: string,
    private readonly _ollamaOptions: OllamaOptions,
    private readonly _memoryStore: MemoryStore | null,
  ) {}

  /**
   * Generate a reflection analyzing why a task failed and what to do differently.
   */
  async reflect(
    failedTask: TaskNode,
    error: string,
    context: string,
  ): Promise<Reflection> {
    const messages: OllamaMessage[] = [
      {
        role: "system",
        content:
          "You are a coding assistant analyzing why a task failed. Be concise and actionable.",
      },
      {
        role: "user",
        content: [
          `A coding task failed.`,
          `Task: ${failedTask.description}`,
          `Error: ${error}`,
          `Context: ${context}`,
          ``,
          `Analyze the root cause in 2-3 sentences. What went wrong and what should be done differently on retry?`,
        ].join("\n"),
      },
    ];

    const analysis = await this._callOllama(messages);
    const constraints = this._extractConstraints(analysis);

    return {
      taskId: failedTask.id,
      analysis,
      constraints,
      timestamp: Date.now(),
    };
  }

  /**
   * Persist the reflection analysis in the memory store as an error_resolution entry.
   */
  async storeReflection(
    reflection: Reflection,
    sessionId?: string,
  ): Promise<void> {
    if (!this._memoryStore) return;
    await this._memoryStore.save(
      reflection.analysis,
      "error_resolution",
      sessionId,
    );
  }

  /**
   * Format accumulated reflections for a failed task into context for the retry.
   */
  buildRetryContext(reflections: readonly Reflection[]): string {
    if (reflections.length === 0) return "";

    const lines = reflections.map((r, i) => {
      const constraintText =
        r.constraints.length > 0
          ? `\n  Constraints: ${r.constraints.join("; ")}`
          : "";
      return `- Attempt ${i + 1}: ${r.analysis}${constraintText}`;
    });

    return `## Previous Attempt Failures\n\n${lines.join("\n")}`;
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

  private _extractConstraints(text: string): string[] {
    const constraints: string[] = [];
    let match: RegExpExecArray | null;

    // Reset lastIndex for global regex.
    CONSTRAINT_PATTERN.lastIndex = 0;
    while ((match = CONSTRAINT_PATTERN.exec(text)) !== null) {
      const constraint = match[1]?.trim();
      if (constraint) {
        constraints.push(constraint);
      }
    }

    return constraints;
  }
}
