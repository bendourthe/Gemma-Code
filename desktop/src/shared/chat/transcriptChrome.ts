/**
 * v2.2.7 Phase 4 -- messenger date, discrete clock, and per-bubble tokens.
 *
 * Missing or epoch-zero createdAt skips the clock (never "Jan 1 1970").
 * Unknown token counts render an em dash, not 0.
 */

import type { ChatMessage } from "./types";

/** Product lock: unknown token counts show an em dash, not a guessed 0. */
export const UNKNOWN_TOKEN_MARK = "\u2014";

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
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** User: `12 in`. Assistant: `12 think + 36 out`, `48 out`, or em dash. */
export function formatBubbleTokens(message: Pick<ChatMessage, "role" | "inputTokens" | "reasoningTokens" | "outputTokens">): string {
  if (message.role === "user") {
    const input = numericOrNull(message.inputTokens);
    return input === null ? UNKNOWN_TOKEN_MARK : `${input} in`;
  }
  if (message.role === "assistant") {
    const think = numericOrNull(message.reasoningTokens);
    const out = numericOrNull(message.outputTokens);
    if (think !== null && out !== null) return `${think} think + ${out} out`;
    if (think !== null) return `${think} think`;
    if (out !== null) return `${out} out`;
    return UNKNOWN_TOKEN_MARK;
  }
  return UNKNOWN_TOKEN_MARK;
}

export function withLiveTimestamp(message: ChatMessage): ChatMessage {
  if (message.timestamp) return message;
  return { ...message, timestamp: new Date().toISOString() };
}
