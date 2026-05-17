import type { CodingSessionSummaryT } from "../../../../sidecar/src/protocol";

export interface SessionListPanelProps {
  sessions: readonly CodingSessionSummaryT[];
  activeSessionId: string | null;
  onResume: (sessionId: string) => void;
}

export function SessionListPanel({
  sessions,
  activeSessionId,
  onResume,
}: SessionListPanelProps): JSX.Element {
  return (
    <section data-testid="sessions-panel" aria-label="Sessions panel">
      <h2 style={{ marginTop: 0 }}>Sessions</h2>
      {sessions.length === 0 ? (
        <p style={{ color: "var(--fg-muted)" }}>No previous sessions.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {sessions.map((s) => (
            <li
              key={s.sessionId}
              style={{
                padding: "var(--space-2)",
                borderBottom: "1px solid var(--border-1)",
                background:
                  s.sessionId === activeSessionId ? "var(--bg-1)" : "transparent",
              }}
            >
              <button
                type="button"
                data-testid={`session-${s.sessionId}`}
                onClick={() => onResume(s.sessionId)}
                style={{
                  background: "transparent",
                  color: "var(--fg-0)",
                  border: "none",
                  width: "100%",
                  textAlign: "left",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <strong>{s.title}</strong>
                <span style={{ color: "var(--fg-muted)", marginLeft: "var(--space-2)" }}>
                  {s.modelId} - {s.messageCount} msg
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
