export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_ctx?: number;
}

export interface OllamaToolFunction {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface OllamaToolDefinition {
  type: "function";
  function: OllamaToolFunction;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  options?: OllamaOptions;
  tools?: OllamaToolDefinition[];
}

export interface OllamaChatChunk {
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

export class OllamaError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "OllamaError";
    this.statusCode = statusCode;
  }
}

export interface OllamaClient {
  checkHealth(): Promise<boolean>;
  listModels(): Promise<OllamaModel[]>;
  streamChat(
    request: OllamaChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<OllamaChatChunk>;
}
