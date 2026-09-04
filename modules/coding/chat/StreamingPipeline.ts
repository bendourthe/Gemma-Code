import type {
  OllamaClient,
  OllamaMessage,
  OllamaOptions,
  OllamaToolDefinition,
} from "../llm/types.js";
import { OllamaError } from "../llm/types.js";
import type { ConversationManager } from "./ConversationManager.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";
import { formatForUser } from "../utils/errors.js";
import { MemoryContextScrubber } from "./MemoryContextScrubber.js";
import { Gemma4StreamScrubber, parseChannel } from "../llm/Gemma4Parser.js";
import { ToolCallStreamParser } from "./ToolCallStreamParser.js";
import { toLlmMessages } from "./llmMessages.js";
import { isVisionCapableModel } from "../config/ModelCapabilities.js";

export type PostMessageFn = (message: ExtensionToWebviewMessage) => void;

/**
 * v0.9.0 Phase 2.7 -- callback that derives the keep_alive hint for the
 * model about to stream. Returning `null` skips the field entirely so the
 * legacy code path (Ollama's default 5-minute idle eviction) is preserved
 * when no `ModelPinRegistry` is wired.
 */
export type KeepAliveResolver = (model: string) => number | string | null;

/** Maximum number of retry attempts after an early stream failure (< 3 tokens). */
const MAX_RETRIES = 1;

/** A stream is considered "early failure" if fewer than this many tokens arrived. */
const EARLY_FAILURE_TOKEN_THRESHOLD = 3;

export class StreamingPipeline {
  private _abortController: AbortController | null = null;
  private readonly _resolveKeepAlive: KeepAliveResolver | null;

  constructor(
    private readonly _client: OllamaClient,
    private readonly _manager: ConversationManager,
    private _modelName: string,
    private readonly _runAgentLoop?: (
      postMessage: PostMessageFn,
    ) => Promise<void>,
    private readonly _ollamaOptions?: OllamaOptions,
    private readonly _tools?: OllamaToolDefinition[],
    resolveKeepAlive?: KeepAliveResolver | null,
  ) {
    this._resolveKeepAlive = resolveKeepAlive ?? null;
  }

  /** Abort any in-flight stream request. */
  cancel(): void {
    this._abortController?.abort();
  }

  /**
   * v2.4.6 Phase 4 -- follow the coding model picker without rebuilding the
   * pipeline graph (skills, hooks, and the agent loop stay attached).
   */
  setModelName(modelName: string): void {
    this._modelName = modelName;
  }

  /**
   * Send a user message through the pipeline:
   * 1. Record the user message in the ConversationManager.
   * 2. Stream from Ollama, posting token updates to the webview.
   * 3. Commit the assistant response on completion.
   * Always posts `status: idle` when done, even on error.
   *
   * v0.7.0 Phase 4.5 -- emits `renderThoughtMetaRow` around the thinking
   * phase so the webview can replace the legacy three-dots indicator with a
   * "Thinking..." -> "Thought for Ns" meta-row.
   */
  async send(
    text: string,
    postMessage: PostMessageFn,
    images?: readonly string[],
  ): Promise<void> {
    this._manager.addUserMessage(text, images);
    const thinkStart = Date.now();
    postMessage({ type: "status", state: "thinking" });
    postMessage({
      type: "renderThoughtMetaRow",
      status: "thinking",
      durationMs: null,
    });

    try {
      if (this._runAgentLoop !== undefined) {
        await this._runAgentLoop(postMessage);
      } else {
        await this._attemptStream(postMessage);
      }
    } finally {
      postMessage({
        type: "renderThoughtMetaRow",
        status: "complete",
        durationMs: Date.now() - thinkStart,
      });
      postMessage({ type: "status", state: "idle" });
    }
  }

