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
import { RegenerateFromSource } from "./RegenerateFromSource.js";
import { calculateBudget } from "../config/PromptBudget.js";
import { getSettings } from "../config/settings.js";
import { Tracer } from "../observability/Tracer.js";

export class ContextCompactor {
  private _postCompactionHook?: (sessionId: string) => Promise<void>;
  private _traceId = "";
  private _traceParentSpanId?: string;

  constructor(
    private readonly _manager: ConversationManager,
    private readonly _client: OllamaClient,
    private readonly _modelName: string,
    private readonly _maxTokens: number,
    private readonly _ollamaOptions?: OllamaOptions,
    private readonly _preCompactionHook?: (messages: readonly Message[]) => Promise<void>,
    private readonly _compactionThreshold: number = 0.8,
    private readonly _workspacePath?: string,
  ) {}

  /** Set the trace context so compaction spans are linked to the agent trace. */
  setTraceContext(traceId: string, parentSpanId?: string): void {
    this._traceId = traceId;
    this._traceParentSpanId = parentSpanId;
  }

  /** Set a hook to run after compaction (e.g. memory consolidation). */
  setPostCompactionHook(hook: (sessionId: string) => Promise<void>): void {
    this._postCompactionHook = hook;
  }

  /** Returns the estimated token count for the current conversation. */
  estimateTokens(): number {
    return estimateTokensForMessages(this._manager.getHistory());
  }

  /** Returns true when the estimated token count has crossed the compaction threshold. */
  shouldCompact(): boolean {
    return this.estimateTokens() >= this._maxTokens * this._compactionThreshold;
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

    const tracer = Tracer.getInstance();
    const tokensBefore = this.estimateTokens();
    const compactSpanId = tracer.startSpan(
      this._traceId,
      "compact",
      "compaction",
      this._traceParentSpanId,
      { force, tokensBefore, maxTokens: this._maxTokens },
    );

    // Pre-compaction hook: invoked with the full history before any
    // compaction strategy runs. MemoryStore.extractAndSave can be wired here.
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
      ...(this._workspacePath
        ? [new RegenerateFromSource(this._workspacePath)]
        : []),
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

    // Post-compaction hook: invoked with the session id after the conversation
    // has been replaced. MemoryConsolidator.run can be wired here to promote
    // patterns detected in the just-compacted history.
    if (this._postCompactionHook) {
      const sessionId = this._manager.sessionId;
      if (sessionId) {
        await this._postCompactionHook(sessionId).catch((err) => {
          console.warn("[ContextCompactor] Post-compaction hook failed:", err);
        });
      }
    }

    const tokensAfter = this.estimateTokens();
    tracer.endSpan(compactSpanId, "ok", { tokensAfter });

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
