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
import { MessageList, ModelSelector, type ChatMessage } from "../../shared/chat";

type Tab = "chat" | "memory" | "trace" | "sessions";

interface Turn {
  id: string;
  prompt: string;
  rendered: RenderedTurn;
}

function turnsToMessages(turns: readonly Turn[]): readonly ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of turns) {
    messages.push({ id: `${turn.id}-user`, role: "user", content: turn.prompt });
    messages.push({
      id: `${turn.id}-assistant`,
      role: "assistant",
      content: turn.rendered.text,
      toolCards: turn.rendered.cards.map((card) => ({
        callId: card.callId,
        name: card.name,
        args: card.args,
        result: card.result,
      })),
    });
  }
  return messages;
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
        <ModelSelector
          testId="coding-model-select"
          models={FRONTEND_MODELS}
          value={modelId}
          onChange={setModelId}
          disabled={Boolean(sessionId)}
        />
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
            <MessageList
              messages={turnsToMessages(turns)}
              enableTools={true}
              emptyMessage={
                "Start by asking a question or typing / for commands."
              }
            />
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
