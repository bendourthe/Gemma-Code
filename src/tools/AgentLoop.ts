import type { OllamaClient, OllamaMessage } from "../ollama/types.js";
import type { ConversationManager } from "../chat/ConversationManager.js";
import type { PostMessageFn } from "../chat/StreamingPipeline.js";
import type { ContextCompactor } from "../chat/ContextCompactor.js";
import { parseToolCalls, hasToolCall, stripToolCalls, formatToolResult } from "./ToolCallParser.js";
import type { ToolRegistry } from "./ToolRegistry.js";

const DEFAULT_MAX_ITERATIONS = 20;

export class AgentLoop {
  private _cancelled = false;
  private _abortController: AbortController | null = null;

  constructor(
    private readonly _client: OllamaClient,
    private readonly _manager: ConversationManager,
    private readonly _registry: ToolRegistry,
    private readonly _modelName: string,
    private readonly _maxIterations: number = DEFAULT_MAX_ITERATIONS,
    private readonly _compactor?: ContextCompactor
  ) {}

  cancel(): void {
    this._cancelled = true;
    this._abortController?.abort();
  }

  /**
   * Run the agentic loop:
   *  1. Stream a model response.
   *  2. If the response contains tool calls, execute them and loop.
   *  3. If no tool calls remain, commit the message and stop.
   *  4. Stop after maxIterations to prevent infinite loops.
   *  5. After the final response, trigger auto-compaction if needed.
   */
  async run(postMessage: PostMessageFn): Promise<void> {
    // If cancel() was called before run() (e.g. a stale cancel from the prior session),
    // honour it: exit immediately and reset so the next call can proceed.
    if (this._cancelled) {
      this._cancelled = false;
      return;
    }
    this._cancelled = false;

    for (let iteration = 0; iteration < this._maxIterations; iteration++) {
      if (this._cancelled) return;

      // Stream the next model response.
      const accumulated = await this._streamOneTurn(postMessage);

      if (accumulated === null) {
        // Stream was cancelled or errored; _streamOneTurn already posted the error.
        return;
      }

      if (!hasToolCall(accumulated)) {
        // No tool calls → final response. Commit and finish.
        const msg = this._manager.addAssistantMessage(accumulated);
        postMessage({ type: "messageComplete", messageId: msg.id, renderedHtml: "" });

        // Post updated token count.
        this._postTokenCount(postMessage);

        // Run auto-compaction if the context is getting large.
        if (this._compactor) {
          await this._compactor.compact(postMessage);
        }

        return;
      }

      // Commit the assistant's "reasoning" turn with tool calls stripped.
      this._manager.addAssistantMessage(stripToolCalls(accumulated));

      // Execute each tool call in sequence.
      const parseResults = parseToolCalls(accumulated);
      for (const parsed of parseResults) {
        if (!parsed.ok) continue; // skip malformed calls silently

        const { call } = parsed;
        postMessage({ type: "toolUse", toolName: call.tool, callId: call.id });

        // Pass the call id to the handler via a special _callId parameter.
        const result = await this._registry.execute({
          ...call,
          parameters: { ...call.parameters, _callId: call.id },
        });

        postMessage({
          type: "toolResult",
          callId: call.id,
          success: result.success,
          summary: (result.output || result.error || "").slice(0, 200),
        });

        // Inject the tool result back into the conversation as a user message.
        this._manager.addUserMessage(formatToolResult(call.id, result));
      }
    }

    // Max iterations reached.
    postMessage({
      type: "error",
      text: `Agent loop reached the maximum of ${this._maxIterations} iterations and stopped.`,
    });
  }

  private _postTokenCount(postMessage: PostMessageFn): void {
    if (!this._compactor) return;
    const count = this._compactor.estimateTokens();
    // _maxTokens is not directly accessible here — post a best-effort count.
    // GemmaCodePanel sets the limit; we emit count = estimated, limit = 0 as a signal.
    postMessage({ type: "tokenCount", count, limit: 0 });
  }

  /**
   * Stream one model turn. Returns the accumulated response text, or null if
   * the stream was aborted or encountered an error (error is posted to webview).
   */
  private async _streamOneTurn(postMessage: PostMessageFn): Promise<string | null> {
    this._abortController = new AbortController();

    const ollamaMessages: OllamaMessage[] = this._manager
      .getHistory()
      .map((m) => ({ role: m.role, content: m.content }));

    postMessage({ type: "status", state: "streaming" });

    let accumulated = "";

    try {
      const stream = this._client.streamChat(
        { model: this._modelName, messages: ollamaMessages, stream: true },
        this._abortController.signal
      );

      for await (const chunk of stream) {
        if (this._cancelled) break;
        const token = chunk.message.content;
        if (token) {
          postMessage({ type: "token", value: token });
          accumulated += token;
        }
      }

      return this._cancelled ? null : accumulated;
    } catch (err) {
      if (this._abortController.signal.aborted) {
        return null; // normal cancellation — no error message
      }
      const message =
        err instanceof Error ? err.message : String(err);
      postMessage({ type: "error", text: `Stream error: ${message}` });
      return null;
    } finally {
      this._abortController = null;
    }
  }
}
