/**
 * v1.0.0 Phase 7.2 -- Video Lab top-level page.
 *
 * Layout per the Phase 7 plan:
 *
 *   - left sidebar: `<VideoPromptForm>` (mode, model, prompt, duration,
 *     fps, resolution, steps, cfg, seed, advanced sampler toggle).
 *     For image2video, an upload zone is rendered below the form.
 *   - center top: live latent-preview thumbnail strip (one thumbnail per
 *     generated second) while a job runs.
 *   - center middle: `<TimelinePreviewer>` for completed clips.
 *   - bottom: gallery of generated clips with context-menu actions
 *     (Open, Save As, Copy Workflow, Use Last Frame as Image).
 *
 * Generate / Cancel buttons sit under the form. Drain polling matches
 * the image side -- every `drainIntervalMs` we ask the client for new
 * events until we see `complete` or `error`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_VIDEO_FORM_VALUES,
  VideoPromptForm,
  videoFormToRequest,
  type VideoFormValues,
} from "./VideoPromptForm";
import { TimelinePreviewer } from "./TimelinePreviewer";
import {
  createIpcVideoClient,
  type VideoClient,
  type VideoMode,
  type VideoProgressEvent,
} from "./videoClient";

const DEFAULT_VIDEO_MODELS = [
  { id: "ltx-video", displayName: "LTX-Video (default)", mode: "text2video" as VideoMode },
  // v1.1.0 Phase 13.1 -- SANA-Video 2B "Fast 720p" tier between LTX-Video and CogVideoX.
  {
    id: "sana-video-2b-720p",
    displayName: "SANA-Video 2B 720p (Fast)",
    mode: "text2video" as VideoMode,
  },
  { id: "cogvideox-5b", displayName: "CogVideoX 5B (opt-in)", mode: "text2video" as VideoMode },
  { id: "cogvideox-2b", displayName: "CogVideoX 2B (opt-in)", mode: "text2video" as VideoMode },
  { id: "svd", displayName: "Stable Video Diffusion (default)", mode: "image2video" as VideoMode },
  {
    id: "cogvideox-5b-i2v",
    displayName: "CogVideoX 5B I2V (opt-in)",
    mode: "image2video" as VideoMode,
  },
];

export interface VideoGalleryItem {
  readonly jobId: string;
  readonly mode: VideoMode;
  readonly mp4Path: string;
  readonly summary: string;
  readonly seed: number;
  readonly fps: number;
}

export interface VideoLabPageProps {
  readonly client?: VideoClient;
  /** Test seam: drain interval (ms). Defaults to 100ms. */
  readonly drainIntervalMs?: number;
  /** Test seam: clipboard adapter. Defaults to navigator.clipboard. */
  readonly clipboard?: { writeText: (value: string) => Promise<void> };
  /** Override of the default model list for tests / future ModelRegistry wiring. */
  readonly models?: typeof DEFAULT_VIDEO_MODELS;
  readonly initialValues?: Partial<VideoFormValues>;
  /**
   * Test seam: maps a sidecar mp4Path string into a URL the HTML5
   * video element can play. Production resolves via `file://` once the
   * Tauri filesystem allow-list is configured (Phase 9).
   */
  readonly resolveMp4Url?: (mp4Path: string) => string;
}

