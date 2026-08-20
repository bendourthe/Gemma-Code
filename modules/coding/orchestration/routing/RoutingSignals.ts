/**
 * v2.1.0 Phase 2 -- Switchyard-style routing signals.
 *
 * Pure functions over a per-session event window. No new event sources:
 * callers project AgentLoop traces / tool results into {@link RoutingTurnEvent}.
 * Missing or malformed turns are skipped (neutral), never treated as escalate.
 *
 * Boundary: vscode-free. Does not import src/tools/AgentLoop (cycle / host).
 * DEVIATION: AgentLoop itself is not wired this phase; DAGExecutor records
 * RoutingTurnEvent after each worker node.
 */

import { createHash } from "node:crypto";

export type RoutingRole = "planner" | "critic" | "worker";

export interface RoutingTurnEvent {
  readonly sessionId: string;
  readonly turn: number;
  readonly role?: RoutingRole;
  readonly toolName?: string;
  readonly toolArgsHash?: string;
  readonly toolError?: boolean;
  readonly fileMutated?: boolean;
  readonly testStateChanged?: boolean;
  readonly planNodeAdded?: boolean;
  /** True when telemetry for this turn lagged or crashed. Neutral, not escalate. */
  readonly stale?: boolean;
}

export interface RoutingSignals {
  readonly sessionId: string;
  readonly consecutiveToolErrors: number;
  readonly identicalActionRepeats: number;
  readonly stepsWithoutProgress: number;
  readonly stale: boolean;
}

export const DEFAULT_IDENTICAL_WINDOW = 8;

/** Stable hash of tool name + args, matching LoopGuards (id fields stripped). */
export function hashToolCall(toolName: string, args: unknown): string {
  const params: Record<string, unknown> =
    args && typeof args === "object" && !Array.isArray(args)
      ? { ...(args as Record<string, unknown>) }
      : { value: args };
  delete params.id;
  delete params._callId;
  const payload = JSON.stringify({ tool: toolName, parameters: params });
  return createHash("sha256").update(payload).digest("hex");
}

function usable(event: RoutingTurnEvent, sessionId: string): boolean {
  if (event.stale) return false;
  if (event.sessionId !== sessionId) return false;
  if (!Number.isFinite(event.turn)) return false;
  return true;
}

function actionKey(event: RoutingTurnEvent): string | null {
  if (!event.toolName || event.toolName.trim() === "") return null;
  const hash = event.toolArgsHash?.trim() || "";
  return `${event.toolName}:${hash}`;
}

function madeProgress(event: RoutingTurnEvent): boolean {
  return (
    event.fileMutated === true ||
    event.testStateChanged === true ||
    event.planNodeAdded === true
  );
}

/**
 * Compute per-session signals from a recorded window.
 *
 * Concurrent sessions must not interleave: events with a different sessionId
 * are ignored. Stale/malformed turns do not increment streaks.
 */
export function computeRoutingSignals(
  events: readonly RoutingTurnEvent[],
  sessionId: string,
  identicalWindow: number = DEFAULT_IDENTICAL_WINDOW,
): RoutingSignals {
  if (!sessionId || sessionId.trim() === "") {
    return {
      sessionId: "",
      consecutiveToolErrors: 0,
      identicalActionRepeats: 0,
      stepsWithoutProgress: 0,
      stale: true,
    };
  }

  const scoped = events
    .filter((e) => usable(e, sessionId))
    .slice()
    .sort((a, b) => a.turn - b.turn);

  const anyStale = events.some((e) => e.sessionId === sessionId && e.stale === true);

  let consecutiveToolErrors = 0;
  for (let i = scoped.length - 1; i >= 0; i -= 1) {
    const event = scoped[i];
    if (event?.toolError === true) {
      consecutiveToolErrors += 1;
      continue;
    }
    if (event?.toolName) break;
  }

  const window = scoped.slice(-Math.max(1, identicalWindow));
  let identicalActionRepeats = 0;
  let lastKey: string | null = null;
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const key = actionKey(window[i]!);
    if (!key) break;
    if (lastKey === null) {
      lastKey = key;
      identicalActionRepeats = 1;
      continue;
    }
    if (key === lastKey) {
      identicalActionRepeats += 1;
      continue;
    }
    break;
  }
  if (identicalActionRepeats <= 1) identicalActionRepeats = 0;

  let stepsWithoutProgress = 0;
  for (let i = scoped.length - 1; i >= 0; i -= 1) {
    const event = scoped[i];
    if (!event) break;
    if (event.role === "planner" || event.role === "critic") continue;
    if (madeProgress(event)) break;
    stepsWithoutProgress += 1;
  }

  return {
    sessionId,
    consecutiveToolErrors,
    identicalActionRepeats,
    stepsWithoutProgress,
    stale: anyStale && scoped.length === 0,
  };
}
