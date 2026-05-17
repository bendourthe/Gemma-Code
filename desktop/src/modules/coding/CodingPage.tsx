import { useCallback, useEffect, useMemo, useState } from "react";
import { ipc } from "../../lib/ipc";
import type {
  CodingSessionEventT,
  CodingSessionListResponseT,
  CodingSessionStartResponseT,
  CodingSessionSummaryT,
  CodingMemorySnapshotResponseT,
  CodingTraceSubscribeResponseT,
  MemorySnapshotT,
  TraceEventT,
} from "../../../sidecar/src/protocol";
import { CodingInput } from "./CodingInput";
import { DEFAULT_MODEL_ID, FRONTEND_MODELS } from "./models";
import { applyEvents, type RenderedTurn } from "./toolCallCard";
import { MemoryPanel } from "./panels/MemoryPanel";
import { TraceDashboardPanel } from "./panels/TraceDashboardPanel";
import { SessionListPanel } from "./panels/SessionListPanel";

type Tab = "chat" | "memory" | "trace" | "sessions";

interface Turn {
  id: string;
  prompt: string;
  rendered: RenderedTurn;
}

export interface CodingPageProps {
  initialModelId?: string;
  initialTab?: Tab;
}

export function CodingPage({
  initialModelId,
  initialTab,
}: CodingPageProps = {}): JSX.Element {
  const [tab, setTab] = useState<Tab>(initialTab ?? "chat");
  const [modelId, setModelId] = useState<string>(initialModelId ?? DEFAULT_MODEL_ID);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memorySnapshot, setMemorySnapshot] = useState<MemorySnapshotT | null>(null);
  const [traceEvents, setTraceEvents] = useState<readonly TraceEventT[]>([]);
  const [sessions, setSessions] = useState<readonly CodingSessionSummaryT[]>([]);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionId) return sessionId;
    const reply = await ipc.call<CodingSessionStartResponseT>("coding.session.start", {
      modelId,
    });
    if (!reply.ok) {
      setError(`Could not start session: ${reply.message}`);
      return null;
    }
    setSessionId(reply.value.sessionId);
    return reply.value.sessionId;
  }, [modelId, sessionId]);

  const handleSubmit = useCallback(
    async (text: string): Promise<void> => {
      setError(null);
      setBusy(true);
      try {
        const id = await ensureSession();
        if (!id) return;
        const reply = await ipc.call<{
          sessionId: string;
          events: CodingSessionEventT[];
        }>("coding.session.sendMessage", { sessionId: id, message: text });
        if (!reply.ok) {
          setError(`sendMessage failed: ${reply.message}`);
          return;
        }
        const rendered = applyEvents(reply.value.events);
        setTurns((prev) => [
          ...prev,
          { id: `${id}-${prev.length}`, prompt: text, rendered },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [ensureSession],
  );

  const handleCancel = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    await ipc.call("coding.session.cancel", { sessionId });
  }, [sessionId]);

  useEffect(() => {
    if (tab !== "memory") return;
    void ipc
      .call<CodingMemorySnapshotResponseT>("coding.memory.snapshot", {})
      .then((r) => {
        if (r.ok) setMemorySnapshot(r.value.snapshot);
      });
  }, [tab]);

  useEffect(() => {
    if (tab !== "trace") return;
    void ipc
      .call<CodingTraceSubscribeResponseT>("coding.trace.subscribe", {})
      .then((r) => {
        if (r.ok) setTraceEvents(r.value.events);
      });
  }, [tab]);

  useEffect(() => {
    if (tab !== "sessions") return;
    void ipc
      .call<CodingSessionListResponseT>("coding.sessions.list", {})
      .then((r) => {
        if (r.ok) setSessions(r.value.sessions);
      });
  }, [tab]);

  const tabButtonStyle = useMemo(
    () => (active: boolean): React.CSSProperties => ({
      padding: "var(--space-2) var(--space-3)",
      background: active ? "var(--bg-1)" : "transparent",
      color: active ? "var(--fg-0)" : "var(--fg-muted)",
      border: "1px solid var(--border-1)",
      borderBottom: active ? "1px solid var(--bg-1)" : "1px solid var(--border-1)",
      cursor: "pointer",
    }),
    [],
  );

  return (
    <section
      data-testid="coding-page"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "var(--space-4)",
        color: "var(--fg-0)",
        gap: "var(--space-3)",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0, color: "var(--accent-coding)" }}>Agentic AI Coding</h1>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span style={{ color: "var(--fg-muted)" }}>Model</span>
          <select
            data-testid="coding-model-select"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            disabled={Boolean(sessionId)}
            style={{
              padding: "var(--space-1) var(--space-2)",
              backgroundColor: "var(--bg-1)",
              color: "var(--fg-0)",
              border: "1px solid var(--border-1)",
              borderRadius: "var(--radius-md)",
            }}
          >
            {FRONTEND_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
      </header>

      <nav role="tablist" style={{ display: "flex", gap: 0 }}>
        {(["chat", "memory", "trace", "sessions"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            data-testid={`coding-tab-${t}`}
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={tabButtonStyle(tab === t)}
          >
            {t[0]?.toUpperCase()}{t.slice(1)}
          </button>
        ))}
      </nav>

      {error && (
        <p data-testid="coding-error" role="alert" style={{ color: "var(--accent-danger, #f55)" }}>
          {error}
        </p>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "chat" && (
          <div data-testid="coding-chat">
            {turns.length === 0 ? (
              <p style={{ color: "var(--fg-muted)" }}>
                Start by asking a question or typing <code>/</code> for commands.
              </p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {turns.map((turn) => (
                  <li
                    key={turn.id}
                    data-testid={`turn-${turn.id}`}
                    style={{ marginBottom: "var(--space-3)" }}
                  >
                    <p style={{ color: "var(--fg-muted)", margin: 0 }}>
                      <strong>You:</strong> {turn.prompt}
                    </p>
                    <p style={{ whiteSpace: "pre-wrap", margin: "var(--space-1) 0" }}>
                      {turn.rendered.text}
                    </p>
                    {turn.rendered.cards.map((card) => (
                      <div
                        key={card.callId}
                        data-testid={`tool-card-${card.callId}`}
                        style={{
                          border: "1px solid var(--border-1)",
                          padding: "var(--space-2)",
                          borderRadius: "var(--radius-md)",
                          backgroundColor: "var(--bg-1)",
                        }}
                      >
                        <header>
                          <strong>{card.name}</strong>
                        </header>
                        <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{card.args}</pre>
                        {card.result !== null && (
                          <p style={{ margin: "var(--space-1) 0 0", color: "var(--fg-muted)" }}>
                            -&gt; {card.result}
                          </p>
                        )}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {tab === "memory" && <MemoryPanel snapshot={memorySnapshot} />}
        {tab === "trace" && <TraceDashboardPanel events={traceEvents} />}
        {tab === "sessions" && (
          <SessionListPanel
            sessions={sessions}
            activeSessionId={sessionId}
            onResume={(id) => setSessionId(id)}
          />
        )}
      </div>

      {tab === "chat" && (
        <footer style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <CodingInput disabled={busy} onSubmit={handleSubmit} />
          {sessionId && (
            <button
              type="button"
              data-testid="coding-cancel"
              onClick={() => void handleCancel()}
              style={{
                alignSelf: "flex-start",
                padding: "var(--space-1) var(--space-2)",
                background: "transparent",
                color: "var(--fg-muted)",
                border: "1px solid var(--border-1)",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
              }}
            >
              Cancel session
            </button>
          )}
        </footer>
      )}
    </section>
  );
}
