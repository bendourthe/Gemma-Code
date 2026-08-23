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
import { FileJson, ImagePlus } from "lucide-react";

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
import {
  isBackendDownMessage,
  isSidecarFailureMessage,
  useSidecarStatus,
} from "../../lib/sidecarStatus";

import { MediaComposer, MessageList, chatComposerAccept, type ChatMessage } from "../../shared/chat";
import { ModelSelector } from "../../shared/chat/ModelSelector";
import {
  SETTINGS_MODELS_PATH,
  GET_MORE_MODELS_ID,
  installedModelsForType,
} from "../../shared/models/installedFeed";
import { createIpcModelsClient } from "../../pages/settings/ipcModelsClient";
import type { ListedModelDto } from "../../pages/settings/modelsTypes";
import type { DiffusionTierId } from "../../../../core/config/DiffusionTier";
import { getDiffusionTierConfig } from "../../../../core/config/DiffusionTier";
import { planVideoContinuation, type ContinuationSegmentPlan } from "../../../../core/video/continuation";
import { OFFICIAL_AVATAR_MODEL_ID, avatarAvailable, assertAvatarAllowed } from "../../../../core/video/avatarGate";
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
  type VideoMode,
  type VideoProgressEvent,
} from "./videoClient";
import { RecallActions, applyImageRecall, type RecallMode } from "../../shared/studio/RecallActions";
import { GenerationQueueBar } from "../../shared/studio/GenerationQueueBar";
import {
  createIpcGenerationQueueClient,
  type GenerationQueueClient,
} from "../../shared/studio/generationQueueClient";
import type { GenerationJob } from "../../../../core/generations/GenerationQueue";

const FALLBACK_MODEL: ListedModelDto = {
  id: DEFAULT_VIDEO_FORM_VALUES.modelId,
  displayName: "Wan 2.1 T2V 1.3B",
  type: "video",
  installed: true,
  source: "registry",
};

export interface VideoLabPageProps {
  readonly client?: VideoClient;
  /** Models client for the installed video-model selector. */
  readonly modelsClient?: { list(): Promise<readonly ListedModelDto[]> };
  /** Test seam: drain interval (ms). Defaults to 100ms. */
  readonly drainIntervalMs?: number;
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
}

