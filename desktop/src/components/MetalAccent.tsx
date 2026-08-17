/**
 * Internal liquid-metal ring (v1.17.0 Phase 4). Reverse-engineered metal-fx
 * WebGL specular ring. No `metal-fx` package. Nexus accents only. Falls back
 * to a static on-brand border when WebGL is missing, the instance cap is
 * full, reduced-motion is set, or the surface is paused offscreen.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useActiveMotionSurface, useReducedMotion } from "../motion";
import {
  clampMetalDpr,
  createMetalProgram,
  drawMetalFrame,
  METAL_TINT,
  requestMetalContext,
  type MetalAccentToken,
  type MetalProgram,
} from "./metalGl";
import { releaseMetalSlot, tryAcquireMetalSlot } from "./metalRegistry";

export type { MetalAccentToken };

export interface MetalAccentProps {
  children: ReactNode;
  accentToken?: MetalAccentToken;
  strength?: number;
  paused?: boolean;
  surfaceId: string;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

export function MetalAccent({
  children,
  accentToken = "--accent-coding",
  strength = 0.85,
  paused = false,
  surfaceId,
  className,
  style,
  ...rest
}: MetalAccentProps): JSX.Element {
  const reduce = useReducedMotion();
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(true);
  const [animating, setAnimating] = useState(false);
  const testId = rest["data-testid"] ?? "metal-accent";
  const clamped = Math.min(1, Math.max(0, strength));
  const wantGpu = !reduce && !paused && visible;
  const fallback = !animating;

  useActiveMotionSurface(surfaceId, wantGpu && animating);

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
    if (!canvas || !wantGpu) {
      setAnimating(false);
      return;
    }
    const gl = requestMetalContext(canvas);
    if (!gl) {
      setAnimating(false);
      return;
    }
    if (!tryAcquireMetalSlot()) {
      setAnimating(false);
      return;
    }
    const program: MetalProgram | null = createMetalProgram(gl);
    if (!program) {
      releaseMetalSlot();
      setAnimating(false);
      return;
    }
    setAnimating(true);
    let raf = 0;
    let disposed = false;
    const tint = METAL_TINT[accentToken];
    const t0 =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : 0;

    const resize = (): void => {
      const host = hostRef.current;
      const cssW = Math.max(1, host?.clientWidth || canvas.clientWidth || 80);
      const cssH = Math.max(1, host?.clientHeight || canvas.clientHeight || 32);
      const dpr = clampMetalDpr(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    };

    const loop = (now: number): void => {
      if (disposed) return;
      resize();
      drawMetalFrame(program, canvas.width, canvas.height, (now - t0) / 1000, tint, clamped);
      raf = window.requestAnimationFrame(loop);
    };

    resize();
    raf = window.requestAnimationFrame(loop);

    return () => {
      disposed = true;
      if (raf) window.cancelAnimationFrame(raf);
      releaseMetalSlot();
    };
  }, [accentToken, clamped, wantGpu]);

  return (
    <span
      ref={hostRef}
      data-testid={testId}
      data-metal-fallback={fallback ? "true" : "false"}
      data-metal-animating={animating ? "true" : "false"}
      data-metal-accent={accentToken}
      data-reduced-motion={reduce ? "true" : "false"}
      className={["nexus-metal-accent", fallback ? "nexus-metal-fallback" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={{
        ...style,
        position: "relative",
        display: "inline-flex",
        ["--nexus-metal-color" as string]: `var(${accentToken})`,
      }}
    >
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="nexus-metal-canvas"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          display: fallback ? "none" : "block",
        }}
      />
    </span>
  );
}
