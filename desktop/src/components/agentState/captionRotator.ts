/**
 * v2.2.9 Phase 2.1 (T006) -- pending-orb caption rotator.
 *
 * While a chat/agents reply is pending, the orb pill cycles captions from a
 * fixed list (Thinking / Searching / Working / Solving), shuffled once per
 * pending bubble, then rotated on a steady interval. Reverse-engineered from
 * the thinking-orbs reference grammar (dark pill + particle orb + cycling
 * label); no `thinking-orbs` package import.
 */

import { useEffect, useState } from "react";
import type { AgentState } from "./mapping";

/** Fixed caption list. Order here is the reduced-motion "first caption". */
export const PENDING_CAPTIONS = [
  "Thinking...",
  "Searching...",
  "Working...",
  "Solving...",
] as const;

export type PendingCaption = (typeof PENDING_CAPTIONS)[number];

/** Longest rotating caption; drives a constant pill min-width. */
export function longestPendingCaption(): PendingCaption {
  return PENDING_CAPTIONS.reduce((a, b) => (a.length >= b.length ? a : b));
}

/** Left inset so pill box-shadow / drop-shadow is not cropped by the pane. */
export const PENDING_PILL_INSET_PX = 12;

export function pendingPillMinWidthExpr(orbPx: number): string {
  const captionCh = longestPendingCaption().length;
  return `calc(${orbPx}px + var(--space-2) + ${captionCh}ch + (2 * var(--space-3)))`;
}

/** ~2-3s per caption; slow enough not to read as a flicker. */
export const CAPTION_ROTATE_INTERVAL_MS = 2400;

/**
 * Fisher-Yates shuffle of the fixed caption list. Pure: returns a new array,
 * never mutates `PENDING_CAPTIONS`. `rand` is injectable for tests.
 */
export function shufflePendingCaptions(rand: () => number = Math.random): PendingCaption[] {
  const order: PendingCaption[] = [...PENDING_CAPTIONS];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = order[i];
    const b = order[j];
    if (a === undefined || b === undefined) continue;
    order[i] = b;
    order[j] = a;
  }
  return order;
}

/**
 * Each caption drives the matching orb motion grammar so the particles and
 * the word agree ("Searching..." sweeps, "Solving..." spirals inward).
 * "Thinking..." has no dedicated state; composing is the streaming default.
 */
export function pendingCaptionState(caption: PendingCaption): AgentState {
  switch (caption) {
    case "Searching...":
      return "searching";
    case "Working...":
      return "working";
    case "Solving...":
      return "solving";
    default:
      return "composing";
  }
}

/**
 * React hook: shuffle once per mount (one pending bubble = one mount), then
 * advance through that fixed order every `CAPTION_ROTATE_INTERVAL_MS` while
 * `active`. When inactive (reduced motion, or rotation not requested) no
 * interval is scheduled and the first fixed caption is returned.
 */
export function usePendingCaptionRotator(active: boolean): PendingCaption {
  const [order] = useState<PendingCaption[]>(() => shufflePendingCaptions());
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % order.length);
    }, CAPTION_ROTATE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [active, order.length]);

  if (!active) return PENDING_CAPTIONS[0];
  return order[index % order.length] ?? PENDING_CAPTIONS[0];
}
