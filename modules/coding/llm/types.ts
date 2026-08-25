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

/**
 * v1.16.0 Phase 2.1 (adoption item A2) -- per-request inference counters a
 * backend may report on its FINAL stream chunk.
 *
 * Ollama puts these on the `done: true` chunk of `/api/chat`; durations are
 * nanoseconds (its native unit), token counts are absolute. Every field is
 * optional because no backend guarantees them: LM Studio and other
 * OpenAI-compatible runtimes report an OpenAI-shaped `usage` block instead (and
 * only when asked), so the metrics layer treats "absent" as a first-class state
 * rather than substituting a zero.
 */
export interface LLMUsageCounters {
  /** Ollama: total request wall time, nanoseconds. */
  total_duration?: number;
  /** Ollama: model load time, nanoseconds. */
  load_duration?: number;
  /** Ollama: prompt tokens evaluated. */
  prompt_eval_count?: number;
  /** Ollama: prompt evaluation time, nanoseconds. */
  prompt_eval_duration?: number;
  /** Ollama: completion tokens generated. */
  eval_count?: number;
  /** Ollama: completion generation time, nanoseconds. */
  eval_duration?: number;
  /** OpenAI-compatible runtimes report counts here instead. */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    reasoning_tokens?: number;
  };
}

export interface LLMStreamChunk extends LLMUsageCounters {
  message: {
    role: string;
    content: string;
    /** Gemma 4 thinking-in-message; stripped unless declared on the Zod schema. */
    thinking?: string;
  };
  done: boolean;
  /** Model name echoed by the backend; may differ from the requested alias. */
  model?: string;
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

/**
 * v1.16.0 Phase 2.1: the optional per-request counters. Additive and all
 * `.optional()`, so every existing producer, mock, and test stays valid.
 *
 * NOTE the deliberate non-strictness of the parent schema below: it is a plain
 * `z.object`, so zod STRIPS unknown keys. Before this phase that silently
 * discarded every counter Ollama sends on its final chunk. Declaring them here
 * is what lets them survive `parse` and reach the metrics layer -- adding a
 * counter to `LLMUsageCounters` without adding it here would be a no-op.
 */
export const LLMStreamChunkSchema = z.object({
  message: z.object({
    role: z.string(),
    content: z.string(),
    thinking: z.string().optional(),
  }),
  done: z.boolean(),
  model: z.string().optional(),
  total_duration: z.number().optional(),
  load_duration: z.number().optional(),
  prompt_eval_count: z.number().optional(),
  prompt_eval_duration: z.number().optional(),
  eval_count: z.number().optional(),
  eval_duration: z.number().optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
      reasoning_tokens: z.number().optional(),
    })
    .optional(),
});

export const LLMModelSchema = z.object({
  name: z.string(),
  modified_at: z.string(),
  size: z.number(),
});

export const LLMListModelsResponseSchema = z.object({
  models: z.array(LLMModelSchema).optional(),
});
