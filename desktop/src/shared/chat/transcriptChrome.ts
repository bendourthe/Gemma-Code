/**
 * v2.2.7 Phase 4 -- messenger date, discrete clock, and per-bubble tokens.
 *
 * Missing or epoch-zero createdAt skips the clock (never "Jan 1 1970").
 * v2.2.9 Phase 1.3: unknown token counts omit the span entirely (no em dash,
 * no guessed 0), and known counts render in full words.
 */

import type { ChatMessage } from "./types";

export function parseMessageTime(timestamp?: string | null): Date | null {
  if (typeof timestamp !== "string" || timestamp.trim().length === 0) return null;
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms) || ms === 0) return null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function isoTimestampFromMillis(ms: number | null | undefined): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms === 0) return undefined;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/** Local calendar day key so remounts do not duplicate headings. */
export function calendarDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateHeading(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatBubbleTime(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function numericOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

export interface BubbleTokenMetadata {
  readonly total: number;
  readonly label: string;
  readonly detail: string;
}

/**
 * v2.2.9 Phase 1.3 (T003) -- full-word token copy.
 *
 * User: `1 input token` / `N input tokens`. Assistant: `171 tokens
 * (75 reasoning + 96 output)` when both parts are known (total = sum),
 * `N output tokens` or `N reasoning tokens` when only one is. Unknown counts
 * return an empty string so the caller omits the span (never an em dash,
 * never a guessed 0).
 */
export function bubbleTokenMetadata(
  message: Pick<
    ChatMessage,
    "role" | "inputTokens" | "reasoningTokens" | "outputTokens" | "tokensEstimated"
  >,
): BubbleTokenMetadata | null {
  if (message.role === "system") return null;
  const input = numericOrNull(message.inputTokens);
  const reasoning = numericOrNull(message.reasoningTokens);
  const output = numericOrNull(message.outputTokens);
  const known = [input, reasoning, output].filter((value): value is number => value !== null);
  if (known.length === 0) return null;
  const total = known.reduce((sum, value) => sum + value, 0);
  const value = (count: number | null): string => (count === null ? "unavailable" : String(count));
  const estimate = message.tokensEstimated ? "Estimated. " : "";
  return {
    total,
    label: `(${total} token${total === 1 ? "" : "s"})`,
    detail: `${estimate}Input: ${value(input)}. Reasoning: ${value(reasoning)}. Output: ${value(output)}.`,
  };
}

/** Backward-compatible text helper used by existing consumers and tests. */
export function formatBubbleTokens(
  message: Pick<
    ChatMessage,
    "role" | "inputTokens" | "reasoningTokens" | "outputTokens" | "tokensEstimated"
  >,
): string {
  return bubbleTokenMetadata(message)?.label ?? "";
}

export function withLiveTimestamp(message: ChatMessage): ChatMessage {
  if (message.timestamp) return message;
  return { ...message, timestamp: new Date().toISOString() };
}
