/**
 * v1.0.0 Phase 6.5 -- Image Studio top-level page.
 *
 * Forms-driven UX per the ComfyUI comparison (Section 4):
 *
 *   - left: `<ImagePromptForm>` (prompt, dims, steps, sampler, ...)
 *   - center: canvas / source-image / mask editor depending on mode
 *   - bottom: gallery of generated outputs
 *
 * Mode tabs at the top switch between txt2img / img2img / inpaint /
 * outpaint. The "Generate" button fires the matching IPC call, then
 * polls `diffusion.job.drainEvents` until a `complete` or `error`
 * arrives. The gallery records every completed output and exposes
 * "Copy Workflow" (extracts embedded PNG metadata).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_FORM_VALUES,
  ImagePromptForm,
  type PromptFormValues,
  valuesToBaseRequest,
} from "./ImagePromptForm";
import { MaskEditor } from "./MaskEditor";
import {
  type DiffusionClient,
  type ImageMode,
  type ProgressEvent,
  createIpcDiffusionClient,
} from "./diffusionClient";

const DEFAULT_MODELS = [
  { id: "sdxl-turbo", displayName: "SDXL Turbo" },
  { id: "sdxl-base-1.0", displayName: "SDXL 1.0 Base" },
  { id: "sd1.5", displayName: "SD 1.5" },
  { id: "flux-schnell", displayName: "FLUX.1 Schnell" },
];

const DEFAULT_LORAS = [
  { id: "lora:detail-tweaker", displayName: "Detail Tweaker" },
  { id: "lora:cinematic", displayName: "Cinematic" },
];

const DEFAULT_CONTROLNETS = [
  { id: "controlnet:sdxl-canny", displayName: "SDXL Canny" },
  { id: "controlnet:sdxl-pose", displayName: "SDXL OpenPose" },
  { id: "controlnet:sdxl-depth", displayName: "SDXL MiDaS Depth" },
];

const MODE_LABELS: Record<ImageMode, string> = {
  txt2img: "Text -> Image",
  img2img: "Image -> Image",
  inpaint: "Inpaint",
  outpaint: "Outpaint",
};

const OUTPAINT_DIRECTIONS: Array<"left" | "right" | "top" | "bottom"> = [
  "left",
  "right",
  "top",
  "bottom",
];

export interface GalleryItem {
  readonly jobId: string;
  readonly mode: ImageMode;
  readonly png: string;
  readonly summary: string;
  readonly seed: number;
}

export interface ImageStudioPageProps {
  readonly client?: DiffusionClient;
  /** Test seam: drain interval (ms). Defaults to 100ms. */
  readonly drainIntervalMs?: number;
  /** Test seam: clipboard adapter. Defaults to navigator.clipboard. */
  readonly clipboard?: { writeText: (value: string) => Promise<void> };
  readonly initialMode?: ImageMode;
}

