import { randomUUID } from "crypto";
import type { Message } from "./types.js";
import type { OllamaClient, OllamaMessage, OllamaOptions } from "../ollama/types.js";

// ---------------------------------------------------------------------------
// Token estimation helper (extracted from ContextCompactor)
// ---------------------------------------------------------------------------

/** Characters-per-token heuristic for English text. */
const CHARS_PER_TOKEN = 4;

/** Multiplier for content that contains code blocks. */
const CODE_BLOCK_MULTIPLIER = 1.3;

/** Estimate the token count for an array of messages. */
export function estimateTokensForMessages(messages: readonly Message[]): number {
  let total = 0;
  for (const msg of messages) {
    const chars = msg.content.length;
    const hasCode = msg.content.includes("```");
    total += (chars / CHARS_PER_TOKEN) * (hasCode ? CODE_BLOCK_MULTIPLIER : 1);
  }
  return Math.round(total);
}

// ---------------------------------------------------------------------------
// CompactionStrategy interface
// ---------------------------------------------------------------------------

export interface CompactionStrategy {
  readonly name: string;
  canApply(messages: readonly Message[], budgetTokens: number): boolean;
  apply(messages: readonly Message[], budgetTokens: number): Promise<Message[]>;
}

// ---------------------------------------------------------------------------
// CompactionPipeline
// ---------------------------------------------------------------------------

export class CompactionPipeline {
  constructor(private readonly _strategies: readonly CompactionStrategy[]) {}

  async run(messages: readonly Message[], budgetTokens: number): Promise<Message[]> {
    let current = [...messages];
    for (const strategy of this._strategies) {
      if (estimateTokensForMessages(current) <= budgetTokens) break;
      if (!strategy.canApply(current, budgetTokens)) continue;
      current = await strategy.apply(current, budgetTokens);
    }
    return current;
  }
}

// ---------------------------------------------------------------------------
// Strategy 1: ToolResultClearing (zero cost -- regex)
// ---------------------------------------------------------------------------

/** Matches `<|tool_result>\n...\n<tool_result|>` blocks. */
const TOOL_RESULT_RE = /<\|tool_result>\n([\s\S]*?)\n<tool_result\|>/g;

/** Returns true if a message contains a tool result block. */
function hasToolResult(content: string): boolean {
  TOOL_RESULT_RE.lastIndex = 0;
  return TOOL_RESULT_RE.test(content);
}

/** Build a one-line summary from a tool result JSON body. */
function summarizeToolResult(jsonBody: string): string {
  try {
    const parsed = JSON.parse(jsonBody) as {
      name?: string;
      response?: { success?: boolean };
    };
    const name = parsed.name ?? "unknown";
    const status = parsed.response?.success === false ? "failed" : "succeeded";
    return `[Tool result cleared: ${name} ${status}]`;
  } catch {
    return "[Tool result cleared]";
  }
}

export class ToolResultClearing implements CompactionStrategy {
  readonly name = "ToolResultClearing";

  constructor(private readonly _keepRecent: number = 8) {}

  canApply(messages: readonly Message[]): boolean {
    const toolResultIndices = this._findToolResultIndices(messages);
    return toolResultIndices.length > this._keepRecent;
  }

  async apply(messages: readonly Message[]): Promise<Message[]> {
    const result = [...messages];
    const toolResultIndices = this._findToolResultIndices(result);

    // Indices are ordered oldest-first. Clear all except the last N.
    const toClear = toolResultIndices.slice(0, -this._keepRecent);

    for (const idx of toClear) {
      const msg = result[idx];
      if (!msg) continue;

      TOOL_RESULT_RE.lastIndex = 0;
      const cleared = msg.content.replace(TOOL_RESULT_RE, (_match, body: string) =>
        summarizeToolResult(body),
      );

      result[idx] = { ...msg, content: cleared };
    }

    return result;
  }

  private _findToolResultIndices(messages: readonly Message[]): number[] {
    const indices: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg && hasToolResult(msg.content)) {
        indices.push(i);
      }
    }
    return indices;
  }
}

// ---------------------------------------------------------------------------
// Strategy 2: SlidingWindow (zero cost -- filtering)
// ---------------------------------------------------------------------------

export class SlidingWindow implements CompactionStrategy {
  readonly name = "SlidingWindow";

  constructor(private readonly _keepRecent: number = 10) {}

  canApply(messages: readonly Message[]): boolean {
    const nonSystem = messages.filter((m) => m.role !== "system");
    // Need at least anchors (first msg) + more than keepRecent to have something to drop.
    return nonSystem.length > this._keepRecent + 1;
  }

