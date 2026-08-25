import { useState, type CSSProperties } from "react";
import type { CodingSessionSummaryT } from "../../../../sidecar/src/protocol";

export interface SessionListPanelProps {
  sessions: readonly CodingSessionSummaryT[];
  activeSessionId: string | null;
  onResume: (sessionId: string) => void;
  onRename?: (sessionId: string, title: string) => void;
  onDelete?: (sessionId: string) => void;
}

export function SessionListPanel({
  sessions,
  activeSessionId,
  onResume,
  onRename,
  onDelete,
}: SessionListPanelProps): JSX.Element {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const commitRename = (sessionId: string): void => {
    const next = draftTitle.trim();
    setRenamingId(null);
    if (next.length > 0) onRename?.(sessionId, next);
  };

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
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-1)",
              }}
            >
              {renamingId === s.sessionId ? (
                <input
                  data-testid={`session-rename-input-${s.sessionId}`}
                  value={draftTitle}
                  aria-label="Rename session"
                  onChange={(event) => setDraftTitle(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRename(s.sessionId);
                    if (event.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={() => commitRename(s.sessionId)}
                  autoFocus
                  style={{
                    padding: "var(--space-1)",
                    color: "var(--fg-0)",
                    background: "transparent",
                    border: "1px solid var(--border-1)",
                    borderRadius: "var(--radius-md)",
                  }}
                />
              ) : (
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
              )}
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                {onRename && renamingId !== s.sessionId ? (
                  <button
                    type="button"
                    data-testid={`session-rename-${s.sessionId}`}
                    onClick={() => {
                      setConfirmDeleteId(null);
                      setRenamingId(s.sessionId);
                      setDraftTitle(s.title);
                    }}
                    style={ghostButtonStyle}
                  >
                    Rename
                  </button>
                ) : null}
                {onDelete && confirmDeleteId !== s.sessionId ? (
                  <button
                    type="button"
                    data-testid={`session-delete-${s.sessionId}`}
                    onClick={() => {
                      setRenamingId(null);
                      setConfirmDeleteId(s.sessionId);
                    }}
                    style={ghostButtonStyle}
                  >
                    Delete
                  </button>
                ) : null}
                {onDelete && confirmDeleteId === s.sessionId ? (
                  <button
                    type="button"
                    data-testid={`session-delete-confirm-${s.sessionId}`}
                    onClick={() => {
                      setConfirmDeleteId(null);
                      onDelete(s.sessionId);
                    }}
                    style={ghostButtonStyle}
                  >
                    Confirm delete
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ghostButtonStyle: CSSProperties = {
  background: "transparent",
  color: "var(--fg-muted)",
  border: "1px solid var(--border-1)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  padding: "0 var(--space-2)",
};
