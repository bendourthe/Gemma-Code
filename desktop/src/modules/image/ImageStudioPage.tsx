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

import { MediaComposer, MessageBubble, type ChatMessage } from "../../shared/chat";
import { ModelSelector } from "../../shared/chat/ModelSelector";
import {
  SETTINGS_MODELS_PATH,
  GET_MORE_MODELS_ID,
  installedModelsForType,
} from "../../shared/models/installedFeed";
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
  readonly modelsClient?: { list(): Promise<readonly ListedModelDto[]> };
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
  queueClient: queueOverride,
}: ImageStudioPageProps = {}): JSX.Element {
  const [client] = useState<DiffusionClient>(() => clientOverride ?? createIpcDiffusionClient());
  const [queueClient] = useState<GenerationQueueClient>(
    () => queueOverride ?? createIpcGenerationQueueClient(),
  );
  const [models, setModels] = useState<readonly ListedModelDto[]>([FALLBACK_MODEL]);
  const [noneInstalled, setNoneInstalled] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string>(FALLBACK_MODEL.id);
  const [values, setValues] = useState<PromptFormValues>(DEFAULT_FORM_VALUES);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeJob, setActiveJob] = useState<{ jobId: string; messageId: string } | null>(null);
  const [seededAttachment, setSeededAttachment] = useState<string | null>(null);
  const [formEpoch, setFormEpoch] = useState(0);
  const [queueJobs, setQueueJobs] = useState<readonly GenerationJob[]>([]);
  const [workflowByMessage, setWorkflowByMessage] = useState<Record<string, Record<string, unknown>>>({});
  const outputs = useRef<Map<string, string>>(new Map()); // messageId -> raw png

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
        const image = installedModelsForType(all, "image").filter(
          (m) => !m.tags?.includes("utility"),
        );
        if (cancelled) return;
        const first = image[0];
        if (first) {
          setModels(image);
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
          outputs.current.set(messageId, png);
          patchMessage(messageId, {
            pending: false,
            progress: undefined,
            media: png ? { kind: "image", src: `data:image/png;base64,${png}` } : undefined,
          });
          if (png) {
            void client.extractWorkflow(png).then((wf) => {
              if (wf && typeof wf === "object") {
                setWorkflowByMessage((prev) => ({
                  ...prev,
                  [messageId]: wf as Record<string, unknown>,
                }));
              }
            });
          }
        } else if (event.kind === "error") {
          done = true;
          patchMessage(messageId, {
            pending: false,
            progress: undefined,
            content: `Generation failed: ${event.message ?? "unknown error"}`,
          });
        }
      }
      return { done };
    },
    [patchMessage, client],
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
    async (text: string, attachments: readonly string[]): Promise<void> => {
      if (isGenerating) return;
      const replace = attachments.length > 0 ? parseReplaceIntent(text) : null;
      const intent = inferImageIntent({ text, attachments, mask: null });
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
            const labels = seg.candidates.map((c) => c.label).join(", ");
            patchMessage(assistantId, {
              pending: false,
              content: `Several matches for "${replace.object}" (${labels}). Paint a mask to pick one, or rephrase.`,
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
    [isGenerating, values, selectedModelId, client, patchMessage],
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
        {noneInstalled && (
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

      <div
        data-testid="image-history"
        style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
      >
        {messages.length === 0 ? (
          <p data-testid="image-empty" style={{ color: "var(--fg-muted)" }}>
            Describe an image to generate it, or drop an image and ask to edit, extend, or vary it.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {messages.map((m) => (
              <li key={m.id}>
                <MessageBubble message={m} enableTools={false} />
                {m.role === "assistant" && m.media && (
                  <div
                    data-testid={`image-actions-${m.id}`}
                    style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-1)" }}
                  >
                    <button type="button" data-testid={`image-download-${m.id}`} onClick={() => downloadImage(m.id)}>
                      Download
                    </button>
                    <button type="button" data-testid={`image-copyworkflow-${m.id}`} onClick={() => void copyWorkflow(m.id)}>
                      Copy Workflow
                    </button>
                    <RecallActions
                      messageId={m.id}
                      testIdPrefix="image"
                      hasWorkflow={Boolean(workflowByMessage[m.id])}
                      onRecall={(mode) => recall(m.id, mode)}
                    />
                    <button type="button" data-testid={`image-usesource-${m.id}`} onClick={() => useAsSource(m.id)}>
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
        <details data-testid="image-advanced-settings">
          <summary style={{ cursor: "pointer", color: "var(--fg-muted)" }}>Advanced settings</summary>
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
            <button
              type="button"
              data-testid="image-seed-sweep"
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
            </button>
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
        </details>
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
