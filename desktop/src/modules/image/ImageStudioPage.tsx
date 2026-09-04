/**
 * v1.15.0 Phase 5 (Issue 5) -- Image Studio, redesigned as a chat.
 *
 * Replaces the four mode tabs + parameter sidebar with a conversational surface
 * that mirrors the Local Chatbot: a model selector at the top (installed image
 * models only, plus "Get more models"), a message history, and an
 * attachment-capable composer at the bottom. The user drops / pastes / uploads
 * image(s) (or none) and types a request; `inferImageIntent` maps that to
 * txt2img / img2img / inpaint / outpaint and the matching diffusion call. Every
 * technical parameter lives behind a collapsed "Advanced settings" panel with
 * smart per-GPU-tier defaults.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, FileJson, ImagePlus } from "lucide-react";
import { SidecarDownBanner } from "../../components/SidecarDownBanner";
import { Button } from "../../components/ui";
import { formatInferenceError } from "../../lib/inferenceRpcError";
import {
  isBackendDownMessage,
  isSidecarFailureMessage,
  useSidecarStatus,
} from "../../lib/sidecarStatus";
import { useModelResidency } from "../../shared/models/useModelResidency";
import {
  busyContextFromScheduler,
  modelVramEstimate,
  residentModelsFromScheduler,
  type ResidencySessionMemory,
  type SchedulerActiveJob,
} from "../../shared/models/schedulerResidency";
import {
  ModelSwitchChip,
  ModelSwitchDialog,
} from "../../shared/models/ModelSwitchDialog";

import {
  ComposerContextRow,
  MediaComposer,
  MessageList,
  composerSessionUsage,
  useStickToBottom,
  withLiveTimestamp,
  type ChatMessage,
} from "../../shared/chat";
import { isUsableImageBase64 } from "../../shared/studio/usablePayload";
import { QuickModelSwitcher } from "../../shared/models/QuickModelSwitcher";
import {
  SETTINGS_MODELS_PATH,
  installedModelsForType,
} from "../../shared/models/installedFeed";
import {
  ownedIdSet,
  recommendOrderForTask,
  resolveDefaultId,
  writeFavorite,
  type SelectionSnapshot,
} from "../../shared/models/selectionPolicy";
import { createIpcModelsClient } from "../../pages/settings/ipcModelsClient";
import type {
  ListedModelDto,
  InstallProgressDto,
} from "../../pages/settings/modelsTypes";
import type { InstallHandle } from "../../pages/settings/ModelsSettings";
import type { DiffusionTierId } from "../../../../core/config/DiffusionTier";
import {
  DEFAULT_FORM_VALUES,
  ImagePromptForm,
  type PromptFormValues,
  valuesToBaseRequest,
} from "./ImagePromptForm";
import { inferImageIntent } from "./intent";
import { MaskEditor } from "./MaskEditor";
import {
  parseReplaceIntent,
  inpaintPromptFor,
  restylePromptFor,
  usesSegment,
} from "../../../../core/image/replaceIntent";
import {
  FOLLOWUP_IMG2IMG_STRENGTH,
  MISSING_RESTYLE_SOURCE_TEXT,
  planRestyleRequest,
  SAM2_MODEL_ID,
  pngToDataUrl,
  resolveFollowUpSourceImage,
  stripToRawImageBytes,
} from "./followUpSource";
import {
  type DiffusionClient,
  type ProgressEvent,
  createIpcDiffusionClient,
} from "./diffusionClient";
import {
  RecallActions,
  applyImageRecall,
  type RecallMode,
} from "../../shared/studio/RecallActions";
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
  shouldTitleOnFirstSend,
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
  id: DEFAULT_FORM_VALUES.modelId,
  displayName: "SANA 1.5 1.6B 1024px",
  type: "image",
  installed: true,
  source: "registry",
};

const DEFAULT_LORAS = [
  { id: "lora:detail-tweaker", displayName: "Detail Tweaker" },
  { id: "lora:cinematic", displayName: "Cinematic" },
];
const DEFAULT_CONTROLNETS = [
  { id: "controlnet:sdxl-canny", displayName: "SDXL Canny" },
  { id: "controlnet:sdxl-pose", displayName: "SDXL OpenPose" },
];

export interface ImageStudioPageProps {
  readonly client?: DiffusionClient;
  /** Models client for the installed image-model selector. */
  readonly modelsClient?: {
    list(): Promise<readonly ListedModelDto[]>;
    lastSelection?: SelectionSnapshot | null;
    install?(
      id: string,
      onProgress: (p: InstallProgressDto) => void,
    ): InstallHandle & { done: Promise<void> };
  };
  /** Test seam: drain interval (ms). Defaults to 100ms. */
  readonly drainIntervalMs?: number;
  /** Test seam: clipboard adapter. Defaults to navigator.clipboard. */
  readonly clipboard?: { writeText: (value: string) => Promise<void> };
  /** v2.1.0 Phase 3 -- generation queue. Tests inject an in-memory client. */
  readonly queueClient?: GenerationQueueClient;
  /** Invoked by the selector's "Get more models" entry (App wires navigation). */
  readonly onGetMoreModels?: () => void;
  /** Resolved DiffusionTier so the Advanced panel can gate 2K/4K. */
  readonly diffusionTier?: DiffusionTierId;
  /**
   * v2.2.0 Phase 4 (4.3): free VRAM in GB for the switch policy. `undefined`
   * (the default) means telemetry is unreadable, which the policy treats as
   * "ask the user" rather than guessing a fit. App wiring supplies the live
   * value from the telemetry stream.
   */
  readonly hostVramFreeGB?: number | null;
  /** Host VRAM total so the picker uses installer recommend order. */
  readonly hostVramGB?: number | null;
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

