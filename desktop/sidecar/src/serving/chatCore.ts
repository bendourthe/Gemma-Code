/**
 * v1.16.0 Phase 1.3/1.4 (adoption item A1) -- shared completion plumbing.
 *
 * The OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`) routes
 * differ only in their wire shapes: request parsing, model resolution, the
 * `LLMClient.streamChat` call, and error mapping are identical and live here so
 * 1.4 shares 1.3's logic instead of duplicating it.
 *
 * Token accounting (v1.16.0 Phase 2.1, closing gap LSO.P1.A): the port's stream
 * chunks now carry the counters a backend reports on its final chunk, so
 * `collectUsage` accumulates real prompt/completion counts and both wire shapes
 * report them. A backend that reports nothing still yields a well-formed `usage`
 * block of zeros rather than an omitted field, because the official OpenAI and
 * Anthropic SDKs parse `usage` as required -- but that is now the genuine
 * "backend told us nothing" case, not the unconditional placeholder it was in
 * Phase 1.
 */

import { z } from "zod";
import type {
  LLMChatRequest,
  LLMMessage,
  LLMOptions,
  LLMStreamChunk,
} from "../../../../modules/coding/llm/types.js";
import { badRequest } from "./errors.js";

/** Response writer the routes render through, so they are testable off-socket. */
export interface SseWriter {
  /** Write one `event:`/`data:` frame. Omit `event` for a bare `data:` frame. */
  write(data: string, event?: string): void;
  end(): void;
}

export interface ResponseWriter {
  json(status: number, body: unknown): void;
  /** Switch to `text/event-stream` and return the frame writer. */
  sse(): SseWriter;
}

/** A text part or an image part from a structured `content` array. */
const ContentPart = z.union([
  z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
  z
    .object({
      type: z.literal("image_url"),
      image_url: z.object({ url: z.string() }).passthrough(),
    })
    .passthrough(),
  // Anthropic's structured image/text blocks.
  z
    .object({
      type: z.literal("image"),
      source: z.object({ data: z.string().optional(), type: z.string().optional() }).passthrough(),
    })
    .passthrough(),
]);

export const WireContent = z.union([z.string(), z.array(ContentPart)]);
export type WireContentT = z.infer<typeof WireContent>;

/** Extracted text plus any base64 images found in a `content` value. */
export interface FlattenedContent {
  readonly text: string;
  readonly images: readonly string[];
}

/**
 * Flatten a string-or-parts `content` value into the port's text + images shape.
 * Data-URL prefixes are stripped because the port forwards raw base64 (matching
 * Ollama's per-message `images` array).
 */
export function flattenContent(content: WireContentT): FlattenedContent {
  if (typeof content === "string") return { text: content, images: [] };
  const texts: string[] = [];
  const images: string[] = [];
  for (const part of content) {
    if (part.type === "text") {
      texts.push(part.text);
    } else if (part.type === "image_url") {
      images.push(stripDataUrl(part.image_url.url));
    } else if (part.type === "image" && typeof part.source.data === "string") {
      images.push(stripDataUrl(part.source.data));
    }
  }
  return { text: texts.join("\n"), images };
}

function stripDataUrl(raw: string): string {
  const comma = raw.indexOf(",");
  return raw.startsWith("data:") && comma !== -1 ? raw.slice(comma + 1) : raw;
}

/**
 * Map an inbound role onto the port's three-role vocabulary. `developer` is
 * OpenAI's newer system role; `tool` output is folded into the user turn so a
 * tool-using client still gets a coherent transcript from a local model.
 */
export function normalizeRole(role: string): LLMMessage["role"] {
  switch (role) {
    case "system":
    case "developer":
      return "system";
    case "assistant":
      return "assistant";
    default:
      return "user";
  }
}

/** Sampling knobs both wire shapes can carry, mapped onto `LLMOptions`. */
export interface SamplingInput {
  readonly temperature?: number;
  readonly top_p?: number;
  readonly top_k?: number;
  readonly num_ctx?: number;
}

export function toLlmOptions(input: SamplingInput): LLMOptions | undefined {
  const opts: LLMOptions = {};
  if (input.temperature !== undefined) opts.temperature = input.temperature;
  if (input.top_p !== undefined) opts.top_p = input.top_p;
  if (input.top_k !== undefined) opts.top_k = input.top_k;
  if (input.num_ctx !== undefined) opts.num_ctx = input.num_ctx;
  return Object.keys(opts).length > 0 ? opts : undefined;
}

