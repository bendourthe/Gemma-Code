/**
 * v1.0.0 Phase 4.4 -- Local Chatbot Explorer page.
 *
 * The Chat module's top-level page. Hosts:
 *   - sidebar-hosted `<FolderTree>` (drag-drop, context menu, keyboard nav)
 *   - main pane: shared chat shell (`<MessageList>`, `<MediaComposer>`)
 *   - compact model switcher under the composer (installed-and-ready LLMs + Get more models)
 *   - tools always on (confirmation and sandbox still gate execution)
 *
 * v2.2.0 Phase 5 (5.1): the page persists through the sidecar's SQLite store
 * when running inside Tauri, falling back to the in-memory client elsewhere.
 * Historically (Phase 4 stub):
 * the IPC-backed client lands once the sidecar shared-core build closes
 * known-gap 3.P1.N.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDismissOnOutside } from "../../shared/ui/useDismissOnOutside";
import {
  FolderTree,
  CHAT_FOLDER_TREE_COPY,
  type SelectedNode,
} from "./FolderTree";
import {
  SidebarHistorySlot,
  SIDEBAR_COMPACT_STORAGE_KEY,
  useSidebarCompact,
} from "../../components/SidebarHistoryHost";
import { InMemoryChatExplorerClient } from "./chatExplorerClient";
import {
  createIpcChatExplorerAdapter,
  tauriAvailable,
} from "./ipcChatExplorerClient";
import type { AsyncChatExplorerClient } from "./chatExplorerClient";
import {
  createChatIpcClient,
  joinChatReasoning,
  joinChatReply,
  usageFromChatEvents,
  type ChatSessionClient,
} from "./chatIpcClient";
import { formatChatTurnError } from "../../lib/inferenceRpcError";
import type { Chat, ChatMessageRecord } from "./types";
import {
  ComposerContextRow,
  MediaComposer,
  MessageList,
  composerSessionUsage,
  isoTimestampFromMillis,
  useStickToBottom,
  withLiveTimestamp,
  type ChatMessage,
} from "../../shared/chat";
import {
  chatComposerAccept,
  imageAttachmentAffordance,
  audioAttachmentCopy,
} from "../../shared/chat/modalityGating";
import { partitionAttachments } from "../../shared/chat/classifyAttachment";
import { stripDataUrlPrefix, mimeFromDataUrl } from "../../shared/chat/dataUrl";
import {
  modelAcceptsVision,
  nonVisionAttachmentGuidance,
  resolveVisualTokenBudget,
} from "../../../../core/chat/vision";
import { estimateTokens } from "../../../../core/chat/sessionContextUsage";
import {
  enforceVisualBudget,
  capVideoFrames,
} from "../../../../core/chat/visualBudget";
import { recordMultimodalTurn } from "../../../../core/memory/multimodalSurrogate";
import type { EpisodicMemory } from "../../../../core/memory/MemoryHub";
import { redactSecrets } from "../../../../core/observability/redactSecrets";
import { estimatedMessageUsage } from "../../../../core/chat/tokenUsage";
import { foldModelId } from "../../../../core/registry/modelAliases";
import { DEFAULT_MODEL_ID, FRONTEND_MODELS } from "../coding/models";
import { createIpcDocumentClient, type DocumentClient } from "./documentClient";
import { createIpcAudioClient, type AudioClient } from "./audioClient";
import {
  createBrowserMicRecorder,
  type MicRecorder,
} from "../../shared/chat/micRecorder";
import {
  fallbackTitle,
  DEFAULT_SESSION_TITLE,
} from "../../../sidecar/src/chat/titleGenerator";
import {
  labelSttTranscript,
  STT_TRANSCRIPT_ORIGIN,
} from "./transcriptProvenance";
import {
  INITIAL_VOICE_LOOP,
  reduceVoiceLoop,
  shouldStopTts,
  type VoiceCaptureMode,
  type VoiceLoopState,
} from "./voiceLoop";
import { QuickModelSwitcher } from "../../shared/models/QuickModelSwitcher";
import { SETTINGS_MODELS_PATH } from "../../shared/models/installedFeed";
import {
  installedForTask,
  ownedIdSet,
  recommendOrderForTask,
  resolveDefaultId,
  snapshotForOwnedIds,
  writeFavorite,
  type SelectionSnapshot,
} from "../../shared/models/selectionPolicy";
import { createIpcModelsClient } from "../../pages/settings/ipcModelsClient";
import type { ListedModelDto } from "../../pages/settings/modelsTypes";
import { SidecarDownBanner } from "../../components/SidecarDownBanner";
import {
  useSidecarStatus,
  type UseSidecarStatusOptions,
} from "../../lib/sidecarStatus";
import { useModelResidency } from "../../shared/models/useModelResidency";
import * as chatTurns from "./chatTurns";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { gpuSwitchBody, gpuSwitchTitle } from "../../shared/models/gpuBusy";
import {
  askBeforeModelSwitch,
  setAskBeforeModelSwitch,
} from "../../shared/models/modelSwitchPreference";
import {
  useModelLoadWatch,
  warmModel,
} from "../../shared/models/modelLoadWatch";
import { ModelSwitchDialog } from "../../shared/models/ModelSwitchDialog";
import {
  busyContextFromScheduler,
  modelVramEstimate,
  residentModelsFromScheduler,
  type ResidencySessionMemory,
  type SchedulerActiveJob,
} from "../../shared/models/schedulerResidency";

/** Not a picker feed. Placeholders until `models.list` + snapshot return. */
const FALLBACK_LLMS: readonly ListedModelDto[] = FRONTEND_MODELS.map((m) => ({
  id: m.id,
  displayName: m.displayName,
  type: "llm" as const,
  installed: false,
  source: "registry" as const,
  modalities: ["text"] as const,
}));

/** @deprecated v2.4.2: chat collapse is the sidebar compact toggle. */
export const CHATS_PANE_STORAGE_KEY = SIDEBAR_COMPACT_STORAGE_KEY;

