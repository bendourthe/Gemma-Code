/**
 * v1.1.0 Phase 11.6 -- session list + sub-agent progress projection.
 *
 * Sub-agent spawns are daemon-resident events (Phase 4 `HookBus` ->
 * `lifecycle.subagent.start` / `.stop`). The extension subscribes to those
 * plus the existing `coding.session.event` channel and renders a flat
 * progress timeline. Sessions persist in the daemon's `SessionStore`;
 * reconnecting the extension to a running daemon resumes the active
 * session id from `SettingsStore.get("nexus.coding.activeSessionId")`.
 *
 * This module owns three concerns:
 *  1. The view model the session list renders ({@link SessionListView}).
 *  2. The sub-agent timeline reducer ({@link applySubAgentEvent}).
 *  3. The active-session-id resolution helper used when the extension
 *     reconnects after the VS Code window was closed
 *     ({@link resolveActiveSessionId}).
 */

export interface SessionSummaryInput {
  readonly sessionId: string;
  readonly modelId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly messageCount: number;
}

export interface SessionRowView {
  readonly sessionId: string;
  readonly modelId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly messageCount: number;
  readonly isActive: boolean;
}

export interface SessionListView {
  readonly rows: readonly SessionRowView[];
  readonly activeSessionId: string | null;
}

/**
 * Build the session-list view model. Sessions are returned in the order
 * the daemon supplied them (newest-first by convention); the row tagged
 * with `isActive: true` matches the supplied `activeSessionId`. Returns an
 * empty rows array when the daemon supplied no sessions.
 */
export function projectSessionListView(
  sessions: readonly SessionSummaryInput[],
  activeSessionId: string | null,
): SessionListView {
  const rows = sessions.map((s) =>
    Object.freeze({
      sessionId: s.sessionId,
      modelId: s.modelId,
      title: s.title,
      createdAt: s.createdAt,
      messageCount: s.messageCount,
      isActive: s.sessionId === activeSessionId,
    }),
  );
  return Object.freeze({
    rows: Object.freeze(rows),
    activeSessionId: rows.some((r) => r.isActive) ? activeSessionId : null,
  });
}

/**
 * Resolve which session the extension should resume after a reconnect.
 * Prefers the stored active id when it matches a known session; falls
 * back to the newest session (first row) when the stored id is missing
 * or no longer valid. Returns `null` when there are no sessions at all.
 *
 * Mirrors the desktop module's behaviour so closing+reopening the
 * VS Code window preserves the conversation.
 */
export function resolveActiveSessionId(
  stored: string | null | undefined,
  sessions: readonly SessionSummaryInput[],
): string | null {
  if (sessions.length === 0) return null;
  if (stored && sessions.some((s) => s.sessionId === stored)) {
    return stored;
  }
  return sessions[0]?.sessionId ?? null;
}

export const ACTIVE_SESSION_SETTING_KEY = "nexus.coding.activeSessionId";

// ---------------------------------------------------------------------------
// Sub-agent timeline
// ---------------------------------------------------------------------------

export type SubAgentEvent =
  | {
      readonly kind: "subagent.start";
      readonly spawnId: string;
      readonly agentType: string;
      readonly task: string;
      readonly startedAt: string;
    }
  | {
      readonly kind: "subagent.stop";
      readonly spawnId: string;
      readonly stoppedAt: string;
      readonly status: "completed" | "cancelled" | "failed";
      readonly summary?: string;
    };

export interface SubAgentTimelineRow {
  readonly spawnId: string;
  readonly agentType: string;
  readonly task: string;
  readonly startedAt: string;
  readonly stoppedAt: string | null;
  readonly status: "running" | "completed" | "cancelled" | "failed";
  readonly summary: string | null;
}

export interface SubAgentTimeline {
  readonly rows: readonly SubAgentTimelineRow[];
}

export function emptySubAgentTimeline(): SubAgentTimeline {
  return Object.freeze({ rows: Object.freeze([]) });
}

export function applySubAgentEvent(
  state: SubAgentTimeline,
  event: SubAgentEvent,
): SubAgentTimeline {
  switch (event.kind) {
    case "subagent.start": {
      // Idempotent: dedupe by spawnId so a re-played event stream does not
      // create duplicate rows.
      if (state.rows.some((r) => r.spawnId === event.spawnId)) return state;
      const row: SubAgentTimelineRow = Object.freeze({
        spawnId: event.spawnId,
        agentType: event.agentType,
        task: event.task,
        startedAt: event.startedAt,
        stoppedAt: null,
        status: "running",
        summary: null,
      });
      return Object.freeze({
        rows: Object.freeze([...state.rows, row]),
      });
    }
    case "subagent.stop": {
      const rows = state.rows.map((r) =>
        r.spawnId === event.spawnId
          ? Object.freeze({
              ...r,
              stoppedAt: event.stoppedAt,
              status: event.status,
              summary: event.summary ?? null,
            })
          : r,
      );
      return Object.freeze({ rows: Object.freeze(rows) });
    }
  }
}

export function applySubAgentEvents(
  events: readonly SubAgentEvent[],
): SubAgentTimeline {
  let state = emptySubAgentTimeline();
  for (const event of events) state = applySubAgentEvent(state, event);
  return state;
}
