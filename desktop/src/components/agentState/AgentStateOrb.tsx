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
  clampOrbDpr,
  createOrbDots,
  drawOrbFrame,
  orbDotCount,
  orbPixelSize,
  stepOrbDots,
  type OrbDot,
} from "./orbEngine";

export interface AgentStateOrbProps {
  activity: AgentActivity;
  size?: "hero" | "inline";
  /** Show the mapped activity label beside or below the orb. */
  showCaption?: boolean;
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
      stepOrbDots(dots, mapping.state, t);
      drawOrbFrame(ctx, dots, canvas.width, dpr, fill, mapping.state, t);
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
  }, [allowed, cssSize, mapping.accentFallback, mapping.accentToken, mapping.state, reduce, size, visible]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={`Agent ${mapping.label.toLowerCase()}`}
      data-testid={rest["data-testid"] ?? "agent-state-orb"}
      data-agent-state={mapping.state}
      data-agent-activity={activity}
      data-orb-size={size}
      data-reduced-motion={reduce ? "true" : "false"}
      data-orb-paused={paused ? "true" : "false"}
      className={className}
      style={{
        width: showCaption ? "auto" : cssSize,
        height: showCaption ? "auto" : cssSize,
        flex: "none",
        display: "flex",
        flexDirection: size === "hero" ? "column" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: showCaption ? "var(--space-2)" : undefined,
        borderRadius: showCaption ? undefined : "50%",
        boxShadow:
          !showCaption && size === "hero" && activity !== "idle"
            ? `0 0 16px color-mix(in srgb, ${mapping.accentFallback} 32%, transparent)`
            : undefined,
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        width={cssSize}
        height={cssSize}
        style={{
          display: "block",
          width: cssSize,
          height: cssSize,
          filter:
            showCaption && size === "hero" && activity !== "idle"
              ? `drop-shadow(0 0 16px color-mix(in srgb, ${mapping.accentFallback} 32%, transparent))`
              : undefined,
        }}
      />
      {showCaption ? (
        <span
          data-testid={`${rest["data-testid"] ?? "agent-state-orb"}-caption`}
          style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)", whiteSpace: "nowrap" }}
        >
          {mapping.label}...
        </span>
      ) : null}
    </div>
  );
}
