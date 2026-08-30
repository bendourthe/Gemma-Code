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
import {
  estimatedMessageUsage,
  type MessageTokenUsageV1,
  type RequestTokenUsageV1,
} from "../../../../core/chat/tokenUsage";
import { DEFAULT_MODEL_ID, FRONTEND_MODELS } from "./models";
import { applyEvents, type RenderedTurn } from "./toolCallCard";
import { MemoryPanel } from "./panels/MemoryPanel";
import { TraceDashboardPanel } from "./panels/TraceDashboardPanel";
import { ComposerContextRow, MessageList, composerSessionUsage, type ChatMessage } from "../../shared/chat";
import { FolderTree, type FolderTreeCopy, type SelectedNode } from "../chat/FolderTree";
import type { Chat } from "../chat/types";
import {
  CollapsibleHistoryAside,
  usePersistentCollapsed,
} from "../../shared/explorer/CollapsibleHistoryAside";
import { CODING_HISTORY_COLLAPSE_KEY } from "../../shared/explorer/historyPaneLayout";
import {
  createCodingSessionsAsChatExplorer,
  createIpcCodingExplorerBackend,
} from "../../shared/explorer/codingSessionsAsChatExplorer";
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
  normalizeCodingWorkspaceSelection,
  readCodingWorkspaceSelection,
  writeCodingWorkspaceSelection,
  type CodingWorkspaceSelection,
} from "../../lib/persistence";
import { getDefaultWorkspaceRoot } from "../../lib/workspacePicker";
import { WorkspaceSelector } from "./WorkspaceSelector";

type Tab = "chat" | "memory" | "activity";

export function normalizeCodingTab(value: string | null | undefined): Tab {
  if (value === "memory") return "memory";
  if (value === "activity" || value === "trace") return "activity";
  return "chat";
}

/** Not a picker feed. Placeholders until `models.list` + snapshot return. */
const FALLBACK_LLMS: readonly ListedModelDto[] = FRONTEND_MODELS.map((m) => ({
  id: m.id,
  displayName: m.displayName,
  type: "llm" as const,
  installed: false,
  source: "registry" as const,
}));

const CODING_FOLDER_TREE_COPY: FolderTreeCopy = {
  paneTitle: "Sessions",
  newItem: "New session",
  emptyCta: "Start a new session",
  treeAria: "Agent sessions",
  loadError: "Could not load sessions",
  emptyHint: "No sessions yet.",
  itemNoun: "session",
};

