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
  MetricsInferenceResponseT,
  PerModelMetricSummaryT,
  TraceEventT,
} from "../../../sidecar/src/protocol";
import { CodingInput } from "./CodingInput";
import { MetalAccent } from "../../components/MetalAccent";
import { DEFAULT_MODEL_ID, FRONTEND_MODELS } from "./models";
import { applyEvents, type RenderedTurn } from "./toolCallCard";
import { MemoryPanel } from "./panels/MemoryPanel";
import { TraceDashboardPanel } from "./panels/TraceDashboardPanel";
import { SessionListPanel } from "./panels/SessionListPanel";
import { MessageList, type ChatMessage } from "../../shared/chat";
import { QuickModelSwitcher } from "../../shared/models/QuickModelSwitcher";
import { createIpcModelsClient } from "../../pages/settings/ipcModelsClient";
import type { ListedModelDto } from "../../pages/settings/modelsTypes";
import { defaultHarnessSelector } from "../../../../modules/coding/orchestration/HarnessSelector";
import {
  createIpcDocumentClient,
  type DocumentClient,
} from "../chat/documentClient";
import type { AgentActivity } from "../../components/agentState/mapping";

type Tab = "chat" | "memory" | "trace" | "sessions";

const FALLBACK_LLMS: readonly ListedModelDto[] = FRONTEND_MODELS.map((m) => ({
  id: m.id,
  displayName: m.displayName,
  type: "llm" as const,
  installed: true,
  source: "registry" as const,
}));

interface Turn {
  id: string;
  prompt: string;
  rendered: RenderedTurn;
  pending?: boolean;
  activity?: AgentActivity;
}

function turnsToMessages(turns: readonly Turn[], busy: boolean): readonly ChatMessage[] {
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
      pending: turn.pending,
      activity: turn.activity,
    });
  }
  if (busy && !turns.some((turn) => turn.pending)) {
    messages.push({
      id: "coding-pending",
      role: "assistant",
      content: "",
      pending: true,
      activity: "coding-tool-use",
    });
  }
  return messages;
}

export interface CodingPageProps {
  initialModelId?: string;
  initialTab?: Tab;
  /** v1.16.0 Phase 5 (A4) -- installed-model feed; tests inject a fake. */
  modelsClient?: { list(): Promise<readonly ListedModelDto[]> };
  onGetMoreModels?: () => void;
  /**
   * v1.20.0 Phase 3 -- document-parse client. Tests inject the in-memory one;
   * production talks to sidecar `ocr.*` IPC. This is the Chat parse action,
   * not a silent `parse_document` tool call.
   */
  documentClient?: DocumentClient;
}

