/**
 * v1.9.0 Phase 8 -- the aurora "generating" canvas with a materializing latent
 * preview.
 *
 * RETAINED, NOT DEAD (v1.15.0 Phase 8 refactor triage): the Phase 5/6 chat
 * redesigns show an inline agent-state orb inside the assistant bubble instead
 * of a full-bleed canvas, so nothing mounts this today. It stays (with its
 * unit test, hero orb overlay, and `.nexus-generation-*` styles) as the richer
 * in-bubble progress visual to reinstate if the inline orb proves too sparse.
 * Aurora plus the hero orb coexist here until Phase 5 one-motion precedence.
 * Phase 3 adds a traveling beam on the outer frame (not the same element as
 * the orb). Production Image/Video pages still do not mount this canvas.
 */

import type { CSSProperties, ReactNode } from "react";
import { AccentBeam } from "./AccentBeam";
import { AgentStateOrb } from "./agentState/AgentStateOrb";
import { useReducedMotion } from "../motion";

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

  return (
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
  );
}