interface Turn {
  id: string;
  prompt: string;
  rendered: RenderedTurn;
  pending?: boolean;
  activity?: AgentActivity;
  inputTokens?: number | null;
  reasoningTokens?: number | null;
  reasoningText?: string | null;
  outputTokens?: number | null;
  tokensEstimated?: boolean;
  requestUsage?: RequestTokenUsageV1;
  userMessageUsage?: MessageTokenUsageV1;
  assistantMessageUsage?: MessageTokenUsageV1;
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
      messageUsage: turn.userMessageUsage,
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
        reasoningText: turn.reasoningText ?? null,
        outputTokens: turn.outputTokens ?? null,
        tokensEstimated: turn.tokensEstimated,
        requestUsage: turn.requestUsage,
        messageUsage: turn.assistantMessageUsage,
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

function reasoningFromCodingEvents(events: readonly CodingSessionEventT[]): string | null {
  const text = events
    .filter((event) => event.kind === "reasoning_delta")
    .map((event) => event.text)
    .join("")
    .slice(0, 65_536);
  return text || null;
}

export interface CodingPageProps {
  initialModelId?: string;
  initialTab?: string;
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
  const [tab, setTab] = useState<Tab>(() => normalizeCodingTab(initialTab));
  const [modelId, setModelId] = useState<string>(initialModelId ?? DEFAULT_MODEL_ID);
  const [listedModels, setListedModels] = useState<readonly ListedModelDto[]>(FALLBACK_LLMS);
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  const [documentClient] = useState<DocumentClient>(
    () => documentClientOverride ?? createIpcDocumentClient(),
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<CodingWorkspaceSelection | null>(() =>
    initialWorkspacePath
      ? normalizeCodingWorkspaceSelection([initialWorkspacePath], initialWorkspacePath)
      : readCodingWorkspaceSelection(),
  );
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const workspaceHydrationRequest = useRef(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memorySnapshot, setMemorySnapshot] = useState<MemorySnapshotT | null>(null);
  const [traceEvents, setTraceEvents] = useState<readonly TraceEventT[]>([]);
  const [sessions, setSessions] = useState<readonly CodingSessionSummaryT[]>([]);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [historySelected, setHistorySelected] = useState<SelectedNode | null>(null);
  const { collapsed: historyCollapsed, toggle: toggleHistory } = usePersistentCollapsed(
    CODING_HISTORY_COLLAPSE_KEY,
  );
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
  const modelIdRef = useRef(modelId);
  modelIdRef.current = modelId;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const explorer = useMemo(
    () => {
      const ipcBackend = createIpcCodingExplorerBackend();
      return createCodingSessionsAsChatExplorer({
        backend: {
          ...ipcBackend,
        },
        getWorkspaceSelection: () => workspaceRef.current,
        getModelId: () => modelIdRef.current,
        onSessionCreated: (session) => {
          setSessionId(session.sessionId);
          setTab("chat");
          setHistorySelected({ kind: "chat", id: session.sessionId });
          setHistoryEpoch((n) => n + 1);
        },
      });
    },
    [],
  );

  useEffect(() => {
    if (workspace) return;
    const requestId = ++workspaceHydrationRequest.current;
    void getDefaultWorkspaceRoot().then(
      (home) => {
        if (requestId !== workspaceHydrationRequest.current) return;
        const next = normalizeCodingWorkspaceSelection([home], home);
        if (!next) return;
        setWorkspace(next);
        writeCodingWorkspaceSelection(next);
      },
      (reason) => {
        if (requestId !== workspaceHydrationRequest.current) return;
        setError(`Could not load the home workspace: ${reason instanceof Error ? reason.message : String(reason)}`);
      },
    );
  }, [workspace]);

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
    const selectedWorkspace = workspace;
    if (!selectedWorkspace) {
      setError("The home workspace is still loading. Try again in a moment.");
      return null;
    }
    const reply = await ipc.call<CodingSessionStartResponseT>("coding.session.start", {
      modelId: foldModelId(modelId),
      workspacePath: selectedWorkspace.primaryRoot,
      workspaceRoots: selectedWorkspace.roots,
      primaryRoot: selectedWorkspace.primaryRoot,
    });
    if (!reply.ok) {
      setError(`Could not start session: ${reply.message}`);
      return null;
    }
    setSessionId(reply.value.sessionId);
    setHistoryEpoch((n) => n + 1);
    return reply.value.sessionId;
  }, [modelId, sessionId, workspace]);

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
        const reasoningText = reasoningFromCodingEvents(reply.value.events);
        const estimated =
          usage.inputTokens == null &&
          usage.reasoningTokens == null &&
          usage.outputTokens == null;
        const requestUsage: RequestTokenUsageV1 | undefined = estimated
          ? undefined
          : {
              version: 1,
              inputTokens: usage.inputTokens,
              reasoningTokens: usage.reasoningTokens,
              outputTokens: usage.outputTokens,
              provenance: { accuracy: "exact", source: "provider" },
              raw: {
                inputTokens: usage.inputTokens,
                reasoningTokens: usage.reasoningTokens,
                outputTokens: usage.outputTokens,
              },
            };
        setTurns((prev) => [
          ...prev,
          {
            id: `${id}-${prev.length}`,
            prompt: text,
            createdAt: new Date().toISOString(),
            rendered,
            inputTokens: estimated ? estimateTokens(text) : usage.inputTokens,
            reasoningTokens: usage.reasoningTokens,
            reasoningText,
            outputTokens: estimated ? estimateTokens(rendered.text) : usage.outputTokens,
            tokensEstimated: estimated,
            requestUsage,
            userMessageUsage: estimatedMessageUsage("user", text),
            assistantMessageUsage: estimatedMessageUsage("assistant", rendered.text, reasoningText),
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

  const prepareWorkspaceChange = useCallback(async (): Promise<boolean> => {
    if (!sessionId) return true;
    if (
      busy &&
      !window.confirm(
        "This session is still running with its current folders. Stop it and switch to the new workspace?",
      )
    ) {
      return false;
    }
    await handleNewSession();
    setHistorySelected(null);
    return true;
  }, [busy, handleNewSession, sessionId]);

  const persistWorkspace = useCallback((next: CodingWorkspaceSelection): void => {
    workspaceHydrationRequest.current += 1;
    workspaceRef.current = next;
    setWorkspace(next);
    writeCodingWorkspaceSelection(next);
  }, []);

  const handleReplacePrimary = useCallback(async (paths: readonly string[]): Promise<void> => {
    if (!(await prepareWorkspaceChange())) return;
    const current = workspaceRef.current;
    const oldPrimary = current?.primaryRoot;
    const tail = current?.roots.filter((root) => root !== oldPrimary) ?? [];
    const next = normalizeCodingWorkspaceSelection([...paths, ...tail], paths[0]);
    if (next) persistWorkspace(next);
  }, [persistWorkspace, prepareWorkspaceChange]);

  const handleAddRoots = useCallback(async (paths: readonly string[]): Promise<void> => {
    if (!(await prepareWorkspaceChange())) return;
    const current = workspaceRef.current;
    const next = normalizeCodingWorkspaceSelection(
      [...(current?.roots ?? []), ...paths],
      current?.primaryRoot ?? paths[0],
    );
    if (next) persistWorkspace(next);
  }, [persistWorkspace, prepareWorkspaceChange]);

  const handleRemoveRoot = useCallback(async (path: string): Promise<void> => {
    const current = workspaceRef.current;
    if (!current || current.roots.length <= 1 || path === current.primaryRoot) return;
    if (!(await prepareWorkspaceChange())) return;
    const next = normalizeCodingWorkspaceSelection(
      current.roots.filter((root) => root !== path),
      current.primaryRoot,
    );
    if (next) persistWorkspace(next);
  }, [persistWorkspace, prepareWorkspaceChange]);

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
    const resumedWorkspace = normalizeCodingWorkspaceSelection(
      reply.value.session.workspaceRoots ?? [],
      reply.value.session.primaryRoot,
    );
    if (resumedWorkspace) persistWorkspace(resumedWorkspace);
    setHistorySelected({ kind: "chat", id });
    const restored = reply.value.turns ?? [];
    if (restored.length > 0) {
      setTurns(
        restored.map((turn, index) => ({
          id: `${id}-${index}`,
          prompt: turn.prompt,
          rendered: { text: turn.assistantText, cards: [], done: true },
          inputTokens: turn.inputTokens ?? null,
          reasoningTokens: turn.reasoningTokens ?? null,
          reasoningText: turn.reasoningText ?? null,
          outputTokens: turn.outputTokens ?? null,
          tokensEstimated: turn.tokensEstimated,
          requestUsage: turn.requestUsage,
          userMessageUsage: turn.userMessageUsage,
          assistantMessageUsage: turn.assistantMessageUsage,
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
  }, [persistWorkspace]);

  useEffect(() => {
    if (tab !== "memory") return;
    void ipc
      .call<CodingMemorySnapshotResponseT>("coding.memory.snapshot", {})
      .then((r) => {
        if (r.ok) setMemorySnapshot(r.value.snapshot);
      });
  }, [tab]);

  useEffect(() => {
    if (tab !== "activity") return;
    void ipc
      .call<CodingTraceSubscribeResponseT>("coding.trace.subscribe", {})
      .then((r) => {
        if (r.ok) setTraceEvents(r.value.events);
      });
  }, [tab]);

  // v1.16.0 Phase 2.2 (adoption item A2) -- the Activity tab also loads per-model
  // inference analytics (tokens/sec, TTFT, memory). Read on tab activation like
  // the other trace data; the registry is in-process in the sidecar, so this is
  // a cheap local read with no disk or network access.
  useEffect(() => {
    if (tab !== "activity") return;
    void ipc.call<MetricsInferenceResponseT>("metrics.inference", {}).then((r) => {
      if (r.ok) setModelMetrics(r.value.perModel);
    });
  }, [tab]);

  // v1.1.0 Phase 7.1 -- the Trace tab also needs the session list so the
  // user can pick a session to replay or compare. Reload it whenever the
  // Trace tab becomes active.
  useEffect(() => {
    if (tab !== "activity") return;
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
        flexDirection: "row",
        minHeight: 0,
        color: "var(--fg-0)",
      }}
    >
      <CollapsibleHistoryAside
        testId="coding-history-pane"
        ariaLabel="Agent sessions"
        collapsed={historyCollapsed}
        onToggle={toggleHistory}
        toggleTestId="coding-history-collapse-toggle"
        expandLabel="Expand sessions"
        collapseLabel="Collapse sessions"
      >
        {sidecar.isDown ? (
          <p
            data-testid="coding-history-empty"
            style={{ margin: 0, padding: "var(--space-3)", color: "var(--fg-muted)" }}
          >
            {CODING_FOLDER_TREE_COPY.emptyHint}
          </p>
        ) : (
          <FolderTree
            client={explorer}
            selected={historySelected}
            onSelect={setHistorySelected}
            onOpenChat={(chat: Chat) => void handleResume(chat.id)}
            onChange={() => void reloadSessions()}
            defaultModelId={modelId}
            copy={CODING_FOLDER_TREE_COPY}
            storageKey="nexus.coding.expanded"
            refreshToken={historyEpoch}
            collapsed={historyCollapsed}
            readOnlyFolders={true}
            expandTopLevelOnLoad={true}
            retryLoadError={true}
            getFolderTitle={(folder) => folder.icon?.trim() || folder.name}
            onBeforeSessionDisposition={async (id) => {
              if (sessionIdRef.current === id && busy) {
                const reply = await ipc.call("coding.session.cancel", { sessionId: id });
                if (!reply.ok) throw new Error(reply.message);
              }
            }}
            onSessionDisposition={(id) => {
              if (sessionIdRef.current !== id) return;
              sessionIdRef.current = null;
              setSessionId(null);
              setTurns([]);
              setHistorySelected(null);
              setBusy(false);
              setError(null);
              pendingPromptRef.current = { text: "", attachments: [] };
            }}
          />
        )}
      </CollapsibleHistoryAside>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          padding: "var(--space-4)",
          gap: "var(--space-3)",
        }}
      >
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <WorkspaceSelector
          selection={workspace}
          onReplacePrimary={handleReplacePrimary}
          onAdd={handleAddRoots}
          onRemove={handleRemoveRoot}
          onError={(message) => setError(`Could not select workspace folder: ${message}`)}
        />
      </header>

      <nav role="tablist" style={{ display: "flex", gap: 0 }}>
        {(["chat", "memory", "activity"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            data-testid={`coding-tab-${t}`}
            aria-selected={tab === t}
            title={t === "chat" ? "Conversation and agent output" : t === "memory" ? "Knowledge scoped to this workspace" : "Tools, approvals, and runtime events"}
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
        {tab === "memory" && (
          <section data-testid="coding-memory" aria-label="Workspace memory">
            <p style={{ color: "var(--fg-muted)", marginTop: 0 }}>Knowledge here is scoped to the selected workspace folders.</p>
            <MemoryPanel snapshot={memorySnapshot} />
          </section>
        )}
        {tab === "activity" && (
          <section data-testid="coding-activity" aria-label="Agent activity">
            <p style={{ color: "var(--fg-muted)", marginTop: 0 }}>Review tool calls, approvals, model metrics, and runtime events for this workspace.</p>
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
          </section>
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
                catalogTab="agentic"
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
      </div>
    </section>
  );
}
