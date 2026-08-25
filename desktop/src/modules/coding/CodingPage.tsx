import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ipc } from "../../lib/ipc";
import { formatInferenceError } from "../../lib/inferenceRpcError";
import type {
  CodingSessionEventT,
  CodingSessionListResponseT,
  CodingSessionResumeResponseT,
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
import { foldModelId } from "../../../../core/registry/modelAliases";
import { estimateTokens } from "../../../../core/chat/sessionContextUsage";
import { DEFAULT_MODEL_ID, FRONTEND_MODELS } from "./models";
import { applyEvents, type RenderedTurn } from "./toolCallCard";
import { MemoryPanel } from "./panels/MemoryPanel";
import { TraceDashboardPanel } from "./panels/TraceDashboardPanel";
import { SessionListPanel } from "./panels/SessionListPanel";
import { ComposerContextRow, MessageList, composerSessionUsage, type ChatMessage } from "../../shared/chat";
import { QuickModelSwitcher } from "../../shared/models/QuickModelSwitcher";
import {
  installedForTask,
  ownedIdSet,
  readFavorite,
  resolveDefaultId,
  type SelectionSnapshot,
} from "../../shared/models/selectionPolicy";
import { createIpcModelsClient } from "../../pages/settings/ipcModelsClient";
import type { ListedModelDto } from "../../pages/settings/modelsTypes";
import { SidecarDownBanner } from "../../components/SidecarDownBanner";
import { useSidecarStatus, type UseSidecarStatusOptions } from "../../lib/sidecarStatus";
import {
  createIpcDocumentClient,
  type DocumentClient,
} from "../chat/documentClient";
import type { AgentActivity } from "../../components/agentState/mapping";
import { useModelResidency } from "../../shared/models/useModelResidency";
import { ModelSwitchDialog } from "../../shared/models/ModelSwitchDialog";
import {
  busyContextFromScheduler,
  modelVramEstimate,
  residentModelsFromScheduler,
  type ResidencySessionMemory,
  type SchedulerActiveJob,
} from "../../shared/models/schedulerResidency";
import {
  readCodingWorkspacePath,
  writeCodingWorkspacePath,
} from "../../lib/persistence";

type Tab = "chat" | "memory" | "trace" | "sessions";

/** Not a picker feed. Placeholders until `models.list` + snapshot return. */
const FALLBACK_LLMS: readonly ListedModelDto[] = FRONTEND_MODELS.map((m) => ({
  id: m.id,
  displayName: m.displayName,
  type: "llm" as const,
  installed: false,
  source: "registry" as const,
}));

interface Turn {
  id: string;
  prompt: string;
  rendered: RenderedTurn;
  pending?: boolean;
  activity?: AgentActivity;
  inputTokens?: number | null;
  reasoningTokens?: number | null;
  outputTokens?: number | null;
  tokensEstimated?: boolean;
  createdAt?: string;
}

function turnsToMessages(turns: readonly Turn[], busy: boolean): readonly ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of turns) {
    messages.push({
      id: `${turn.id}-user`,
      role: "user",
      content: turn.prompt,
      timestamp: turn.createdAt,
      inputTokens: turn.inputTokens ?? null,
      tokensEstimated: turn.tokensEstimated,
    });
    const hasAssistant =
      Boolean(turn.pending) ||
      turn.rendered.text.length > 0 ||
      turn.rendered.cards.length > 0;
    if (hasAssistant) {
      messages.push({
        id: `${turn.id}-assistant`,
        role: "assistant",
        content: turn.rendered.text,
        timestamp: turn.createdAt,
        toolCards: turn.rendered.cards.map((card) => ({
          callId: card.callId,
          name: card.name,
          args: card.args,
          result: card.result,
        })),
        pending: turn.pending,
        activity: turn.activity,
        reasoningTokens: turn.reasoningTokens ?? null,
        outputTokens: turn.outputTokens ?? null,
        tokensEstimated: turn.tokensEstimated,
      });
    }
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

function usageFromCodingEvents(events: readonly CodingSessionEventT[]): {
  inputTokens: number | null;
  reasoningTokens: number | null;
  outputTokens: number | null;
} {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event && event.kind === "done") {
      return {
        inputTokens: event.inputTokens ?? null,
        reasoningTokens: event.reasoningTokens ?? null,
        outputTokens: event.outputTokens ?? null,
      };
    }
  }
  return { inputTokens: null, reasoningTokens: null, outputTokens: null };
}

