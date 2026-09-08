/**
 * v2.4.8 follow-up (2026-09-07) -- which media model a studio job is using.
 *
 * The sidebar GPU card only knows the scheduler's active job, whose model id
 * is not carried through for studio jobs, so it read "Local model" with no
 * name while an image was being made. The Images and Videos pages know the
 * model they submitted; they publish it here for the duration of the job and
 * the card renders it next to "Local model".
 */

import { useSyncExternalStore } from "react";

export interface ModelActivity {
  readonly pillar: "image" | "video";
  /** Catalog display name (e.g. "RealVisXL V5.0"), falling back to the id. */
  readonly modelLabel: string;
}

let current: ModelActivity | null = null;
const subscribers = new Set<() => void>();

function same(a: ModelActivity | null, b: ModelActivity | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.pillar === b.pillar && a.modelLabel === b.modelLabel;
}

export function setModelActivity(next: ModelActivity | null): void {
  if (same(current, next)) return;
  current = next;
  for (const notify of subscribers) notify();
}

export function getModelActivity(): ModelActivity | null {
  return current;
}

export function subscribeModelActivity(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

export function useModelActivity(): ModelActivity | null {
  return useSyncExternalStore(
    subscribeModelActivity,
    getModelActivity,
    getModelActivity,
  );
}