export interface ChatPageProps {
  /** Optional client override (tests inject an InMemoryChatExplorerClient). */
  client?: AsyncChatExplorerClient;
  /** Optional chat-session client override (tests inject a fake; default: IPC). */
  chatSession?: ChatSessionClient;
  /** Default model id used when starting a fresh chat. */
  defaultModelId?: string;
  /**
   * v1.16.0 Phase 3 (adoption item A5) -- document-parse client. Tests inject
   * the in-memory one; production talks to the sidecar's `ocr.*` IPC.
   */
  documentClient?: DocumentClient;
  /** Deep-link out to Settings > Models when no document model is installed. */
  onGetMoreModels?: () => void;
  /**
   * v1.16.0 Phase 5 (A4) -- installed-model feed for the compact switcher.
   * Tests inject a fake; production talks to the sidecar `models.list` IPC.
   */
  modelsClient?: {
    list(): Promise<readonly ListedModelDto[]>;
    lastSelection?: SelectionSnapshot | null;
  };
  /**
   * v2.1.0 Phase 4 -- turn a video data URL into still frames. Tests inject
   * a stub; production can wire ffmpeg. Missing sampler skips the video
   * with a notice rather than sending container bytes to the model.
   */
  sampleVideoFrames?: (
    dataUrl: string,
  ) => Promise<{ frames: string[]; notice?: string }>;
  /**
   * v2.1.0 Phase 4 -- optional episodic hub so non-text turns are indexed by
   * a redacted caption surrogate. Tests inject InMemoryMemoryHub.
   */
  memoryHub?: { episodic: Pick<EpisodicMemory, "record"> };
  /**
   * v2.0.0 Phase 1 -- local STT/TTS client. Tests inject an in-memory fake;
   * production talks to sidecar `audio.*` IPC.
   */
  audioClient?: AudioClient;
  /** Optional TTS playback (tests inject a no-op). */
  playAudio?: (dataUrl: string, signal: AbortSignal) => Promise<void>;
  /** Tests inject a fake mic; production uses getUserMedia. */
  voiceMicRecorder?: import("../../shared/chat/micRecorder").MicRecorder;
  /** v2.2.2 -- test seam for the backend-down banner. */
  sidecarStatus?: UseSidecarStatusOptions;
  /** v2.2.3 Phase 5 -- submit-time GPU occupancy inputs. */
  hostVramFreeGB?: number | null;
  /** Host VRAM total so the picker uses installer recommend order. */
  hostVramGB?: number | null;
  activeSchedulerJob?: SchedulerActiveJob | null;
  residencyMemory?: ResidencySessionMemory;
}

