/**
 * v1.9.0 Phase 8 -- the aurora "generating" canvas with a materializing latent
 * preview.
 *
 * RETAINED, NOT DEAD (v1.15.0 Phase 8 refactor triage): the Phase 5/6 chat
 * redesigns show an inline agent-state orb inside the assistant bubble instead
 * of a full-bleed canvas, so nothing mounts this today. It stays (with its
 * unit test, hero orb overlay, and `.nexus-generation-*` styles) as the richer
 * in-bubble progress visual to reinstate if the inline orb proves too sparse.
 * Aurora plus the hero orb coexisted here until Phase 5 one-motion
 * precedence: the orb wins, the frame beam pauses, and aurora halts to a
 * static wash. Production Image/Video pages still do not mount this canvas.
 */

import type { CSSProperties, ReactNode } from "react";
import { AccentBeam } from "./AccentBeam";
import { AgentStateOrb } from "./agentState/AgentStateOrb";
import {
  GENERATION_CANVAS_CANDIDATES,
  MotionSurface,
  primaryMotion,
  useReducedMotion,
} from "../motion";

export type GenerationTint = "image" | "video";

export interface MediaRuntimeRecoveryCardProps {
  readonly state: "repairable" | "repairing" | "failed";
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly progress: number;
  readonly details?: string;
  readonly logPath?: string;
  readonly onRepair?: () => void;
  readonly onCancel?: () => void;
  readonly onOpenLog?: () => void;
}

/** Inline, non-bubble recovery surface shared by Image Studio and Video Lab. */
export function MediaRuntimeRecoveryCard({
  state,
  code,
  message,
  retryable,
  progress,
  details,
  logPath,
  onRepair,
  onCancel,
  onOpenLog,
}: MediaRuntimeRecoveryCardProps): JSX.Element {
  return (
    <section
      data-testid="media-runtime-recovery"
      role="alert"
      style={{
        width: "min(100%, 42rem)",
        border: "1px solid color-mix(in srgb, var(--warning, #f59e0b) 55%, var(--border-1))",
        borderRadius: "var(--radius-lg)",
        background: "color-mix(in srgb, var(--warning, #f59e0b) 8%, var(--bg-1))",
        padding: "var(--space-3)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <strong>Media runtime needs attention</strong>
      <span>{message}</span>
      {state === "repairing" ? (
        <div role="status" aria-live="polite">
          <progress value={progress} max={1} style={{ width: "100%" }} />
          <span style={{ color: "var(--fg-muted)", fontSize: "var(--text-xs)" }}>
            {Math.round(progress * 100)}%
          </span>
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
        {state === "repairing" ? (
          <button type="button" onClick={onCancel} data-testid="media-runtime-cancel">
            Cancel repair
          </button>
        ) : retryable ? (
          <button type="button" onClick={onRepair} data-testid="media-runtime-repair">
            Repair media runtime
          </button>
        ) : null}
        {logPath ? (
          <button type="button" onClick={onOpenLog} data-testid="media-runtime-open-log">
            Open log location
          </button>
        ) : null}
      </div>
      <details>
        <summary>View details</summary>
        <p style={{ marginBottom: 0, whiteSpace: "pre-wrap", color: "var(--fg-muted)" }}>
          {details || code}
        </p>
      </details>
    </section>
  );
}

export interface GenerationCanvasProps {
  /** Job progress 0-1; drives how far the live preview has "materialized". */
  progress?: number;
  /** Per-pillar accent tint for the third aurora layer. */
  tint?: GenerationTint;
  /** Live latent-preview image (a data URI) overlaid as it materializes. */
  previewSrc?: string;
  previewAlt?: string;
  /** Arbitrary overlay content (e.g. the Video Lab thumbnail strip). */
  children?: ReactNode;
  /** Accessible label for the busy region. */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

const TINT_VAR: Record<GenerationTint, string> = {
  image: "var(--accent-image)",
  video: "var(--accent-video)",
};

/**
 * On-brand aurora "generating" mark (v1.9.0 Phase 8, T029/T030). A rounded,
 * overflow-hidden box with three oversized blurred radial-gradient layers that
 * drift via `transform` on staggered loops (`mix-blend-mode: screen`) plus a
 * sweeping shimmer bar -- the keyframes live in globals.css. The shared
 * reduced-motion hook marks the element; the centralized CSS media block
 * disables the aurora (a soft static glow fallback). An optional live latent
 * preview is overlaid and fades in with `progress` so the result reads as
 * materializing; `children` overlay arbitrary content (the Video Lab
 * per-second thumbnail strip). See docs/v1/v1.9/ui-rework-design.md
 * Section 3.
 */
export function GenerationCanvas({
  progress,
  tint,
  previewSrc,
  previewAlt = "Live preview",
  children,
  ariaLabel = "Generating",
  className,
  style,
  ...rest
}: GenerationCanvasProps): JSX.Element {
  // The live preview fades in as the job advances (0.35 -> 1.0); a bare 0.6
  // when progress is unknown so it never renders invisible.
  const previewOpacity =
    typeof progress === "number"
      ? 0.35 + 0.65 * Math.min(1, Math.max(0, progress))
      : 0.6;
  const reduce = useReducedMotion();
  const testId = rest["data-testid"] ?? "generation-canvas";
  const classes = ["nexus-generation-canvas", className].filter(Boolean).join(" ");
  const beamAccent = tint === "video" ? "--accent-video" : "--accent-image";
  const winner = primaryMotion(GENERATION_CANVAS_CANDIDATES);

  return (
    <MotionSurface surfaceId="generation-canvas" candidates={GENERATION_CANVAS_CANDIDATES}>
    <AccentBeam
      mode="traveling"
      playing
      accentToken={beamAccent}
      radiusToken="--radius-lg"
      strength={0.55}
      surfaceId="generation-canvas-beam"
      data-testid={`${testId}-beam`}
    >
    <div
      className={classes}
      style={style}
      role="img"
      aria-label={ariaLabel}
      aria-busy="true"
      data-testid={testId}
      data-reduced-motion={reduce ? "true" : "false"}
      data-motion-winner={winner ?? ""}
    >
      <div className="nexus-aurora-layer nexus-aurora-layer-1" aria-hidden="true" />
      <div className="nexus-aurora-layer nexus-aurora-layer-2" aria-hidden="true" />
      <div
        className="nexus-aurora-layer nexus-aurora-layer-3"
        aria-hidden="true"
        style={
          tint
            ? {
                background: `radial-gradient(circle at 50% 70%, ${TINT_VAR[tint]}, transparent 60%)`,
              }
            : undefined
        }
      />
      <div className="nexus-aurora-shimmer" aria-hidden="true" />
      {previewSrc ? (
        <img
          className="nexus-generation-preview"
          src={previewSrc}
          alt={previewAlt}
          style={{ opacity: previewOpacity }}
          data-testid={`${testId}-preview`}
        />
      ) : null}
      {children != null ? (
        <div className="nexus-generation-overlay">{children}</div>
      ) : null}
      <div
        className="nexus-generation-orb"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 3,
          pointerEvents: "none",
        }}
      >
        <AgentStateOrb
          activity={tint === "video" ? "video-generation" : "image-generation"}
          size="hero"
          surfaceId="generation-canvas"
        />
      </div>
    </div>
    </AccentBeam>
    </MotionSurface>
  );
}