export function ImageStudioPage({
  client: clientOverride,
  drainIntervalMs = 100,
  clipboard,
  initialMode = "txt2img",
}: ImageStudioPageProps = {}): JSX.Element {
  const [client] = useState<DiffusionClient>(() => clientOverride ?? createIpcDiffusionClient());
  const [mode, setMode] = useState<ImageMode>(initialMode);
  const [values, setValues] = useState<PromptFormValues>(DEFAULT_FORM_VALUES);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [maskImage, setMaskImage] = useState<string | null>(null);
  const [outpaintDirection, setOutpaintDirection] = useState<"left" | "right" | "top" | "bottom">("right");
  const [outpaintPixels, setOutpaintPixels] = useState(128);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [livePreview, setLivePreview] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const cancelRef = useRef(false);

  const isGenerating = jobId !== null;

  const advanceFromEvents = useCallback(
    (events: readonly ProgressEvent[]): { done: boolean } => {
      let done = false;
      for (const event of events) {
        if (event.kind === "progress") {
          if (typeof event.step === "number") setProgressStep(event.step);
          if (typeof event.totalSteps === "number") setProgressTotal(event.totalSteps);
          if (event.preview) setLivePreview(event.preview);
        } else if (event.kind === "complete") {
          done = true;
          const png = event.png ?? "";
          setGallery((prev) => [
            {
              jobId: event.jobId,
              mode,
              png,
              summary: values.prompt.slice(0, 80) || "(empty prompt)",
              seed: values.seed,
            },
            ...prev,
          ]);
        } else if (event.kind === "error") {
          done = true;
          setErrorMessage(event.message ?? "diffusion failed");
        }
      }
      return { done };
    },
    [mode, values.prompt, values.seed],
  );

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const events = await client.drainEvents(jobId);
        if (cancelRef.current) {
          cancelled = true;
          clearInterval(timer);
          setJobId(null);
          return;
        }
        const result = advanceFromEvents(events);
        if (result.done) {
          cancelled = true;
          clearInterval(timer);
          setJobId(null);
        }
      } catch (err) {
        cancelled = true;
        clearInterval(timer);
        setJobId(null);
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }, drainIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [jobId, client, advanceFromEvents, drainIntervalMs]);

  async function handleGenerate(): Promise<void> {
    setErrorMessage(null);
    setProgressStep(0);
    setProgressTotal(0);
    setLivePreview(null);
    cancelRef.current = false;
    const base = valuesToBaseRequest(values) as unknown as Parameters<DiffusionClient["txt2img"]>[0];
    try {
      let accepted;
      if (mode === "txt2img") {
        accepted = await client.txt2img(base);
      } else if (mode === "img2img") {
        if (!sourceImage) {
          setErrorMessage("Source image required for img2img");
          return;
        }
        accepted = await client.img2img({ ...base, sourceImage });
      } else if (mode === "inpaint") {
        if (!sourceImage || !maskImage) {
          setErrorMessage("Source image and mask required for inpaint");
          return;
        }
        accepted = await client.inpaint({ ...base, sourceImage, mask: maskImage });
      } else {
        if (!sourceImage) {
          setErrorMessage("Source image required for outpaint");
          return;
        }
        accepted = await client.outpaint({
          ...base,
          sourceImage,
          direction: outpaintDirection,
          pixels: outpaintPixels,
        });
      }
      setJobId(accepted.jobId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function handleCancel(): void {
    cancelRef.current = true;
    setJobId(null);
  }

  async function copyWorkflow(item: GalleryItem): Promise<void> {
    try {
      const workflow = await client.extractWorkflow(item.png);
      if (!workflow) {
        setErrorMessage("Workflow metadata not found in this PNG");
        return;
      }
      const adapter = clipboard ?? (typeof navigator !== "undefined" ? navigator.clipboard : null);
      if (adapter && typeof adapter.writeText === "function") {
        await adapter.writeText(JSON.stringify(workflow, null, 2));
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function useAsSource(item: GalleryItem): void {
    setSourceImage(`data:image/png;base64,${item.png}`);
    setMode("img2img");
  }

  const advancedModels = useMemo(() => DEFAULT_MODELS, []);
  const advancedLoras = useMemo(() => DEFAULT_LORAS, []);
  const advancedControlNets = useMemo(() => DEFAULT_CONTROLNETS, []);

  return (
    <section
      data-testid="image-studio-page"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "var(--space-4)",
        gap: "var(--space-4)",
        color: "var(--fg-0)",
      }}
    >
      <header style={{ display: "flex", gap: "var(--space-2)" }}>
        {(Object.keys(MODE_LABELS) as ImageMode[]).map((m) => (
          <button
            key={m}
            data-testid={`mode-tab-${m}`}
            data-active={m === mode}
            type="button"
            onClick={() => setMode(m)}
            disabled={isGenerating}
            style={{
              padding: "var(--space-2) var(--space-3)",
              border: `1px solid ${m === mode ? "var(--accent-image)" : "var(--border-1)"}`,
              borderRadius: "var(--radius-md)",
              background: m === mode ? "var(--accent-image)" : "transparent",
              color: m === mode ? "var(--bg-0)" : "var(--fg-1)",
            }}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: "var(--space-4)" }}>
        <aside style={{ borderRight: "1px solid var(--border-1)", paddingRight: "var(--space-3)" }}>
          <ImagePromptForm
            initial={values}
            availableModels={advancedModels}
            availableLoras={advancedLoras}
            availableControlNets={advancedControlNets}
            onChange={setValues}
            disabled={isGenerating}
          />
          <div style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-2)" }}>
            <button
              data-testid="image-generate"
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? "Generating..." : "Generate"}
            </button>
            {isGenerating && (
              <button data-testid="image-cancel" type="button" onClick={handleCancel}>
                Cancel
              </button>
            )}
          </div>
          {isGenerating && (
            <div data-testid="image-progress" style={{ marginTop: "var(--space-2)" }}>
              <progress value={progressStep} max={progressTotal || 1} />
              <span data-testid="image-progress-text">
                {progressStep}/{progressTotal || "?"}
              </span>
            </div>
          )}
          {errorMessage && (
            <p data-testid="image-error" style={{ color: "var(--status-err)" }}>
              {errorMessage}
            </p>
          )}
        </aside>

        <div data-testid="image-canvas" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {mode === "txt2img" && (
            <div
              data-testid="image-canvas-preview"
              style={{
                aspectRatio: `${values.width} / ${values.height}`,
                background: "var(--bg-1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--fg-muted)",
              }}
            >
              {livePreview ? (
                <img
                  alt="Latent preview"
                  src={`data:image/png;base64,${livePreview}`}
                  data-testid="image-live-preview"
                  style={{ maxWidth: "100%", maxHeight: "100%" }}
                />
              ) : (
                "Latent preview will appear here while the job runs."
              )}
            </div>
          )}

          {(mode === "img2img" || mode === "outpaint") && (
            <div data-testid="image-source-zone">
              <input
                type="file"
                accept="image/png,image/jpeg"
                data-testid="image-source-upload"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === "string") setSourceImage(reader.result);
                  };
                  reader.readAsDataURL(file);
                }}
              />
              {sourceImage && (
                <img
                  alt="Source"
                  src={sourceImage}
                  data-testid="image-source-preview"
                  style={{ maxWidth: "100%", marginTop: "var(--space-2)" }}
                />
              )}
              {mode === "outpaint" && (
                <div data-testid="image-outpaint-controls" style={{ marginTop: "var(--space-2)", display: "flex", gap: "var(--space-2)" }}>
                  {OUTPAINT_DIRECTIONS.map((d) => (
                    <button
                      key={d}
                      data-testid={`outpaint-direction-${d}`}
                      data-active={d === outpaintDirection}
                      type="button"
                      onClick={() => setOutpaintDirection(d)}
                    >
                      {d}
                    </button>
                  ))}
                  <input
                    data-testid="outpaint-pixels"
                    type="number"
                    min={8}
                    max={1024}
                    value={outpaintPixels}
                    onChange={(e) => setOutpaintPixels(Number(e.target.value))}
                  />
                </div>
              )}
            </div>
          )}

          {mode === "inpaint" && (
            <div data-testid="image-inpaint-zone">
              <input
                type="file"
                accept="image/png,image/jpeg"
                data-testid="image-inpaint-upload"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === "string") setSourceImage(reader.result);
                  };
                  reader.readAsDataURL(file);
                }}
              />
              {sourceImage && (
                <MaskEditor
                  sourceImage={sourceImage}
                  width={values.width}
                  height={values.height}
                  onMaskChange={setMaskImage}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <section data-testid="image-gallery" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-md)" }}>Outputs</h2>
        {gallery.length === 0 && (
          <p data-testid="image-gallery-empty" style={{ color: "var(--fg-muted)" }}>
            Generated images will land here.
          </p>
        )}
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "var(--space-2)",
          }}
        >
          {gallery.map((item) => (
            <li key={item.jobId} data-testid={`gallery-item-${item.jobId}`} className="nx-card" style={{ padding: "var(--space-2)" }}>
              {item.png && (
                <img
                  alt={item.summary}
                  src={`data:image/png;base64,${item.png}`}
                  style={{ width: "100%", height: "auto", borderRadius: "var(--radius-sm)" }}
                />
              )}
              <p style={{ fontSize: "var(--text-xs)", color: "var(--fg-muted)", margin: "var(--space-1) 0 0 0" }}>
                {item.summary}
              </p>
              <div style={{ display: "flex", gap: "var(--space-1)", marginTop: "var(--space-1)" }}>
                <button data-testid={`gallery-copy-${item.jobId}`} type="button" onClick={() => copyWorkflow(item)}>
                  Copy Workflow
                </button>
                <button data-testid={`gallery-source-${item.jobId}`} type="button" onClick={() => useAsSource(item)}>
                  Use as Source
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
