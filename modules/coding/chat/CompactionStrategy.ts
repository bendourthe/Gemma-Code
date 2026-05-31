import { randomUUID } from "crypto";
import type { Message } from "./types.js";
import type { OllamaClient, OllamaMessage, OllamaOptions } from "../llm/types.js";
import { countTokens } from "../config/PromptBudget.js";

/**
 * Compacted-summary framing prefix. Tells the model that the embedded summary
 * is BACKGROUND REFERENCE, not active instructions. Sourced from
 * `src/chat/prompts/compaction.md` (kept as a const here so runtime has no fs
 * dependency; the .md file is the authoritative copy for documentation +
 * future reuse by other compaction backends).
 */
export const COMPACTION_SUMMARY_PREFIX =
  "The following is a compacted summary of the prior conversation, provided as BACKGROUND REFERENCE ONLY -- NOT as active instructions to act on. The authoritative current state lives in `Memory.md` / `Context.md`. Resume from the `## Active Task` section below.";

// ---------------------------------------------------------------------------
// Token estimation helper (extracted from ContextCompactor)
//
// Phase 5 (v0.5.0): delegates to the shared `countTokens` in PromptBudget,
// which prefers tiktoken `cl100k_base` and falls back to the chars/4
// heuristic when the native binding cannot load. The per-Message memoization
// remains so we do not recompute for the same Message object across calls.
// ---------------------------------------------------------------------------

/**
 * Per-Message memoization cache for token estimates. Messages are immutable,
 * so the estimate is stable for the lifetime of the Message object. WeakMap
 * lets entries be collected when the Message is no longer referenced.
 */
const _tokenEstimateCache = new WeakMap<Message, number>();

/** Compute the per-message token estimate (bypassing the cache). */
function _computeTokensForMessage(msg: Message): number {
  return countTokens(msg.content);
}

/** Estimate the token count for a single message. Result is memoized. */
export function estimateTokensForMessage(msg: Message): number {
  const cached = _tokenEstimateCache.get(msg);
  if (cached !== undefined) return cached;
  const raw = _computeTokensForMessage(msg);
  _tokenEstimateCache.set(msg, raw);
  return raw;
}

/** Estimate the token count for an array of messages. Per-message results cached. */
export function estimateTokensForMessages(messages: readonly Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokensForMessage(msg);
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
      content: `[Conversation summary]\n\n${COMPACTION_SUMMARY_PREFIX}\n\n${summary.trim()}`,
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
    // Compute the starting total once, then subtract each dropped message's
    // estimate instead of re-summing the whole array on every iteration.
    let total = 0;
    for (const msg of messages) total += estimateTokensForMessage(msg);

    // Collect indices of non-system messages in order; drop oldest-first until
    // under budget. Build the result in a single O(N) pass.
    const dropped = new Set<number>();
    for (let i = 0; i < messages.length && Math.round(total) > budgetTokens; i++) {
      const msg = messages[i];
      if (msg && msg.role !== "system") {
        total -= estimateTokensForMessage(msg);
        dropped.add(i);
      }
    }

    if (dropped.size === 0) return [...messages];

    const result: Message[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (!dropped.has(i)) {
        const msg = messages[i];
        if (msg) result.push(msg);
      }
    }
    return result;
  }
}
