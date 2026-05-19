import type { OllamaClient, OllamaOptions } from "../llm/types.js";
import { getLogger } from "../../modules/coding/utils/logger.js";
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

/**
 * v0.8.0 Phase 6.1 (item A4) -- three-state sync return.
 *
 * Callers (AgentLoop, ChatCommandHandlers) inspect the state to decide
 * whether to resume the turn (`ok`), surface an error to the user (`error`),
 * or discard the in-memory conversation prefix and rebuild from the memory
 * snapshot + recent N turns (`rebuild-needed`). The `rebuild-needed` state
 * is emitted when the pipeline cannot shrink the conversation below the
 * budget even after EmergencyTrim -- the only safe recovery is a full
 * rebuild from the durable memory snapshot.
 */
export type CompactionResult =
  | { readonly state: "ok"; readonly summary: string }
  | { readonly state: "error"; readonly error: string }
  | { readonly state: "rebuild-needed"; readonly reason: string };

/** Caller-supplied rebuild context for the `rebuild-needed` state. */
export interface RebuildContext {
  readonly tokensAfter: number;
  readonly maxTokens: number;
}

/**
 * v0.9.0 Phase 2.3 (from v0.8.0 known-gaps 10.O.S) -- durable rebuild
 * snapshot provider.
 *
 * When EmergencyTrim cannot shrink the conversation under the budget, the
 * compactor calls the provider for a tail of recent messages from a
 * durable source (typically `ChatHistoryStore` -- the on-disk session
 * record). Returning `null` reproduces the pre-2.3 behaviour: surface
 * `rebuild-needed` to the caller so the operator can start a new session.
 */
export interface RebuildSnapshotProvider {
  loadLatest(sessionId: string): Promise<{
    messages: readonly Message[];
    capturedAt: number;
  } | null>;
}

export class ContextCompactor {
  private _postCompactionHook?: (sessionId: string) => Promise<void>;
  private _traceId = "";
  private _traceParentSpanId?: string;
  private _rebuildProvider: RebuildSnapshotProvider | null = null;

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

  /**
   * v0.9.0 Phase 2.3 -- supply a durable snapshot source for the rebuild
   * branch. Production callers wire `ChatHistoryStore`; tests inject an
   * in-memory fake. Passing `null` removes the wiring.
   */
  setRebuildSnapshotProvider(provider: RebuildSnapshotProvider | null): void {
    this._rebuildProvider = provider;
  }

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
  async compact(postMessage: PostMessageFn, force = false): Promise<CompactionResult> {
    if (!force && !this.shouldCompact()) {
      return { state: "ok", summary: "no-op (below threshold)" };
    }

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
      try {
        await this._preCompactionHook(this._manager.getHistory());
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        tracer.endSpan(compactSpanId, "error", { reason: "pre-hook-failed", errorMessage });
        return { state: "error", error: `Pre-compaction hook failed: ${errorMessage}` };
      }
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

    let compacted;
    try {
      // v0.9.0 Phase 2.1: feed the compaction pipeline a replay view that
      // strips Gemma 4 `<think>` blocks from assistant messages so the
      // compaction prompt is dominated by user-visible content.
      compacted = await pipeline.run(
        this._manager.replayForCompaction(),
        budget.conversationBudget,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      tracer.endSpan(compactSpanId, "error", { reason: "pipeline-failed", errorMessage });
      return { state: "error", error: `Compaction pipeline failed: ${errorMessage}` };
    }

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

    // v0.8.0 Phase 6.1: if the pipeline could not shrink below the conversation
    // budget after every strategy (including EmergencyTrim), the caller must
    // discard the in-memory prefix and rebuild from the memory snapshot.
    if (tokensAfter > this._maxTokens) {
      postMessage({
        type: "compactionStatus",
        text: "Context still over budget after compaction. Rebuilding from snapshot...",
      });
      // v0.9.0 Phase 2.3: prefer the durable snapshot path when a provider
      // is wired. Falls back to surfacing `rebuild-needed` to the caller
      // when no provider exists or the snapshot is empty.
      const sessionId = this._manager.sessionId;
      if (this._rebuildProvider && sessionId) {
        let snapshot: Awaited<ReturnType<RebuildSnapshotProvider["loadLatest"]>> = null;
        try {
          snapshot = await this._rebuildProvider.loadLatest(sessionId);
        } catch (err) {
          getLogger().warn(
            "[ContextCompactor] Rebuild snapshot provider threw:",
            err,
          );
        }
        if (snapshot && snapshot.messages.length > 0) {
          this._manager.replaceMessages(snapshot.messages);
          const stamp = new Date(snapshot.capturedAt).toISOString();
          postMessage({
            type: "compactionStatus",
            text: `[Context rebuilt from snapshot at ${stamp}]`,
          });
          setTimeout(() => {
            postMessage({ type: "compactionStatus", text: "" });
          }, 3000);
          return {
            state: "ok",
            summary: `rebuilt from snapshot captured ${stamp} (${snapshot.messages.length} messages)`,
          };
        }
      }
      setTimeout(() => {
        postMessage({ type: "compactionStatus", text: "" });
      }, 3000);
      return {
        state: "rebuild-needed",
        reason:
          this._rebuildProvider === null
            ? `tokensAfter=${tokensAfter} exceeds maxTokens=${this._maxTokens}`
            : "No durable snapshot available for this session. Start a new session.",
      };
    }

    postMessage({
      type: "compactionStatus",
      text: "Context compacted. Continuing...",
    });

    // Clear the status message after a short delay.
    setTimeout(() => {
      postMessage({ type: "compactionStatus", text: "" });
    }, 3000);

    return {
      state: "ok",
      summary: `compacted ${tokensBefore} -> ${tokensAfter} tokens`,
    };
  }
}
