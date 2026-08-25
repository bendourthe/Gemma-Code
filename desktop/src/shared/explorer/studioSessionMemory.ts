/**
 * v2.2.6 Phase 2 -- map studio turns onto chat bubbles and decide when a
 * last-output path is safe to reuse as img2img / continueFrom.
 *
 * Paths only. Inline data: blobs are never treated as durable lastOutputRef.
 */

import type { ChatMessage } from "../chat/types";
import type { StudioTurn } from "../../../../core/generations/StudioSessionStore.types";

export const MISSING_OUTPUT_TEXT = "output missing on disk";
export const UNREADABLE_OUTPUT_TEXT = "Last output is unreadable; cannot edit it.";

export function sessionTitleFromPrompt(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return "New session";
  return trimmed.length > 48 ? `${trimmed.slice(0, 45)}...` : trimmed;
}

export function isInlineBlobRef(ref: string): boolean {
  return ref.trim().toLowerCase().startsWith("data:");
}

export function isUsablePathRef(
  ref: string | null | undefined,
  exists?: (path: string) => boolean,
): boolean {
  if (typeof ref !== "string") return false;
  const trimmed = ref.trim();
  if (!trimmed || isInlineBlobRef(trimmed)) return false;
  if (exists) return exists(trimmed);
  return true;
}

export function lastAssistantMediaRef(turns: readonly StudioTurn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn?.role === "assistant" && turn.mediaRef) return turn.mediaRef;
  }
  return null;
}

export function studioTurnsToChatMessages(
  turns: readonly StudioTurn[],
  options?: {
    outputExists?: (path: string) => boolean;
    mediaKind?: "image" | "video";
  },
): ChatMessage[] {
  const mediaKind = options?.mediaKind ?? "image";
  return turns.map((turn) => {
    if (turn.role === "user") {
      return {
        id: turn.id,
        role: "user" as const,
        content: turn.content,
        timestamp: new Date(turn.createdAt).toISOString(),
        inputTokens: turn.inputTokens ?? null,
        reasoningTokens: turn.reasoningTokens ?? null,
        outputTokens: turn.outputTokens ?? null,
        tokensEstimated: turn.tokensEstimated,
        ...(turn.mediaRef ? { attachments: [turn.mediaRef] } : {}),
      };
    }
    const ref = turn.mediaRef;
    if (ref && !isUsablePathRef(ref, options?.outputExists)) {
      return {
        id: turn.id,
        role: "assistant" as const,
        content: turn.content.trim() ? turn.content : MISSING_OUTPUT_TEXT,
        timestamp: new Date(turn.createdAt).toISOString(),
        inputTokens: turn.inputTokens ?? null,
        reasoningTokens: turn.reasoningTokens ?? null,
        outputTokens: turn.outputTokens ?? null,
        tokensEstimated: turn.tokensEstimated,
      };
    }
    return {
      id: turn.id,
      role: "assistant" as const,
      content: turn.content,
      timestamp: new Date(turn.createdAt).toISOString(),
      inputTokens: turn.inputTokens ?? null,
      reasoningTokens: turn.reasoningTokens ?? null,
      outputTokens: turn.outputTokens ?? null,
      tokensEstimated: turn.tokensEstimated,
      ...(ref ? { media: { kind: mediaKind, src: ref } } : {}),
    };
  });
}
