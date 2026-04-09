import type { OllamaClient, OllamaOptions } from "../ollama/types.js";
import type { ConversationManager } from "./ConversationManager.js";
import type { PostMessageFn } from "./StreamingPipeline.js";
import type { Message } from "./types.js";
import {
  CompactionPipeline,
  ToolResultClearing,
  SlidingWindow,
  CodeBlockTruncation,
  LlmSummary,
  EmergencyTrim,
  estimateTokensForMessages,
} from "./CompactionStrategy.js";
import { calculateBudget } from "../config/PromptBudget.js";
import { getSettings } from "../config/settings.js";

/** Fraction of maxTokens at which auto-compaction triggers. */
const COMPACTION_THRESHOLD = 0.8;

export class ContextCompactor {
  constructor(
    private readonly _manager: ConversationManager,
    private readonly _client: OllamaClient,
    private readonly _modelName: string,
    private readonly _maxTokens: number,
    private readonly _ollamaOptions?: OllamaOptions,
    private readonly _preCompactionHook?: (messages: readonly Message[]) => Promise<void>,
  ) {}

  /** Returns the estimated token count for the current conversation. */
  estimateTokens(): number {
    return estimateTokensForMessages(this._manager.getHistory());
  }

  /** Returns true when the estimated token count has crossed the compaction threshold. */
  shouldCompact(): boolean {
    return this.estimateTokens() >= this._maxTokens * COMPACTION_THRESHOLD;
  }

  /**
   * Runs the multi-strategy compaction pipeline. Strategies are applied in
   * cost order (cheapest first) until the conversation fits within the
   * conversation budget.
   *
   * @param postMessage - webview message sender for status updates
   * @param force - if true, compact regardless of the token count
   */
  async compact(postMessage: PostMessageFn, force = false): Promise<void> {
    if (!force && !this.shouldCompact()) return;

    // Pre-compaction hook (Phase 3 wires MemoryStore.extractAndSave here).
    if (this._preCompactionHook) {
      await this._preCompactionHook(this._manager.getHistory());
    }

    postMessage({
      type: "compactionStatus",
      text: "Context window approaching limit — compacting...",
    });

    const settings = getSettings();
    const budget = calculateBudget(this._maxTokens);

    const pipeline = new CompactionPipeline([
      new ToolResultClearing(settings.compactionToolResultsKeep),
      new SlidingWindow(settings.compactionKeepRecent),
      new CodeBlockTruncation(),
      new LlmSummary(
        this._client,
        this._modelName,
        settings.compactionKeepRecent,
        this._ollamaOptions,
      ),
      new EmergencyTrim(),
    ]);

    const compacted = await pipeline.run(
      this._manager.getHistory(),
      budget.conversationBudget,
    );

    this._manager.replaceMessages(compacted);

    postMessage({
      type: "compactionStatus",
      text: "Context compacted. Continuing...",
    });

    // Clear the status message after a short delay.
    setTimeout(() => {
      postMessage({ type: "compactionStatus", text: "" });
    }, 3000);
  }
}
