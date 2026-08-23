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
import { Download, FileJson, ImagePlus } from "lucide-react";
import { SidecarDownBanner } from "../../components/SidecarDownBanner";
import { Button } from "../../components/ui";
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

import { MediaComposer, MessageList, type ChatMessage } from "../../shared/chat";
import { ModelSelector } from "../../shared/chat/ModelSelector";
import {
  SETTINGS_MODELS_PATH,
  GET_MORE_MODELS_ID,
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
import {
  DEFAULT_FORM_VALUES,
  ImagePromptForm,
  type PromptFormValues,
  valuesToBaseRequest,
} from "./ImagePromptForm";
import { inferImageIntent } from "./intent";
import { MaskEditor } from "./MaskEditor";
import { parseReplaceIntent, inpaintPromptFor } from "../../../../core/image/replaceIntent";
import {
  type DiffusionClient,
  type ProgressEvent,
  createIpcDiffusionClient,
} from "./diffusionClient";
import { RecallActions, applyImageRecall, type RecallMode } from "../../shared/studio/RecallActions";
import { GenerationQueueBar } from "../../shared/studio/GenerationQueueBar";
import {
  createIpcGenerationQueueClient,
  type GenerationQueueClient,
} from "../../shared/studio/generationQueueClient";
import type { GenerationJob } from "../../../../core/generations/GenerationQueue";

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
  /** The scheduler's active job, so the policy knows what would be evicted. */
  readonly activeSchedulerJob?: SchedulerActiveJob | null;
  readonly residencyMemory?: ResidencySessionMemory;
}

