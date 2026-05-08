import type { OllamaClient, OllamaMessage, OllamaOptions, OllamaToolDefinition } from "../llm/types.js";
import { OllamaError } from "../llm/types.js";
import type { ConversationManager } from "./ConversationManager.js";
import type { ExtensionToWebviewMessage } from "../panels/messages.js";
import { formatForUser } from "../utils/errors.js";

export type PostMessageFn = (message: ExtensionToWebviewMessage) => void;

/** Maximum number of retry attempts after an early stream failure (< 3 tokens). */
const MAX_RETRIES = 1;

/** A stream is considered "early failure" if fewer than this many tokens arrived. */
const EARLY_FAILURE_TOKEN_THRESHOLD = 3;

export class StreamingPipeline {
  private _abortController: AbortController | null = null;

  constructor(
    private readonly _client: OllamaClient,
    private readonly _manager: ConversationManager,
    private readonly _modelName: string,
    private readonly _runAgentLoop?: (postMessage: PostMessageFn) => Promise<void>,
    private readonly _ollamaOptions?: OllamaOptions,
    private readonly _tools?: OllamaToolDefinition[]
  ) {}

  /** Abort any in-flight stream request. */
  cancel(): void {
    this._abortController?.abort();
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
  async send(text: string, postMessage: PostMessageFn): Promise<void> {
    this._manager.addUserMessage(text);
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

      try {
        const ollamaMessages: OllamaMessage[] = this._manager
          .getHistory()
          .map((m) => ({ role: m.role, content: m.content }));

        postMessage({ type: "status", state: "streaming" });

        const stream = this._client.streamChat(
          { model: this._modelName, messages: ollamaMessages, stream: true, options: this._ollamaOptions, tools: this._tools },
          this._abortController.signal
        );

        for await (const chunk of stream) {
          const token = chunk.message.content;
          if (token) {
            postMessage({ type: "token", value: token });
            accumulated += token;
            tokenCount++;
          }
        }

        const msg = this._manager.addAssistantMessage(accumulated);
        // renderedHtml is populated by GemmaCodePanel's postMessage interceptor.
        postMessage({ type: "messageComplete", messageId: msg.id, renderedHtml: "" });
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
        return (
          "Cannot reach Ollama. Make sure `ollama serve` is running on your machine."
        );
      }
      return `Ollama error (${err.statusCode}): ${err.message}`;
    }
    if (err instanceof Error && err.name === "AbortError") {
      return "Request timed out. Try a shorter prompt or check if Ollama is overloaded.";
    }
    return formatForUser(err);
  }
}
