import type { TraceEventT } from "../../../../sidecar/src/protocol";

export interface TraceDashboardPanelProps {
  events: readonly TraceEventT[];
}

export function TraceDashboardPanel({ events }: TraceDashboardPanelProps): JSX.Element {
  return (
    <section data-testid="trace-panel" aria-label="Trace dashboard panel">
      <h2 style={{ marginTop: 0 }}>Trace</h2>
      {events.length === 0 ? (
        <p style={{ color: "var(--fg-muted)" }}>No trace events recorded yet.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {events.map((e) => (
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
              <strong>[{e.kind}]</strong> {e.summary}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
