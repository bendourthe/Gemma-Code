import { z } from "zod";

/**
 * Vendor-neutral LLM port. The extension talks to a `LLMClient` and never
 * depends on any particular provider's wire protocol. The concrete adapter
 * that speaks to Ollama lives in `./OllamaClient.ts` and maps between the
 * Ollama wire format and the types declared here.
 *
 * If a second provider is ever wired up (e.g. a remote inference server or
 * a mock for testing), it implements `LLMClient` and the orchestration code
 * keeps working unchanged.
 *
 * The `Ollama*`-prefixed aliases are retained because most of the codebase
 * was written against those names before the port was introduced. New code
 * should prefer the `LLM*` names.
 */

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /**
   * v1.5.0 Phase 5 (item 33) -- base64-encoded image data forwarded to a
   * vision-capable model. Maps directly to Ollama's `/api/chat` per-message
   * `images` array. Omitted for text-only requests; text-only models that
   * receive it ignore it. The prompt-assembly sites only set this when the
   * active model is vision-capable (see `isVisionCapableModel`).
   */
  images?: readonly string[];
}

export interface LLMOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_ctx?: number;
}

export interface LLMToolFunction {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMToolDefinition {
  type: "function";
  function: LLMToolFunction;
}

export interface LLMChatRequest {
  model: string;
  messages: LLMMessage[];
  stream: boolean;
  options?: LLMOptions;
  tools?: LLMToolDefinition[];
  /**
   * v0.9.0 Phase 2.7 (from v0.8.0 known-gaps 10.O.W) -- Ollama keep_alive
   * hint. `-1` disables idle eviction (pinned), a duration string like
   * `"5m"` or a numeric second count sets a custom retention. The
   * StreamingPipeline derives this from the active `ModelPinRegistry`.
   */
  keep_alive?: number | string;
}

export interface LLMStreamChunk {
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

export interface LLMModel {
  name: string;
  modified_at: string;
  size: number;
}

export class LLMError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "LLMError";
    this.statusCode = statusCode;
  }
}

/**
 * Result returned by `LLMClient.embed`. `available` lets the caller distinguish
 * "embedding model is not loaded" (a hard miss that should bypass retries)
 * from a transient failure (returned as `embedding === null` with
 * `available === true`).
 */
export interface LLMEmbedResult {
  readonly embedding: number[] | null;
  readonly available: boolean;
}

export interface LLMClient {
  checkHealth(): Promise<boolean>;
  listModels(): Promise<LLMModel[]>;
  streamChat(
    request: LLMChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamChunk>;
  /**
   * Optional embedding capability. Returns `available: false` when the
   * configured embedding model is not loaded; returns `embedding: null` with
   * `available: true` when a transient error occurred. Implementations that
   * do not support embeddings can omit this method.
   */
  embed?(text: string, model: string): Promise<LLMEmbedResult>;
  /** Optional batch embedding. Implementations may polyfill via `embed`. */
  embedBatch?(texts: readonly string[], model: string): Promise<LLMEmbedResult[]>;
}

// ---------------------------------------------------------------------------
// Transitional aliases — kept so existing `Ollama*` call sites continue to
// compile. Prefer the `LLM*` names in new code.
// ---------------------------------------------------------------------------

export type OllamaMessage = LLMMessage;
export type OllamaOptions = LLMOptions;
export type OllamaToolFunction = LLMToolFunction;
export type OllamaToolDefinition = LLMToolDefinition;
export type OllamaChatRequest = LLMChatRequest;
export type OllamaChatChunk = LLMStreamChunk;
export type OllamaModel = LLMModel;
export type OllamaClient = LLMClient;
export const OllamaError = LLMError;
export type OllamaError = LLMError;

// ---------------------------------------------------------------------------
// Runtime schemas — pre-compiled for hot paths (every stream chunk goes
// through `LLMStreamChunkSchema.parse`, so we keep the schema lean).
// ---------------------------------------------------------------------------

export const LLMStreamChunkSchema = z.object({
  message: z.object({
    role: z.string(),
    content: z.string(),
  }),
  done: z.boolean(),
});

export const LLMModelSchema = z.object({
  name: z.string(),
  modified_at: z.string(),
  size: z.number(),
});

export const LLMListModelsResponseSchema = z.object({
  models: z.array(LLMModelSchema).optional(),
});