export function ChatPage({
  client: clientOverride,
  chatSession: chatSessionOverride,
  defaultModelId = DEFAULT_MODEL_ID,
  documentClient: documentClientOverride,
  onGetMoreModels,
  modelsClient: modelsClientOverride,
  audioClient: audioClientOverride,
  playAudio: playAudioOverride,
  voiceMicRecorder,
  sampleVideoFrames,
  memoryHub,
  sidecarStatus: sidecarStatusOptions,
  hostVramFreeGB = null,
  hostVramGB = null,
  activeSchedulerJob = null,
  residencyMemory,
}: ChatPageProps = {}): JSX.Element {
  // The client survives re-renders but is recreated per ChatPage instance.
  // Tests can inject one via the prop so they observe state changes.
  const [internalClient] = useState<AsyncChatExplorerClient>(
    // v2.2.0 Phase 5 (5.1): the app now persists to SQLite through the sidecar
    // (closes 3.P1.N). The in-memory client remains the fallback for tests and
    // for running outside Tauri, where there is no sidecar to talk to.
    // v2.2.3 Phase 1 (1.1): the IPC client is wrapped in an adapter that
    // actually satisfies the contract FolderTree/ChatPage consume; the old
    // double cast onto the sync interface crashed on first paint (U7).
    () =>
      clientOverride ??
      (tauriAvailable()
        ? createIpcChatExplorerAdapter()
        : new InMemoryChatExplorerClient()),
  );
  const client = clientOverride ?? internalClient;
  const sidecar = useSidecarStatus(sidecarStatusOptions);
  const [chatSession] = useState<ChatSessionClient>(
    () => chatSessionOverride ?? createChatIpcClient(),
  );
  // Per-chat sidecar session id, lazily started on first message.
  const sessionIdsRef = useRef<Map<string, string>>(new Map());
  const messagesByChatRef = useRef<Map<string, ChatMessage[]>>(new Map());
  const hydrationPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const hydrationVersionRef = useRef<Map<string, number>>(new Map());

  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const chatsCollapsed = useSidebarCompact();
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  // Bumped when something outside the rail renames a chat (auto-titling).
  const [treeVersion, setTreeVersion] = useState(0);
  const [modelId, setModelId] = useState<string>(defaultModelId);
  const [messagesByChat, setMessagesByChat] = useState<
    Map<string, ChatMessage[]>
  >(() => new Map());
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const residency = useModelResidency({ rememberedPairs: residencyMemory });
  const pendingPromptRef = useRef<{
    text: string;
    attachments: readonly string[];
  }>({
    text: "",
    attachments: [],
  });
  // v1.16.0 Phase 3 (adoption item A5) -- document-parse state.
  const [documentClient] = useState<DocumentClient>(
    () => documentClientOverride ?? createIpcDocumentClient(),
  );
  const [audioClient] = useState<AudioClient>(
    () => audioClientOverride ?? createIpcAudioClient(),
  );
  const [personaByChat, setPersonaByChat] = useState<Record<string, string>>(
    {},
  );
  // v2.4.8 follow-up: the persona can be written before the first message
  // creates the chat; the draft moves onto the chat when it is created. The
  // ref mirrors state so a turn sent in the same tick sees the persona.
  const personaByChatRef = useRef<Record<string, string>>({});
  const [draftPersona, setDraftPersona] = useState("");
  const setChatPersona = useCallback(
    (chatId: string, value: string) => {
      personaByChatRef.current = { ...personaByChatRef.current, [chatId]: value };
      setPersonaByChat((prev) => ({ ...prev, [chatId]: value }));
      void client
        .setPersona?.(chatId, value.trim() ? value : null)
        .catch(() => undefined);
    },
    [client],
  );
  const adoptDraftPersona = useCallback(
    (chatId: string) => {
      const draft = draftPersona.trim();
      if (!draft) return;
      setChatPersona(chatId, draftPersona);
      setDraftPersona("");
    },
    [draftPersona, setChatPersona],
  );
  // v2.2.7 Phase 3: persona is a text control under the composer, not a header gear.
  const [personaOpen, setPersonaOpen] = useState(false);
  // v2.4.8 Phase 2 (T007): the popover closes on an outside pointer or Escape.
  const personaPopoverRef = useRef<HTMLDivElement>(null);
  // v2.4.8 follow-up: the toggle is part of the dismiss surface so a click on
  // it toggles instead of closing-then-reopening.
  const personaToggleRef = useRef<HTMLButtonElement>(null);
  const personaSurface = useMemo(
    () => [personaPopoverRef, personaToggleRef],
    [],
  );
  const closePersona = useCallback(() => setPersonaOpen(false), []);
  useDismissOnOutside(personaSurface, personaOpen, closePersona);
  const [voiceLoop, setVoiceLoop] =
    useState<VoiceLoopState>(INITIAL_VOICE_LOOP);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const ttsAbortRef = useRef<AbortController | null>(null);
  // v2.4.8 follow-up: a chat may switch model mid-conversation. The override
  // wins over the chat's stored model for this app session; the sidecar
  // session restarts with the replayed history so no context is lost.
  const [modelOverrideByChat, setModelOverrideByChat] = useState<
    Record<string, string>
  >({});
  const [pendingModelSwitch, setPendingModelSwitch] = useState<string | null>(
    null,
  );
  const [warmingModelId, setWarmingModelId] = useState<string | null>(null);
  const [askDialog, setAskDialog] = useState(() => askBeforeModelSwitch());
  const voiceMicRef = useRef<MicRecorder | null>(voiceMicRecorder ?? null);
  const [documentModelInstalled, setDocumentModelInstalled] = useState<
    boolean | null
  >(null);
  // v1.16.0 Phase 5 (A4) -- compact switcher feed. Falls back to the catalog
  // projection when `models.list` is unavailable (tests, sidecar down).
  const [listedModels, setListedModels] =
    useState<readonly ListedModelDto[]>(FALLBACK_LLMS);
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  const userChangedModelRef = useRef(false);

  useEffect(() => {
    let active = true;
    void documentClient.installedDocumentModels().then(
      (models) => {
        if (active) setDocumentModelInstalled(models.length > 0);
      },
      () => {
        if (active) setDocumentModelInstalled(false);
      },
    );
    return () => {
      active = false;
    };
  }, [documentClient]);

  useEffect(() => {
    let cancelled = false;
    const source = modelsClientOverride ?? createIpcModelsClient();
    void source.list().then(
      (all) => {
        if (!cancelled && all.length > 0) {
          const snap = source.lastSelection ?? null;
          setListedModels(all);
          setSelection(snap);
          const ready = installedForTask(all, "chat", snap);
          const next = resolveDefaultId(ready, {
            recommended: snap?.recommendedByTask.chat ?? null,
          });
          if (next && !userChangedModelRef.current) {
            setModelId(next);
          }
        }
      },
      () => {
        if (cancelled) return;
        setSelection(
          snapshotForOwnedIds(
            FALLBACK_LLMS.filter((m) => m.installed).map((m) => m.id),
          ),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [modelsClientOverride]);

  // v2.4.8 follow-up: the model this session actually talks to.
  const effectiveModelId =
    (activeChat ? modelOverrideByChat[activeChat.id] : undefined) ??
    activeChat?.modelId ??
    modelId;
  const effectiveModel = useMemo(
    () => listedModels.find((m) => m.id === effectiveModelId),
    [listedModels, effectiveModelId],
  );
  const storedRows = activeChat ? messagesByChat.get(activeChat.id) : undefined;
  const hasPendingReply = Boolean(
    storedRows?.some(
      (m) => m.pending && m.role === "assistant" && m.activity === "chat-streaming",
    ),
  );
  const warmBubbleId = activeChat ? `${activeChat.id}-model-warm` : null;
  // Watch the model load while a reply is pending or a switch is warming up.
  const modelLoad = useModelLoadWatch({
    active: hasPendingReply || warmingModelId !== null,
    modelId: warmingModelId ?? effectiveModelId,
    modelVramGB: effectiveModel?.vramGB ?? null,
  });
  const loadingProgress = useMemo<ChatMessage["progress"]>(
    () =>
      modelLoad.loading
        ? {
            step: 0,
            total: 0,
            stage: "loading",
            ...(modelLoad.pct !== null
              ? { loadedBytes: modelLoad.pct, totalBytes: 100 }
              : {}),
          }
        : undefined,
    [modelLoad.loading, modelLoad.pct],
  );

  const messages = useMemo(() => {
    if (!activeChat) return [];
    const stored = messagesByChat.get(activeChat.id) ?? [];
    // A pending chat reply shows "Loading model" for as long as Ollama has not
    // loaded the model; the caption returns to the studio rotator after.
    const rows = loadingProgress
      ? stored.map((m) =>
          m.pending && m.role === "assistant" && m.activity === "chat-streaming"
            ? { ...m, progress: loadingProgress }
            : m,
        )
      : stored;
    const extras: ChatMessage[] = [];
    if (warmingModelId !== null && warmBubbleId) {
      // Transient, never persisted: the model switch loading the new model.
      extras.push({
        id: warmBubbleId,
        role: "assistant",
        content: "",
        pending: true,
        activity: "chat-streaming",
        progress: loadingProgress ?? { step: 0, total: 0, stage: "loading" },
      });
    }
    if (voiceLoop.captureVisible) {
      extras.push({
        id: `${activeChat.id}-asr-capture`,
        role: "assistant" as const,
        content: "",
        pending: true,
        activity: "asr-capture" as const,
      });
    }
    return extras.length > 0 ? [...rows, ...extras] : rows;
  }, [
    activeChat,
    messagesByChat,
    voiceLoop.captureVisible,
    loadingProgress,
    warmingModelId,
    warmBubbleId,
  ]);

  const lastMessage = messages[messages.length - 1];
  const { scrollRef, onScroll, stickNow } = useStickToBottom(
    `${messages.length}:${lastMessage?.id ?? ""}:${lastMessage?.content?.length ?? 0}:${lastMessage?.pending ? 1 : 0}`,
  );

  const selectedListedModel = effectiveModel;
  const modelDisplayName = useCallback(
    (id: string): string =>
      listedModels.find((candidate) => candidate.id === id)?.displayName ?? id,
    [listedModels],
  );

  const pickerModel = useMemo(
    () => listedModels.find((m) => m.id === modelId),
    [listedModels, modelId],
  );
  const contextUsage = useMemo(
    () => composerSessionUsage(messages, pickerModel),
    [messages, pickerModel],
  );

  const imageGate = imageAttachmentAffordance(selectedListedModel);
  const audioHint = audioAttachmentCopy(selectedListedModel);

  const dispatchVoice = useCallback(
    (event: Parameters<typeof reduceVoiceLoop>[1]) => {
      setVoiceLoop((prev) => {
        const next = reduceVoiceLoop(prev, event);
        if (shouldStopTts(prev, next)) {
          ttsAbortRef.current?.abort();
          ttsAbortRef.current = null;
        }
        return next;
      });
    },
    [],
  );

  const playReply = useCallback(
    async (text: string) => {
      if (!voiceEnabled || !text.trim()) return;
      dispatchVoice({ type: "tts-started" });
      const abort = new AbortController();
      ttsAbortRef.current = abort;
      try {
        const spoken = await audioClient.speak(text);
        if (abort.signal.aborted) return;
        const dataUrl = `data:${spoken.mimeType};base64,${spoken.audioBase64}`;
        const play =
          playAudioOverride ??
          (async (url: string, signal: AbortSignal) => {
            const audio = new Audio(url);
            await new Promise<void>((resolve, reject) => {
              const stop = () => {
                audio.pause();
                resolve();
              };
              signal.addEventListener("abort", stop, { once: true });
              audio.onended = () => resolve();
              audio.onerror = () => reject(new Error("tts playback failed"));
              void audio.play();
            });
          });
        await play(dataUrl, abort.signal);
        if (!abort.signal.aborted) dispatchVoice({ type: "tts-ended" });
      } catch (err) {
        if (!abort.signal.aborted) {
          dispatchVoice({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [audioClient, dispatchVoice, playAudioOverride, voiceEnabled],
  );

  const handleSelect = useCallback((node: SelectedNode) => {
    setSelected(node);
  }, []);

  const handleOpenChat = useCallback(
    (chat: Chat) => {
      setActiveChat(chat);
      setSelected({ kind: "chat", id: chat.id });
      // v2.4.8 follow-up: the picker shows the model this session talks to,
      // so a switch is always relative to what is really loaded.
      const sessionModel = modelOverrideByChat[chat.id] ?? chat.modelId;
      if (listedModels.some((m) => m.id === sessionModel && m.installed)) {
        setModelId(sessionModel);
      }
      if (!client.listMessages) return;

      const version = (hydrationVersionRef.current.get(chat.id) ?? 0) + 1;
      hydrationVersionRef.current.set(chat.id, version);
      const hydration = Promise.resolve(client.listMessages(chat.id, 500)).then(
        (records) => {
          if (hydrationVersionRef.current.get(chat.id) !== version) return;
          const hydrated = records.map(chatMessageFromRecord);
          // v2.4.8 follow-up: a reply still being written for this chat keeps
          // its pending bubble across a session switch or a tab change.
          const inFlight = chatTurns.inFlightTurn(chat.id);
          if (
            inFlight &&
            !hydrated.some((m) => m.id === inFlight.assistantId)
          ) {
            hydrated.push(withLiveTimestamp(inFlight.pending));
          }
          const next = new Map(messagesByChatRef.current);
          next.set(chat.id, hydrated);
          messagesByChatRef.current = next;
          setMessagesByChat(next);
          setTranscriptError(null);
        },
        (err: unknown) => {
          setTranscriptError(
            `Chat history could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      );
      hydrationPromisesRef.current.set(chat.id, hydration);
      void hydration.finally(() => {
        if (hydrationPromisesRef.current.get(chat.id) === hydration) {
          hydrationPromisesRef.current.delete(chat.id);
        }
      });
    },
    [client, listedModels, modelOverrideByChat],
  );

  const persistMessage = useCallback(
    async (chatId: string, message: ChatMessage): Promise<void> => {
      if (!client.appendMessage || message.pending) return;
      try {
        await Promise.resolve(
          client.appendMessage({
            chatId,
            role: message.role === "user" ? "user" : "assistant",
            content: message.content,
            ...(message.attachments
              ? { attachments: message.attachments }
              : {}),
            ...(message.inputTokens !== undefined
              ? { inputTokens: message.inputTokens }
              : {}),
            ...(message.reasoningTokens !== undefined
              ? { reasoningTokens: message.reasoningTokens }
              : {}),
            ...(message.reasoningText !== undefined
              ? { reasoningText: message.reasoningText }
              : {}),
            ...(message.outputTokens !== undefined
              ? { outputTokens: message.outputTokens }
              : {}),
            ...(message.tokensEstimated ? { tokensEstimated: true } : {}),
            ...(message.requestUsage
              ? { requestUsage: message.requestUsage }
              : {}),
            ...(message.messageUsage
              ? { messageUsage: message.messageUsage }
              : {}),
          }),
        );
        setTranscriptError(null);
      } catch (err) {
        setTranscriptError(
          `Message is visible but was not saved: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [client],
  );

  /** Append locally first, then persist non-pending rows without blocking UI. */
  const appendMessage = useCallback(
    (chatId: string, message: ChatMessage) => {
      const stamped = withLiveTimestamp(message);
      const next = new Map(messagesByChatRef.current);
      next.set(chatId, [...(next.get(chatId) ?? []), stamped]);
      messagesByChatRef.current = next;
      setMessagesByChat(next);
      if (!stamped.pending) void persistMessage(chatId, stamped);
    },
    [persistMessage],
  );

  /** Replace one message in place (used to stream parse progress into a bubble). */
  const patchMessage = useCallback(
    (chatId: string, messageId: string, patch: Partial<ChatMessage>) => {
      const next = new Map(messagesByChatRef.current);
      next.set(
        chatId,
        (next.get(chatId) ?? []).map((m) =>
          m.id === messageId ? { ...m, ...patch } : m,
        ),
      );
      messagesByChatRef.current = next;
      setMessagesByChat(next);
    },
    [],
  );

  // v2.4.8 follow-up: replies finish into whichever ChatPage is mounted. The
  // instance that started the turn may be gone (tab change) or showing another
  // session; this listener patches the bubble when the reply lands.
  useEffect(
    () =>
      chatTurns.subscribeCompletedTurns(({ chatId, assistantId, message }) => {
        const rows = messagesByChatRef.current.get(chatId);
        if (!rows) return;
        if (rows.some((m) => m.id === assistantId)) {
          patchMessage(chatId, assistantId, { ...message, pending: false });
          return;
        }
        // Persisted by the originating turn; only the view needs the row.
        const next = new Map(messagesByChatRef.current);
        next.set(chatId, [...rows, withLiveTimestamp(message)]);
        messagesByChatRef.current = next;
        setMessagesByChat(next);
      }),
    [patchMessage],
  );

  const handleStopTurn = useCallback((): void => {
    const chatId = activeChat?.id;
    if (!chatId) return;
    chatTurns.cancelTurn(chatId);
    const pending = [...(messagesByChatRef.current.get(chatId) ?? [])]
      .reverse()
      .find((m) => m.pending && m.role === "assistant");
    if (!pending) return;
    const stopped = {
      pending: false,
      content: pending.content.trim().length > 0 ? pending.content : "Stopped.",
      messageUsage: estimatedMessageUsage(
        "assistant",
        pending.content.trim().length > 0 ? pending.content : "Stopped.",
      ),
    };
    patchMessage(chatId, pending.id, stopped);
    void persistMessage(chatId, { ...pending, ...stopped });
  }, [activeChat, patchMessage, persistMessage]);

  const sendChatTurn = useCallback(
    async (
      chatId: string,
      baseId: string,
      message: string,
      images: readonly string[] = [],
    ): Promise<string> => {
      const assistantId = `${baseId}-assistant`;
      const pendingBubble: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        pending: true,
        activity: "chat-streaming",
      };
      const turn = chatTurns.beginTurn(chatId, pendingBubble);
      appendMessage(chatId, pendingBubble);
      let content: string;
      let usage = {
        inputTokens: null as number | null,
        reasoningTokens: null as number | null,
        outputTokens: null as number | null,
      };
      let reasoningText: string | null = null;
      try {
        const chat = activeChat;
        let sessionId = sessionIdsRef.current.get(chatId);
        if (!sessionId) {
          const started = await chatSession.start({
            modelId: foldModelId(
              modelOverrideByChat[chatId] ?? chat?.modelId ?? modelId,
            ),
            title: chat?.title,
            history: replayHistory(
              messagesByChatRef.current.get(chatId) ?? [],
              `${baseId}-user`,
            ),
          });
          sessionId = started.sessionId;
          sessionIdsRef.current.set(chatId, sessionId);
        }
        const persona = (
          personaByChatRef.current[chatId] ?? personaByChat[chatId]
        )?.trim();
        const outbound =
          persona && persona.length > 0
            ? `[Persona]\n${persona}\n\n${message.trim().length > 0 ? message : images.length > 0 ? "(image)" : message}`
            : message.trim().length > 0
              ? message
              : images.length > 0
                ? "(image)"
                : message;
        let reply;
        try {
          reply = await chatSession.sendMessage({
            sessionId,
            message: outbound,
            ...(images.length > 0
              ? { images: images.map(stripDataUrlPrefix) }
              : {}),
          });
        } catch (err) {
          if (!isUnknownChatSessionError(err)) throw err;
          sessionIdsRef.current.delete(chatId);
          const restarted = await chatSession.start({
            modelId: foldModelId(
              modelOverrideByChat[chatId] ?? chat?.modelId ?? modelId,
            ),
            title: chat?.title,
            history: replayHistory(
              messagesByChatRef.current.get(chatId) ?? [],
              `${baseId}-user`,
            ),
          });
          sessionIdsRef.current.set(chatId, restarted.sessionId);
          reply = await chatSession.sendMessage({
            sessionId: restarted.sessionId,
            message: outbound,
            ...(images.length > 0
              ? { images: images.map(stripDataUrlPrefix) }
              : {}),
          });
        }
        content = joinChatReply(reply.events) || "(no reply)";
        reasoningText = joinChatReasoning(reply.events) || null;
        usage = usageFromChatEvents(reply.events);
      } catch (err) {
        content = formatChatTurnError(err);
      }
      if (!chatTurns.isCurrentTurn(chatId, turn)) return "";
      const requestUsage = {
        version: 1 as const,
        ...usage,
        provenance: { accuracy: "exact" as const, source: "provider" as const },
        raw: {
          inputTokens: usage.inputTokens,
          reasoningTokens: usage.reasoningTokens,
          outputTokens: usage.outputTokens,
        },
      };
      const estimated = estimatedMessageUsage(
        "assistant",
        content,
        reasoningText,
      );
      const messageUsage = {
        version: 1 as const,
        inputTokens: null as number | null,
        reasoningTokens: usage.reasoningTokens ?? estimated.reasoningTokens,
        outputTokens: usage.outputTokens ?? estimated.outputTokens,
        provenance:
          usage.outputTokens !== null
            ? { accuracy: "exact" as const, source: "provider" as const }
            : estimated.provenance,
      };
      patchMessage(chatId, assistantId, {
        content,
        pending: false,
        reasoningText,
        requestUsage,
        messageUsage,
      });
      const finished: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content,
        reasoningText,
        requestUsage,
        messageUsage,
      };
      void persistMessage(chatId, finished);
      chatTurns.completeTurn({ chatId, assistantId, message: finished });
      return content;
    },
    [
      activeChat,
      appendMessage,
      chatSession,
      modelId,
      modelOverrideByChat,
      patchMessage,
      persistMessage,
      personaByChat,
    ],
  );

  /**
   * v1.16.0 Phase 3 (adoption item A5) -- the parse-document chat action.
   *
   * An attachment turns the turn into a document parse rather than a model
   * chat: the OCR runtime reads it and the extracted text comes back as the
   * assistant message, so the user can then ask questions about it in the same
   * thread. Parsed text is NOT auto-sent to the model -- the user decides what
   * to do with it, which keeps an untrusted document from silently entering a
   * prompt.
   */
  const handleParseDocument = useCallback(
    async (
      chatId: string,
      baseId: string,
      attachment: string,
      note: string,
    ) => {
      const messageId = `${baseId}-parse`;
      appendMessage(chatId, {
        id: messageId,
        role: "assistant",
        content: "Reading document...",
        pending: true,
        activity: "document-parse",
      });
      try {
        const handle = documentClient.parse(
          attachment,
          ({ page, totalPages }) => {
            patchMessage(chatId, messageId, {
              content:
                totalPages > 0
                  ? `Reading document... page ${page} of ${totalPages}`
                  : "Reading document...",
            });
          },
        );
        const result = await handle.done;
        const body = (result.markdown ?? result.text).trim();
        const header =
          result.pageCount > 1
            ? `Parsed ${result.pageCount} pages with ${result.engine}:`
            : `Parsed with ${result.engine}:`;
        const content =
          body.length > 0
            ? `${header}\n\n${body}`
            : `${header}\n\n(no text found)`;
        patchMessage(chatId, messageId, {
          content,
          pending: false,
        });
        void persistMessage(chatId, {
          id: messageId,
          role: "assistant",
          content,
        });
      } catch (err) {
        const content = `Could not parse the document: ${
          err instanceof Error ? err.message : String(err)
        }`;
        patchMessage(chatId, messageId, {
          content,
          pending: false,
        });
        void persistMessage(chatId, {
          id: messageId,
          role: "assistant",
          content,
        });
      }
      if (note.trim().length > 0) {
        // The user typed alongside the attachment; keep their note visible.
        appendMessage(chatId, {
          id: `${baseId}-note`,
          role: "assistant",
          content:
            "Ask a follow-up question about the parsed text above to send it to the model.",
        });
      }
    },
    [appendMessage, documentClient, patchMessage, persistMessage],
  );

  const handleSubmit = useCallback(
    async (
      text: string,
      attachments: readonly string[] = [],
      residencyApproved = false,
    ) => {
      stickNow();
      let chat = activeChat;
      if (!chat) {
        const created = client.createChat({
          folderId: null,
          title: DEFAULT_SESSION_TITLE,
          modelId,
        });
        chat = await Promise.resolve(created);
        setActiveChat(chat);
        setSelected({ kind: "chat", id: chat.id });
        setTreeVersion((v) => v + 1);
        adoptDraftPersona(chat.id);
      } else {
        await hydrationPromisesRef.current.get(chat.id);
      }
      const groups = partitionAttachments(attachments);
      // Document parse does not load the chat LLM. Gate residency only when
      // this turn will actually start or send to the selected chat model.
      if (!residencyApproved && groups.documents.length === 0) {
        const selectedModel = listedModels.find(
          (candidate) => candidate.id === modelId,
        );
        const verdict = residency.request({
          targetModelId: modelId,
          targetVramGB: modelVramEstimate(selectedModel?.vramGB),
          requestingModule: "chat",
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
          const earlyUserText = text.trim();
          if (earlyUserText.length > 0 && attachments.length === 0) {
            appendMessage(chat.id, {
              id: `${chat.id}-${Date.now()}-user`,
              role: "user",
              content: earlyUserText,
              ...estimatedUserUsage(earlyUserText),
            });
          }
          appendMessage(chat.id, {
            id: `${chat.id}-${Date.now()}-assistant`,
            role: "assistant",
            content:
              verdict.kind === "not-installed"
                ? `${modelId} is not installed. Install it in Settings > Models.`
                : `Cannot load ${modelId} right now: ${verdict.reason}`,
          });
          return;
        }
      }
      const baseId = `${chat.id}-${Date.now()}`;
      let prompt = text;
      let origin: ChatMessage["origin"];
      const displayAttachments = groups.images;

      if (groups.audio.length > 0) {
        const parts: string[] = [];
        for (const clip of groups.audio) {
          const mime = mimeFromDataUrl(clip) ?? "audio/webm";
          const result = await audioClient.transcribe(clip, mime);
          parts.push(result.transcript);
        }
        const labelled = labelSttTranscript(parts.join("\n"));
        origin = STT_TRANSCRIPT_ORIGIN;
        prompt = [text, labelled]
          .filter((part) => part.trim().length > 0)
          .join("\n\n");
        if (memoryHub) {
          void memoryHub.episodic
            .record({
              id: `${baseId}-stt`,
              content: redactSecrets(prompt),
              source: "chat-stt",
            })
            .catch(() => undefined);
        }
      }

      const userContent =
        attachments.length > 0
          ? `${prompt || (groups.images.length > 0 ? "(image)" : "(attachment)")}\n\n[${attachments.length} attachment${
              attachments.length === 1 ? "" : "s"
            }]`
          : prompt;
      appendMessage(chat.id, {
        id: `${baseId}-user`,
        role: "user",
        content: userContent,
        ...(displayAttachments.length > 0
          ? { attachments: displayAttachments }
          : {}),
        ...(origin ? { origin } : {}),
        ...estimatedUserUsage(userContent),
      });
      // v2.2.0 Phase 8 (DF-13) / v2.2.9 Phase 1.5 (T005): name the chat from
      // its first prompt AND persist it. Fire only on the first message of a
      // still-default chat: a chat the user already named must never be
      // renamed out from under them, and re-titling on every send would fight
      // the user's own rename. An empty prompt keeps "New session".
      const isFirstTitledSend =
        chat.messageCount === 0 &&
        chat.title === DEFAULT_SESSION_TITLE &&
        chat.userRenamed !== true &&
        prompt.trim().length > 0;
      if (isFirstTitledSend) {
        // Immediate prompt-derived fallback through the explorer rename
        // (byUser false), so the rail never sits on "New session" waiting for
        // the 5s title RPC that contends with the live turn.
        const immediate = fallbackTitle(prompt);
        if (immediate !== DEFAULT_SESSION_TITLE) {
          const chatId = chat.id;
          void Promise.resolve(client.renameChat(chatId, immediate, false))
            .then(() => {
              setActiveChat((prev) =>
                prev && prev.id === chatId
                  ? { ...prev, title: immediate }
                  : prev,
              );
              setTreeVersion((v) => v + 1);
            })
            // Titling is a convenience. If the sidecar is down, the chat
            // keeps its default name rather than failing the send.
            .catch(() => undefined);
        }
      } else {
        // Async-safe touch: the IPC adapter rejects when the sidecar is down,
        // and an unhandled rejection here must never take the send down.
        void Promise.resolve(client.renameChat(chat.id, chat.title)).catch(
          () => undefined,
        );
      }

      if (memoryHub && attachments.length > 0) {
        const kinds = [
          ...groups.images.map(() => "image"),
          ...groups.video.map(() => "video"),
          ...groups.audio.map(() => "audio"),
          ...groups.documents.map(() => "document"),
        ];
        void recordMultimodalTurn(memoryHub.episodic, {
          id: `${baseId}-mm`,
          prompt: text,
          kinds,
        }).catch(() => undefined);
      }

      if (groups.documents.length > 0) {
        const first = groups.documents[0];
        if (first !== undefined) {
          await handleParseDocument(chat.id, baseId, first, prompt);
        }
        return;
      }

      const visual = [...groups.images, ...groups.video];
      if (visual.length > 0 && !imageGate.enabled) {
        const first = groups.images[0];
        if (first !== undefined) {
          await handleParseDocument(chat.id, baseId, first, prompt);
          return;
        }
        const alt = listedModels.find(
          (m) => m.installed && modelAcceptsVision(m),
        );
        appendMessage(chat.id, {
          id: `${baseId}-assistant`,
          role: "assistant",
          content: nonVisionAttachmentGuidance(alt?.displayName),
        });
        return;
      }

      const notices: string[] = [];
      const frameUrls: string[] = [];
      const budget = resolveVisualTokenBudget(selectedListedModel);
      for (const clip of groups.video) {
        if (!sampleVideoFrames) {
          notices.push(
            "Video was not sent: frame sampling is unavailable. Attach a still image instead.",
          );
          continue;
        }
        const sampled = await sampleVideoFrames(clip);
        if (sampled.notice) notices.push(sampled.notice);
        const capped = capVideoFrames(sampled.frames.length, budget);
        if (capped.notice) notices.push(capped.notice);
        frameUrls.push(...sampled.frames.slice(0, capped.keep));
      }

      const rawImages = [...groups.images, ...frameUrls];
      const budgeted = enforceVisualBudget(
        rawImages.map((url) => ({
          bytes: dataUrlToBytes(url),
          mime: mimeFromDataUrl(url) ?? "image/png",
        })),
        budget,
      );
      notices.push(...budgeted.notices, ...budgeted.rejected);
      const sendImages = budgeted.images.map((img) => uint8ToBase64(img.bytes));

      if (notices.length > 0) {
        appendMessage(chat.id, {
          id: `${baseId}-budget`,
          role: "assistant",
          content: notices.join(" "),
        });
      }

      if (
        sendImages.length === 0 &&
        rawImages.length > 0 &&
        prompt.trim().length === 0
      ) {
        return;
      }

      const reply = await sendChatTurn(
        chat.id,
        baseId,
        prompt,
        imageGate.enabled ? sendImages : [],
      );
      // v2.2.9 Phase 1.5 (T005): refine the fallback title with the model
      // AFTER the first assistant turn completes, so the title RPC never
      // contends with the live reply. The sidecar persists the generated
      // title through the explorer rename; the guard here keeps a user
      // rename (byUser) from ever being overwritten locally.
      if (isFirstTitledSend && client.generateTitle) {
        const chatId = chat.id;
        void client
          .generateTitle(chat.id, prompt)
          .then(async (result: { title: string }) => {
            const current = await Promise.resolve(client.getChat(chatId)).catch(
              () => null,
            );
            if (current?.userRenamed === true) return;
            if (!current || current.title !== result.title) {
              await Promise.resolve(
                client.renameChat(chatId, result.title, false),
              );
            }
            setActiveChat((prev) =>
              prev && prev.id === chatId
                ? { ...prev, title: result.title }
                : prev,
            );
            setTreeVersion((v) => v + 1);
          })
          .catch(() => undefined);
      }
      if (memoryHub) {
        void memoryHub.episodic
          .record({
            id: `${baseId}-turn`,
            content: redactSecrets(`User: ${prompt}\nAssistant: ${reply}`),
            source: "chat-turn",
            scopeId: chat.contextScopeId,
          })
          .catch(() => undefined);
      }
      if (voiceEnabled) void playReply(reply);
    },
    [
      activeChat,
      activeSchedulerJob,
      appendMessage,
      audioClient,
      client,
      handleParseDocument,
      hostVramFreeGB,
      imageGate.enabled,
      listedModels,
      memoryHub,
      modelId,
      playReply,
      residency,
      sampleVideoFrames,
      selectedListedModel,
      sendChatTurn,
      stickNow,
      voiceEnabled,
    ],
  );

  const handleStartNewSession = useCallback(async (): Promise<void> => {
    const created = client.createChat({
      folderId: activeChat?.folderId ?? null,
      title: DEFAULT_SESSION_TITLE,
      modelId,
    });
    const chat = await Promise.resolve(created);
    setActiveChat(chat);
    setSelected({ kind: "chat", id: chat.id });
    setTreeVersion((v) => v + 1);
    adoptDraftPersona(chat.id);
    setPersonaOpen(false);
  }, [activeChat, adoptDraftPersona, client, modelId]);

  const ensureVoiceMic = useCallback((): MicRecorder => {
    if (!voiceMicRef.current) {
      voiceMicRef.current =
        voiceMicRecorder ??
        createBrowserMicRecorder({
          onSpeechStart: () => dispatchVoice({ type: "speech-start" }),
          onSilence: () => dispatchVoice({ type: "silence" }),
        });
    }
    return voiceMicRef.current;
  }, [dispatchVoice, voiceMicRecorder]);

  const finishVoiceCapture = useCallback(async () => {
    const recorder = voiceMicRef.current;
    if (!recorder) return;
    const url = await recorder.stop();
    dispatchVoice({ type: "ptt-up" });
    if (!url) {
      dispatchVoice({ type: "error", message: "no audio captured" });
      return;
    }
    dispatchVoice({ type: "transcript-ready" });
    await handleSubmit("", [url]);
    dispatchVoice({ type: "reply-ready" });
  }, [dispatchVoice, handleSubmit]);

  const onPttDown = useCallback(() => {
    if (!voiceEnabled || voiceLoop.mode !== "ptt") return;
    dispatchVoice({ type: "ptt-down" });
    void ensureVoiceMic().start();
  }, [dispatchVoice, ensureVoiceMic, voiceEnabled, voiceLoop.mode]);

  const onPttUp = useCallback(() => {
    if (!voiceEnabled || voiceLoop.mode !== "ptt") return;
    void finishVoiceCapture();
  }, [finishVoiceCapture, voiceEnabled, voiceLoop.mode]);

  const onVadToggle = useCallback(() => {
    if (!voiceEnabled || voiceLoop.mode !== "vad") return;
    if (voiceLoop.phase === "recording") {
      dispatchVoice({ type: "vad-stop" });
      void finishVoiceCapture();
      return;
    }
    dispatchVoice({ type: "vad-start" });
    void ensureVoiceMic().start();
  }, [
    dispatchVoice,
    ensureVoiceMic,
    finishVoiceCapture,
    voiceEnabled,
    voiceLoop.mode,
    voiceLoop.phase,
  ]);

  // v2.2.0 Phase 5 (5.4): the mic menu's entries, wired to the SAME voiceLoop
  // state machine the old button row drove. Nothing was dropped -- Voice loop,
  // push-to-talk, VAD and hold-to-talk are all still reachable, just not as
  // five flat buttons above the composer.
  const voiceModes = useMemo(
    () => [
      {
        id: "voice-loop",
        label: voiceEnabled ? "Turn voice loop off" : "Turn voice loop on",
        active: voiceEnabled,
        onSelect: () => {
          setVoiceEnabled((prev) => {
            if (prev) dispatchVoice({ type: "reset" });
            return !prev;
          });
        },
      },
      {
        id: "ptt",
        // Selecting this arms push-to-talk; the composer's mic button is then
        // the hold target, which is why the old dedicated "Hold to talk"
        // button is no longer needed.
        label:
          voiceLoop.mode === "ptt" && voiceLoop.phase === "recording"
            ? "Release to send"
            : "Push to talk",
        active: voiceEnabled && voiceLoop.mode === "ptt",
        onSelect: () => {
          if (voiceLoop.mode !== "ptt") {
            dispatchVoice({ type: "set-mode", mode: "ptt" });
            return;
          }
          if (voiceLoop.phase === "recording") onPttUp();
          else onPttDown();
        },
      },
      {
        id: "vad",
        label:
          voiceLoop.mode === "vad" && voiceLoop.phase === "recording"
            ? "Stop VAD"
            : "Start VAD",
        active: voiceEnabled && voiceLoop.mode === "vad",
        onSelect: () => {
          if (voiceLoop.mode !== "vad") {
            dispatchVoice({
              type: "set-mode",
              mode: "vad" as VoiceCaptureMode,
            });
            return;
          }
          onVadToggle();
        },
      },
    ],
    [
      voiceEnabled,
      voiceLoop.mode,
      voiceLoop.phase,
      dispatchVoice,
      onVadToggle,
      onPttDown,
      onPttUp,
    ],
  );

  return (
    <section
      data-testid="chat-page"
      style={{
        flex: 1,
        display: "flex",
        // v2.2.3 Phase 1 (1.1): without minHeight the flex chain grows past
        // the viewport and the transcript never scrolls.
        minHeight: 0,
        color: "var(--fg-0)",
      }}
    >
      <SidebarHistorySlot>
        <div
          data-testid="chats-pane"
          aria-label={CHAT_FOLDER_TREE_COPY.paneTitle}
          data-history-collapsed={chatsCollapsed ? "true" : "false"}
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <FolderTree
            client={client}
            selected={selected}
            onSelect={handleSelect}
            onOpenChat={handleOpenChat}
            refreshToken={treeVersion}
            defaultModelId={modelId}
            collapsed={chatsCollapsed}
            onSessionDisposition={(id) => {
              if (activeChat?.id !== id) return;
              const next = new Map(messagesByChatRef.current);
              next.delete(id);
              messagesByChatRef.current = next;
              setMessagesByChat(next);
              pendingPromptRef.current = { text: "", attachments: [] };
              setActiveChat(null);
              setSelected(null);
              setPersonaOpen(false);
            }}
          />
        </div>
      </SidebarHistorySlot>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          padding: "var(--space-4)",
          gap: "var(--space-3)",
        }}
      >
        {sidecar.isDown && (
          <SidecarDownBanner
            status={sidecar.status}
            restarting={sidecar.restarting}
            restartError={sidecar.restartError}
            onRestart={() => void sidecar.restart()}
            context="Chat cannot reach the local backend."
            testId="chat-sidecar-down"
          />
        )}

        {transcriptError ? (
          <div
            data-testid="chat-transcript-error"
            role="status"
            style={{ color: "var(--warning)", fontSize: "var(--text-sm)" }}
          >
            {transcriptError}
          </div>
        ) : null}

        {pendingModelSwitch && activeChat ? (
          <ConfirmDialog
            testId="chat-model-switch-confirm"
            title={gpuSwitchTitle("chat", modelDisplayName(pendingModelSwitch))}
            body={[
              ...gpuSwitchBody(
                { label: modelDisplayName(effectiveModelId), running: false },
                modelDisplayName(pendingModelSwitch),
              ),
              "This conversation is kept.",
            ].map((line) => (
              <p key={line} style={{ margin: "0 0 var(--space-1)" }}>
                {line}
              </p>
            ))}
            checkbox={{
              label: "Do not show this again",
              checked: !askDialog,
              onChange: (hide: boolean) => {
                setAskDialog(!hide);
                setAskBeforeModelSwitch(!hide);
              },
            }}
            confirmLabel="Switch and load"
            onCancel={() => setPendingModelSwitch(null)}
            onConfirm={() => {
              const next = pendingModelSwitch;
              const chatId = activeChat.id;
              setPendingModelSwitch(null);
              userChangedModelRef.current = true;
              setModelId(next);
              writeFavorite("chat", next);
              setModelOverrideByChat((prev) => ({ ...prev, [chatId]: next }));
              // The next message restarts the sidecar session with the
              // replayed history, so the context carries over.
              sessionIdsRef.current.delete(chatId);
              setWarmingModelId(next);
              void warmModel(next).finally(() => {
                setWarmingModelId((current) => (current === next ? null : current));
              });
            }}
          />
        ) : null}

        {residency.pending ? (
          <ModelSwitchDialog
            pending={residency.pending}
            testId="chat-model-switch-dialog"
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

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <div
            data-testid="transcript-scroll"
            ref={scrollRef}
            onScroll={onScroll}
            style={{ flex: 1, overflowY: "auto", minWidth: 0 }}
          >
            {activeChat ? (
              <MessageList messages={messages} enableTools={true} />
            ) : (
              <p
                data-testid="chat-page-empty"
                style={{ color: "var(--fg-muted)" }}
              >
                Type a message to start a chat. Folders are optional.
              </p>
            )}
          </div>
        </div>

        <footer
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            position: "relative",
          }}
        >
          {/*
              v1.20.0 Phase 2: RapidOCR remains required for PDF/image. Native
              Office parse does not, so the composer stays usable when this
              banner is showing.
            */}
          {documentModelInstalled === false ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              <button
                type="button"
                data-testid="chat-get-more-models"
                onClick={() => onGetMoreModels?.()}
                style={getMoreModelsStyle}
              >
                No document model installed - get more models
              </button>
              <a
                data-testid="chat-settings-link"
                href={SETTINGS_MODELS_PATH}
                style={{ display: "none" }}
              >
                Settings
              </a>
            </div>
          ) : null}
          {/*
              v2.2.9 Phase 1.1 (T001): the indicator renders ONLY while the
              microphone is actually open. The idle composer shows no "Mic
              closed" leftover (screenshot 1).
            */}
          {voiceLoop.captureVisible ? (
            <span
              data-testid="chat-voice-capture-indicator"
              data-visible="true"
              role="status"
              aria-live="polite"
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--accent-chatbot)",
              }}
            >
              Recording -- microphone is open
            </span>
          ) : null}
          {personaOpen ? (
            <div
              data-testid="chat-persona-popover"
              ref={personaPopoverRef}
              style={{
                position: "absolute",
                // v2.4.8 follow-up: anchored to the right edge, under the
                // Persona button, not the left of the composer.
                right: 0,
                bottom: "100%",
                zIndex: 30,
                width: "min(22rem, 100%)",
                boxSizing: "border-box",
                marginBottom: "var(--space-2)",
                padding: "var(--space-3)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-elevated)",
                boxShadow: "var(--shadow-md)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}
            >
              <label
                htmlFor="chat-persona-field"
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: 600,
                  color: "var(--fg-1)",
                }}
              >
                Persona for this chat
              </label>
              <textarea
                id="chat-persona-field"
                data-testid="chat-persona"
                rows={3}
                value={
                  activeChat ? (personaByChat[activeChat.id] ?? "") : draftPersona
                }
                onChange={(e) => {
                  const next = e.target.value;
                  if (activeChat) setChatPersona(activeChat.id, next);
                  else setDraftPersona(next);
                }}
                placeholder="Optional system prompt for this chat"
                style={{
                  resize: "vertical",
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "var(--space-2) var(--space-3)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-subtle)",
                  background: "var(--bg-1)",
                  color: "var(--fg-0)",
                  fontFamily: "var(--font-sans)",
                  fontSize: "var(--text-sm)",
                  lineHeight: 1.4,
                  outline: "none",
                }}
              />
            </div>
          ) : null}
          <MediaComposer
            onSubmit={(text, attachments) =>
              void handleSubmit(text, attachments)
            }
            onStop={handleStopTurn}
            submitAccentVar="--accent-chatbot"
            voiceModes={voiceModes}
            // v2.4.8 follow-up: Persona is its own person-icon button that
            // opens the persona box directly (no "..." menu in between).
            // Available before the first message too: the draft persona
            // moves onto the chat the first send creates.
            personaAction={{
              active: personaOpen,
              testId: "chat-persona-toggle",
              toggleRef: personaToggleRef,
              onToggle: () => setPersonaOpen((v) => !v),
            }}
            accept={chatComposerAccept({
              allowImages: imageGate.enabled,
              allowAudio: true,
            })}
            placeholder="Type a message, attach a document, or record audio to transcribe locally."
            streaming={messages.some((m) => m.pending && m.id !== warmBubbleId)}
            imageEnabled={imageGate.enabled}
            imageDisabledReason={imageGate.tooltip}
            audioEnabled
            audioHint={audioHint}
          />
          <ComposerContextRow
            usage={contextUsage}
            onStartNewSession={() => void handleStartNewSession()}
          >
            <QuickModelSwitcher
              testId="chat-model-select"
              models={listedModels}
              taskType="llm"
              ownedIds={ownedIdSet(selection)}
              hostVramGB={hostVramGB}
              recommendOrder={recommendOrderForTask(selection, "chat")}
              value={modelId}
              onChange={(nextModelId) => {
                // v2.4.8 follow-up: inside a session, switching asks first,
                // then loads the new model; the conversation is kept.
                // The switcher also syncs its value once on mount when the
                // current id is not an installed option; only a change away
                // from a valid installed model is the user's switch.
                if (
                  activeChat &&
                  nextModelId !== effectiveModelId &&
                  listedModels.some((m) => m.id === modelId && m.installed) &&
                  askDialog
                ) {
                  setPendingModelSwitch(nextModelId);
                  return;
                }
                userChangedModelRef.current = true;
                setModelId(nextModelId);
                writeFavorite("chat", nextModelId);
              }}
              onGetMoreModels={onGetMoreModels}
              disabled={messages.some((m) => m.pending)}
            />
          </ComposerContextRow>
        </footer>
      </div>
    </section>
  );
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = stripDataUrlPrefix(dataUrl);
  if (typeof Buffer !== "undefined")
    return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function chatMessageFromRecord(record: ChatMessageRecord): ChatMessage {
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    attachments: record.attachments,
    timestamp: isoTimestampFromMillis(record.createdAt),
    inputTokens: record.inputTokens ?? null,
    reasoningTokens: record.reasoningTokens ?? null,
    reasoningText: record.reasoningText ?? null,
    outputTokens: record.outputTokens ?? null,
    tokensEstimated: record.tokensEstimated,
    requestUsage: record.requestUsage,
    messageUsage: record.messageUsage,
  };
}

function estimatedUserUsage(content: string): {
  inputTokens: number;
  tokensEstimated: true;
  messageUsage: ReturnType<typeof estimatedMessageUsage>;
} {
  return {
    inputTokens: estimateTokens(content),
    tokensEstimated: true,
    messageUsage: estimatedMessageUsage("user", content),
  };
}

function replayHistory(
  messages: readonly ChatMessage[],
  currentUserId: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter(
      (message): message is ChatMessage & { role: "user" | "assistant" } =>
        !message.pending &&
        message.id !== currentUserId &&
        message.role !== "system",
    )
    .slice(-500)
    .map((message) => ({ role: message.role, content: message.content }));
}

function isUnknownChatSessionError(err: unknown): boolean {
  return err instanceof Error && /unknown sessionId/i.test(err.message);
}

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined")
    return Buffer.from(bytes).toString("base64");
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

const getMoreModelsStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-3)",
  border: "1px solid var(--border-1)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-2)",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontSize: "var(--text-sm)",
};
