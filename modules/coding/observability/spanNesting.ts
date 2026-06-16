import type { Span } from "./TraceStore.js";

/**
 * v1.6.0 Phase 4 (A2) -- shared, render-agnostic span-nesting logic used by both
 * the Trace Dashboard and the standalone A4 HTML export so the two surfaces lay
 * the swarm topology out identically.
 *
 * The swarm orchestrator stamps `groupId` + `parentRunId` on each sub-run
 * (planner -> worker -> critic). This module turns the flat span list returned
 * by the trace store into a depth-annotated, pre-ordered list:
 *
 *   - **Nested**: when any span carries run-nesting metadata, spans are arranged
 *     as a run tree (a span nests under the run named by its `parentRunId`),
 *     emitted in pre-order with a `depth` per entry. Children of one parent keep
 *     their start-time order; roots keep their start-time order.
 *   - **Flat fallback**: when no span carries `groupId` or `parentRunId` (every
 *     legacy trace and every non-swarm run), the original flat, start-time
 *     ordered timeline is returned unchanged with `depth: 0` throughout.
 *
 * The function is pure and side-effect-free so it can be unit-tested directly
 * and reused across the (vscode-coupled) dashboard and the plain-Node export.
 */

/** A span paired with its nesting depth in the run tree (0 = root). */
export interface SpanTreeEntry {
  readonly span: Span;
  readonly depth: number;
}

/**
 * True when at least one span carries run-nesting metadata (`groupId` or
 * `parentRunId`). When false, callers should render the flat timeline.
 */
export function hasRunNesting(spans: readonly Span[]): boolean {
  return spans.some((s) => s.groupId != null || s.parentRunId != null);
}

function byStartTime(a: Span, b: Span): number {
  return a.startTime - b.startTime;
}

/**
 * Flatten a span list into a pre-ordered, depth-annotated list. Falls back to
 * the flat start-time order (all depth 0) when no run-nesting metadata exists.
 */
export function flattenSpanForest(spans: readonly Span[]): SpanTreeEntry[] {
  const sorted = [...spans].sort(byStartTime);

  // Flat fallback: no nesting metadata anywhere -> preserve the legacy timeline.
  if (!hasRunNesting(sorted)) {
    return sorted.map((span) => ({ span, depth: 0 }));
  }

  const byId = new Map<string, Span>();
  for (const s of sorted) byId.set(s.spanId, s);

  // A span's tree parent is the run named by parentRunId, but only when that
  // run is a span in this trace; an unresolved (or null) parent makes the span
  // a root. This keeps a worker whose planner run lives in another trace from
  // vanishing from the view.
  const childrenOf = new Map<string, Span[]>();
  const roots: Span[] = [];
  for (const s of sorted) {
    const parentId = s.parentRunId;
    if (parentId != null && parentId !== s.spanId && byId.has(parentId)) {
      const bucket = childrenOf.get(parentId);
      if (bucket) bucket.push(s);
      else childrenOf.set(parentId, [s]);
    } else {
      roots.push(s);
    }
  }

  const entries: SpanTreeEntry[] = [];
  const visited = new Set<string>();

  const walk = (span: Span, depth: number): void => {
    // Cycle guard: a malformed parentRunId chain must never loop forever.
    if (visited.has(span.spanId)) return;
    visited.add(span.spanId);
    entries.push({ span, depth });
    const kids = childrenOf.get(span.spanId);
    if (kids) {
      for (const child of kids) walk(child, depth + 1);
    }
  };

  for (const root of roots) walk(root, 0);

  // Defensive: any span left unvisited (e.g. trapped in a parentRunId cycle)
  // is still emitted at the end as a depth-0 root so the view never silently
  // drops a span.
  for (const s of sorted) {
    if (!visited.has(s.spanId)) {
      visited.add(s.spanId);
      entries.push({ span: s, depth: 0 });
    }
  }

  return entries;
}
