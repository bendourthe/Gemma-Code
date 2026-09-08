/**
 * Internal agent-state orb (v1.17.0 Phase 2). Reverse-engineered dotted
 * thought-orb: Canvas 2D ring of dots, one motion grammar per mapped state.
 * No `thinking-orbs` package. Nexus accents only (forced-dark).
 */

import { useEffect, useRef, useState } from "react";
import { useActiveMotionSurface, useAllowsMotion, useReducedMotion } from "../../motion";
import type { AgentActivity } from "./mapping";
import { resolveAgentState } from "./mapping";
import {
  isStudioActivity,
  longestPendingCaption,
  pendingCaptionState,
  pendingPillMinWidthExpr,
  usePendingCaptionRotator,
  useStudioCaptionRotator,
} from "./captionRotator";
import {
  clampOrbDpr,
  createOrbDots,
  drawOrbFrame,
  orbDotCount,
  orbPixelSize,
  stepOrbDots,
  type OrbDot,
  type OrbSizePreset,
} from "./orbEngine";

export {
  longestPendingCaption,
  pendingPillMinWidthExpr,
} from "./captionRotator";

export interface AgentStateOrbProps {
  activity: AgentActivity;
  size?: OrbSizePreset;
  /** Show the mapped activity label beside or below the orb. */
  showCaption?: boolean;
  /**
   * v2.2.9 T006 -- pending pill mode. Cycles Thinking / Searching / Working /
   * Solving (shuffled once per mount, ~2.4s interval) inside a dark pill and
   * drives the matching particle grammar. Reduced-motion: the first fixed
   * caption, static, no rotation. Implies `showCaption`.
   */
  rotateCaptions?: boolean;
  /**
   * v2.4.8 Phase 8: a fixed caption that overrides the mapping label and the
   * studio rotator (e.g. "Loading model..." before sampling starts).
   */
  caption?: string;
  /**
   * Stable accessible name. Required so a rotating caption never floods a
   * screen reader; defaults to "Generating reply" while rotating.
   */
  accessibleName?: string;
  /** Recede-when-active id. Defaults to a stable per-activity value. */
  surfaceId?: string;
  className?: string;
  "data-testid"?: string;
}

