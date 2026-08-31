/**
 * v1.15.0 Phase 6 (Issue 5) -- Video Lab, redesigned as a chat.
 *
 * The video analogue of the Phase 5 Image Studio: the mode select + parameter
 * sidebar are replaced by a model selector (installed video models + "Get more
 * models"), a message history with inline playable clips, and the shared
 * attachment-capable `MediaComposer`. `inferVideoIntent` picks text2video (no
 * image) or image2video (an attached image animates), so there is no mode
 * control. Every technical parameter lives behind an "Advanced settings" panel.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileJson, ImagePlus } from "lucide-react";

import { useModelResidency } from "../../shared/models/useModelResidency";
import {
  busyContextFromScheduler,
  modelVramEstimate,
  residentModelsFromScheduler,
  type ResidencySessionMemory,
  type SchedulerActiveJob,
} from "../../shared/models/schedulerResidency";
import { ModelSwitchChip, ModelSwitchDialog } from "../../shared/models/ModelSwitchDialog";
import { SidecarDownBanner } from "../../components/SidecarDownBanner";
import { Button } from "../../components/ui";
import { formatInferenceError } from "../../lib/inferenceRpcError";
import {
  isBackendDownMessage,
  isSidecarFailureMessage,
  useSidecarStatus,
} from "../../lib/sidecarStatus";

import { ComposerContextRow, MediaComposer, MessageList, chatComposerAccept, composerSessionUsage, useStickToBottom, withLiveTimestamp, type ChatMessage } from "../../shared/chat";
import { isUsableVideoPath } from "../../shared/studio/usablePayload";
import { QuickModelSwitcher } from "../../shared/models/QuickModelSwitcher";
import {
  SETTINGS_MODELS_PATH,
  installedModelsForType,
} from "../../shared/models/installedFeed";
import {
  ownedIdSet,
  readFavorite,
  resolveDefaultId,
  type SelectionSnapshot,
} from "../../shared/models/selectionPolicy";
import { createIpcModelsClient } from "../../pages/settings/ipcModelsClient";
import type { ListedModelDto } from "../../pages/settings/modelsTypes";
import type { DiffusionTierId } from "../../../../core/config/DiffusionTier";
import { getDiffusionTierConfig } from "../../../../core/config/DiffusionTier";
import { planVideoContinuation, type ContinuationSegmentPlan } from "../../../../core/video/continuation";
import { OFFICIAL_AVATAR_MODEL_ID, avatarAvailable, assertAvatarAllowed } from "../../../../core/video/avatarGate";
import type { RationalFrameRate } from "../../../../core/video/VideoEnhancement";
import {
  DEFAULT_VIDEO_FORM_VALUES,
  VideoPromptForm,
  videoFormToRequest,
  type VideoFormValues,
} from "./VideoPromptForm";
import { inferVideoIntent } from "./intent";
import { TimelinePreviewer, type TimelineSegment } from "./TimelinePreviewer";
import {
  createIpcVideoClient,
  type VideoClient,
  type VideoContinueFrom,
  type VideoMode,
  type VideoProgressEvent,
} from "./videoClient";
import { VideoEnhancementPanel } from "./VideoEnhancementPanel";
import {
  createIpcVideoEnhancementClient,
  type VideoEnhancementClient,
  type VideoEnhancementJobDto,
} from "./videoEnhancementClient";
import { RecallActions, applyImageRecall, type RecallMode } from "../../shared/studio/RecallActions";
import { GenerationQueueBar } from "../../shared/studio/GenerationQueueBar";
import {
  createIpcGenerationQueueClient,
  type GenerationQueueClient,
} from "../../shared/studio/generationQueueClient";
import type { GenerationJob } from "../../../../core/generations/GenerationQueue";
import { StudioHistoryPane } from "../../shared/explorer/StudioHistoryPane";
import {
  InMemoryStudioExplorerClient,
  type StudioExplorerClient,
} from "../../shared/explorer/studioExplorerClient";
import { createIpcStudioExplorerClient } from "../../shared/explorer/ipcStudioExplorerClient";
import { tauriAvailable } from "../chat/ipcChatExplorerClient";
import { ipc } from "../../lib/ipc";
import {
  isUsablePathRef,
  lastAssistantMediaRef,
  studioTurnsToChatMessages,
  UNREADABLE_OUTPUT_TEXT,
} from "../../shared/explorer/studioSessionMemory";
import {
  applyImmediateFallbackTitle,
  DEFAULT_SESSION_TITLE,
  refineGeneratedTitle,
} from "../../shared/explorer/scheduleFirstPromptTitle";
import type { StudioTurn } from "../../../../core/generations/StudioSessionStore.types";
import { studioPersistUsage } from "../../shared/studio/studioTurnUsage";
import {
  createIpcMediaRuntimeClient,
  isMediaRuntimeFailure,
  type MediaRuntimeClient,
  type MediaRuntimeState,
} from "../../shared/studio/mediaRuntimeClient";

const FALLBACK_MODEL: ListedModelDto = {
  id: DEFAULT_VIDEO_FORM_VALUES.modelId,
  displayName: "Wan 2.1 T2V 1.3B",
  type: "video",
  installed: true,
  source: "registry",
};

export interface VideoLabPageProps {
  readonly client?: VideoClient;
  readonly enhancementClient?: VideoEnhancementClient;
  /** Models client for the installed video-model selector. */
  readonly modelsClient?: {
    list(): Promise<readonly ListedModelDto[]>;
    lastSelection?: SelectionSnapshot | null;
  };
  /** Test seam: drain interval (ms). Defaults to 100ms. */
  readonly drainIntervalMs?: number;
  /** Test seam: enhancement polling interval (ms). Defaults to 1000ms. */
  readonly enhancementPollIntervalMs?: number;
  /** Test seam: clipboard adapter. Defaults to navigator.clipboard. */
  readonly clipboard?: { writeText: (value: string) => Promise<void> };
  /** Invoked by the selector's "Get more models" entry (App wires navigation). */
  readonly onGetMoreModels?: () => void;
  /** Maps a sidecar mp4Path into a URL the HTML5 video element can play. */
  readonly resolveMp4Url?: (mp4Path: string) => string;
  readonly initialValues?: Partial<VideoFormValues>;
  readonly diffusionTier?: DiffusionTierId;
  readonly vramGB?: number;
  readonly queueClient?: GenerationQueueClient;
  /**
   * v2.2.0 Phase 8 (DF-9/10/11): free VRAM from live telemetry. `null` (the
   * default) means telemetry is unreadable, which the policy treats as "ask
   * the user" rather than guessing a fit.
   */
  readonly hostVramFreeGB?: number | null;
  /** The scheduler's active job, so the policy knows what would be evicted. */
  readonly activeSchedulerJob?: SchedulerActiveJob | null;
  readonly residencyMemory?: ResidencySessionMemory;
  /** v2.2.6: inject a studio explorer (tests). Production uses IPC when Tauri+sidecar are up. */
  readonly explorerClient?: StudioExplorerClient;
  /** Test seam: hydrate this session on mount (quit/reopen). */
  readonly initialSessionId?: string;
  /** Test seam: probe whether a last-output path still exists on disk. */
  readonly outputExists?: (path: string) => boolean;
  readonly mediaRuntimeClient?: MediaRuntimeClient;
}

