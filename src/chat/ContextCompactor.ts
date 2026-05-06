import type { OllamaClient, OllamaOptions } from "../llm/types.js";
import { getLogger } from "../utils/logger.js";
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
import { DeduplicationStrategy } from "./strategies/deduplication.js";
import { PurgeErrorsStrategy } from "./strategies/purgeErrors.js";
import { RegenerateFromSource } from "./RegenerateFromSource.js";
import { calculateBudget } from "../config/PromptBudget.js";
import { Tracer } from "../observability/Tracer.js";

/**
 * The slice of `GemmaCodeSettings` the compactor reads on each invocation.
 * Provided via callback so reactivity to settings changes does not require
 * reconstructing the compactor.
 *
 * v0.7.0 Phase 3 extends the slice with the new compaction settings. The
 * fields are optional so legacy callers that constructed the compactor with
 * the v0.6.0 shape keep working; missing values fall back to safe defaults.
 */
export interface CompactionSettingsProvider {
  (): {
    compactionToolResultsKeep: number;
    compactionKeepRecent: number;
    compactionProtectedTools?: readonly string[];
    compactionProtectedFilePatterns?: readonly string[];
    compactionErrorPurgeTurns?: number;
  };
}

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
    private readonly _tracer: Tracer = new Tracer(),
    private readonly _settingsProvider: CompactionSettingsProvider = () => ({
      compactionToolResultsKeep: 3,
      compactionKeepRecent: 6,
    }),
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

    const tracer = this._tracer;
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

    const settings = this._settingsProvider();
    const budget = calculateBudget(this._maxTokens);

    // v0.7.0 Phase 3: deduplication + purge-errors run BEFORE the v0.6.0
    // strategies. Both are no-ops when there is nothing to compress, so the
    // pipeline cost stays zero in the common case.
    const protectedTools = settings.compactionProtectedTools ?? [
      "compress_range",
      "compress_message",
      "verify",
      "research",
      "memory",
      "write_file",
      "edit_file",
      "create_file",
      "delete_file",
    ];
    const protectedFilePatterns = settings.compactionProtectedFilePatterns ?? [];
    const errorPurgeTurns = settings.compactionErrorPurgeTurns ?? 4;

    const pipeline = new CompactionPipeline([
      new DeduplicationStrategy({ protectedTools, protectedFilePatterns }),
      new PurgeErrorsStrategy({ protectedTools, errorPurgeTurns }),
      new ToolResultClearing(settings.compactionToolResultsKeep),
      new SlidingWindow(settings.compactionKeepRecent),
      new CodeBlockTruncation(),
      ...(this._workspacePath
        ? [new RegenerateFromSource(this._workspacePath, 2000, settings.compactionKeepRecent)]
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
          getLogger().warn("[ContextCompactor] Post-compaction hook failed:", err);
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
