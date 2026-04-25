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

export interface LLMClient {
  checkHealth(): Promise<boolean>;
  listModels(): Promise<LLMModel[]>;
  streamChat(
    request: LLMChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamChunk>;
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