export function VideoLabPage({
  client: clientOverride,
  drainIntervalMs = 100,
  clipboard,
  models = DEFAULT_VIDEO_MODELS,
  initialValues,
  resolveMp4Url = (path) => path,
}: VideoLabPageProps = {}): JSX.Element {
  const [client] = useState<VideoClient>(() => clientOverride ?? createIpcVideoClient());
  const [values, setValues] = useState<VideoFormValues>({
    ...DEFAULT_VIDEO_FORM_VALUES,
    ...initialValues,
  });
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Array<string | null>>([]);
  const [progressStep, setProgressStep] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gallery, setGallery] = useState<VideoGalleryItem[]>([]);
  const [activePreview, setActivePreview] = useState<VideoGalleryItem | null>(null);
  const cancelRef = useRef(false);

  const isGenerating = jobId !== null;
  const isImageMode = values.mode === "image2video";

  const advanceFromEvents = useCallback(
    (events: readonly VideoProgressEvent[]): { done: boolean } => {
      let done = false;
      for (const event of events) {
        if (event.kind === "progress") {
          if (typeof event.step === "number") setProgressStep(event.step);
          if (typeof event.totalSteps === "number") setProgressTotal(event.totalSteps);
          if (event.preview && typeof event.secondIndex === "number") {
            setThumbnails((prev) => {
              const next = [...prev];
              while (next.length <= event.secondIndex!) next.push(null);
              next[event.secondIndex!] = event.preview!;
              return next;
            });
          } else if (event.preview) {
            setThumbnails((prev) => [...prev, event.preview!]);
          }
        } else if (event.kind === "complete") {
          done = true;
          if (event.mp4Path) {
            const item: VideoGalleryItem = {
              jobId: event.jobId,
              mode: values.mode,
              mp4Path: event.mp4Path,
              summary: values.prompt.slice(0, 80) || "(empty prompt)",
              seed: values.seed,
              fps: values.fps,
            };
            setGallery((prev) => [item, ...prev]);
            setActivePreview(item);
          }
        } else if (event.kind === "error") {
          done = true;
          setErrorMessage(event.message ?? "video generation failed");
        }
      }
      return { done };
    },
    [values.mode, values.prompt, values.seed, values.fps],
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
    setThumbnails(Array.from({ length: values.durationSeconds }, () => null));
    cancelRef.current = false;
    if (!values.prompt.trim()) {
      setErrorMessage("Prompt is required");
      return;
    }
    if (isImageMode && !sourceImage) {
      setErrorMessage("Source image required for image2video");
      return;
    }
    const base = videoFormToRequest(values);
    try {
      const accepted =
        values.mode === "text2video"
          ? await client.text2video(base)
          : await client.image2video({ ...base, sourceImage: sourceImage! });
      setJobId(accepted.jobId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function handleCancel(): void {
    cancelRef.current = true;
    setJobId(null);
  }

  async function copyWorkflow(item: VideoGalleryItem): Promise<void> {
    try {
      const workflow = await client.extractWorkflow(item.mp4Path);
      if (!workflow) {
        setErrorMessage("Workflow metadata not found in this MP4");
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

  function loadIntoPreviewer(item: VideoGalleryItem): void {
    setActivePreview(item);
  }

  const previewerSrc = useMemo(
    () => (activePreview ? resolveMp4Url(activePreview.mp4Path) : null),
    [activePreview, resolveMp4Url],
  );

  return (
    <section
      data-testid="video-lab-page"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "var(--space-4)",
        gap: "var(--space-4)",
        color: "var(--fg-0)",
      }}
    >
      <header>
        <h1
          style={{
            margin: 0,
            fontSize: "var(--text-lg)",
            color: "var(--accent-video)",
            textShadow: "0 0 18px var(--accent-video-soft)",
          }}
        >
          Video Lab
        </h1>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 360px) 1fr",
          gap: "var(--space-4)",
        }}
      >
        <aside style={{ borderRight: "1px solid var(--border-1)", paddingRight: "var(--space-3)" }}>
          <VideoPromptForm
            initial={values}
            availableModels={models}
            onChange={setValues}
            disabled={isGenerating}
          />
          {isImageMode && (
            <div data-testid="video-source-zone" style={{ marginTop: "var(--space-2)" }}>
              <input
                type="file"
                accept="image/png,image/jpeg"
                data-testid="video-source-upload"
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
                  data-testid="video-source-preview"
                  style={{ maxWidth: "100%", marginTop: "var(--space-2)" }}
                />
              )}
            </div>
          )}
          <div style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-2)" }}>
            <button
              data-testid="video-generate"
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? "Generating..." : "Generate"}
            </button>
            {isGenerating && (
              <button data-testid="video-cancel" type="button" onClick={handleCancel}>
                Cancel
              </button>
            )}
          </div>
          {isGenerating && (
            <div data-testid="video-progress" style={{ marginTop: "var(--space-2)" }}>
              <progress value={progressStep} max={progressTotal || 1} />
              <span data-testid="video-progress-text">
                {progressStep}/{progressTotal || "?"}
              </span>
            </div>
          )}
          {errorMessage && (
            <p data-testid="video-error" style={{ color: "var(--status-err)" }}>
              {errorMessage}
            </p>
          )}
        </aside>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div
            data-testid="video-thumbnail-strip"
            style={{
              display: "flex",
              gap: "var(--space-1)",
              minHeight: "60px",
              padding: "var(--space-1)",
              background: "var(--bg-1)",
              borderRadius: "var(--radius-md)",
              overflowX: "auto",
            }}
          >
            {thumbnails.length === 0 && (
              <span data-testid="video-thumbnail-empty" style={{ color: "var(--fg-muted)" }}>
                Live previews appear here while a job runs.
              </span>
            )}
            {thumbnails.map((thumb, index) => (
              <div
                key={`thumb-${index}`}
                data-testid={`video-thumbnail-${index}`}
                style={{
                  width: "80px",
                  height: "45px",
                  background: "var(--bg-2)",
                  borderRadius: "var(--radius-sm)",
                  flex: "0 0 auto",
                }}
              >
                {thumb && (
                  <img
                    alt={`Frame at ${index}s`}
                    src={`data:image/jpeg;base64,${thumb}`}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                )}
              </div>
            ))}
          </div>

          <TimelinePreviewer src={previewerSrc} fps={activePreview?.fps ?? values.fps} />
        </div>
      </div>

      <section data-testid="video-gallery" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-md)" }}>Outputs</h2>
        {gallery.length === 0 && (
          <p data-testid="video-gallery-empty" style={{ color: "var(--fg-muted)" }}>
            Generated clips will land here.
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
            <li
              key={item.jobId}
              data-testid={`video-gallery-item-${item.jobId}`}
              className="nx-card"
              style={{ padding: "var(--space-2)" }}
            >
              <p style={{ fontSize: "var(--text-xs)", color: "var(--fg-muted)", margin: 0 }}>
                {item.summary}
              </p>
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--fg-muted)",
                  margin: "var(--space-1) 0 0 0",
                }}
              >
                {item.mode} · seed {item.seed} · {item.fps} fps
              </p>
              <div style={{ display: "flex", gap: "var(--space-1)", marginTop: "var(--space-1)", flexWrap: "wrap" }}>
                <button
                  data-testid={`video-gallery-open-${item.jobId}`}
                  type="button"
                  onClick={() => loadIntoPreviewer(item)}
                >
                  Open
                </button>
                <button
                  data-testid={`video-gallery-copy-workflow-${item.jobId}`}
                  type="button"
                  onClick={() => copyWorkflow(item)}
                >
                  Copy Workflow
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
