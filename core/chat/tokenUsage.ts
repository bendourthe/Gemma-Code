import { estimateTokens } from "./sessionContextUsage.js";

export type TokenCountAccuracy = "exact" | "estimated" | "legacy";
export type TokenCountSource = "provider" | "tokenizer" | "estimate" | "legacy";

export interface TokenUsageProvenance {
  readonly accuracy: TokenCountAccuracy;
  readonly source: TokenCountSource;
  readonly provider?: string;
  readonly tokenizer?: string;
}

/** Request-wide telemetry. It may include system, history, attachments, and cache input. */
export interface RequestTokenUsageV1 {
  readonly version: 1;
  readonly inputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly outputTokens: number | null;
  readonly provenance: TokenUsageProvenance;
  readonly raw?: Readonly<Record<string, number | string | boolean | null>>;
}

/** Tokens attributable only to the text rendered by one transcript message. */
export interface MessageTokenUsageV1 {
  readonly version: 1;
  readonly inputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly outputTokens: number | null;
  readonly provenance: TokenUsageProvenance;
}

export function estimatedMessageUsage(
  role: "user" | "assistant",
  content: string,
  reasoningText?: string | null,
): MessageTokenUsageV1 {
  return role === "user"
    ? {
        version: 1,
        inputTokens: estimateTokens(content),
        reasoningTokens: null,
        outputTokens: null,
        provenance: { accuracy: "estimated", source: "estimate" },
      }
    : {
        version: 1,
        inputTokens: null,
        reasoningTokens: reasoningText ? estimateTokens(reasoningText) : null,
        outputTokens: estimateTokens(content),
        provenance: { accuracy: "estimated", source: "estimate" },
      };
}
