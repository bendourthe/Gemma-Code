import { useEffect, useMemo, useState } from "react";
import type {
  CodingSessionSummaryT,
  TraceEventT,
} from "../../../../sidecar/src/protocol";
import { TimelineScrubber } from "./TimelineScrubber";
import { SessionCompareView } from "./SessionCompareView";

export interface TraceDashboardPanelProps {
  events: readonly TraceEventT[];
  /**
   * v1.1.0 Phase 7.1 -- optional list of recorded sessions. When supplied,
   * the panel renders a left-side session list; clicking a row asks the
   * parent to load that session's events via `onSelectSession`.
   */
  sessions?: readonly CodingSessionSummaryT[];
  /** Currently-selected session id (drives the highlight in the side list). */
  activeSessionId?: string | null;
  /** Called when the user clicks a session row. */
  onSelectSession?: (sessionId: string) => void;
  /**
   * v1.1.0 Phase 7.3 -- once the user picks a comparison session, the parent
   * supplies its metadata + events here and the panel switches to side-by-side
   * mode. Setting this to null/undefined exits compare mode.
   */
  compareSession?: CodingSessionSummaryT | null;
  compareEvents?: readonly TraceEventT[];
  /** Bubbles up the user's compare-target pick to the parent. */
  onPickCompareSession?: (sessionId: string) => void;
  /** Called when the user clicks "Close compare". */
  onCloseCompare?: () => void;
  /** Test seam: forwarded to TimelineScrubber instances. */
  now?: () => number;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (handle: number) => void;
}

/**
 * v1.1.0 Phase 7 -- the TraceDashboard now hosts:
 *   1. a session-list side panel (sub-task 7.1), and
 *   2. a `<TimelineScrubber>` for the active session (sub-task 7.2), and
 *   3. a "Compare to..." button that opens a session-picker dialog and
 *      flips to a side-by-side compare view (sub-task 7.3).
 *
 * When no `sessions` prop is supplied, the panel renders the legacy
 * `hookKind`-filtered event list -- this keeps existing tests + the older
 * call site in CodingPage backward-compatible.
 */