export function CodingPage({
  initialModelId,
  initialTab,
  modelsClient: modelsClientOverride,
  onGetMoreModels,
  documentClient: documentClientOverride,
}: CodingPageProps = {}): JSX.Element {
  const [tab, setTab] = useState<Tab>(initialTab ?? "chat");
  const [modelId, setModelId] = useState<string>(initialModelId ?? DEFAULT_MODEL_ID);
  const [listedModels, setListedModels] = useState<readonly ListedModelDto[]>(FALLBACK_LLMS);
  const [documentClient] = useState<DocumentClient>(
    () => documentClientOverride ?? createIpcDocumentClient(),
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memorySnapshot, setMemorySnapshot] = useState<MemorySnapshotT | null>(null);
  const [traceEvents, setTraceEvents] = useState<readonly TraceEventT[]>([]);
  const [sessions, setSessions] = useState<readonly CodingSessionSummaryT[]>([]);
  // v1.16.0 Phase 2.2 -- per-model inference analytics for the Trace tab.
  const [modelMetrics, setModelMetrics] = useState<readonly PerModelMetricSummaryT[]>([]);
  // v1.1.0 Phase 7 -- session-replay state: the active session selected from
  // the trace dashboard's left rail, and the optional second session being
  // compared against it (with its own pre-fetched event list).
  const [replaySessionId, setReplaySessionId] = useState<string | null>(null);
  const [compareSessionId, setCompareSessionId] = useState<string | null>(null);
  const [compareEvents, setCompareEvents] = useState<readonly TraceEventT[]>([]);

  useEffect(() => {
    let cancelled = false;
    const source = modelsClientOverride ?? createIpcModelsClient();
    void source.list().then(
      (all) => {
        if (!cancelled && all.length > 0) setListedModels(all);
      },
      () => {
        // Keep the catalog fallback.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [modelsClientOverride]);

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

  const handleParseDocument = useCallback(
    async (text: string, attachment: string): Promise<void> => {
      const turnId = `parse-${Date.now()}`;
      const userContent =
        `${text || "(document)"}\n\n[1 attachment]`;
      setTurns((prev) => [
        ...prev,
        {
          id: turnId,
          prompt: userContent,
          rendered: { text: "Reading document...", cards: [], done: false },
          pending: true,
          activity: "document-parse",
        },
      ]);
      setBusy(true);
      const patch = (content: string, pending: boolean): void => {
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === turnId
              ? {
                  ...turn,
                  rendered: { ...turn.rendered, text: content, done: !pending },
                  pending,
                }
              : turn,
          ),
        );
      };
      try {
        const handle = documentClient.parse(attachment, ({ page, totalPages }) => {
          patch(
            totalPages > 0
              ? `Reading document... page ${page} of ${totalPages}`
              : "Reading document...",
            true,
          );
        });
        const result = await handle.done;
        const body = (result.markdown ?? result.text).trim();
        const header =
          result.pageCount > 1
            ? `Parsed ${result.pageCount} pages with ${result.engine}:`
            : `Parsed with ${result.engine}:`;
        const parsed =
          body.length > 0 ? `${header}\n\n${body}` : `${header}\n\n(no text found)`;
        const followUp =
          text.trim().length > 0
            ? `\n\nAsk a follow-up question about the parsed text above to send it to the model.`
            : "";
        patch(`${parsed}${followUp}`, false);
      } catch (err) {
        patch(
          `Could not parse the document: ${
            err instanceof Error ? err.message : String(err)
          }`,
          false,
        );
      } finally {
        setBusy(false);
      }
    },
    [documentClient],
  );

  const handleSubmit = useCallback(
    async (text: string, attachments: readonly string[] = []): Promise<void> => {
      setError(null);
      if (attachments.length > 0) {
        const first = attachments[0];
        if (first !== undefined) {
          await handleParseDocument(text, first);
        }
        return;
      }
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
    [ensureSession, handleParseDocument],
  );

  const handleCancel = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    await ipc.call("coding.session.cancel", { sessionId });
  }, [sessionId]);

  const handleNewSession = useCallback(async (): Promise<void> => {
    if (sessionId) {
      await ipc.call("coding.session.cancel", { sessionId });
    }
    setSessionId(null);
    setTurns([]);
    setBusy(false);
    setError(null);
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

  // v1.16.0 Phase 2.2 (adoption item A2) -- the Trace tab also loads per-model
  // inference analytics (tokens/sec, TTFT, memory). Read on tab activation like
  // the other trace data; the registry is in-process in the sidecar, so this is
  // a cheap local read with no disk or network access.
  useEffect(() => {
    if (tab !== "trace") return;
    void ipc.call<MetricsInferenceResponseT>("metrics.inference", {}).then((r) => {
      if (r.ok) setModelMetrics(r.value.perModel);
    });
  }, [tab]);

  // v1.1.0 Phase 7.1 -- the Trace tab also needs the session list so the
  // user can pick a session to replay or compare. Reload it whenever the
  // Trace tab becomes active.
  useEffect(() => {
    if (tab !== "trace") return;
    void ipc
      .call<CodingSessionListResponseT>("coding.sessions.list", {})
      .then((r) => {
        if (r.ok) setSessions(r.value.sessions);
      });
  }, [tab]);

  // v1.1.0 Phase 7.1 -- selecting a session in the trace dashboard loads
  // that session's events into the scrubber.
  const handleReplaySelect = useCallback(async (id: string): Promise<void> => {
    setReplaySessionId(id);
    setCompareSessionId(null);
    setCompareEvents([]);
    const reply = await ipc.call<CodingTraceSubscribeResponseT>(
      "coding.trace.subscribe",
      { sessionId: id },
    );
    if (reply.ok) setTraceEvents(reply.value.events);
  }, []);

  // v1.1.0 Phase 7.3 -- picking the second session pulls its events in
  // parallel and flips the dashboard to compare mode.
  const handleCompareSelect = useCallback(async (id: string): Promise<void> => {
    setCompareSessionId(id);
    const reply = await ipc.call<CodingTraceSubscribeResponseT>(
      "coding.trace.subscribe",
      { sessionId: id },
    );
    if (reply.ok) setCompareEvents(reply.value.events);
  }, []);

  const handleCloseCompare = useCallback((): void => {
    setCompareSessionId(null);
    setCompareEvents([]);
  }, []);

  const compareSummary = useMemo<CodingSessionSummaryT | null>(() => {
    if (!compareSessionId) return null;
    return sessions.find((s) => s.sessionId === compareSessionId) ?? null;
  }, [sessions, compareSessionId]);

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
        <h1
          style={{
            margin: 0,
            fontSize: "var(--text-lg)",
            color: "var(--accent-coding)",
            textShadow: "0 0 18px var(--accent-coding-soft)",
          }}
        >
          Agentic AI Coding
        </h1>
        <QuickModelSwitcher
          testId="coding-model-select"
          models={listedModels}
          taskType="llm"
          value={modelId}
          onChange={setModelId}
          onGetMoreModels={onGetMoreModels}
          disabled={Boolean(sessionId)}
          harnessLabel={defaultHarnessSelector.profileForModel(modelId).id}
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
              messages={turnsToMessages(turns, busy)}
              enableTools={true}
              emptyMessage={
                "Start by asking a question, attaching a document, or typing / for commands."
              }
            />
          </div>
        )}
        {tab === "memory" && <MemoryPanel snapshot={memorySnapshot} />}
        {tab === "trace" && (
          <TraceDashboardPanel
            events={traceEvents}
            sessions={sessions}
            modelMetrics={modelMetrics}
            activeSessionId={replaySessionId}
            onSelectSession={(id) => void handleReplaySelect(id)}
            compareSession={compareSummary}
            compareEvents={compareEvents}
            onPickCompareSession={(id) => void handleCompareSelect(id)}
            onCloseCompare={handleCloseCompare}
          />
        )}
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
          <CodingInput disabled={busy} streaming={busy} onSubmit={handleSubmit} />
          {sessionId && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              <MetalAccent
                accentToken="--accent-coding"
                surfaceId="coding-new-session"
                data-testid="coding-new-session-metal"
              >
                <button
                  type="button"
                  data-testid="coding-new-session"
                  onClick={() => void handleNewSession()}
                  style={{
                    padding: "var(--space-1) var(--space-3)",
                    backgroundColor: "var(--accent-coding)",
                    color: "var(--bg-0)",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                  }}
                >
                  New session
                </button>
              </MetalAccent>
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
            </div>
          )}
        </footer>
      )}
    </section>
  );
}