/** Build the port request. Rejects an empty transcript as a 400, not a 502. */
export function buildChatRequest(args: {
  modelName: string;
  messages: readonly LLMMessage[];
  stream: boolean;
  options?: LLMOptions;
}): LLMChatRequest {
  if (args.messages.length === 0) {
    throw badRequest("'messages' must contain at least one message.", "empty_messages");
  }
  return {
    model: args.modelName,
    messages: [...args.messages],
    stream: args.stream,
    ...(args.options ? { options: args.options } : {}),
  };
}

/**
 * Token counts observed on a stream, in the neutral shape both wire dialects
 * render from. `reported` distinguishes "the backend told us zero" from "the
 * backend told us nothing", which the Traces panel needs and a client may want.
 */
export interface CollectedUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number | null;
  reported: boolean;
}

/** A fresh, all-zero usage accumulator. */
export function newUsage(): CollectedUsage {
  return { promptTokens: 0, completionTokens: 0, reasoningTokens: null, reported: false };
}

/**
 * Fold one chunk's counters into the accumulator. Accepts both the Ollama shape
 * (`prompt_eval_count` / `eval_count`) and the OpenAI-compatible `usage` block,
 * because the gateway fronts both kinds of local runtime. Later chunks win: a
 * backend reports cumulative totals on its final chunk.
 */
export function collectUsage(chunk: LLMStreamChunk, into: CollectedUsage): void {
  if (typeof chunk.prompt_eval_count === "number") {
    into.promptTokens = chunk.prompt_eval_count;
    into.reported = true;
  }
  if (typeof chunk.eval_count === "number") {
    into.completionTokens = chunk.eval_count;
    into.reported = true;
  }
  const usage = chunk.usage;
  if (usage) {
    if (typeof usage.prompt_tokens === "number") {
      into.promptTokens = usage.prompt_tokens;
      into.reported = true;
    }
    if (typeof usage.completion_tokens === "number") {
      into.completionTokens = usage.completion_tokens;
      into.reported = true;
    }
    if (typeof usage.reasoning_tokens === "number") {
      into.reasoningTokens = usage.reasoning_tokens;
    }
  }
}

/**
 * v2.4.8 Phase 1 (T001) -- the provider's completion count is the truth for
 * the whole turn. Ollama's `eval_count` and OpenAI's `completion_tokens` both
 * count every generated token, thinking included, so reasoning is never added
 * on top of them. When a backend reports an explicit `reasoning_tokens`, output
 * is the remainder. When it reports only the total and the model produced
 * thinking text, the total is split in proportion to the thinking and reply
 * byte lengths, so `reasoning + output === total` exactly and the ratio follows
 * the text. The bytes/4 estimate survives only for a turn with no counts at
 * all, which is the case it was written for.
 */
export function turnUsageFromCollected(
  usage: CollectedUsage,
  thinkingText = "",
  replyText = "",
): {
  inputTokens: number | null;
  reasoningTokens: number | null;
  outputTokens: number | null;
} {
  const thinkBytes = new TextEncoder().encode(thinkingText.trim()).length;
  if (!usage.reported) {
    const estimated = thinkBytes > 0 ? Math.ceil(thinkBytes / 4) : null;
    return { inputTokens: null, reasoningTokens: usage.reasoningTokens ?? estimated, outputTokens: null };
  }
  const total = usage.completionTokens;
  if (usage.reasoningTokens !== null) {
    return {
      inputTokens: usage.promptTokens,
      reasoningTokens: usage.reasoningTokens,
      outputTokens: Math.max(total - usage.reasoningTokens, 0),
    };
  }
  if (thinkBytes === 0) {
    return { inputTokens: usage.promptTokens, reasoningTokens: null, outputTokens: total };
  }
  const replyBytes = new TextEncoder().encode(replyText.trim()).length;
  const reasoning = Math.round((total * thinkBytes) / (thinkBytes + replyBytes));
  return {
    inputTokens: usage.promptTokens,
    reasoningTokens: reasoning,
    outputTokens: total - reasoning,
  };
}

export function doneUsageFields(usage: ReturnType<typeof turnUsageFromCollected>): {
  inputTokens?: number | null;
  reasoningTokens?: number | null;
  outputTokens?: number | null;
} {
  if (usage.inputTokens == null && usage.reasoningTokens == null && usage.outputTokens == null) {
    return {};
  }
  return {
    inputTokens: usage.inputTokens,
    reasoningTokens: usage.reasoningTokens,
    outputTokens: usage.outputTokens,
  };
}

/** Monotonic-ish id factory; injectable so tests get deterministic ids. */
export type IdFactory = (prefix: string) => string;

let _seq = 0;
export const defaultIdFactory: IdFactory = (prefix) => {
  _seq += 1;
  return `${prefix}-${_seq.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
};

/** Unix seconds, injectable for deterministic tests. */
export type NowFactory = () => number;
export const defaultNow: NowFactory = () => Math.floor(Date.now() / 1000);