export function TraceDashboardPanel({
  events,
  sessions,
  activeSessionId,
  onSelectSession,
  compareSession,
  compareEvents,
  onPickCompareSession,
  onCloseCompare,
  now,
  raf,
  caf,
}: TraceDashboardPanelProps): JSX.Element {
  const [hookKindFilter, setHookKindFilter] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);

  // Close the picker once the parent acknowledges the compare target.
  useEffect(() => {
    if (compareSession) setPickerOpen(false);
  }, [compareSession]);

  const availableHookKinds = useMemo<readonly string[]>(() => {
    const set = new Set<string>();
    for (const e of events) {
      if (e.hookKind && e.hookKind.length > 0) set.add(e.hookKind);
    }
    return Array.from(set).sort();
  }, [events]);

  const filteredEvents = useMemo<readonly TraceEventT[]>(() => {
    if (!hookKindFilter) return events;
    return events.filter((e) => !e.hookKind || e.hookKind === hookKindFilter);
  }, [events, hookKindFilter]);

  const activeSession = useMemo<CodingSessionSummaryT | null>(() => {
    if (!sessions || !activeSessionId) return null;
    return sessions.find((s) => s.sessionId === activeSessionId) ?? null;
  }, [sessions, activeSessionId]);

  // Sessions eligible to be picked as compare target = all minus the active one.
  const compareCandidates = useMemo<readonly CodingSessionSummaryT[]>(() => {
    if (!sessions) return [];
    return sessions.filter((s) => s.sessionId !== activeSessionId);
  }, [sessions, activeSessionId]);

  const compareModeActive = Boolean(
    compareSession && compareEvents && activeSession,
  );

  const renderSessionList = (): JSX.Element | null => {
    if (!sessions) return null;
    return (
      <aside
        data-testid="trace-session-list"
        aria-label="Recorded sessions"
        style={{
          minWidth: "220px",
          borderRight: "1px solid var(--border-1)",
          paddingRight: "var(--space-2)",
        }}
      >
        <header style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>
          Sessions
        </header>
        {sessions.length === 0 ? (
          <p style={{ color: "var(--fg-muted)" }}>No recorded sessions.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {sessions.map((s) => {
              const isActive = s.sessionId === activeSessionId;
              return (
                <li
                  key={s.sessionId}
                  style={{
                    padding: "var(--space-2)",
                    borderBottom: "1px solid var(--border-1)",
                    background: isActive ? "var(--bg-1)" : "transparent",
                  }}
                >
                  <button
                    type="button"
                    data-testid={`trace-session-${s.sessionId}`}
                    onClick={() => onSelectSession?.(s.sessionId)}
                    style={{
                      background: "transparent",
                      color: "var(--fg-0)",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                    }}
                  >
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                      {s.sessionId.slice(0, 8)}
                    </div>
                    <div style={{ fontWeight: 600 }}>{s.title}</div>
                    <div style={{ color: "var(--fg-muted)", fontSize: "0.8rem" }}>
                      {s.modelId} - {s.messageCount} ev - {s.createdAt}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    );
  };

  const renderEventList = (
    visibleEvents: readonly TraceEventT[],
  ): JSX.Element => (
    <>
      <label
        data-testid="trace-hookkind-filter"
        style={{
          display: "inline-flex",
          gap: "var(--space-2)",
          alignItems: "center",
          marginBottom: "var(--space-2)",
          fontSize: "0.875rem",
          color: "var(--fg-muted)",
        }}
      >
        hookKind:
        <select
          value={hookKindFilter}
          onChange={(e) => setHookKindFilter(e.target.value)}
          aria-label="Filter by hookKind"
        >
          <option value="">(all)</option>
          {availableHookKinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      {visibleEvents.length === 0 ? (
        <p style={{ color: "var(--fg-muted)" }}>No trace events recorded yet.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {visibleEvents.map((e) => (
            <li
              key={e.id}
              data-testid={`trace-event-${e.id}`}
              style={{
                padding: "var(--space-2)",
                borderBottom: "1px solid var(--border-1)",
              }}
            >
              <span style={{ color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}>
                {e.timestamp}
              </span>{" "}
              <strong>[{e.kind}]</strong>{" "}
              {e.hookKind ? (
                <span
                  data-testid={`trace-hookkind-${e.id}`}
                  style={{
                    display: "inline-block",
                    marginRight: "var(--space-2)",
                    padding: "0 var(--space-1)",
                    border: "1px solid var(--border-1)",
                    borderRadius: "4px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.7rem",
                    color: "var(--fg-muted)",
                  }}
                >
                  {e.hookKind}
                </span>
              ) : null}
              {e.summary}
            </li>
          ))}
        </ul>
      )}
    </>
  );

  // The "Compare to..." picker dialog.
  const renderPicker = (): JSX.Element | null => {
    if (!pickerOpen) return null;
    return (
      <div
        data-testid="trace-compare-picker"
        role="dialog"
        aria-label="Pick a session to compare"
        style={{
          border: "1px solid var(--border-1)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-2)",
          marginBottom: "var(--space-2)",
        }}
      >
        <header style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>
          Compare to...
        </header>
        {compareCandidates.length === 0 ? (
          <p style={{ color: "var(--fg-muted)" }}>No other sessions available.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {compareCandidates.map((s) => (
              <li key={s.sessionId} style={{ padding: "var(--space-1) 0" }}>
                <button
                  type="button"
                  data-testid={`trace-compare-pick-${s.sessionId}`}
                  onClick={() => onPickCompareSession?.(s.sessionId)}
                >
                  {s.sessionId.slice(0, 8)} -- {s.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          data-testid="trace-compare-picker-cancel"
          onClick={() => setPickerOpen(false)}
        >
          Cancel
        </button>
      </div>
    );
  };

  return (
    <section data-testid="trace-panel" aria-label="Trace dashboard panel">
      <h2 style={{ marginTop: 0 }}>Trace</h2>

      <div style={{ display: "flex", gap: "var(--space-3)" }}>
        {renderSessionList()}

        <div style={{ flex: 1 }}>
          {compareModeActive && activeSession && compareSession && compareEvents ? (
            <SessionCompareView
              sessionA={activeSession}
              eventsA={events}
              sessionB={compareSession}
              eventsB={compareEvents}
              onCloseCompare={onCloseCompare}
              now={now}
              raf={raf}
              caf={caf}
            />
          ) : (
            <>
              {sessions && activeSession && (
                <header
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "var(--space-2)",
                  }}
                >
                  <span>
                    Replaying:{" "}
                    <strong data-testid="trace-active-session-title">
                      {activeSession.title}
                    </strong>
                  </span>
                  <button
                    type="button"
                    data-testid="trace-compare-open"
                    onClick={() => setPickerOpen(true)}
                    disabled={compareCandidates.length === 0}
                  >
                    Compare to...
                  </button>
                </header>
              )}

              {renderPicker()}

              {sessions && activeSession && (
                <TimelineScrubber
                  events={events}
                  now={now}
                  raf={raf}
                  caf={caf}
                  testIdPrefix="trace-scrubber"
                />
              )}

              {renderEventList(filteredEvents)}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