let messageSeq = 0;
function nextId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}-${messageSeq}`;
}

function imageRecoveryState(
  state: MediaRuntimeState,
): ChatMessage["mediaRecovery"] {
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

export function ImageStudioPage({
  client: clientOverride,
  modelsClient,
  drainIntervalMs = 100,
  clipboard,
  onGetMoreModels,
  diffusionTier = "diffusion-low",
  hostVramFreeGB,
  hostVramGB = null,
  activeSchedulerJob,
  residencyMemory,
  queueClient: queueOverride,
  explorerClient: explorerClientOverride,
  initialSessionId,
  outputExists,
  mediaRuntimeClient: mediaRuntimeOverride,
}: ImageStudioPageProps = {}): JSX.Element {
  const [client] = useState<DiffusionClient>(
    () => clientOverride ?? createIpcDiffusionClient(),
  );
  const [queueClient] = useState<GenerationQueueClient>(
    () => queueOverride ?? createIpcGenerationQueueClient(),
  );
  const [mediaRuntimeClient] = useState<MediaRuntimeClient>(
    () => mediaRuntimeOverride ?? createIpcMediaRuntimeClient(),
  );
  const [models, setModels] = useState<readonly ListedModelDto[]>([
    FALLBACK_MODEL,
  ]);
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  const userChangedModelRef = useRef(false);
  const [noneInstalled, setNoneInstalled] = useState(false);
  // v2.2.0 Phase 2 (2.2): distinguish "the backend is down" from "you have no
  // image models". The pre-v2.2.0 catch-all reported the latter for both.
  const [listFailure, setListFailure] = useState<string | null>(null);
  const sidecar = useSidecarStatus();
  // v2.2.0 Phase 4 (4.3): single-GPU switch policy. Classification happens
  // on SUBMIT only -- mounting this route must never change residency.
  const residency = useModelResidency({ rememberedPairs: residencyMemory });
  // Holds the prompt whose submit opened the confirm dialog, so answering
  // "Switch now" resumes the SAME request instead of losing it.
  const pendingPromptRef = useRef<{
    text: string;
    attachments: readonly string[];
  }>({
    text: "",
    attachments: [],
  });
  const mediaRetryRef = useRef<{
    assistantId: string;
    text: string;
    attachments: readonly string[];
  } | null>(null);
  const backendDown = sidecar.isDown || isBackendDownMessage(listFailure);
  const studioClient = useMemo(() => {
    if (explorerClientOverride) return explorerClientOverride;
    if (backendDown || !tauriAvailable())
      return new InMemoryStudioExplorerClient("image");
    return createIpcStudioExplorerClient("image");
  }, [explorerClientOverride, backendDown]);
  const [selectedModelId, setSelectedModelId] = useState<string>(
    FALLBACK_MODEL.id,
  );
  const [values, setValues] = useState<PromptFormValues>(DEFAULT_FORM_VALUES);
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
  const lastPngB64Ref = useRef<string | null>(null);
  const modelsSourceRef =
    useRef<ImageStudioPageProps["modelsClient"]>(modelsClient);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [activeJob, setActiveJob] = useState<{
    jobId: string;
    messageId: string;
  } | null>(null);
  const [seededAttachment, setSeededAttachment] = useState<string | null>(null);
  const [formEpoch, setFormEpoch] = useState(0);
  const [queueJobs, setQueueJobs] = useState<readonly GenerationJob[]>([]);
  const [workflowByMessage, setWorkflowByMessage] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [paintedMask, setPaintedMask] = useState<string | null>(null);
  const [pendingReplace, setPendingReplace] = useState<{
    assistantId: string;
    sourceImage: string;
    base: Parameters<DiffusionClient["txt2img"]>[0];
    candidates: readonly { label: string; maskPngBase64: string }[];
  } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const outputs = useRef<Map<string, string>>(new Map()); // messageId -> raw png

  useEffect(() => {
    if (pendingReplace) setAdvancedOpen(true);
  }, [pendingReplace]);

  const isGenerating = activeJob !== null;

  // Load the installed image models for the selector (Phase 4 feed). Falls back
  // to a single default model when the sidecar is unavailable (dev/tests) so
  // generation still works and the selector always has a valid value.
  useEffect(() => {
    let cancelled = false;
    const source = modelsClient ?? createIpcModelsClient();
    modelsSourceRef.current = source;
    void (async () => {
      try {
        const all = await source.list();
        const snap = source.lastSelection ?? null;
        const image = installedModelsForType(
          all,
          "image",
          ownedIdSet(snap),
        ).filter((m) => !m.tags?.includes("utility"));
        if (cancelled) return;
        setSelection(snap);
        const first = image[0];
        if (first) {
          setModels(image);
          const next = resolveDefaultId(image, {
            recommended: snap?.recommendedByTask.image ?? null,
          });
          if (!userChangedModelRef.current)
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
          // Sidecar-down is unknown, not empty. Never show a fake installed SANA.
          if (backendFailed) {
            setModels([]);
            setNoneInstalled(false);
            setListFailure(message);
          } else {
            // ipc-unavailable (Vite / Vitest): keep a local fallback so the
            // composer still has a model id, without claiming none-installed.
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

  const patchMessage = useCallback(
    (id: string, patch: Partial<ChatMessage>): void => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      );
    },
    [],
  );

  const persistTurn = useCallback(
    (input: {
      role: "user" | "assistant";
      content: string;
      mediaRef?: string | null;
    }): void => {
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
        ).then(
          () => setHistoryEpoch((n) => n + 1),
          () => undefined,
        );
      } catch {
        // Do not claim saved.
      }
    },
    [backendDown, studioClient],
  );

  const ensureSession = useCallback(
    async (prompt: string): Promise<string | null> => {
      if (backendDown) return null;
      const scheduleTitle = (
        sessionId: string,
        title: string,
        turnCount: number,
      ): void => {
        if (!shouldTitleOnFirstSend({ title, turnCount, prompt })) return;
        titleJobRef.current = { id: sessionId, prompt };
        void applyImmediateFallbackTitle({
          sessionId,
          prompt,
          currentTitle: title,
          rename: (id, nextTitle) => studioClient.renameSession(id, nextTitle),
        }).then(
          () => setHistoryEpoch((n) => n + 1),
          () => undefined,
        );
      };
      if (activeSessionIdRef.current) {
        const existingId = activeSessionIdRef.current;
        try {
          const session = await Promise.resolve(
            studioClient.getSession(existingId),
          );
          scheduleTitle(
            existingId,
            session?.title ?? DEFAULT_SESSION_TITLE,
            session?.turnCount ?? 0,
          );
        } catch {
          scheduleTitle(existingId, DEFAULT_SESSION_TITLE, 0);
        }
        return existingId;
      }
      try {
        const session = await Promise.resolve(
          studioClient.createSession({
            folderId: null,
            title: DEFAULT_SESSION_TITLE,
            modelId: selectedModelId,
          }),
        );
        setActiveSession(session.id);
        scheduleTitle(session.id, DEFAULT_SESSION_TITLE, 0);
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
      const apply = (
        turns: readonly StudioTurn[],
        lastRef: string | null,
      ): void => {
        setActiveSession(sessionId);
        lastOutputRef.current = lastRef;
        lastPngB64Ref.current = lastRef?.toLowerCase().startsWith("data:")
          ? lastRef
          : null;
        setMessages(studioTurnsToChatMessages(turns, { outputExists }));
      };
      const turnsMaybe = studioClient.listTurns?.(sessionId) ?? [];
      const sessionMaybe = studioClient.getSession(sessionId);
      const isThenable = (value: unknown): value is Promise<unknown> =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as { then?: unknown }).then === "function";
      if (!isThenable(turnsMaybe) && !isThenable(sessionMaybe)) {
        const turns = turnsMaybe as readonly StudioTurn[];
        apply(
          turns,
          (sessionMaybe as { lastOutputRef?: string | null } | null)
            ?.lastOutputRef ?? lastAssistantMediaRef(turns),
        );
        return;
      }
      void Promise.all([
        Promise.resolve(turnsMaybe),
        Promise.resolve(sessionMaybe),
      ]).then(([turns, session]) => {
        const list = (turns ?? []) as readonly StudioTurn[];
        apply(
          list,
          (session as { lastOutputRef?: string | null } | null)
            ?.lastOutputRef ?? lastAssistantMediaRef(list),
        );
      });
    },
    [studioClient, outputExists, setActiveSession],
  );

  const startFreshStudioSession = useCallback(async (): Promise<void> => {
    setMessages([]);
    lastOutputRef.current = null;
    lastPngB64Ref.current = null;
    setActiveSession(null);
    if (backendDown) return;
    try {
      const session = await Promise.resolve(
        studioClient.createSession({
          folderId: null,
          title: DEFAULT_SESSION_TITLE,
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

  const advanceFromEvents = useCallback(
    (
      events: readonly ProgressEvent[],
      messageId: string,
    ): { done: boolean } => {
      let done = false;
      for (const event of events) {
        if (event.kind === "progress") {
          const step = event.step ?? 0;
          const total = event.totalSteps ?? 0;
          patchMessage(messageId, { progress: { step, total } });
        } else if (event.kind === "complete") {
          done = true;
          const png = event.png ?? "";
          if (!isUsableImageBase64(png)) {
            outputs.current.delete(messageId);
            setWorkflowByMessage((prev) => {
              const next = { ...prev };
              delete next[messageId];
              return next;
            });
            patchMessage(messageId, {
              pending: false,
              progress: undefined,
              media: undefined,
              content:
                "Generation failed: image generation completed without image bytes.",
            });
            persistTurn({
              role: "assistant",
              content:
                "Generation failed: image generation completed without image bytes.",
            });
            continue;
          }
          outputs.current.set(messageId, png);
          lastPngB64Ref.current = png;
          patchMessage(messageId, {
            pending: false,
            progress: undefined,
            media: { kind: "image", src: `data:image/png;base64,${png}` },
          });
          const pathRef = event.outputPath?.trim() ?? "";
          if (isUsablePathRef(pathRef)) {
            lastOutputRef.current = pathRef;
            persistTurn({ role: "assistant", content: "", mediaRef: pathRef });
          } else {
            lastOutputRef.current = `data:image/png;base64,${png}`;
            persistTurn({ role: "assistant", content: "" });
          }
          void client.extractWorkflow(png).then((wf) => {
            if (wf && typeof wf === "object") {
              setWorkflowByMessage((prev) => ({
                ...prev,
                [messageId]: wf as Record<string, unknown>,
              }));
            }
          });
          if (mediaRetryRef.current?.assistantId === messageId) {
            mediaRetryRef.current = null;
          }
        } else if (event.kind === "error") {
          done = true;
          outputs.current.delete(messageId);
          const runtimeMessage = event.message ?? "unknown error";
          if (isMediaRuntimeFailure(runtimeMessage)) {
            void mediaRuntimeClient.status().then((state) => {
              patchMessage(messageId, {
                pending: false,
                progress: undefined,
                media: undefined,
                content: "",
                mediaRecovery: imageRecoveryState(state),
              });
            });
            continue;
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
        }
      }
      return { done };
    },
    [patchMessage, client, persistTurn, mediaRuntimeClient],
  );

  const handleMediaError = useCallback(
    (message: ChatMessage): void => {
      outputs.current.delete(message.id);
      setWorkflowByMessage((prev) => {
        const next = { ...prev };
        delete next[message.id];
        return next;
      });
      patchMessage(message.id, {
        media: undefined,
        content: "Generation failed: generated image could not be displayed.",
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
          const { done } = advanceFromEvents(events, activeJob.messageId);
          if (done) {
            cancelled = true;
            clearInterval(timer);
            setActiveJob(null);
          }
        } catch (err) {
          cancelled = true;
          clearInterval(timer);
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
    const timer = setInterval(
      () => {
        void queueClient
          .list()
          .then((jobs) => {
            if (!cancelled) setQueueJobs(jobs);
          })
          .catch(() => undefined);
      },
      Math.max(drainIntervalMs, 200),
    );
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
          mediaRecovery: imageRecoveryState(state),
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
      // v2.2.0 Phase 4: ask the policy before doing GPU work. A `confirm`
      // verdict opens the dialog and returns; the user's answer re-enters
      // this path. Everything else proceeds immediately.
      if (!residencyApproved) {
        const selected = models.find((m) => m.id === selectedModelId);
        const verdict = residency.request({
          targetModelId: selectedModelId,
          targetVramGB: modelVramEstimate(selected?.vramGB),
          requestingModule: "image",
          resident: residentModelsFromScheduler(activeSchedulerJob),
          freeVramGB: hostVramFreeGB ?? null,
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
              id: nextId("assistant"),
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
      const implicitSource = resolveFollowUpSourceImage({
        lastPngBase64: lastPngB64Ref.current,
        lastOutputRef: lastOutputRef.current,
      });
      const replace = parseReplaceIntent(text);
      const objectEdit = Boolean(replace && usesSegment(replace));
      const restyle = replace?.scope === "image";
      if (restyle && attachments.length === 0 && !implicitSource) {
        const userMsg: ChatMessage = {
          id: nextId("user"),
          role: "user",
          content: text,
        };
        const assistantMsg: ChatMessage = {
          id: nextId("assistant"),
          role: "assistant",
          content: MISSING_RESTYLE_SOURCE_TEXT,
        };
        setMessages((prev) => [
          ...prev,
          withLiveTimestamp(userMsg),
          withLiveTimestamp(assistantMsg),
        ]);
        await ensureSession(text);
        persistTurn({ role: "user", content: text });
        persistTurn({
          role: "assistant",
          content: MISSING_RESTYLE_SOURCE_TEXT,
        });
        return;
      }
      if (
        attachments.length === 0 &&
        lastOutputRef.current &&
        !lastPngB64Ref.current &&
        !implicitSource?.toLowerCase().startsWith("data:") &&
        !isUsablePathRef(lastOutputRef.current, outputExists)
      ) {
        const userMsg: ChatMessage = {
          id: nextId("user"),
          role: "user",
          content: text,
        };
        const assistantMsg: ChatMessage = {
          id: nextId("assistant"),
          role: "assistant",
          content: UNREADABLE_OUTPUT_TEXT,
        };
        setMessages((prev) => [
          ...prev,
          withLiveTimestamp(userMsg),
          withLiveTimestamp(assistantMsg),
        ]);
        await ensureSession(text);
        persistTurn({ role: "user", content: text });
        persistTurn({ role: "assistant", content: UNREADABLE_OUTPUT_TEXT });
        return;
      }
      const intent = inferImageIntent({
        text,
        attachments,
        mask: paintedMask,
        lastOutputRef: implicitSource,
      });
      const userMsg: ChatMessage = {
        id: nextId("user"),
        role: "user",
        content: text,
        ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
      };
      const assistantId = retryAssistantId ?? nextId("assistant");
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        pending: true,
        activity: "image-generation",
      };
      if (retryAssistantId) {
        patchMessage(assistantId, {
          pending: true,
          content: "",
          mediaRecovery: undefined,
          sam2Recovery: undefined,
          activity: "image-generation",
        });
      } else {
        setMessages((prev) => [
          ...prev,
          withLiveTimestamp(userMsg),
          withLiveTimestamp(assistantMsg),
        ]);
        await ensureSession(text);
        persistTurn({ role: "user", content: text });
      }
      mediaRetryRef.current = {
        assistantId,
        text,
        attachments: [...attachments],
      };

      const base = valuesToBaseRequest(values, {
        prompt:
          restyle && replace
            ? restylePromptFor(replace)
            : objectEdit && replace
              ? inpaintPromptFor(replace)
              : intent.prompt,
        modelId: selectedModelId,
      }) as unknown as Parameters<DiffusionClient["txt2img"]>[0];
      const segmentSource = attachments[0] ?? implicitSource;
      const followUpImg2img =
        Boolean(implicitSource) && attachments.length === 0;

      try {
        if (objectEdit && replace && segmentSource) {
          const sourceImage = stripToRawImageBytes(segmentSource);
          const seg = await client.segment({
            sourceImage,
            phrase: replace.object,
            hint: { text: replace.object },
          });
          if (!seg.ok || !seg.candidates || seg.candidates.length === 0) {
            const fallback =
              seg.message ??
              "Could not find a mask for that object. Paint a mask to continue, or install sam2:hiera-tiny.";
            const missing = seg.code === "weights_missing";
            patchMessage(assistantId, {
              pending: false,
              content: fallback,
              ...(missing
                ? {
                    sam2Recovery: {
                      modelId: SAM2_MODEL_ID,
                      message: fallback,
                    },
                  }
                : {}),
            });
            persistTurn({ role: "assistant", content: fallback });
            return;
          }
          if (seg.candidates.length > 1) {
            patchMessage(assistantId, {
              pending: false,
              content: `Several matches for "${replace.object}". Tap a candidate to inpaint it, or paint a mask.`,
            });
            setPendingReplace({
              assistantId,
              sourceImage,
              base,
              candidates: seg.candidates,
            });
            return;
          }
          const mask = seg.candidates[0]?.maskPngBase64 ?? "";
          const accepted = await client.inpaint({
            ...base,
            sourceImage,
            mask,
          });
          setActiveJob({ jobId: accepted.jobId, messageId: assistantId });
          return;
        }

        let accepted;
        // v2.4.4 Phase 3.1 (T010): a restyle is decided here and only here.
        // Previously it depended on `intent.mode`, which is inferred from the
        // presence of a source and knows nothing about restyle; any path that
        // produced "txt2img" silently reprinted the original prompt instead.
        const restylePlan =
          restyle && replace
            ? planRestyleRequest({
                restylePrompt: restylePromptFor(replace),
                sourceImage: attachments[0] ?? implicitSource,
              })
            : null;
        if (restyle && !restylePlan) {
          patchMessage(assistantId, {
            pending: false,
            content: MISSING_RESTYLE_SOURCE_TEXT,
          });
          persistTurn({
            role: "assistant",
            content: MISSING_RESTYLE_SOURCE_TEXT,
          });
          return;
        }
        if (restylePlan) {
          accepted = await client.img2img({
            ...base,
            prompt: restylePlan.prompt,
            sourceImage: restylePlan.sourceImage,
            strength: restylePlan.strength,
          });
        } else if (intent.mode === "txt2img") {
          accepted = await client.txt2img(base);
        } else if (intent.mode === "img2img") {
          accepted = await client.img2img({
            ...base,
            sourceImage: intent.sourceImage ?? implicitSource ?? "",
            ...(followUpImg2img ? { strength: FOLLOWUP_IMG2IMG_STRENGTH } : {}),
          });
        } else if (intent.mode === "inpaint") {
          accepted = await client.inpaint({
            ...base,
            sourceImage: intent.sourceImage ?? "",
            mask: intent.mask ?? "",
          });
        } else {
          accepted = await client.outpaint({
            ...base,
            sourceImage: intent.sourceImage ?? "",
            direction: intent.direction ?? "right",
            pixels: intent.pixels ?? 128,
          });
        }
        setActiveJob({ jobId: accepted.jobId, messageId: assistantId });
      } catch (err) {
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
            const reply = await ipc.call<{ title: string }>(
              "chat.generateTitle",
              {
                chatId: id,
                firstMessage: prompt,
              },
            );
            return reply.ok ? reply.value : null;
          },
        }).then(
          () => setHistoryEpoch((n) => n + 1),
          () => undefined,
        );
      }
    },
    [
      isGenerating,
      values,
      selectedModelId,
      client,
      patchMessage,
      paintedMask,
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
      patchMessage(message.id, { mediaRecovery: imageRecoveryState(state) });
      while (state.state === "repairing") {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        state = await mediaRuntimeClient.status();
        patchMessage(message.id, { mediaRecovery: imageRecoveryState(state) });
      }
      const pending = mediaRetryRef.current;
      if (state.state === "ready" && pending?.assistantId === message.id) {
        mediaRetryRef.current = null;
        await handleSubmit(
          pending.text,
          pending.attachments,
          true,
          pending.assistantId,
        );
      }
    },
    [handleSubmit, mediaRuntimeClient, patchMessage],
  );

  const cancelMediaRepair = useCallback(
    async (message: ChatMessage): Promise<void> => {
      const state = await mediaRuntimeClient.cancelRepair();
      mediaRetryRef.current = null;
      patchMessage(message.id, { mediaRecovery: imageRecoveryState(state) });
    },
    [mediaRuntimeClient, patchMessage],
  );

  const installSam2 = useCallback(
    async (message: ChatMessage): Promise<void> => {
      const source = modelsSourceRef.current;
      const recovery = message.sam2Recovery;
      if (!source?.install || backendDown || !recovery) return;
      patchMessage(message.id, {
        sam2Recovery: { ...recovery, installing: true, installed: false },
      });
      try {
        await source.install(SAM2_MODEL_ID, () => undefined).done;
        patchMessage(message.id, {
          sam2Recovery: { ...recovery, installing: false, installed: true },
        });
      } catch (err) {
        patchMessage(message.id, {
          sam2Recovery: {
            ...recovery,
            installing: false,
            message: `Install failed: ${formatInferenceError(err)}`,
          },
        });
      }
    },
    [backendDown, patchMessage],
  );

  const paintSam2Mask = useCallback((message: ChatMessage): void => {
    const parked = mediaRetryRef.current;
    const src = resolveFollowUpSourceImage({
      attachment: parked?.attachments[0] ?? message.attachments?.[0],
      lastPngBase64: lastPngB64Ref.current,
      lastOutputRef: lastOutputRef.current,
    });
    if (src) {
      setSeededAttachment(
        src.toLowerCase().startsWith("data:") ? src : pngToDataUrl(src),
      );
    }
    setAdvancedOpen(true);
  }, []);

  const retrySam2 = useCallback(
    async (message: ChatMessage): Promise<void> => {
      const parked = mediaRetryRef.current;
      if (!parked || parked.assistantId !== message.id) return;
      await handleSubmit(
        parked.text,
        parked.attachments,
        true,
        parked.assistantId,
      );
    },
    [handleSubmit],
  );

  const pickCandidate = useCallback(
    async (maskPngBase64: string): Promise<void> => {
      if (!pendingReplace) return;
      const accepted = await client.inpaint({
        ...pendingReplace.base,
        sourceImage: pendingReplace.sourceImage,
        mask: maskPngBase64,
      });
      patchMessage(pendingReplace.assistantId, { pending: true, content: "" });
      setActiveJob({
        jobId: accepted.jobId,
        messageId: pendingReplace.assistantId,
      });
      setPendingReplace(null);
    },
    [client, pendingReplace, patchMessage],
  );

  async function copyWorkflow(messageId: string): Promise<void> {
    const png = outputs.current.get(messageId);
    if (!png) return;
    try {
      const workflow = await client.extractWorkflow(png);
      if (!workflow) return;
      const adapter =
        clipboard ??
        (typeof navigator !== "undefined" ? navigator.clipboard : null);
      if (adapter && typeof adapter.writeText === "function") {
        await adapter.writeText(JSON.stringify(workflow, null, 2));
      }
    } catch {
      // best-effort; failures are non-fatal for the copy action.
    }
  }

  async function copyImage(messageId: string): Promise<void> {
    const png = outputs.current.get(messageId);
    if (!png) return;
    const src = `data:image/png;base64,${png}`;
    const adapter =
      clipboard ??
      (typeof navigator !== "undefined" ? navigator.clipboard : null);
    try {
      if (adapter && typeof adapter.writeText === "function") {
        await adapter.writeText(src);
      }
    } catch {
      // best-effort
    }
  }

  function downloadImage(messageId: string): void {
    const png = outputs.current.get(messageId);
    if (!png || typeof document === "undefined") return;
    const a = document.createElement("a");
    a.href = `data:image/png;base64,${png}`;
    a.download = `nexus-image-${messageId}.png`;
    a.click();
  }

  function useAsSource(messageId: string): void {
    const png = outputs.current.get(messageId);
    if (png) setSeededAttachment(`data:image/png;base64,${png}`);
  }

  function recall(messageId: string, mode: RecallMode): void {
    const wf = workflowByMessage[messageId];
    if (!wf) return;
    setValues((prev) => ({ ...prev, ...applyImageRecall(prev, wf, mode) }));
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
      data-testid="image-studio-page"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        color: "var(--fg-0)",
      }}
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
            data-testid="image-get-more-models"
            onClick={() => onGetMoreModels?.()}
            style={{
              background: "transparent",
              color: "var(--accent-image)",
              border: "none",
              cursor: "pointer",
            }}
          >
            No image models installed - get more models
          </button>
        </header>
      )}
      <a
        data-testid="image-settings-link"
        href={SETTINGS_MODELS_PATH}
        style={{ display: "none" }}
      >
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
          context="Image models cannot be listed."
          testId="image-sidecar-down"
        />
      )}

      <StudioHistoryPane
        pillar="image"
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
          lastPngB64Ref.current = null;
          pendingPromptRef.current = { text: "", attachments: [] };
          setFormEpoch((value) => value + 1);
        }}
      />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          data-testid="image-history"
          ref={scrollRef}
          onScroll={onScroll}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          {messages.length === 0 ? (
            <p data-testid="image-empty" style={{ color: "var(--fg-muted)" }}>
              Describe an image to generate it, or drop an image and ask to
              edit, extend, or vary it.
            </p>
          ) : (
            <MessageList
              messages={messages}
              enableTools={false}
              onMediaError={handleMediaError}
              renderAfter={(m) =>
                m.role === "assistant" && m.media ? (
                  <div
                    data-testid={`image-actions-${m.id}`}
                    style={{
                      display: "flex",
                      gap: "var(--space-2)",
                      marginTop: "var(--space-1)",
                    }}
                  >
                    <button
                      type="button"
                      className="nx-icon-btn"
                      aria-label="Download"
                      title="Download"
                      data-testid={`image-download-${m.id}`}
                      onClick={() => downloadImage(m.id)}
                    >
                      <Download size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="nx-icon-btn"
                      aria-label="Copy image"
                      title="Copy image"
                      data-testid={`image-copyimage-${m.id}`}
                      onClick={() => void copyImage(m.id)}
                    >
                      <Copy size={16} aria-hidden="true" />
                    </button>
                  </div>
                ) : null
              }
              renderPreviewExtra={(m) =>
                m.role === "assistant" && m.media ? (
                  <>
                    <button
                      type="button"
                      className="nx-icon-btn"
                      aria-label="Copy Workflow"
                      title="Copy Workflow"
                      data-testid={`image-copyworkflow-${m.id}`}
                      onClick={() => void copyWorkflow(m.id)}
                    >
                      <FileJson size={16} aria-hidden="true" />
                    </button>
                    <RecallActions
                      messageId={m.id}
                      testIdPrefix="image"
                      hasWorkflow={Boolean(workflowByMessage[m.id])}
                      onRecall={(mode) => recall(m.id, mode)}
                    />
                    <button
                      type="button"
                      className="nx-icon-btn"
                      aria-label="Use as Source"
                      title="Use as Source"
                      data-testid={`image-usesource-${m.id}`}
                      onClick={() => useAsSource(m.id)}
                    >
                      <ImagePlus size={16} aria-hidden="true" />
                    </button>
                  </>
                ) : null
              }
              onRepairMediaRuntime={(message) =>
                void repairMediaRuntime(message)
              }
              onCancelMediaRepair={(message) => void cancelMediaRepair(message)}
              onOpenMediaRepairLog={() =>
                void mediaRuntimeClient.openLogLocation()
              }
              onInstallSam2={(message) => void installSam2(message)}
              onPaintSam2Mask={paintSam2Mask}
              onOpenSam2Settings={
                onGetMoreModels ? () => onGetMoreModels() : undefined
              }
              onRetrySam2={(message) => void retrySam2(message)}
              sam2InstallDisabled={backendDown}
            />
          )}
        </div>

        <div
          style={{
            padding: "var(--space-3) var(--space-4)",
            borderTop: "1px solid var(--border-1)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          <div>
            <Button
              type="button"
              variant="ghost"
              testId="image-advanced-settings"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              Advanced settings
            </Button>
            {advancedOpen ? (
              <div style={{ marginTop: "var(--space-2)" }}>
                <ImagePromptForm
                  key={formEpoch}
                  initial={values}
                  availableModels={models.map((m) => ({
                    id: m.id,
                    displayName: m.displayName,
                  }))}
                  availableLoras={DEFAULT_LORAS}
                  availableControlNets={DEFAULT_CONTROLNETS}
                  onChange={setValues}
                  disabled={isGenerating}
                  diffusionTier={diffusionTier}
                />
                {seededAttachment ? (
                  <div data-testid="image-mask-layer">
                    <p
                      style={{
                        color: "var(--fg-muted)",
                        fontSize: "var(--text-xs)",
                      }}
                    >
                      Paint a mask on the source image (Advanced). The next
                      Generate uses inpaint.
                    </p>
                    <MaskEditor
                      sourceImage={seededAttachment}
                      width={values.width}
                      height={values.height}
                      onMaskChange={setPaintedMask}
                    />
                  </div>
                ) : null}
                {pendingReplace ? (
                  <div
                    data-testid="image-sam-candidates"
                    style={{
                      display: "flex",
                      gap: "var(--space-2)",
                      flexWrap: "wrap",
                    }}
                  >
                    {pendingReplace.candidates.map((c) => (
                      <Button
                        key={c.label}
                        type="button"
                        variant="ghost"
                        testId={`image-sam-candidate-${c.label}`}
                        disabled={isGenerating}
                        onClick={() => void pickCandidate(c.maskPngBase64)}
                      >
                        {c.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <Button
                  type="button"
                  testId="image-seed-sweep"
                  disabled={isGenerating}
                  onClick={() => {
                    void queueClient
                      .enqueue({
                        pillar: "image",
                        jobType: "txt2img",
                        parameters: {
                          ...values,
                          prompt: values.prompt || "batch",
                        },
                        priority: "batch",
                        batchSpec: {
                          kind: "seed-range",
                          start: values.seed,
                          end: values.seed + 2,
                        },
                      })
                      .then((jobs) =>
                        setQueueJobs((prev) => [...prev, ...jobs]),
                      );
                  }}
                >
                  Queue seed sweep
                </Button>
                <GenerationQueueBar
                  jobs={queueJobs}
                  onCancel={(id) => {
                    void queueClient
                      .cancel(id)
                      .then(() => queueClient.list().then(setQueueJobs));
                  }}
                  onReorder={(ids) => {
                    void queueClient
                      .reorder(ids)
                      .then(() => queueClient.list().then(setQueueJobs));
                  }}
                />
              </div>
            ) : null}
          </div>
          <MediaComposer
            disabled={isGenerating}
            onSubmit={(text, attachments) =>
              void handleSubmit(text, attachments)
            }
            submitAccentVar="--accent-image"
            submitLabel="Generate"
            seededAttachment={seededAttachment}
            streaming={isGenerating}
          />
          <ComposerContextRow
            usage={contextUsage}
            onStartNewSession={() => void startFreshStudioSession()}
          >
            <QuickModelSwitcher
              testId="image-model-select"
              models={models}
              taskType="image"
              value={selectedModelId}
              hostVramGB={hostVramGB}
              recommendOrder={recommendOrderForTask(selection, "image")}
              ownedIds={ownedIdSet(selection)}
              onChange={(nextModelId) => {
                userChangedModelRef.current = true;
                setSelectedModelId(nextModelId);
                writeFavorite("image", nextModelId);
              }}
              onGetMoreModels={onGetMoreModels}
              disabled={isGenerating}
            />
          </ComposerContextRow>
        </div>
      </div>
    </section>
  );
}