function readAccent(el: HTMLElement, token: string, fallback: string): string {
  try {
    const value = getComputedStyle(el).getPropertyValue(token).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Dotted Canvas orb that expresses the current agent activity. Honors
 * `prefers-reduced-motion` (static frame, no rAF) and pauses when offscreen
 * (IntersectionObserver; missing IO in jsdom is treated as visible).
 */
export function AgentStateOrb({
  activity,
  size = "inline",
  showCaption = false,
  rotateCaptions = false,
  caption,
  accessibleName,
  surfaceId,
  className,
  ...rest
}: AgentStateOrbProps): JSX.Element {
  const mapping = resolveAgentState(activity);
  const reduce = useReducedMotion();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(true);
  const id = surfaceId ?? `agent-state-orb-${activity}`;
  const allowed = useAllowsMotion("orb");
  const paused = reduce || !visible || !allowed;
  const cssSize = orbPixelSize(size);
  // Rotator hook is unconditional (hooks rule); it schedules an interval only
  // while rotation is requested and motion is allowed.
  const rotatingCaption = usePendingCaptionRotator(rotateCaptions && !reduce);
  // v2.4.4 Phase 5.3 (T020): Image and Video pending rotate their own words.
  // Both hooks are called unconditionally (hooks rule); only one is read.
  const studio = isStudioActivity(activity);
  const studioCaption = useStudioCaptionRotator(studio && showCaption && !reduce);
  const captionShown = showCaption || rotateCaptions;
  const captionText =
    caption ??
    (rotateCaptions
      ? rotatingCaption
      : studio
        ? studioCaption
        : `${mapping.label}...`);
  const engineState = rotateCaptions ? pendingCaptionState(rotatingCaption) : mapping.state;
  const hostLabel =
    accessibleName ?? (rotateCaptions ? "Generating reply" : `Agent ${mapping.label.toLowerCase()}`);

  useActiveMotionSurface(id, activity !== "idle" && allowed);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];
      setVisible(entry ? entry.isIntersecting : true);
    });
    io.observe(host);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = clampOrbDpr(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    canvas.width = Math.floor(cssSize * dpr);
    canvas.height = Math.floor(cssSize * dpr);
    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;

    const fill = host
      ? readAccent(host, mapping.accentToken, mapping.accentFallback)
      : mapping.accentFallback;
    const dots: OrbDot[] = createOrbDots(orbDotCount(size));
    let raf = 0;
    let disposed = false;
    const t0 =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : 0;

    const paint = (t: number): void => {
      stepOrbDots(dots, engineState, t);
      drawOrbFrame(ctx, dots, canvas.width, dpr, fill, engineState, t);
    };

    const loop = (now: number): void => {
      paint((now - t0) / 1000);
      raf = window.requestAnimationFrame(loop);
    };

    const stop = (): void => {
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const start = (): void => {
      if (disposed || raf) return;
      if (reduce || !visible || !allowed || (typeof document !== "undefined" && document.hidden)) {
        paint(0);
        return;
      }
      raf = window.requestAnimationFrame(loop);
    };

    const onVisibility = (): void => {
      if (typeof document !== "undefined" && document.hidden) stop();
      else start();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    start();

    return () => {
      disposed = true;
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [allowed, cssSize, engineState, mapping.accentFallback, mapping.accentToken, reduce, size, visible]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={hostLabel}
      data-testid={rest["data-testid"] ?? "agent-state-orb"}
      data-agent-state={engineState}
      data-agent-activity={activity}
      data-orb-size={size}
      data-orb-pill={rotateCaptions ? "true" : undefined}
      data-reduced-motion={reduce ? "true" : "false"}
      data-orb-paused={paused ? "true" : "false"}
      className={className}
      style={{
        position: "relative",
        width: captionShown ? "auto" : cssSize,
        height: captionShown ? "auto" : cssSize,
        flex: "none",
        display: "flex",
        // The pending pill is a horizontal capsule: orb left, caption right.
        flexDirection: rotateCaptions || size === "inline" ? "row" : "column",
        alignItems: "center",
        justifyContent: "center",
        gap: captionShown ? "var(--space-2)" : undefined,
        // v2.4.2 Phase 1: do not put border-radius on the host that owns the
        // canvas. A 999px capsule clips the 48px bubble orb's left dots.
        // Pill chrome is a sibling layer; the canvas stays unclipped.
        overflow: "visible",
        minWidth: rotateCaptions ? pendingPillMinWidthExpr(cssSize) : undefined,
        // v2.4.4 Phase 1.2: no second pill inset. The transcript gutter on the
        // message list is the only left offset, so the pending pill starts on
        // the same gutter as a completed assistant bubble and its glow still
        // has room inside that padding instead of being cropped by the pane.
        borderRadius: rotateCaptions ? undefined : captionShown ? undefined : "50%",
        padding: rotateCaptions ? "var(--space-2) var(--space-3)" : undefined,
        boxSizing: "border-box",
        boxShadow:
          !rotateCaptions && !captionShown && size !== "inline" && activity !== "idle"
            ? `0 0 16px color-mix(in srgb, ${mapping.accentFallback} 32%, transparent)`
            : undefined,
      }}
    >
      {rotateCaptions ? (
        <span
          data-testid={`${rest["data-testid"] ?? "agent-state-orb"}-pill-chrome`}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "999px",
            border: "1px solid var(--border-1)",
            backgroundColor: "color-mix(in srgb, var(--bg-0, #101014) 88%, transparent)",
            boxShadow: `0 0 14px color-mix(in srgb, ${mapping.accentFallback} 18%, transparent)`,
            pointerEvents: "none",
          }}
        />
      ) : null}
      <canvas
        ref={canvasRef}
        data-testid={`${rest["data-testid"] ?? "agent-state-orb"}-canvas`}
        aria-hidden="true"
        width={cssSize}
        height={cssSize}
        style={{
          position: "relative",
          zIndex: 1,
          display: "block",
          width: cssSize,
          height: cssSize,
          flex: "none",
          filter:
            captionShown && size !== "inline" && activity !== "idle"
              ? `drop-shadow(0 0 16px color-mix(in srgb, ${mapping.accentFallback} 32%, transparent))`
              : undefined,
        }}
      />
      {captionShown ? (
        // The rotating caption stays out of the accessibility tree: the host
        // exposes one stable name, so screen readers never hear the cycle.
        <span
          data-testid={`${rest["data-testid"] ?? "agent-state-orb"}-caption`}
          aria-hidden="true"
          aria-live="off"
          style={{
            position: "relative",
            zIndex: 1,
            color: "var(--fg-muted)",
            fontSize: "var(--text-sm)",
            whiteSpace: "nowrap",
            minWidth: rotateCaptions ? `${longestPendingCaption().length}ch` : undefined,
          }}
        >
          {captionText}
        </span>
      ) : null}
    </div>
  );
}