export interface CodingPageProps {
  initialModelId?: string;
  initialTab?: Tab;
  /** v1.16.0 Phase 5 (A4) -- installed-model feed; tests inject a fake. */
  modelsClient?: {
    list(): Promise<readonly ListedModelDto[]>;
    lastSelection?: SelectionSnapshot | null;
  };
  onGetMoreModels?: () => void;
  /**
   * v1.20.0 Phase 3 -- document-parse client. Tests inject the in-memory one;
   * production talks to sidecar `ocr.*` IPC. This is the Chat parse action,
   * not a silent `parse_document` tool call.
   */
  documentClient?: DocumentClient;
  /** v2.2.2 -- test seam for the backend-down banner. */
  sidecarStatus?: UseSidecarStatusOptions;
  /** v2.2.3 Phase 5 -- submit-time GPU occupancy inputs. */
  hostVramFreeGB?: number | null;
  activeSchedulerJob?: SchedulerActiveJob | null;
  residencyMemory?: ResidencySessionMemory;
  /** v2.2.3 Phase 6 -- test/bootstrap seam for the persisted workspace field. */
  initialWorkspacePath?: string;
}

export function CodingPage({
  initialModelId,
  initialTab,
  modelsClient: modelsClientOverride,
  onGetMoreModels,
  documentClient: documentClientOverride,
  sidecarStatus: sidecarStatusOptions,
  hostVramFreeGB = null,
  activeSchedulerJob = null,
  residencyMemory,
  initialWorkspacePath,
}: CodingPageProps = {}): JSX.Element {
  const [tab, setTab] = useState<Tab>(initialTab ?? "chat");
  const [modelId, setModelId] = useState<string>(initialModelId ?? DEFAULT_MODEL_ID);
  const [listedModels, setListedModels] = useState<readonly ListedModelDto[]>(FALLBACK_LLMS);
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  const [documentClient] = useState<DocumentClient>(
    () => documentClientOverride ?? createIpcDocumentClient(),
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState(
    () => initialWorkspacePath ?? readCodingWorkspacePath() ?? "",
  );
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
  const sidecar = useSidecarStatus(sidecarStatusOptions);
  const residency = useModelResidency({ rememberedPairs: residencyMemory });
  const pendingPromptRef = useRef<{ text: string; attachments: readonly string[] }>({
    text: "",
    attachments: [],
  });

  useEffect(() => {
    let cancelled = false;
    const source = modelsClientOverride ?? createIpcModelsClient();
    void source.list().then(
      (all) => {
        if (!cancelled && all.length > 0) {
          const snap = source.lastSelection ?? null;
          setListedModels(all);
          setSelection(snap);
          const ready = installedForTask(all, "agentic", snap);
          const next = resolveDefaultId(ready, {
            favorite: readFavorite("agentic"),
            recommended: snap?.recommendedByTask.agentic ?? null,
          });
          if (next) {
            setModelId((current) => (ready.some((m) => m.id === current) ? current : next));
          }
        }
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
    const selectedWorkspace = workspacePath.trim();
    if (!selectedWorkspace) {
      setError("Choose a workspace folder before starting a coding session.");
      return null;
    }
    const reply = await ipc.call<CodingSessionStartResponseT>("coding.session.start", {
      modelId: foldModelId(modelId),
      workspacePath: selectedWorkspace,
    });
    if (!reply.ok) {
      setError(`Could not start session: ${reply.message}`);
      return null;
    }
    setSessionId(reply.value.sessionId);
    return reply.value.sessionId;
  }, [modelId, sessionId, workspacePath]);

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
          createdAt: new Date().toISOString(),
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
    async (
      text: string,
      attachments: readonly string[] = [],
      residencyApproved = false,
    ): Promise<void> => {
      setError(null);
      if (!residencyApproved) {
        const selectedModel = listedModels.find((candidate) => candidate.id === modelId);
        const verdict = residency.request({
          targetModelId: modelId,
          targetVramGB: modelVramEstimate(selectedModel?.vramGB),
          requestingModule: "coding",
          resident: residentModelsFromScheduler(activeSchedulerJob),
          freeVramGB: hostVramFreeGB,
          activeJob: busyContextFromScheduler(activeSchedulerJob),
          installed: Boolean(selectedModel?.installed),
        });
        if (verdict.kind === "confirm") {
          pendingPromptRef.current = { text, attachments };
          return;
        }
        if (verdict.kind === "not-installed" || verdict.kind === "defer") {
          const notice =
            verdict.kind === "not-installed"
              ? `${modelId} is not installed. Install it in Settings > Models.`
              : `Cannot load ${modelId} right now: ${verdict.reason}`;
          if (text.trim().length > 0 && attachments.length === 0) {
            setTurns((prev) => [
              ...prev,
              {
                id: `local-${Date.now()}`,
                prompt: text,
                createdAt: new Date().toISOString(),
                rendered: { text: notice, cards: [], done: true },
              },
            ]);
          }
          setError(notice);
          return;
        }
      }
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
          setError(`sendMessage failed: ${formatInferenceError(reply.message)}`);
          return;
        }
        const rendered = applyEvents(reply.value.events);
        const usage = usageFromCodingEvents(reply.value.events);
        const estimated =
          usage.inputTokens == null &&
          usage.reasoningTokens == null &&
          usage.outputTokens == null;
        setTurns((prev) => [
          ...prev,
          {
            id: `${id}-${prev.length}`,
            prompt: text,
            createdAt: new Date().toISOString(),
            rendered,
            inputTokens: estimated ? estimateTokens(text) : usage.inputTokens,
            reasoningTokens: usage.reasoningTokens,
            outputTokens: estimated ? estimateTokens(rendered.text) : usage.outputTokens,
            tokensEstimated: estimated,
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [
      activeSchedulerJob,
      ensureSession,
      handleParseDocument,
      hostVramFreeGB,
      listedModels,
      modelId,
      residency,
    ],
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

  const reloadSessions = useCallback(async (): Promise<void> => {
    const reply = await ipc.call<CodingSessionListResponseT>("coding.sessions.list", {});
    if (reply.ok) setSessions(reply.value.sessions);
  }, []);

  const handleResume = useCallback(async (id: string): Promise<void> => {
    setError(null);
    const reply = await ipc.call<CodingSessionResumeResponseT>("coding.session.resume", {
      sessionId: id,
    });
    if (!reply.ok) {
      setSessionId(null);
      setTurns([]);
      setTab("chat");
      setError(`Could not resume session: ${reply.message}`);
      return;
    }
    setSessionId(id);
    if (reply.value.session.modelId) setModelId(reply.value.session.modelId);
    const restored = reply.value.turns ?? [];
    if (restored.length > 0) {
      setTurns(
        restored.map((turn, index) => ({
          id: `${id}-${index}`,
          prompt: turn.prompt,
          rendered: { text: turn.assistantText, cards: [], done: true },
          inputTokens: turn.inputTokens ?? null,
          reasoningTokens: turn.reasoningTokens ?? null,
          outputTokens: turn.outputTokens ?? null,
          tokensEstimated: turn.tokensEstimated,
          createdAt: turn.createdAt,
        })),
      );
    } else {
      setTurns(
        reply.value.messages.map((prompt, index) => ({
          id: `${id}-${index}`,
          prompt,
          rendered: { text: "", cards: [], done: true },
        })),
      );
    }
    setTab("chat");
  }, []);

  const handleRenameSession = useCallback(
    async (id: string, title: string): Promise<void> => {
      const reply = await ipc.call("coding.session.rename", { sessionId: id, title });
      if (!reply.ok) {
        setError(`Could not rename session: ${reply.message}`);
        return;
      }
      await reloadSessions();
    },
    [reloadSessions],
  );

  const handleDeleteSession = useCallback(
    async (id: string): Promise<void> => {
      const reply = await ipc.call("coding.session.delete", { sessionId: id });
      if (!reply.ok) {
        setError(`Could not delete session: ${reply.message}`);
        return;
      }
      if (sessionId === id) {
        setSessionId(null);
        setTurns([]);
      }
      await reloadSessions();
    },
    [reloadSessions, sessionId],
  );

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

  const transcriptMessages = useMemo(() => turnsToMessages(turns, busy), [turns, busy]);
  const pickerModel = useMemo(
    () => listedModels.find((candidate) => candidate.id === modelId),
    [listedModels, modelId],
  );
  const contextUsage = useMemo(
    () => composerSessionUsage(transcriptMessages, pickerModel),
    [transcriptMessages, pickerModel],
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
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <label
          htmlFor="coding-workspace-path"
          style={{
            display: "grid",
            gridTemplateColumns: "auto minmax(0, 1fr)",
            alignItems: "center",
            gap: "var(--space-2)",
            color: "var(--fg-muted)",
            fontSize: "var(--text-xs)",
          }}
        >
          Workspace
          <input
            id="coding-workspace-path"
            data-testid="coding-workspace-path"
            type="text"
            value={workspacePath}
            disabled={Boolean(sessionId)}
            placeholder="C:\\path\\to\\project"
            onChange={(event) => {
              const next = event.currentTarget.value;
              setWorkspacePath(next);
              writeCodingWorkspacePath(next);
            }}
            style={{
              minWidth: 0,
              padding: "var(--space-1) var(--space-2)",
              color: "var(--fg-0)",
              background: "color-mix(in srgb, var(--bg-1) 72%, transparent)",
              border: "1px solid var(--border-1)",
              borderRadius: "var(--radius-md)",
            }}
          />
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

      {residency.pending ? (
        <ModelSwitchDialog
          pending={residency.pending}
          testId="coding-model-switch-dialog"
          onResolve={(resolution) => {
            const resolved = residency.resolvePending(resolution);
            if (resolved && resolved.kind !== "confirm") {
              const resumed = pendingPromptRef.current;
              pendingPromptRef.current = { text: "", attachments: [] };
              void handleSubmit(resumed.text, resumed.attachments, true);
            }
          }}
          onExpire={() => residency.dismissPending()}
        />
      ) : null}

      {sidecar.isDown && (
        <SidecarDownBanner
          status={sidecar.status}
          restarting={sidecar.restarting}
          restartError={sidecar.restartError}
          onRestart={() => void sidecar.restart()}
          context="Coding cannot reach the local backend."
          testId="coding-sidecar-down"
        />
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "chat" && (
          <div data-testid="coding-chat">
            <MessageList
              messages={transcriptMessages}
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
            onResume={(id) => void handleResume(id)}
            onRename={(id, title) => void handleRenameSession(id, title)}
            onDelete={(id) => void handleDeleteSession(id)}
          />
        )}
      </div>

      {tab === "chat" && (
        <footer style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <CodingInput disabled={busy} streaming={busy} onSubmit={handleSubmit} />
          <ComposerContextRow usage={contextUsage} onStartNewSession={() => void handleNewSession()}>
            <QuickModelSwitcher
              testId="coding-model-select"
              models={listedModels}
              taskType="llm"
              ownedIds={ownedIdSet(selection)}
              value={modelId}
              onChange={setModelId}
              onGetMoreModels={onGetMoreModels}
              disabled={Boolean(sessionId)}
            />
          </ComposerContextRow>
          {sessionId && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              {/*
                v2.2.3 Phase 2: the MetalAccent ring is replaced by the same
                liquid-glass treatment the rest of the chrome uses (frosted
                fill, hairline, inset highlight) -- no pillar hue, no metal.
              */}
              <button
                type="button"
                data-testid="coding-new-session"
                onClick={() => void handleNewSession()}
                style={{
                  padding: "var(--space-1) var(--space-3)",
                  backgroundColor: "color-mix(in srgb, var(--bg-1) 70%, transparent)",
                  color: "var(--fg-0)",
                  border: "1px solid color-mix(in srgb, var(--fg-0) 14%, transparent)",
                  boxShadow: "inset 0 1px 0 color-mix(in srgb, white 8%, transparent)",
                  backdropFilter: "blur(12px)",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                }}
              >
                New session
              </button>
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
