/**
 * v1.16.0 Phase 1.3/1.4 (adoption item A1) -- shared completion plumbing.
 *
 * The OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`) routes
 * differ only in their wire shapes: request parsing, model resolution, the
 * `LLMClient.streamChat` call, and error mapping are identical and live here so
 * 1.4 shares 1.3's logic instead of duplicating it.
 *
 * Token accounting note: the `LLMClient` port's stream chunks carry no usage
 * counts, so the `usage` blocks the two wire shapes require are emitted with
 * zeros. Real prompt/completion counts arrive with the v1.16.0 Phase 2.1
 * per-request inference metrics, which capture exactly these numbers at this
 * same boundary. Zeros (rather than an omitted field) keep the official SDK
 * clients parsing, which is the acceptance criterion for both routes.
 */

import { z } from "zod";
import type {
  LLMChatRequest,
  LLMMessage,
  LLMOptions,
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

/** Zero-valued usage block. See the token-accounting note in the file header. */
export const ZERO_USAGE = { prompt: 0, completion: 0 } as const;

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