  private async _attemptStream(postMessage: PostMessageFn): Promise<void> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      this._abortController = new AbortController();
      let tokenCount = 0;
      let accumulated = "";
      // v0.8.0 Phase 2 (item A2): strip <memory-context> spans from the
      // streamed tokens. The scrubber holds back partial-tag tails across
      // chunk boundaries so a tag split between chunks does not leak.
      const scrubber = new MemoryContextScrubber();
      // v0.9.0 Phase 2.1: strip Gemma 4 channel tokens (think / tool_response
      // blocks, turn separators) from the visible stream.
      const channelScrubber = new Gemma4StreamScrubber();
      // v0.9.0 Phase 2.9: forward toolCallHeader / toolCallArgDelta /
      // toolCallComplete events to the webview so the progressive tool-call
      // card can render before the model finishes the call.
      const toolCallParser = new ToolCallStreamParser();

      try {
        // v1.5.0 Phase 5 (item 33): forward image attachments only when the
        // active model is vision-capable; text-only models get a clean
        // text-only request.
        const ollamaMessages: OllamaMessage[] = toLlmMessages(
          this._manager.getHistory(),
          isVisionCapableModel(this._modelName),
        );

        postMessage({ type: "status", state: "streaming" });

        const keepAlive = this._resolveKeepAlive?.(this._modelName) ?? null;
        const request: Parameters<typeof this._client.streamChat>[0] = {
          model: this._modelName,
          messages: ollamaMessages,
          stream: true,
          ...(this._ollamaOptions ? { options: this._ollamaOptions } : {}),
          ...(this._tools ? { tools: this._tools } : {}),
          ...(keepAlive !== null ? { keep_alive: keepAlive } : {}),
        };
        const stream = this._client.streamChat(
          request,
          this._abortController.signal,
        );

        for await (const chunk of stream) {
          const token = chunk.message.content;
          if (token) {
            const memCleaned = scrubber.feed(token);
            if (memCleaned) {
              const channelCleaned = channelScrubber.feed(memCleaned);
              const events = toolCallParser.feed(channelCleaned);
              for (const ev of events) postMessage(ev);
              if (channelCleaned) {
                postMessage({ type: "token", value: channelCleaned });
                accumulated += channelCleaned;
                tokenCount++;
              }
            }
          }
        }

        const memTail = scrubber.flush();
        const channelTail =
          channelScrubber.feed(memTail) + channelScrubber.flush();
        const tailEvents = [
          ...toolCallParser.feed(channelTail),
          ...toolCallParser.flush(),
        ];
        for (const ev of tailEvents) postMessage(ev);
        if (channelTail) {
          postMessage({ type: "token", value: channelTail });
          accumulated += channelTail;
        }

        // v0.9.0 Phase 2.1: persist only the visible channel so replay /
        // compaction does not re-feed hidden reasoning into the next prompt.
        const visible = parseChannel(accumulated).visible || accumulated;
        const msg = this._manager.addAssistantMessage(visible);
        // renderedHtml is populated by NexusCodingPanel's postMessage interceptor.
        postMessage({
          type: "messageComplete",
          messageId: msg.id,
          renderedHtml: "",
        });
        return;
      } catch (err) {
        if (this._abortController.signal.aborted) {
          postMessage({ type: "error", text: "Stream cancelled." });
          return;
        }

        const isEarlyFailure = tokenCount < EARLY_FAILURE_TOKEN_THRESHOLD;
        if (attempt < MAX_RETRIES && isEarlyFailure) {
          // Signal webview to discard partial tokens before retrying
          postMessage({ type: "status", state: "thinking" });
          continue;
        }

        postMessage({ type: "error", text: this._humanizeError(err) });
        return;
      } finally {
        this._abortController = null;
      }
    }
  }

  private _humanizeError(err: unknown): string {
    if (err instanceof OllamaError) {
      if (err.statusCode === 404) {
        return (
          `Model not found. Run \`ollama pull ${this._modelName}\`` +
          " in your terminal, then try again."
        );
      }
      if (err.statusCode === 0 || err.message.toLowerCase().includes("fetch")) {
        return "Cannot reach Ollama. Make sure `ollama serve` is running on your machine.";
      }
      return `Ollama error (${err.statusCode}): ${err.message}`;
    }
    if (err instanceof Error && err.name === "AbortError") {
      return "Request timed out. Try a shorter prompt or check if Ollama is overloaded.";
    }
    return formatForUser(err);
  }
}
