/**
 * v2.4.8 follow-up (2026-09-07) -- chat turns that outlive the page.
 *
 * Operator report: clicking another session while a reply was being written,
 * then coming back, showed neither the pending orb nor the reply. Two causes:
 * the cancellation counter was one global number (a send in chat B silently
 * discarded chat A's reply), and re-opening a chat re-hydrated it from the
 * store, which never holds a pending bubble. Navigating to another tab
 * unmounted the page and lost the in-flight state entirely.
 *
 * This module keeps the in-flight turns at module scope, keyed by chat id, so
 * any ChatPage instance can put the pending bubble back on hydration and
 * receive the finished reply, whichever instance started the turn.
 */

import type { ChatMessage } from "../../shared/chat/types";

export interface InFlightTurn {
  readonly chatId: string;
  readonly assistantId: string;
  /** The pending assistant bubble to restore when the chat is re-hydrated. */
  readonly pending: ChatMessage;
  readonly startedAt: number;
}

export interface CompletedTurn {
  readonly chatId: string;
  readonly assistantId: string;
  /** The finished assistant message (never pending). */
  readonly message: ChatMessage;
}

type Listener = (turn: CompletedTurn) => void;

const inFlight = new Map<string, InFlightTurn>();
const epochs = new Map<string, number>();
const listeners = new Set<Listener>();

/** Start a turn for `chatId`; returns its epoch for `isCurrentTurn`. */
export function beginTurn(chatId: string, pending: ChatMessage): number {
  const epoch = (epochs.get(chatId) ?? 0) + 1;
  epochs.set(chatId, epoch);
  inFlight.set(chatId, {
    chatId,
    assistantId: pending.id,
    pending,
    startedAt: Date.now(),
  });
  return epoch;
}

/** True while no later turn or stop has superseded `epoch` for this chat. */
export function isCurrentTurn(chatId: string, epoch: number): boolean {
  return epochs.get(chatId) === epoch;
}

/** Stop the current turn for one chat (the Stop button); others keep going. */
export function cancelTurn(chatId: string): void {
  epochs.set(chatId, (epochs.get(chatId) ?? 0) + 1);
  inFlight.delete(chatId);
}

export function inFlightTurn(chatId: string): InFlightTurn | null {
  return inFlight.get(chatId) ?? null;
}

/** Update the stored pending bubble (e.g. model-loading progress). */
export function patchInFlight(
  chatId: string,
  patch: Partial<ChatMessage>,
): void {
  const current = inFlight.get(chatId);
  if (!current) return;
  inFlight.set(chatId, { ...current, pending: { ...current.pending, ...patch } });
}

/** Finish a turn and hand the reply to every mounted listener. */
export function completeTurn(turn: CompletedTurn): void {
  const current = inFlight.get(turn.chatId);
  if (current && current.assistantId === turn.assistantId) {
    inFlight.delete(turn.chatId);
  }
  for (const listener of listeners) listener(turn);
}

export function subscribeCompletedTurns(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam. */
export function resetChatTurns(): void {
  inFlight.clear();
  epochs.clear();
  listeners.clear();
}