  async apply(messages: readonly Message[]): Promise<Message[]> {
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    if (nonSystem.length <= this._keepRecent + 1) {
      return [...messages];
    }

    // Anchors: first non-system message + any conversation summary markers.
    const anchors = new Set<string>();
    if (nonSystem[0]) anchors.add(nonSystem[0].id);
    for (const msg of nonSystem) {
      if (msg.content.startsWith("[Conversation summary]")) {
        anchors.add(msg.id);
      }
    }

    // Tail: last N non-system messages.
    const tail = nonSystem.slice(-this._keepRecent);
    const tailIds = new Set(tail.map((m) => m.id));

    // Collect kept messages (anchors not already in tail + tail).
    const kept: Message[] = [];
    for (const msg of nonSystem) {
      if (anchors.has(msg.id) && !tailIds.has(msg.id)) {
        kept.push(msg);
      }
    }
    kept.push(...tail);

    // Sort by timestamp to maintain chronological order.
    kept.sort((a, b) => a.timestamp - b.timestamp);

    return [...systemMessages, ...kept];
  }
}

// ---------------------------------------------------------------------------
// Strategy 3: CodeBlockTruncation (zero cost -- text replacement)
// ---------------------------------------------------------------------------

/** Matches triple-backtick code fences with optional language tag. */
const CODE_BLOCK_RE = /```(\w*)\n([\s\S]*?)```/g;

export class CodeBlockTruncation implements CompactionStrategy {
  readonly name = "CodeBlockTruncation";

  constructor(private readonly _minLines: number = 80) {}

  canApply(messages: readonly Message[]): boolean {
    for (const msg of messages) {
      CODE_BLOCK_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CODE_BLOCK_RE.exec(msg.content)) !== null) {
        const body = match[2] ?? "";
        const lineCount = body.split("\n").length;
        if (lineCount > this._minLines) return true;
      }
    }
    return false;
  }

  async apply(messages: readonly Message[]): Promise<Message[]> {
    return messages.map((msg) => {
      CODE_BLOCK_RE.lastIndex = 0;
      if (!msg.content.includes("```")) return msg;

      const replaced = msg.content.replace(
        CODE_BLOCK_RE,
        (_match, lang: string, body: string) => {
          const lineCount = body.split("\n").length;
          if (lineCount <= this._minLines) {
            return _match; // Leave small blocks unchanged.
          }
          const langLabel = lang ? `, ${lang}` : "";
          return `[Code block: ${lineCount} lines${langLabel}]`;
        },
      );

      if (replaced === msg.content) return msg;
      return { ...msg, content: replaced };
    });
  }
}

// ---------------------------------------------------------------------------
// Strategy 4: LlmSummary (1 LLM call -- expensive)
// ---------------------------------------------------------------------------

const SUMMARY_PROMPT = `Summarise this conversation, preserving:
- All file paths mentioned or modified
- Key technical decisions and their rationale
- Errors encountered and how they were resolved
- Outstanding action items or incomplete tasks
- Tool calls made and their outcomes (tool name + success/failure)
Output ONLY the summary as a structured list.`;

export class LlmSummary implements CompactionStrategy {
  readonly name = "LlmSummary";

  constructor(
    private readonly _client: OllamaClient,
    private readonly _modelName: string,
    private readonly _keepRecent: number = 10,
    private readonly _ollamaOptions?: OllamaOptions,
  ) {}

  canApply(messages: readonly Message[], budgetTokens: number): boolean {
    // Only invoke the LLM if more than 5% over budget.
    return estimateTokensForMessages(messages) > budgetTokens * 1.05;
  }

  async apply(messages: readonly Message[], _budgetTokens: number): Promise<Message[]> {
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    // Build the summary request (exclude system messages).
    const historyForSummary: OllamaMessage[] = nonSystem.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    historyForSummary.push({ role: "user", content: SUMMARY_PROMPT });

    let summary = "";
    try {
      const stream = this._client.streamChat({
        model: this._modelName,
        messages: historyForSummary,
        stream: true,
        options: this._ollamaOptions,
      });

      for await (const chunk of stream) {
        summary += chunk.message.content ?? "";
      }
    } catch {
      // On LLM failure, return messages unchanged.
      return [...messages];
    }

    if (!summary.trim()) {
      return [...messages];
    }

    const summaryMessage: Message = {
      id: randomUUID(),
      role: "assistant",
      content: `[Conversation summary]\n\n${summary.trim()}`,
      timestamp: Date.now(),
    };

    // Keep last N non-system messages.
    const tail = nonSystem.slice(-this._keepRecent);

    return [...systemMessages, summaryMessage, ...tail];
  }
}

// ---------------------------------------------------------------------------
// Strategy 5: EmergencyTrim (zero cost -- hard limit)
// ---------------------------------------------------------------------------

export class EmergencyTrim implements CompactionStrategy {
  readonly name = "EmergencyTrim";

  canApply(): boolean {
    return true; // Always available as last resort.
  }

  async apply(messages: readonly Message[], budgetTokens: number): Promise<Message[]> {
    const result = [...messages];
    let i = 0;
    while (i < result.length && estimateTokensForMessages(result) > budgetTokens) {
      const msg = result[i];
      if (msg && msg.role !== "system") {
        result.splice(i, 1);
      } else {
        i++;
      }
    }
    return result;
  }
}
