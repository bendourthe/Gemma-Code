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

import { MediaComposer, MessageBubble, chatComposerAccept, type ChatMessage } from "../../shared/chat";
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

const FALLBACK_MODEL: ListedModelDto = {
  id: DEFAULT_VIDEO_FORM_VALUES.modelId,
  displayName: "LTX-Video",
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
}: VideoLabPageProps = {}): JSX.Element {
  const tierClip = getDiffusionTierConfig(diffusionTier).video.clipSeconds || 4;
  const canAvatar = avatarAvailable(diffusionTier, vramGB);
  const [client] = useState<VideoClient>(() => clientOverride ?? createIpcVideoClient());
  const [models, setModels] = useState<readonly ListedModelDto[]>([FALLBACK_MODEL]);
  const [noneInstalled, setNoneInstalled] = useState(false);
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
        } else {
          setModels([FALLBACK_MODEL]);
          setNoneInstalled(true);
        }
      } catch {
        if (!cancelled) {
          setModels([FALLBACK_MODEL]);
          setNoneInstalled(true);
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
          chainRef.current = null;
          return { done: true };
        } else if (event.kind === "error") {
          chainRef.current = null;
          patchMessage(messageId, {
            pending: false,
            progress: undefined,
            content: `Generation failed: ${event.message ?? "unknown error"}`,
          });
          return { done: true };
        }
      }
      return { done: false };
    },
    [patchMessage, resolveMp4Url, dispatchSegment],
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

  const handleSubmit = useCallback(
    async (text: string, attachments: readonly string[]): Promise<void> => {
      if (isGenerating) return;
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
      const base = videoFormToRequest({
        ...values,
        prompt: intent.prompt,
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
        {noneInstalled && (
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
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {messages.map((m) => (
              <li key={m.id}>
                <MessageBubble message={m} enableTools={false} />
                {m.role === "assistant" && (playlists.get(m.id)?.length ?? 0) > 1 ? (
                  <TimelinePreviewer
                    src={playlists.get(m.id)?.[0]?.src ?? null}
                    fps={values.fps}
                    segments={playlists.get(m.id)}
                    testId={`video-timeline-${m.id}`}
                  />
                ) : null}
                {m.role === "assistant" && m.media && (
                  <div
                    data-testid={`video-actions-${m.id}`}
                    style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-1)" }}
                  >
                    <button type="button" data-testid={`video-copyworkflow-${m.id}`} onClick={() => void copyWorkflow(m.id)}>
                      Copy Workflow
                    </button>
                    <button
                      type="button"
                      data-testid={`video-useframe-${m.id}`}
                      onClick={() => setSeededAttachment(m.media?.src ?? null)}
                    >
                      Use as Source
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ padding: "var(--space-3) var(--space-4)", borderTop: "1px solid var(--border-1)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <details data-testid="video-advanced-settings">
          <summary style={{ cursor: "pointer", color: "var(--fg-muted)" }}>Advanced settings</summary>
          <div style={{ marginTop: "var(--space-2)" }}>
            <VideoPromptForm
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
            />
          </div>
        </details>
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
