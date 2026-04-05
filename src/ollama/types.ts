export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaOptions {
  temperature?: number;
  top_p?: number;
  num_ctx?: number;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  options?: OllamaOptions;
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
