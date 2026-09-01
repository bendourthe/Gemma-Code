/**
 * Pure dotted-orb engine (v1.17.0 Phase 2). Canvas-free so unit tests can
 * step and inspect dots without a 2d context. The React component wires this
 * to a canvas + rAF. Reverse-engineered thought-orb idea (ring of dots, one
 * motion grammar per state); no package import, Nexus accents only.
 */

import type { AgentState } from "./mapping";

export const ORB_MAX_DPR = 2;
export const ORB_SIZE_HERO = 64;
/** Chat/Agents composing in the bubble. Larger than the 20px status-chip inline size. */
export const ORB_SIZE_BUBBLE = 48;
export const ORB_SIZE_INLINE = 20;

export type OrbSizePreset = "hero" | "bubble" | "inline";

export interface OrbDot {
  angle: number;
  radius: number;
  phase: number;
}

export interface OrbCtx2D {
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  globalAlpha: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
}

export function clampOrbDpr(dpr: number): number {
  const safe = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(Math.max(safe, 1), ORB_MAX_DPR);
}

export function orbPixelSize(preset: OrbSizePreset): number {
  if (preset === "hero") return ORB_SIZE_HERO;
  if (preset === "bubble") return ORB_SIZE_BUBBLE;
  return ORB_SIZE_INLINE;
}

export function orbDotCount(preset: OrbSizePreset): number {
  if (preset === "hero") return 36;
  if (preset === "bubble") return 28;
  return 14;
}

/** True when `inner` lies entirely inside `outer` (inclusive edges). */
export function rectFullyInside(
  inner: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  outer: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
): boolean {
  return inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
}

export function createOrbDots(count: number, rand: () => number = Math.random): OrbDot[] {
  const dots: OrbDot[] = [];
  for (let i = 0; i < count; i += 1) {
    dots.push({
      angle: (i / count) * Math.PI * 2,
      radius: 0.62,
      phase: rand() * Math.PI * 2,
    });
  }
  return dots;
}

/** Advance dots one frame. `t` is seconds. Mutates in place. */
export function stepOrbDots(dots: OrbDot[], state: AgentState, t: number): void {
  for (let i = 0; i < dots.length; i += 1) {
    const d = dots[i];
    if (!d) continue;
    const frac = i / Math.max(1, dots.length);
    switch (state) {
      case "idle":
        d.angle += 0.004;
        d.radius = 0.7 + 0.03 * Math.sin(d.phase);
        break;
      case "working":
        d.angle += 0.048 + 0.008 * Math.sin(d.phase + t);
        d.radius = 0.62 + 0.1 * Math.sin(t * 2.4 + d.phase);
        break;
      case "searching": {
        const sweep = ((d.angle + t * 1.6) % (Math.PI * 2)) / (Math.PI * 2);
        d.angle += 0.026;
        d.radius = 0.36 + 0.44 * sweep;
        break;
      }
      case "solving":
        d.angle += 0.02;
        d.radius = 0.18 + 0.52 * (0.5 + 0.5 * Math.cos(t * 2.1 + d.phase));
        break;
      case "listening":
        d.angle += 0.01;
        d.radius = 0.5 + 0.26 * Math.sin(t * 2.2);
        break;
      case "composing":
        d.angle += 0.04;
        d.radius = 0.74 + 0.05 * Math.sin(t * 3.4 + frac * Math.PI * 2);
        break;
      case "shaping":
        d.angle += 0.016 * (1 + 0.45 * Math.cos(t));
        d.radius = 0.32 + 0.34 * Math.sin(t * 1.7 + d.phase * 0.5);
        break;
    }
  }
}

export function drawOrbFrame(
  ctx: OrbCtx2D,
  dots: OrbDot[],
  size: number,
  dpr: number,
  fill: string,
  state: AgentState,
  t: number,
): void {
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.42;
  // `size` is already the backing-store (device-pixel) width. Floor the
  // radius in those units; `dpr` only sets a minimum so 1x displays stay visible.
  const dotR = Math.max(0.9 * dpr, size * 0.028);
  ctx.fillStyle = fill;
  for (let i = 0; i < dots.length; i += 1) {
    const d = dots[i];
    if (!d) continue;
    const frac = i / Math.max(1, dots.length);
    let alpha = 0.72;
    if (state === "composing") {
      const chase = (frac - ((t * 0.55) % 1) + 1) % 1;
      alpha = chase < 0.2 ? 0.95 : 0.16;
    } else if (state === "searching") {
      const sweep = ((d.angle + t * 1.4) % (Math.PI * 2)) / (Math.PI * 2);
      alpha = 0.2 + 0.7 * sweep;
    } else if (state === "idle") {
      alpha = 0.35;
    }
    const x = cx + Math.cos(d.angle) * d.radius * maxR;
    const y = cy + Math.sin(d.angle) * d.radius * maxR;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
