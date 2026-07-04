/**
 * Constellation engine -- the pure, canvas-free core of the animated network
 * background. Ported from the north-star reference
 * (guides/interactive-guide/nexus-ai-guide.html) so the React
 * `<ConstellationBackground/>` and the PyQt `ConstellationBackground` widget
 * animate identically. See docs/versions/v1/v1.9.0/design-tokens.md.
 *
 * These functions hold no DOM references so they are unit-testable without a
 * real canvas; the component wires them to a `<canvas>` + requestAnimationFrame.
 */

/** Link (line) color -- tokens.css `--glow-cyan`. */
export const CONSTELLATION_LINK = "#38bdf8";
/** Node (dot) color -- tokens.css `--glow-cyan-node`. */
export const CONSTELLATION_NODE = "#7dd3fc";
/** Device-pixel-ratio cap; bounds fill cost on hi-DPI displays (guide parity). */
export const MAX_DPR = 2;
/** Link fade distance in device pixels, scaled by dpr at draw time. */
export const LINK_MAX_DISTANCE = 150;
/** Node radius in device pixels, scaled by dpr at draw time. */
export const NODE_RADIUS = 1.5;

export interface ConstellationNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Minimal 2D-context surface the engine draws through (test seam). */
export interface Ctx2D {
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  globalAlpha: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
}

/** ~40 nodes at a typical width, hard-capped at 46, floored at 18. */
export function computeNodeCount(cssWidth: number): number {
  return Math.max(18, Math.min(46, Math.floor(cssWidth / 34)));
}

/** Clamp a raw devicePixelRatio into [1, MAX_DPR]. */
export function clampDpr(dpr: number): number {
  const safe = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(Math.max(safe, 1), MAX_DPR);
}

/** Build `count` nodes with random positions + slow drift velocities. */
export function createNodes(
  count: number,
  width: number,
  height: number,
  dpr: number,
  rand: () => number = Math.random,
): ConstellationNode[] {
  const nodes: ConstellationNode[] = [];
  for (let i = 0; i < count; i += 1) {
    nodes.push({
      x: rand() * width,
      y: rand() * height,
      vx: (rand() - 0.5) * 0.16 * dpr,
      vy: (rand() - 0.5) * 0.16 * dpr,
    });
  }
  return nodes;
}

/** Advance every node one frame, bouncing off the edges. */
export function stepNodes(
  nodes: ConstellationNode[],
  width: number,
  height: number,
): void {
  for (const n of nodes) {
    n.x += n.vx;
    n.y += n.vy;
    if (n.x < 0 || n.x > width) n.vx *= -1;
    if (n.y < 0 || n.y > height) n.vy *= -1;
  }
}

/** Draw one frame: distance-faded links, then nodes. */
export function drawFrame(
  ctx: Ctx2D,
  nodes: ConstellationNode[],
  width: number,
  height: number,
  dpr: number,
): void {
  ctx.clearRect(0, 0, width, height);
  const maxd = LINK_MAX_DISTANCE * dpr;
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (!n) continue;
    for (let j = i + 1; j < nodes.length; j += 1) {
      const m = nodes[j];
      if (!m) continue;
      const dx = n.x - m.x;
      const dy = n.y - m.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < maxd) {
        ctx.globalAlpha = (1 - d / maxd) * 0.45;
        ctx.strokeStyle = CONSTELLATION_LINK;
        ctx.lineWidth = 0.6 * dpr;
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(m.x, m.y);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 0.85;
  for (const n of nodes) {
    ctx.fillStyle = CONSTELLATION_NODE;
    ctx.beginPath();
    ctx.arc(n.x, n.y, NODE_RADIUS * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** True when the platform requests reduced motion. Safe when matchMedia is absent. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
