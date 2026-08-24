import { useEffect, useRef } from "react";
import { useMotionActivity, useReducedMotion } from "../motion";
import {
  type ConstellationNode,
  clampDpr,
  computeNodeCount,
  createNodes,
  drawFrame,
  stepNodes,
} from "./constellation";

export interface ConstellationBackgroundProps {
  /** Canvas opacity; the guide uses 0.55 on the active view. */
  opacity?: number;
  /** Stacking order; keep content above at a higher z-index. */
  zIndex?: number;
  className?: string;
  "data-testid"?: string;
}

/**
 * Full-viewport animated constellation background (v1.9.0 T203). Ported from
 * the north-star guide's canvas routine via the pure `./constellation` engine.
 *
 * - Honors `prefers-reduced-motion` via `useReducedMotion`: renders a single
 *   static frame, no loop.
 * - Recedes (opacity token) when a surface registers an active effect.
 * - Pauses the animation when the tab/window is hidden and resumes on show.
 * - Caps devicePixelRatio at 2 to bound fill cost on hi-DPI displays.
 * - `pointer-events: none` + `aria-hidden`: purely decorative, never blocks UI.
 */
export function ConstellationBackground({
  opacity = 0.55,
  zIndex = 0,
  className,
  ...rest
}: ConstellationBackgroundProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduce = useReducedMotion();
  const { isAmbientReceded } = useMotionActivity();
  const testId = rest["data-testid"] ?? "constellation";
  const classes = ["nexus-constellation", isAmbientReceded ? "nexus-ambient-recede" : "", className]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    // jsdom / headless renderers return null; there is nothing to animate.
    if (!ctx) return;

    let nodes: ConstellationNode[] = [];
    let dpr = 1;
    let raf = 0;
    let disposed = false;

    const resize = (): void => {
      dpr = clampDpr(window.devicePixelRatio || 1);
      const cssW = Math.max(1, window.innerWidth);
      const cssH = Math.max(1, window.innerHeight);
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      nodes = createNodes(computeNodeCount(cssW), canvas.width, canvas.height, dpr);
    };

    const renderStatic = (): void => {
      drawFrame(ctx, nodes, canvas.width, canvas.height, dpr);
    };

    const loop = (): void => {
      stepNodes(nodes, canvas.width, canvas.height);
      drawFrame(ctx, nodes, canvas.width, canvas.height, dpr);
      raf = window.requestAnimationFrame(loop);
    };

    const start = (): void => {
      if (raf || disposed) return;
      if (reduce) {
        renderStatic();
      } else {
        raf = window.requestAnimationFrame(loop);
      }
    };

    const stop = (): void => {
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const onResize = (): void => {
      resize();
      if (reduce) renderStatic();
    };

    const onVisibility = (): void => {
      if (document.hidden) stop();
      else start();
    };

    resize();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    if (document.hidden) renderStatic();
    else start();

    return () => {
      disposed = true;
      stop();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduce]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid={testId}
      data-reduced-motion={reduce ? "true" : "false"}
      data-ambient-receded={isAmbientReceded ? "true" : "false"}
      className={classes}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex,
        pointerEvents: "none",
        opacity: isAmbientReceded ? "var(--motion-recede-opacity)" : opacity,
      }}
    />
  );
}
