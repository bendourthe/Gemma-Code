import { useMemo, useState } from "react";
import type { TraceEventT } from "../../../../sidecar/src/protocol";

export interface TraceDashboardPanelProps {
  events: readonly TraceEventT[];
}

/**
 * v1.1.0 Phase 4.5 -- TraceDashboard gains a `hookKind` dropdown filter.
 *
 * The dropdown is populated from the distinct `hookKind` values present
 * on the current event list (events without a `hookKind` are always
 * visible because they are not lifecycle-sourced). Choosing a value
 * narrows the visible events to that hook only.
 */
export function TraceDashboardPanel({
  events,
}: TraceDashboardPanelProps): JSX.Element {
  const [hookKindFilter, setHookKindFilter] = useState<string>("");

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

  return (
    <section data-testid="trace-panel" aria-label="Trace dashboard panel">
      <h2 style={{ marginTop: 0 }}>Trace</h2>
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
      {filteredEvents.length === 0 ? (
        <p style={{ color: "var(--fg-muted)" }}>No trace events recorded yet.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {filteredEvents.map((e) => (
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
    </section>
  );
}