let messageSeq = 0;
function nextId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}-${messageSeq}`;
}

export function ImageStudioPage({
  client: clientOverride,
  modelsClient,
  drainIntervalMs = 100,
  clipboard,
  onGetMoreModels,
  diffusionTier = "diffusion-low",
  hostVramFreeGB,
  activeSchedulerJob,
  residencyMemory,
  queueClient: queueOverride,
}: ImageStudioPageProps = {}): JSX.Element {
  const [client] = useState<DiffusionClient>(() => clientOverride ?? createIpcDiffusionClient());
  const [queueClient] = useState<GenerationQueueClient>(
    () => queueOverride ?? createIpcGenerationQueueClient(),
  );
  const [models, setModels] = useState<readonly ListedModelDto[]>([FALLBACK_MODEL]);
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
  const pendingPromptRef = useRef<{ text: string; attachments: readonly string[] }>({
    text: "",
    attachments: [],
  });
  const backendDown = sidecar.isDown || isBackendDownMessage(listFailure);
  const [selectedModelId, setSelectedModelId] = useState<string>(FALLBACK_MODEL.id);
  const [values, setValues] = useState<PromptFormValues>(DEFAULT_FORM_VALUES);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeJob, setActiveJob] = useState<{ jobId: string; messageId: string } | null>(null);
  const [seededAttachment, setSeededAttachment] = useState<string | null>(null);
  const [formEpoch, setFormEpoch] = useState(0);
  const [queueJobs, setQueueJobs] = useState<readonly GenerationJob[]>([]);
  const [workflowByMessage, setWorkflowByMessage] = useState<Record<string, Record<string, unknown>>>({});
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
    void (async () => {
      try {
        const all = await source.list();
        const snap = source.lastSelection ?? null;
        const image = installedModelsForType(all, "image", ownedIdSet(snap)).filter(
          (m) => !m.tags?.includes("utility"),
        );
        if (cancelled) return;
        const first = image[0];
        if (first) {
          setModels(image);
          const next = resolveDefaultId(image, {
            favorite: readFavorite("image"),
            recommended: snap?.recommendedByTask.image ?? null,
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

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>): void => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const advanceFromEvents = useCallback(
    (events: readonly ProgressEvent[], messageId: string): { done: boolean } => {
      let done = false;
      for (const event of events) {
        if (event.kind === "progress") {
          const step = event.step ?? 0;
          const total = event.totalSteps ?? 0;
          patchMessage(messageId, { progress: { step, total } });
        } else if (event.kind === "complete") {
          done = true;
          const png = event.png ?? "";
          if (!png) {
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
              content: "Generation failed: image generation completed without image bytes.",
            });
            continue;
          }
          outputs.current.set(messageId, png);
          patchMessage(messageId, {
            pending: false,
            progress: undefined,
            media: { kind: "image", src: `data:image/png;base64,${png}` },
          });
          void client.extractWorkflow(png).then((wf) => {
            if (wf && typeof wf === "object") {
              setWorkflowByMessage((prev) => ({
                ...prev,
                [messageId]: wf as Record<string, unknown>,
              }));
            }
          });
        } else if (event.kind === "error") {
          done = true;
          outputs.current.delete(messageId);
          patchMessage(messageId, {
            pending: false,
            progress: undefined,
            media: undefined,
            content: `Generation failed: ${event.message ?? "unknown error"}`,
          });
        }
      }
      return { done };
    },
    [patchMessage, client],
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
              id: nextId("assistant"),
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
      const replace = attachments.length > 0 ? parseReplaceIntent(text) : null;
      const intent = inferImageIntent({ text, attachments, mask: paintedMask });
      const userMsg: ChatMessage = {
        id: nextId("user"),
        role: "user",
        content: text,
        ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
      };
      const assistantId = nextId("assistant");
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        pending: true,
        activity: "image-generation",
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      const base = valuesToBaseRequest(values, {
        prompt: replace ? inpaintPromptFor(replace) : intent.prompt,
        modelId: selectedModelId,
      }) as unknown as Parameters<DiffusionClient["txt2img"]>[0];

      try {
        if (replace && attachments[0]) {
          const sourceImage = attachments[0].includes(",")
            ? attachments[0].slice(attachments[0].indexOf(",") + 1)
            : attachments[0];
          const seg = await client.segment({
            sourceImage,
            phrase: replace.object,
            hint: { text: replace.object },
          });
          if (!seg.ok || !seg.candidates || seg.candidates.length === 0) {
            patchMessage(assistantId, {
              pending: false,
              content:
                seg.message ??
                "Could not find a mask for that object. Paint a mask to continue, or install sam2:hiera-tiny.",
            });
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
        if (intent.mode === "txt2img") {
          accepted = await client.txt2img(base);
        } else if (intent.mode === "img2img") {
          accepted = await client.img2img({ ...base, sourceImage: intent.sourceImage ?? "" });
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
        patchMessage(assistantId, {
          pending: false,
          content: `Generation failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
    [isGenerating, values, selectedModelId, client, patchMessage, paintedMask],
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

  const pickCandidate = useCallback(
    async (maskPngBase64: string): Promise<void> => {
      if (!pendingReplace) return;
      const accepted = await client.inpaint({
        ...pendingReplace.base,
        sourceImage: pendingReplace.sourceImage,
        mask: maskPngBase64,
      });
      patchMessage(pendingReplace.assistantId, { pending: true, content: "" });
      setActiveJob({ jobId: accepted.jobId, messageId: pendingReplace.assistantId });
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
      const adapter = clipboard ?? (typeof navigator !== "undefined" ? navigator.clipboard : null);
      if (adapter && typeof adapter.writeText === "function") {
        await adapter.writeText(JSON.stringify(workflow, null, 2));
      }
    } catch {
      // best-effort; failures are non-fatal for the copy action.
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

  const selectorModels = useMemo(
    () => [
      ...models.map((m) => ({ id: m.id, displayName: m.displayName })),
      { id: GET_MORE_MODELS_ID, displayName: "+ Get more models..." },
    ],
    [models],
  );

  return (
    <section
      data-testid="image-studio-page"
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
          testId="image-model-select"
        />
        {noneInstalled && !backendDown && (
          <button
            type="button"
            data-testid="image-get-more-models"
            onClick={() => onGetMoreModels?.()}
            style={{ background: "transparent", color: "var(--accent-image)", border: "none", cursor: "pointer" }}
          >
            No image models installed - get more models
          </button>
        )}
        <a data-testid="image-settings-link" href={SETTINGS_MODELS_PATH} style={{ display: "none" }}>
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
          context="Image models cannot be listed."
          testId="image-sidecar-down"
        />
      )}

      <div
        data-testid="image-history"
        style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
      >
        {messages.length === 0 ? (
          <p data-testid="image-empty" style={{ color: "var(--fg-muted)" }}>
            Describe an image to generate it, or drop an image and ask to edit, extend, or vary it.
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
                  style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-1)" }}
                >
                  {/* v2.2.3 Phase 2 (2.3): icon-only glass actions; names on aria-label + title. */}
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
                </div>
              ) : null
            }
          />
        )}
      </div>

      <div style={{ padding: "var(--space-3) var(--space-4)", borderTop: "1px solid var(--border-1)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
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
              availableModels={models.map((m) => ({ id: m.id, displayName: m.displayName }))}
              availableLoras={DEFAULT_LORAS}
              availableControlNets={DEFAULT_CONTROLNETS}
              onChange={setValues}
              disabled={isGenerating}
              diffusionTier={diffusionTier}
            />
            {seededAttachment ? (
              <div data-testid="image-mask-layer">
                <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-xs)" }}>
                  Paint a mask on the source image (Advanced). The next Generate uses inpaint.
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
              <div data-testid="image-sam-candidates" style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
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
                void queueClient.enqueue({
                  pillar: "image",
                  jobType: "txt2img",
                  parameters: { ...values, prompt: values.prompt || "batch" },
                  priority: "batch",
                  batchSpec: { kind: "seed-range", start: values.seed, end: values.seed + 2 },
                }).then((jobs) => setQueueJobs((prev) => [...prev, ...jobs]));
              }}
            >
              Queue seed sweep
            </Button>
            <GenerationQueueBar
              jobs={queueJobs}
              onCancel={(id) => {
                void queueClient.cancel(id).then(() =>
                  queueClient.list().then(setQueueJobs),
                );
              }}
              onReorder={(ids) => {
                void queueClient.reorder(ids).then(() =>
                  queueClient.list().then(setQueueJobs),
                );
              }}
            />
          </div>
          ) : null}
        </div>
        <MediaComposer
          disabled={isGenerating}
          onSubmit={(text, attachments) => void handleSubmit(text, attachments)}
          submitAccentVar="--accent-image"
          submitLabel="Generate"
          seededAttachment={seededAttachment}
          streaming={isGenerating}
        />
      </div>
    </section>
  );
}