let messageSeq = 0;
function nextId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}-${messageSeq}`;
}

export function VideoLabPage({
  client: clientOverride,
  modelsClient,
  drainIntervalMs = 100,
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
}: VideoLabPageProps = {}): JSX.Element {
  const tierClip = getDiffusionTierConfig(diffusionTier).video.clipSeconds || 4;
  const canAvatar = avatarAvailable(diffusionTier, vramGB);
  const [client] = useState<VideoClient>(() => clientOverride ?? createIpcVideoClient());
  const [queueClient] = useState<GenerationQueueClient>(
    () => queueOverride ?? createIpcGenerationQueueClient(),
  );
  const [models, setModels] = useState<readonly ListedModelDto[]>([FALLBACK_MODEL]);
  const [noneInstalled, setNoneInstalled] = useState(false);
  // v2.2.0 Phase 2 (2.2): "backend down" is not "no models installed".
  const [listFailure, setListFailure] = useState<string | null>(null);
  const sidecar = useSidecarStatus();
  const backendDown = sidecar.isDown || isBackendDownMessage(listFailure);
  const [selectedModelId, setSelectedModelId] = useState<string>(FALLBACK_MODEL.id);
  const [values, setValues] = useState<VideoFormValues>({
    ...DEFAULT_VIDEO_FORM_VALUES,
    clipSeconds: tierClip,
    ...initialValues,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeJob, setActiveJob] = useState<{ jobId: string; messageId: string } | null>(null);
  const [seededAttachment, setSeededAttachment] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<ReadonlyMap<string, readonly TimelineSegment[]>>(
    () => new Map(),
  );
  const outputs = useRef<Map<string, string>>(new Map()); // messageId -> mp4Path
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
        const video = installedModelsForType(all, "video");
        if (cancelled) return;
        const first = video[0];
        if (first) {
          setModels(video);
          setSelectedModelId(first.id);
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
      },
    ) => {
      const request = {
        ...base,
        durationSeconds: segment.durationSeconds,
        ...(segment.continueFromPrior && extras.priorJobId
          ? {
              continueFrom: {
                priorJobId: extras.priorJobId,
                segmentIndex: segment.index,
                segmentCount: extras.segmentCount,
              },
            }
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
          const mp4Path = event.mp4Path ?? "";
          if (!mp4Path) {
            outputs.current.delete(messageId);
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
            return { done: true };
          }
          outputs.current.set(messageId, mp4Path);
          const chain = chainRef.current;
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
          chainRef.current = null;
          return { done: true };
        } else if (event.kind === "error") {
          chainRef.current = null;
          outputs.current.delete(messageId);
          patchMessage(messageId, {
            pending: false,
            progress: undefined,
            media: undefined,
            content: `Generation failed: ${event.message ?? "unknown error"}`,
          });
          return { done: true };
        }
      }
      return { done: false };
    },
    [patchMessage, resolveMp4Url, dispatchSegment, client],
  );

  const handleMediaError = useCallback(
    (message: ChatMessage): void => {
      outputs.current.delete(message.id);
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
            content: `Generation failed: ${err instanceof Error ? err.message : String(err)}`,
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

  const handleSubmit = useCallback(
    async (
      text: string,
      attachments: readonly string[],
      residencyApproved = false,
    ): Promise<void> => {
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
          installed: Boolean(selected?.installed ?? true),
        });
        if (verdict.kind === "confirm") {
          pendingPromptRef.current = { text, attachments };
          return;
        }
        if (verdict.kind === "not-installed" || verdict.kind === "defer") {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId("vassistant"),
              role: "assistant",
              content:
                verdict.kind === "not-installed"
                  ? `${selectedModelId} is not installed. Install it in Settings > Models.`
                  : `Cannot load ${selectedModelId} right now: ${verdict.reason}`,
            },
          ]);
          return;
        }
      }
      const intent = inferVideoIntent({ text, attachments, avatarEnabled: canAvatar });
      const userMsg: ChatMessage = {
        id: nextId("vuser"),
        role: "user",
        content: text,
        ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
      };
      const assistantId = nextId("vassistant");
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant", content: "", pending: true, activity: "video-generation" },
      ]);

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
        });
        setActiveJob({ jobId: accepted.jobId, messageId: assistantId });
      } catch (err) {
        chainRef.current = null;
        patchMessage(assistantId, {
          pending: false,
          content: `Generation failed: ${err instanceof Error ? err.message : String(err)}`,
        });
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
    ],
  );

  const onSelectModel = useCallback(
    (id: string): void => {
      if (id === GET_MORE_MODELS_ID) {
        onGetMoreModels?.();
        return;
      }
      setSelectedModelId(id);
    },
    [onGetMoreModels],
  );

  async function copyWorkflow(messageId: string): Promise<void> {
    const mp4Path = outputs.current.get(messageId);
    if (!mp4Path) return;
    try {
      const workflow = await client.extractWorkflow(mp4Path);
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

  const selectorModels = useMemo(
    () => [
      ...models.map((m) => ({ id: m.id, displayName: m.displayName })),
      { id: GET_MORE_MODELS_ID, displayName: "+ Get more models..." },
    ],
    [models],
  );

  return (
    <section
      data-testid="video-lab-page"
      style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, color: "var(--fg-0)" }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--border-1)",
        }}
      >
        <ModelSelector
          models={selectorModels}
          value={selectedModelId}
          onChange={onSelectModel}
          disabled={isGenerating}
          testId="video-model-select"
        />
        {noneInstalled && !backendDown && (
          <button
            type="button"
            data-testid="video-get-more-models"
            onClick={() => onGetMoreModels?.()}
            style={{ background: "transparent", color: "var(--accent-video)", border: "none", cursor: "pointer" }}
          >
            No video models installed - get more models
          </button>
        )}
        <a data-testid="video-settings-link" href={SETTINGS_MODELS_PATH} style={{ display: "none" }}>
          models settings
        </a>
      </header>
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

      <div
        data-testid="video-history"
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
            renderAfter={(m) => (
              <>
                {m.role === "assistant" && (m.media || (playlists.get(m.id)?.length ?? 0) > 0) ? (
                  <TimelinePreviewer
                    src={playlists.get(m.id)?.[0]?.src ?? m.media?.src ?? null}
                    fps={values.fps}
                    segments={playlists.get(m.id)}
                    testId={`video-timeline-${m.id}`}
                    comments={frameComments}
                    onAddComment={(c) => setFrameComments((prev) => [...prev, c])}
                  />
                ) : null}
                {m.role === "assistant" && m.media ? (
                  <div
                    data-testid={`video-actions-${m.id}`}
                    style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-1)" }}
                  >
                    {/* v2.2.3 Phase 2 (2.3): icon-only glass actions; names on aria-label + title. */}
                    <button
                      type="button"
                      className="nx-icon-btn"
                      aria-label="Copy Workflow"
                      title="Copy Workflow"
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
                  </div>
                ) : null}
              </>
            )}
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
      </div>
    </section>
  );
}
