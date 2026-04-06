import type { OllamaClient, OllamaMessage } from "../ollama/types.js";
import type { ConversationManager } from "./ConversationManager.js";
import type { PostMessageFn } from "./StreamingPipeline.js";

/** Fraction of maxTokens at which auto-compaction triggers. */
const COMPACTION_THRESHOLD = 0.8;

/** Characters-per-token heuristic for English text. */
const CHARS_PER_TOKEN = 4;

/** Multiplier for content that contains code blocks. */
const CODE_BLOCK_MULTIPLIER = 1.3;

/** Number of most-recent non-system messages to preserve after compaction. */
const PRESERVED_MESSAGES = 4;

export class ContextCompactor {
  constructor(
    private readonly _manager: ConversationManager,
    private readonly _client: OllamaClient,
    private readonly _modelName: string,
    private readonly _maxTokens: number
  ) {}

  /** Returns the estimated token count for the current conversation. */
  estimateTokens(): number {
    const history = this._manager.getHistory();
    let total = 0;
    for (const msg of history) {
      const chars = msg.content.length;
      const hasCode = msg.content.includes("```");
      total += (chars / CHARS_PER_TOKEN) * (hasCode ? CODE_BLOCK_MULTIPLIER : 1);
    }
    return Math.round(total);
  }

  /** Returns true when the estimated token count has crossed the compaction threshold. */
  shouldCompact(): boolean {
    return this.estimateTokens() >= this._maxTokens * COMPACTION_THRESHOLD;
  }

  /**
   * Runs compaction: summarises the conversation, then replaces the history
   * with the summary plus the most recent messages.
   *
   * @param postMessage - webview message sender for status updates
   * @param force - if true, compact regardless of the token count
   */
  async compact(postMessage: PostMessageFn, force = false): Promise<void> {
    if (!force && !this.shouldCompact()) return;

    postMessage({
      type: "compactionStatus",
      text: "Context window approaching limit — compacting…",
    });

    // Build a minimal conversation that only asks for a summary.
    const historyForSummary: OllamaMessage[] = this._manager
      .getHistory()
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    historyForSummary.push({
      role: "user",
      content:
        "Summarise the conversation so far in a single concise paragraph, preserving all technical decisions, file paths, and action items. Output ONLY the summary.",
    });

    let summary = "";
    try {
      const stream = this._client.streamChat({
        model: this._modelName,
        messages: historyForSummary,
        stream: true,
      });

      for await (const chunk of stream) {
        summary += chunk.message.content ?? "";
      }
    } catch {
      // If compaction fails, clear the status and continue without compacting.
      postMessage({ type: "compactionStatus", text: "" });
      return;
    }

    this._manager.replaceWithSummary(summary.trim(), PRESERVED_MESSAGES);

    postMessage({
      type: "compactionStatus",
      text: "Context compacted. Continuing…",
    });

    // Clear the status message after a short delay.
    setTimeout(() => {
      postMessage({ type: "compactionStatus", text: "" });
    }, 3000);
  }
}
