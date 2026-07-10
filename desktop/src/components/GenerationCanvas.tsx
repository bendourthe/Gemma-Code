import type { CSSProperties, ReactNode } from "react";

export type GenerationTint = "image" | "video";

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
 * sweeping shimmer bar -- the keyframes live in globals.css and are disabled
 * under `prefers-reduced-motion` (a soft static glow fallback). An optional
 * live latent preview is overlaid and fades in with `progress` so the result
 * reads as materializing; `children` overlay arbitrary content (the Video Lab
 * per-second thumbnail strip). See docs/versions/v1/v1.9.0/ui-rework-design.md
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
  const testId = rest["data-testid"] ?? "generation-canvas";
  const classes = ["nexus-generation-canvas", className].filter(Boolean).join(" ");

  return (
    <div
      className={classes}
      style={style}
      role="img"
      aria-label={ariaLabel}
      aria-busy="true"
      data-testid={testId}
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
    </div>
  );
}