interface VideoEnhancementSourceBinding {
  readonly parentJobId: string;
  readonly sourceOutputId: string;
  readonly sourceOutputHash: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: RationalFrameRate;
}

let messageSeq = 0;
const OUTPUT_HASH_PATTERN = /^[a-f0-9]{64}$/;

function nextId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}-${messageSeq}`;
}

function videoRecoveryState(state: MediaRuntimeState): ChatMessage["mediaRecovery"] {
  if (state.state === "ready") return undefined;
  return {
    state: state.state,
    code: state.code,
    message: state.message,
    retryable: state.retryable,
    progress: state.progress,
    ...(state.details ? { details: state.details } : {}),
    ...(state.logPath ? { logPath: state.logPath } : {}),
  };
}

export function VideoLabPage({
  client: clientOverride,
  enhancementClient: enhancementClientOverride,
  modelsClient,
  drainIntervalMs = 100,
  enhancementPollIntervalMs = 1_000,
  clipboard,
  onGetMoreModels,
  resolveMp4Url = (path) => path,
  initialValues,
  diffusionTier = "diffusion-mid",
  vramGB = 0,
  queueClient: queueOverride,
  hostVramFreeGB = null,
  activeSchedulerJob = null,
  residencyMemory,
  explorerClient: explorerClientOverride,
  initialSessionId,
  outputExists,
  mediaRuntimeClient: mediaRuntimeOverride,
}: VideoLabPageProps = {}): JSX.Element {
  const tierClip = getDiffusionTierConfig(diffusionTier).video.clipSeconds || 4;
  const canAvatar = avatarAvailable(diffusionTier, vramGB);
  const [client] = useState<VideoClient>(() => clientOverride ?? createIpcVideoClient());
  const [enhancementClient] = useState<VideoEnhancementClient>(
    () => enhancementClientOverride ?? createIpcVideoEnhancementClient(),
  );
  const [queueClient] = useState<GenerationQueueClient>(
    () => queueOverride ?? createIpcGenerationQueueClient(),
  );
  const [mediaRuntimeClient] = useState<MediaRuntimeClient>(
    () => mediaRuntimeOverride ?? createIpcMediaRuntimeClient(),
  );
  const [models, setModels] = useState<readonly ListedModelDto[]>([FALLBACK_MODEL]);
  const [noneInstalled, setNoneInstalled] = useState(false);
  // v2.2.0 Phase 2 (2.2): "backend down" is not "no models installed".
  const [listFailure, setListFailure] = useState<string | null>(null);
  const sidecar = useSidecarStatus();
  const backendDown = sidecar.isDown || isBackendDownMessage(listFailure);
  const mediaRetryRef = useRef<{
    assistantId: string;
    text: string;
    attachments: readonly string[];
  } | null>(null);
  const studioClient = useMemo(() => {
    if (explorerClientOverride) return explorerClientOverride;
    if (backendDown || !tauriAvailable()) return new InMemoryStudioExplorerClient("video");
    return createIpcStudioExplorerClient("video");
  }, [explorerClientOverride, backendDown]);
  const [selectedModelId, setSelectedModelId] = useState<string>(FALLBACK_MODEL.id);
  const [values, setValues] = useState<VideoFormValues>({
    ...DEFAULT_VIDEO_FORM_VALUES,
    clipSeconds: tierClip,
    ...initialValues,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const lastStudioMessage = messages[messages.length - 1];
  const { scrollRef, onScroll, stickNow } = useStickToBottom(
    `${messages.length}:${lastStudioMessage?.id ?? ""}:${lastStudioMessage?.content?.length ?? 0}:${lastStudioMessage?.pending ? 1 : 0}`,
  );
  const activeSessionIdRef = useRef<string | null>(null);
  const titleJobRef = useRef<{ id: string; prompt: string } | null>(null);
  // v2.2.9 Phase 1.4 (T004): state mirror of the ref so the history pane can
  // bind its highlighted row to the session that is actually open.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const setActiveSession = useCallback((id: string | null): void => {
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
  }, []);
  const lastOutputRef = useRef<string | null>(null);
  const lastJobIdRef = useRef<string | null>(null);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [activeJob, setActiveJob] = useState<{ jobId: string; messageId: string } | null>(null);
  const [seededAttachment, setSeededAttachment] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<ReadonlyMap<string, readonly TimelineSegment[]>>(
    () => new Map(),
  );
  const outputs = useRef<Map<string, string>>(new Map()); // messageId -> mp4Path
  const frameRatesByMessage = useRef<Map<string, number>>(new Map());
  const [enhancementSources, setEnhancementSources] = useState<
    ReadonlyMap<string, VideoEnhancementSourceBinding>
  >(() => new Map());
  const [openEnhancementPanels, setOpenEnhancementPanels] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const enhancementButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const completedEnhancementJobs = useRef<Set<string>>(new Set());
  const enhancedMessageIds = useRef<Set<string>>(new Set());
  const [formEpoch, setFormEpoch] = useState(0);
  const [queueJobs, setQueueJobs] = useState<readonly GenerationJob[]>([]);
  const [workflowByMessage, setWorkflowByMessage] = useState<Record<string, Record<string, unknown>>>({});
  const [frameComments, setFrameComments] = useState<readonly { frame: number; text: string }[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const chainRef = useRef<{
    messageId: string;
    current: ContinuationSegmentPlan;
    remaining: ContinuationSegmentPlan[];
    playlist: TimelineSegment[];
    mode: VideoMode;
    base: ReturnType<typeof videoFormToRequest>;
    sourceImage?: string;
    sourceAudio?: string;
  } | null>(null);

  const isGenerating = activeJob !== null;
  // v2.2.0 Phase 8 (DF-9/10/11): the same single-GPU switch policy Image
  // Studio has used since Phase 4. Video is the tab most likely to collide
  // with agentic work, and it was the one still loading unconditionally.
  // Classification happens on SUBMIT only: mounting this route must never
  // change residency, which is the accidental-tab-click case.
  const residency = useModelResidency({ rememberedPairs: residencyMemory });
  // Holds the prompt whose submit opened the dialog, so "Switch now" resumes
  // the SAME request instead of losing it.
  const pendingPromptRef = useRef<{ text: string; attachments: readonly string[] }>({
    text: "",
    attachments: [],
  });

  // Installed video models for the selector (Phase 4 feed). Falls back to a
  // single default when the sidecar is unavailable so generation still works.
  useEffect(() => {
    let cancelled = false;
    const source = modelsClient ?? createIpcModelsClient();
    void (async () => {
      try {
        const all = await source.list();
        const snap = source.lastSelection ?? null;
        const video = installedModelsForType(all, "video", ownedIdSet(snap));
        if (cancelled) return;
        const first = video[0];
        if (first) {
          setModels(video);
          const next = resolveDefaultId(video, {
            favorite: readFavorite("video"),
            recommended: snap?.recommendedByTask.video ?? null,
          });
          setSelectedModelId(next || first.id);
          setNoneInstalled(false);
          setListFailure(null);
        } else {
          setModels([]);
          setNoneInstalled(true);
          setListFailure(null);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          const backendFailed = isSidecarFailureMessage(message);
          if (backendFailed) {
            setModels([]);
            setNoneInstalled(false);
            setListFailure(message);
          } else {
            setModels([FALLBACK_MODEL]);
            setNoneInstalled(false);
            setListFailure(null);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelsClient]);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>): void => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const persistTurn = useCallback(
    (input: { role: "user" | "assistant"; content: string; mediaRef?: string | null }): void => {
      if (backendDown) return;
      const sessionId = activeSessionIdRef.current;
      if (!sessionId || !studioClient.appendTurn) return;
      try {
        void Promise.resolve(
          studioClient.appendTurn({
            sessionId,
            role: input.role,
            content: input.content,
            mediaRef: input.mediaRef ?? null,
            ...studioPersistUsage(input),
          }),
        ).then(() => setHistoryEpoch((n) => n + 1), () => undefined);
      } catch {
        // Do not claim saved.
      }
    },
    [backendDown, studioClient],
  );

  const ensureSession = useCallback(
    async (prompt: string): Promise<string | null> => {
      if (backendDown) return null;
      if (activeSessionIdRef.current) return activeSessionIdRef.current;
      try {
        const session = await Promise.resolve(
          studioClient.createSession({
            folderId: null,
            title: DEFAULT_SESSION_TITLE,
            modelId: selectedModelId,
          }),
        );
        setActiveSession(session.id);
        titleJobRef.current = { id: session.id, prompt };
        void applyImmediateFallbackTitle({
          sessionId: session.id,
          prompt,
          currentTitle: DEFAULT_SESSION_TITLE,
          rename: (id, title) => studioClient.renameSession(id, title),
        }).then(() => setHistoryEpoch((n) => n + 1), () => undefined);
        setHistoryEpoch((n) => n + 1);
        return session.id;
      } catch {
        return null;
      }
    },
    [backendDown, setActiveSession, studioClient, selectedModelId],
  );

  const hydrateSession = useCallback(
    (sessionId: string): void => {
      const apply = (turns: readonly StudioTurn[], lastRef: string | null): void => {
        setActiveSession(sessionId);
        lastOutputRef.current = lastRef;
        lastJobIdRef.current = null;
        setEnhancementSources(new Map());
        setOpenEnhancementPanels(new Set());
        completedEnhancementJobs.current.clear();
        enhancedMessageIds.current.clear();
        frameRatesByMessage.current.clear();
        setMessages(studioTurnsToChatMessages(turns, { outputExists, mediaKind: "video" }));
      };
      const turnsMaybe = studioClient.listTurns?.(sessionId) ?? [];
      const sessionMaybe = studioClient.getSession(sessionId);
      const isThenable = (value: unknown): value is Promise<unknown> =>
        typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
      if (!isThenable(turnsMaybe) && !isThenable(sessionMaybe)) {
        const turns = turnsMaybe as readonly StudioTurn[];
        apply(turns, (sessionMaybe as { lastOutputRef?: string | null } | null)?.lastOutputRef ?? lastAssistantMediaRef(turns));
        return;
      }
      void Promise.all([Promise.resolve(turnsMaybe), Promise.resolve(sessionMaybe)]).then(
        ([turns, session]) => {
          const list = (turns ?? []) as readonly StudioTurn[];
          apply(
            list,
            (session as { lastOutputRef?: string | null } | null)?.lastOutputRef ?? lastAssistantMediaRef(list),
          );
        },
      );
    },
    [studioClient, outputExists, setActiveSession],
  );

  const startFreshStudioSession = useCallback(async (): Promise<void> => {
    setMessages([]);
    lastOutputRef.current = null;
    lastJobIdRef.current = null;
    setEnhancementSources(new Map());
    setOpenEnhancementPanels(new Set());
    completedEnhancementJobs.current.clear();
    enhancedMessageIds.current.clear();
    frameRatesByMessage.current.clear();
    setActiveSession(null);
    if (backendDown) return;
    try {
      const session = await Promise.resolve(
        studioClient.createSession({
          folderId: null,
          title: "New chat",
          modelId: selectedModelId,
        }),
      );
      setActiveSession(session.id);
      setHistoryEpoch((n) => n + 1);
    } catch {
      // Local transcript already cleared; the old session stays in the pane.
    }
  }, [backendDown, setActiveSession, studioClient, selectedModelId]);

  useEffect(() => {
    if (!initialSessionId) return;
    hydrateSession(initialSessionId);
  }, [initialSessionId, hydrateSession]);

  const dispatchSegment = useCallback(
    async (
      mode: VideoMode,
      base: ReturnType<typeof videoFormToRequest>,
      segment: ContinuationSegmentPlan,
      extras: {
        sourceImage?: string;
        sourceAudio?: string;
        priorJobId?: string;
        segmentCount: number;
        sessionContinueFrom?: VideoContinueFrom;
      },
    ) => {
      const request = {
        ...base,
        durationSeconds: segment.durationSeconds,
        ...(segment.continueFromPrior && extras.priorJobId
          ? {
              continueFrom: {
                priorJobId: extras.priorJobId,
                lastFramePath: lastOutputRef.current ?? undefined,
                segmentIndex: segment.index,
                segmentCount: extras.segmentCount,
              },
            }
          : extras.sessionContinueFrom
            ? { continueFrom: extras.sessionContinueFrom }
            : {}),
      };
      if (mode === "audio2video") {
        return client.audio2video({
          ...request,
          sourceImage: extras.sourceImage ?? "",
          sourceAudio: extras.sourceAudio ?? "",
          confirmLocalAvatar: true,
          diffusionTier,
          vramGB,
          weightRepo: "meituan-longcat/LongCat-Video-Avatar-1.5",
        });
      }
      if (mode === "image2video") {
        return client.image2video({ ...request, sourceImage: extras.sourceImage ?? "" });
      }
      return client.text2video(request);
    },
    [client, diffusionTier, vramGB],
  );

  const advanceFromEvents = useCallback(
    async (
      events: readonly VideoProgressEvent[],
      messageId: string,
    ): Promise<{ done: boolean; nextJobId?: string }> => {
      for (const event of events) {
        if (event.kind === "progress") {
          patchMessage(messageId, {
            progress: { step: event.step ?? 0, total: event.totalSteps ?? 0 },
          });
        } else if (event.kind === "complete") {
          const mp4Path = event.outputPath ?? event.mp4Path ?? "";
          if (!isUsableVideoPath(mp4Path)) {
            outputs.current.delete(messageId);
            frameRatesByMessage.current.delete(messageId);
            setEnhancementSources((prev) => {
              const next = new Map(prev);
              next.delete(messageId);
              return next;
            });
            setOpenEnhancementPanels((prev) => {
              const next = new Set(prev);
              next.delete(messageId);
              return next;
            });
            chainRef.current = null;
            setPlaylists((prev) => {
              const next = new Map(prev);
              next.delete(messageId);
              return next;
            });
            setWorkflowByMessage((prev) => {
              const next = { ...prev };
              delete next[messageId];
              return next;
            });
            patchMessage(messageId, {
              pending: false,
              progress: undefined,
              media: undefined,
              content: "Generation failed: video generation completed without a playable clip.",
            });
            persistTurn({
              role: "assistant",
              content: "Generation failed: video generation completed without a playable clip.",
            });
            return { done: true };
          }
          outputs.current.set(messageId, mp4Path);
          const chain = chainRef.current;
          if (chain) frameRatesByMessage.current.set(messageId, chain.base.fps);
          if (chain && mp4Path) {
            chain.playlist.push({
              src: resolveMp4Url(mp4Path),
              durationSeconds: chain.current.durationSeconds,
            });
          }
          const next = chain?.remaining[0];
          if (chain && next) {
            chain.current = next;
            chain.remaining = chain.remaining.slice(1);
            const accepted = await dispatchSegment(chain.mode, chain.base, next, {
              sourceImage: chain.sourceImage,
              sourceAudio: chain.sourceAudio,
              priorJobId: event.jobId,
              segmentCount: next.index + 1 + chain.remaining.length,
            });
            return { done: false, nextJobId: accepted.jobId };
          }
          const playlist = chain?.playlist ?? [];
          if (playlist.length > 1) {
            setPlaylists((prev) => {
              const copy = new Map(prev);
              copy.set(messageId, playlist);
              return copy;
            });
          }
          const firstSrc = playlist[0]?.src ?? (mp4Path ? resolveMp4Url(mp4Path) : undefined);
          patchMessage(messageId, {
            pending: false,
            progress: undefined,
            media: firstSrc ? { kind: "video", src: firstSrc } : undefined,
          });
          if (isUsablePathRef(mp4Path)) {
            lastOutputRef.current = mp4Path;
            lastJobIdRef.current = event.jobId;
            persistTurn({ role: "assistant", content: "", mediaRef: mp4Path });
          } else {
            persistTurn({ role: "assistant", content: "" });
          }
          if (mp4Path) {
            void client.extractWorkflow(mp4Path).then((wf) => {
              if (wf && typeof wf === "object") {
                setWorkflowByMessage((prev) => ({
                  ...prev,
                  [messageId]: wf as Record<string, unknown>,
                }));
              }
            });
          }
          const outputId = event.outputId?.trim() ?? "";
          const outputHash = event.outputHash?.trim() ?? "";
          if (
            chain &&
            outputId.length > 0 &&
            outputId.length <= 256 &&
            OUTPUT_HASH_PATTERN.test(outputHash)
          ) {
            setEnhancementSources((prev) => {
              const next = new Map(prev);
              next.set(messageId, {
                parentJobId: event.jobId,
                sourceOutputId: outputId,
                sourceOutputHash: outputHash,
                width: chain.base.width,
                height: chain.base.height,
                frameRate: { numerator: chain.base.fps, denominator: 1 },
              });
              return next;
            });
          } else {
            setEnhancementSources((prev) => {
              const next = new Map(prev);
              next.delete(messageId);
              return next;
            });
          }
          chainRef.current = null;
          if (mediaRetryRef.current?.assistantId === messageId) {
            mediaRetryRef.current = null;
          }
          return { done: true };
        } else if (event.kind === "error") {
          chainRef.current = null;
          outputs.current.delete(messageId);
          frameRatesByMessage.current.delete(messageId);
          setEnhancementSources((prev) => {
            const next = new Map(prev);
            next.delete(messageId);
            return next;
          });
          const runtimeMessage = event.message ?? "unknown error";
          if (isMediaRuntimeFailure(runtimeMessage)) {
            void mediaRuntimeClient.status().then((state) => {
              patchMessage(messageId, {
                pending: false,
                progress: undefined,
                media: undefined,
                content: "",
                mediaRecovery: videoRecoveryState(state),
              });
            });
            return { done: true };
          }
          patchMessage(messageId, {
            pending: false,
            progress: undefined,
            media: undefined,
            content: `Generation failed: ${event.message ?? "unknown error"}`,
          });
          persistTurn({
            role: "assistant",
            content: `Generation failed: ${event.message ?? "unknown error"}`,
          });
          return { done: true };
        }
      }
      return { done: false };
    },
    [patchMessage, resolveMp4Url, dispatchSegment, client, persistTurn, mediaRuntimeClient],
  );

  const handleMediaError = useCallback(
    (message: ChatMessage): void => {
      outputs.current.delete(message.id);
      frameRatesByMessage.current.delete(message.id);
      setEnhancementSources((prev) => {
        const next = new Map(prev);
        next.delete(message.id);
        return next;
      });
      setOpenEnhancementPanels((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
      setPlaylists((prev) => {
        const next = new Map(prev);
        next.delete(message.id);
        return next;
      });
      setWorkflowByMessage((prev) => {
        const next = { ...prev };
        delete next[message.id];
        return next;
      });
      patchMessage(message.id, {
        media: undefined,
        content: "Generation failed: generated video could not be displayed.",
      });
    },
    [patchMessage],
  );

  useEffect(() => {
    if (!activeJob) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        if (cancelled) return;
        try {
          const events = await client.drainEvents(activeJob.jobId);
          if (cancelled) return;
          const { done, nextJobId } = await advanceFromEvents(events, activeJob.messageId);
          if (nextJobId) {
            setActiveJob({ jobId: nextJobId, messageId: activeJob.messageId });
            return;
          }
          if (done) {
            cancelled = true;
            clearInterval(timer);
            setActiveJob(null);
          }
        } catch (err) {
          cancelled = true;
          clearInterval(timer);
          chainRef.current = null;
          patchMessage(activeJob.messageId, {
            pending: false,
            content: `Generation failed: ${formatInferenceError(err)}`,
          });
          setActiveJob(null);
        }
      })();
    }, drainIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeJob, client, advanceFromEvents, drainIntervalMs, patchMessage]);

  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(() => {
      void queueClient.list().then((jobs) => {
        if (!cancelled) setQueueJobs(jobs);
      }).catch(() => undefined);
    }, Math.max(drainIntervalMs, 200));
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [queueClient, drainIntervalMs]);

  const markMediaRuntimeFailure = useCallback(
    async (assistantId: string, error: unknown): Promise<boolean> => {
      const message = formatInferenceError(error);
      if (!isMediaRuntimeFailure(message)) return false;
      try {
        const state = await mediaRuntimeClient.status();
        patchMessage(assistantId, {
          pending: false,
          content: "",
          mediaRecovery: videoRecoveryState(state),
        });
      } catch {
        patchMessage(assistantId, {
          pending: false,
          content: `Generation failed: ${message}`,
        });
      }
      return true;
    },
    [mediaRuntimeClient, patchMessage],
  );

  const handleSubmit = useCallback(
    async (
      text: string,
      attachments: readonly string[],
      residencyApproved = false,
      retryAssistantId?: string,
    ): Promise<void> => {
      stickNow();
      if (isGenerating) return;
      if (!residencyApproved) {
        const selected = models.find((m) => m.id === selectedModelId);
        const verdict = residency.request({
          targetModelId: selectedModelId,
          targetVramGB: modelVramEstimate(selected?.vramGB),
          requestingModule: "video",
          resident: residentModelsFromScheduler(activeSchedulerJob),
          freeVramGB: hostVramFreeGB,
          activeJob: busyContextFromScheduler(activeSchedulerJob),
          installed: Boolean(selected?.installed),
        });
        if (verdict.kind === "confirm") {
          pendingPromptRef.current = { text, attachments };
          return;
        }
        if (verdict.kind === "not-installed" || verdict.kind === "defer") {
          setMessages((prev) => [
            ...prev,
            withLiveTimestamp({
              id: nextId("vassistant"),
              role: "assistant",
              content:
                verdict.kind === "not-installed"
                  ? `${selectedModelId} is not installed. Install it in Settings > Models.`
                  : `Cannot load ${selectedModelId} right now: ${verdict.reason}`,
            }),
          ]);
          return;
        }
      }
      if (
        attachments.length === 0 &&
        lastOutputRef.current &&
        !isUsablePathRef(lastOutputRef.current, outputExists)
      ) {
        const userMsg: ChatMessage = {
          id: nextId("vuser"),
          role: "user",
          content: text,
        };
        const assistantMsg: ChatMessage = {
          id: nextId("vassistant"),
          role: "assistant",
          content: UNREADABLE_OUTPUT_TEXT,
        };
        setMessages((prev) => [...prev, withLiveTimestamp(userMsg), withLiveTimestamp(assistantMsg)]);
        await ensureSession(text);
        persistTurn({ role: "user", content: text });
        persistTurn({ role: "assistant", content: UNREADABLE_OUTPUT_TEXT });
        return;
      }
      const intent = inferVideoIntent({ text, attachments, avatarEnabled: canAvatar });
      const userMsg: ChatMessage = {
        id: nextId("vuser"),
        role: "user",
        content: text,
        ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
      };
      const assistantId = retryAssistantId ?? nextId("vassistant");
      if (retryAssistantId) {
        patchMessage(assistantId, {
          pending: true,
          content: "",
          mediaRecovery: undefined,
          activity: "video-generation",
        });
      } else {
        setMessages((prev) => [
          ...prev,
          withLiveTimestamp(userMsg),
          withLiveTimestamp({
            id: assistantId,
            role: "assistant",
            content: "",
            pending: true,
            activity: "video-generation",
          }),
        ]);
        await ensureSession(text);
        persistTurn({ role: "user", content: text });
      }
      mediaRetryRef.current = { assistantId, text, attachments: [...attachments] };

      if (intent.blockedReason) {
        patchMessage(assistantId, { pending: false, content: intent.blockedReason });
        return;
      }

      if (intent.mode === "audio2video") {
        const gate = assertAvatarAllowed({
          tierId: diffusionTier,
          vramGB,
          confirmed: values.confirmLocalAvatar,
          modelId: OFFICIAL_AVATAR_MODEL_ID,
        });
        if (!gate.ok) {
          patchMessage(assistantId, { pending: false, content: gate.message });
          return;
        }
      }

      const clipSeconds = values.clipSeconds || tierClip;
      const segments = planVideoContinuation(values.durationSeconds, clipSeconds);
      const first = segments[0];
      if (!first) {
        patchMessage(assistantId, { pending: false, content: "Generation failed: empty continuation plan" });
        return;
      }

      const modelId =
        intent.mode === "audio2video" ? OFFICIAL_AVATAR_MODEL_ID : selectedModelId;
      const commentBlock =
        frameComments.length > 0
          ? `\n\nFrame notes:\n${frameComments.map((c) => `f${c.frame}: ${c.text}`).join("\n")}`
          : "";
      const base = videoFormToRequest({
        ...values,
        prompt: `${intent.prompt}${commentBlock}`,
        modelId,
      });

      const sessionContinueFrom: VideoContinueFrom | undefined =
        !intent.sourceImage &&
        lastJobIdRef.current &&
        isUsablePathRef(lastOutputRef.current, outputExists)
          ? {
              priorJobId: lastJobIdRef.current,
              lastFramePath: lastOutputRef.current ?? undefined,
              segmentIndex: 1,
              segmentCount: 2,
            }
          : undefined;

      try {
        chainRef.current = {
          messageId: assistantId,
          current: first,
          remaining: segments.slice(1).map((s) => s),
          playlist: [],
          mode: intent.mode,
          base,
          sourceImage: intent.sourceImage,
          sourceAudio: intent.sourceAudio,
        };
        const accepted = await dispatchSegment(intent.mode, base, first, {
          sourceImage: intent.sourceImage,
          sourceAudio: intent.sourceAudio,
          segmentCount: segments.length,
          sessionContinueFrom,
        });
        setActiveJob({ jobId: accepted.jobId, messageId: assistantId });
      } catch (err) {
        chainRef.current = null;
        if (!(await markMediaRuntimeFailure(assistantId, err))) {
          patchMessage(assistantId, {
            pending: false,
            content: `Generation failed: ${formatInferenceError(err)}`,
          });
          persistTurn({
            role: "assistant",
            content: `Generation failed: ${formatInferenceError(err)}`,
          });
          mediaRetryRef.current = null;
        }
      }
      const titleJob = titleJobRef.current;
      titleJobRef.current = null;
      if (titleJob) {
        void refineGeneratedTitle({
          sessionId: titleJob.id,
          prompt: titleJob.prompt,
          rename: (id, title) => studioClient.renameSession(id, title),
          generateTitle: async (id, prompt) => {
            const reply = await ipc.call<{ title: string }>("chat.generateTitle", {
              chatId: id,
              firstMessage: prompt,
            });
            return reply.ok ? reply.value : null;
          },
        }).then(() => setHistoryEpoch((n) => n + 1), () => undefined);
      }
    },
    [
      isGenerating,
      values,
      selectedModelId,
      client,
      patchMessage,
      canAvatar,
      diffusionTier,
      vramGB,
      tierClip,
      dispatchSegment,
      frameComments,
      persistTurn,
      ensureSession,
      outputExists,
      markMediaRuntimeFailure,
      stickNow,
      studioClient,
    ],
  );

  const repairMediaRuntime = useCallback(
    async (message: ChatMessage): Promise<void> => {
      let state = await mediaRuntimeClient.repair();
      patchMessage(message.id, { mediaRecovery: videoRecoveryState(state) });
      while (state.state === "repairing") {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        state = await mediaRuntimeClient.status();
        patchMessage(message.id, { mediaRecovery: videoRecoveryState(state) });
      }
      const pending = mediaRetryRef.current;
      if (state.state === "ready" && pending?.assistantId === message.id) {
        mediaRetryRef.current = null;
        await handleSubmit(pending.text, pending.attachments, true, pending.assistantId);
      }
    },
    [handleSubmit, mediaRuntimeClient, patchMessage],
  );

  const cancelMediaRepair = useCallback(
    async (message: ChatMessage): Promise<void> => {
      const state = await mediaRuntimeClient.cancelRepair();
      mediaRetryRef.current = null;
      patchMessage(message.id, { mediaRecovery: videoRecoveryState(state) });
    },
    [mediaRuntimeClient, patchMessage],
  );

  const handleEnhancementComplete = useCallback(
    (job: VideoEnhancementJobDto): void => {
      if (job.state !== "succeeded" || !job.output) return;
      if (completedEnhancementJobs.current.has(job.childJobId)) return;
      completedEnhancementJobs.current.add(job.childJobId);
      const output = job.output;

      const messageId = `video-enhancement-${job.childJobId}`;
      enhancedMessageIds.current.add(messageId);
      outputs.current.set(messageId, output.path);
      frameRatesByMessage.current.set(
        messageId,
        output.frameRate.numerator / output.frameRate.denominator,
      );
      const workflowAndProvenance = {
        ...output.workflow,
        durableProvenance: output.durableProvenance,
      };
      setWorkflowByMessage((prev) => ({
        ...prev,
        [messageId]: workflowAndProvenance,
      }));
      const content = `Enhanced output (${output.width} x ${output.height}, ${output.frameRate.numerator}/${output.frameRate.denominator} fps). This is a separate synthesized file; the original remains unchanged.`;
      setMessages((prev) => [
        ...prev,
        withLiveTimestamp({
          id: messageId,
          role: "assistant",
          content,
          media: { kind: "video", src: resolveMp4Url(output.path) },
        }),
      ]);
      persistTurn({ role: "assistant", content, mediaRef: output.path });
    },
    [persistTurn, resolveMp4Url],
  );

  useEffect(() => {
    const parentIds = Array.from(
      new Set(Array.from(enhancementSources.values()).map((source) => source.parentJobId)),
    );
    if (parentIds.length === 0) return;
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const lists = await Promise.all(
          parentIds.map((parentJobId) => enhancementClient.list(parentJobId)),
        );
        if (cancelled) return;
        for (const jobs of lists) {
          for (const job of jobs) handleEnhancementComplete(job);
        }
      } catch {
        // Keep the last truthful transcript. The open panel owns retry copy.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), enhancementPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enhancementClient, enhancementPollIntervalMs, enhancementSources, handleEnhancementComplete]);

  const closeEnhancementPanel = useCallback((messageId: string): void => {
    setOpenEnhancementPanels((prev) => {
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
    setTimeout(() => enhancementButtonRefs.current.get(messageId)?.focus(), 0);
  }, []);

  function isEnhancedOutput(messageId: string): boolean {
    return messageId.startsWith("video-enhancement-") || enhancedMessageIds.current.has(messageId);
  }

  function downloadVideo(messageId: string): void {
    const href =
      playlists.get(messageId)?.[0]?.src ??
      (outputs.current.get(messageId) ? resolveMp4Url(outputs.current.get(messageId) as string) : undefined);
    if (!href || typeof document === "undefined") return;
    const a = document.createElement("a");
    a.href = href;
    a.download = isEnhancedOutput(messageId)
      ? `nexus-video-enhanced-${messageId}.mp4`
      : `nexus-video-original-${messageId}.mp4`;
    a.click();
  }

  async function copyWorkflow(messageId: string): Promise<void> {
    const mp4Path = outputs.current.get(messageId);
    if (!mp4Path) return;
    try {
      const workflow = workflowByMessage[messageId] ?? (await client.extractWorkflow(mp4Path));
      if (!workflow) return;
      const adapter = clipboard ?? (typeof navigator !== "undefined" ? navigator.clipboard : null);
      if (adapter && typeof adapter.writeText === "function") {
        await adapter.writeText(JSON.stringify(workflow, null, 2));
      }
    } catch {
      // best-effort; a failed copy is non-fatal.
    }
  }

  function recall(messageId: string, mode: RecallMode): void {
    const wf = workflowByMessage[messageId];
    if (!wf) return;
    const patched = applyImageRecall(
      {
        prompt: values.prompt,
        negativePrompt: values.negativePrompt,
        modelId: values.modelId,
        width: values.width,
        height: values.height,
        steps: values.steps,
        cfgScale: values.cfgScale,
        sampler: values.sampler,
        seed: values.seed,
      },
      wf,
      mode,
    );
    setValues((prev) => ({
      ...prev,
      prompt: patched.prompt,
      negativePrompt: patched.negativePrompt,
      modelId: patched.modelId,
      steps: patched.steps,
      cfgScale: patched.cfgScale,
      sampler: patched.sampler,
      seed: patched.seed,
    }));
    setFormEpoch((n) => n + 1);
  }

  const pickerModel = useMemo(
    () => models.find((candidate) => candidate.id === selectedModelId),
    [models, selectedModelId],
  );
  const contextUsage = useMemo(
    () => composerSessionUsage(messages, pickerModel),
    [messages, pickerModel],
  );

  return (
    <section
      data-testid="video-lab-page"
      style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, color: "var(--fg-0)" }}
    >
      {/* v2.2.9 Phase 3.1 (T007): the header only exists when it has a visible
          child. When models are installed it would be an empty padded bar
          (screenshot 6), so it is not rendered at all. The none-installed CTA
          keeps the header alive so "get more models" stays reachable. */}
      {noneInstalled && !backendDown && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-3) var(--space-4)",
            borderBottom: "1px solid var(--border-1)",
          }}
        >
          <button
            type="button"
            data-testid="video-get-more-models"
            onClick={() => onGetMoreModels?.()}
            style={{ background: "transparent", color: "var(--accent-video)", border: "none", cursor: "pointer" }}
          >
            No video models installed - get more models
          </button>
        </header>
      )}
      <a data-testid="video-settings-link" href={SETTINGS_MODELS_PATH} style={{ display: "none" }}>
        models settings
      </a>
      {residency.pending && (
        <ModelSwitchDialog
          pending={residency.pending}
          onResolve={(resolution) => {
            const resolved = residency.resolvePending(resolution);
            if (resolved && resolved.kind !== "confirm") {
              // The user agreed: re-enter the submit path with consent applied.
              const resumed = pendingPromptRef.current;
              pendingPromptRef.current = { text: "", attachments: [] };
              void handleSubmit(resumed.text, resumed.attachments, true);
            }
          }}
          onExpire={() => residency.dismissPending()}
        />
      )}
      <ModelSwitchChip switching={residency.switching} />
      {backendDown && (
        <SidecarDownBanner
          status={sidecar.status}
          restarting={sidecar.restarting}
          restartError={sidecar.restartError}
          onRestart={() => void sidecar.restart()}
          context="Video models cannot be listed."
          testId="video-sidecar-down"
        />
      )}

      <StudioHistoryPane
        pillar="video"
        client={studioClient}
        defaultModelId={selectedModelId}
        sidecarDown={backendDown}
        refreshToken={historyEpoch}
        onSelectSession={hydrateSession}
        activeSessionId={activeSessionId}
        onBeforeSessionDisposition={async (id) => {
          if (activeSessionId !== id || !activeJob) return;
          await queueClient.cancel(activeJob.jobId);
        }}
        onSessionDisposition={(id) => {
          if (activeSessionId !== id) return;
          setActiveJob(null);
          setActiveSession(null);
          setMessages([]);
          setSeededAttachment(null);
          lastOutputRef.current = null;
          pendingPromptRef.current = { text: "", attachments: [] };
        }}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        data-testid="video-history"
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
      >
        {messages.length === 0 ? (
          <p data-testid="video-empty" style={{ color: "var(--fg-muted)" }}>
            Describe a video to generate it, or drop an image and ask to animate it.
            {canAvatar
              ? " On this diffusion-pro host, attach a photo and an audio track for a local talking-head."
              : ""}
          </p>
        ) : (
          <MessageList
            messages={messages}
            enableTools={false}
            onMediaError={handleMediaError}
            renderAfter={(m) => {
              const enhancementSource = enhancementSources.get(m.id);
              const panelOpen = openEnhancementPanels.has(m.id);
              return (
                <>
                  {m.role === "assistant" && (m.media || (playlists.get(m.id)?.length ?? 0) > 0) ? (
                    <TimelinePreviewer
                      src={playlists.get(m.id)?.[0]?.src ?? m.media?.src ?? null}
                      fps={frameRatesByMessage.current.get(m.id) ?? values.fps}
                      segments={playlists.get(m.id)}
                      testId={`video-timeline-${m.id}`}
                      comments={frameComments}
                      onAddComment={(c) => setFrameComments((prev) => [...prev, c])}
                    />
                  ) : null}
                  {m.role === "assistant" && m.media ? (
                    <div
                      data-testid={`video-actions-${m.id}`}
                      style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-1)", flexWrap: "wrap" }}
                    >
                      <button
                        type="button"
                        className="nx-icon-btn"
                        aria-label={
                          isEnhancedOutput(m.id)
                            ? `Download enhanced video ${m.id}`
                            : `Download original video ${m.id}`
                        }
                        title={
                          isEnhancedOutput(m.id)
                            ? "Download enhanced video"
                            : "Download original video"
                        }
                        data-testid={`video-download-${m.id}`}
                        onClick={() => downloadVideo(m.id)}
                      >
                        <Download size={16} aria-hidden="true" />
                      </button>
                      {enhancementSource ? (
                        <button
                          ref={(element) => {
                            if (element) enhancementButtonRefs.current.set(m.id, element);
                            else enhancementButtonRefs.current.delete(m.id);
                          }}
                          type="button"
                          className="nx-control"
                          aria-label={`Enhance video ${m.id}`}
                          aria-expanded={panelOpen}
                          title="Create a separate enhanced copy. The original is preserved."
                          data-testid={`video-enhance-${m.id}`}
                          onClick={() => {
                            setOpenEnhancementPanels((prev) => {
                              const next = new Set(prev);
                              if (next.has(m.id)) next.delete(m.id);
                              else next.add(m.id);
                              return next;
                            });
                          }}
                        >
                          Enhance
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {enhancementSource && panelOpen ? (
                    <VideoEnhancementPanel
                      parentJobId={enhancementSource.parentJobId}
                      sourceOutputId={enhancementSource.sourceOutputId}
                      sourceWidth={enhancementSource.width}
                      sourceHeight={enhancementSource.height}
                      sourceFrameRate={enhancementSource.frameRate}
                      client={enhancementClient}
                      pollIntervalMs={enhancementPollIntervalMs}
                      onClose={() => closeEnhancementPanel(m.id)}
                      onComplete={handleEnhancementComplete}
                    />
                  ) : null}
                </>
              );
            }}
            renderPreviewExtra={(m) =>
              m.role === "assistant" && m.media ? (
                <>
                  <button
                    type="button"
                    className="nx-icon-btn"
                    aria-label={
                      isEnhancedOutput(m.id)
                        ? "Copy workflow and provenance"
                        : "Copy Workflow"
                    }
                    title={
                      isEnhancedOutput(m.id)
                        ? "Copy workflow and provenance"
                        : "Copy Workflow"
                    }
                    data-testid={`video-copyworkflow-${m.id}`}
                    onClick={() => void copyWorkflow(m.id)}
                  >
                    <FileJson size={16} aria-hidden="true" />
                  </button>
                  <RecallActions
                    messageId={m.id}
                    testIdPrefix="video"
                    hasWorkflow={Boolean(workflowByMessage[m.id])}
                    onRecall={(mode) => recall(m.id, mode)}
                  />
                  <button
                    type="button"
                    className="nx-icon-btn"
                    aria-label="Use as Source"
                    title="Use as Source"
                    data-testid={`video-useframe-${m.id}`}
                    onClick={() => setSeededAttachment(m.media?.src ?? null)}
                  >
                    <ImagePlus size={16} aria-hidden="true" />
                  </button>
                </>
              ) : null
            }
            onRepairMediaRuntime={(message) => void repairMediaRuntime(message)}
            onCancelMediaRepair={(message) => void cancelMediaRepair(message)}
            onOpenMediaRepairLog={() => void mediaRuntimeClient.openLogLocation()}
          />
        )}
      </div>

      <div style={{ padding: "var(--space-3) var(--space-4)", borderTop: "1px solid var(--border-1)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <div>
          <Button
            type="button"
            variant="ghost"
            testId="video-advanced-settings"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            Advanced settings
          </Button>
          {advancedOpen ? (
          <div style={{ marginTop: "var(--space-2)" }}>
            <VideoPromptForm
              key={formEpoch}
              initial={values}
              availableModels={models.map((m) => ({
                id: m.id,
                displayName: m.displayName,
                mode: "text2video" as const,
              }))}
              onChange={setValues}
              disabled={isGenerating}
              hideMode
              avatarAvailable={canAvatar}
              diffusionTier={diffusionTier}
            />
            <GenerationQueueBar
              jobs={queueJobs}
              onCancel={(id) => {
                void queueClient.cancel(id).then(() => queueClient.list().then(setQueueJobs));
              }}
              onReorder={(ids) => {
                void queueClient.reorder(ids).then(() => queueClient.list().then(setQueueJobs));
              }}
            />
          </div>
          ) : null}
        </div>
        <MediaComposer
          disabled={isGenerating}
          placeholder={
            canAvatar
              ? "Describe the video, drop an image to animate, or add a photo plus audio for a talking-head..."
              : "Describe the video you want, or drop an image to animate..."
          }
          onSubmit={(text, attachments) => void handleSubmit(text, attachments)}
          submitAccentVar="--accent-video"
          submitLabel="Generate"
          seededAttachment={seededAttachment}
          streaming={isGenerating}
          accept={
            canAvatar
              ? chatComposerAccept({ allowImages: true, allowAudio: true })
              : "image/*"
          }
          audioEnabled={canAvatar}
          audioHint="Photo plus audio stay on this device."
        />
        <ComposerContextRow usage={contextUsage} onStartNewSession={() => void startFreshStudioSession()}>
          <QuickModelSwitcher
            testId="video-model-select"
            models={models}
            taskType="video"
            value={selectedModelId}
            onChange={setSelectedModelId}
            onGetMoreModels={onGetMoreModels}
            disabled={isGenerating}
          />
        </ComposerContextRow>
      </div>
      </div>
    </section>
  );
}
