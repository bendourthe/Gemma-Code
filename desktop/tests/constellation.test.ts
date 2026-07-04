import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONSTELLATION_LINK,
  CONSTELLATION_NODE,
  type Ctx2D,
  clampDpr,
  computeNodeCount,
  createNodes,
  drawFrame,
  prefersReducedMotion,
  stepNodes,
} from "../src/components/constellation";

describe("computeNodeCount", () => {
  it("floors at 18 for narrow widths", () => {
    expect(computeNodeCount(100)).toBe(18);
    expect(computeNodeCount(0)).toBe(18);
  });

  it("caps at 46 for very wide viewports", () => {
    expect(computeNodeCount(5000)).toBe(46);
  });

  it("scales ~width/34 in between", () => {
    expect(computeNodeCount(912)).toBe(26);
    expect(computeNodeCount(34 * 40)).toBe(40);
  });
});

describe("clampDpr", () => {
  it("caps at 2", () => {
    expect(clampDpr(3)).toBe(2);
  });

  it("floors at 1", () => {
    expect(clampDpr(0.5)).toBe(1);
  });

  it("falls back to 1 for invalid values", () => {
    expect(clampDpr(Number.NaN)).toBe(1);
    expect(clampDpr(0)).toBe(1);
    expect(clampDpr(-4)).toBe(1);
  });

  it("passes valid fractional dpr through", () => {
    expect(clampDpr(1.5)).toBe(1.5);
  });
});

describe("createNodes", () => {
  it("creates the requested count with in-bounds positions and drift", () => {
    const seq = [0.1, 0.2, 0.75, 0.25, 0.9, 0.4];
    let i = 0;
    const rand = () => seq[i++ % seq.length] ?? 0;
    const nodes = createNodes(3, 200, 100, 2, rand);
    expect(nodes).toHaveLength(3);
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(200);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(100);
    }
    // vx = (rand - 0.5) * 0.16 * dpr; first node: (0.75-0.5)*0.16*2 = 0.08
    expect(nodes[0]!.vx).toBeCloseTo(0.08, 6);
  });

  it("defaults to Math.random when no rng is supplied", () => {
    const nodes = createNodes(5, 100, 100, 1);
    expect(nodes).toHaveLength(5);
  });
});

describe("stepNodes", () => {
  it("advances by velocity", () => {
    const nodes = [{ x: 10, y: 10, vx: 2, vy: -3 }];
    stepNodes(nodes, 100, 100);
    expect(nodes[0]!.x).toBe(12);
    expect(nodes[0]!.y).toBe(7);
  });

  it("bounces off the edges by flipping velocity", () => {
    const nodes = [{ x: -1, y: 50, vx: -2, vy: 1 }];
    stepNodes(nodes, 100, 100);
    expect(nodes[0]!.vx).toBe(2); // flipped positive on the left edge
    const right = [{ x: 101, y: 50, vx: 3, vy: 1 }];
    stepNodes(right, 100, 100);
    expect(right[0]!.vx).toBe(-3);
  });
});

describe("drawFrame", () => {
  function fakeCtx(): Ctx2D & { calls: Record<string, number> } {
    const calls: Record<string, number> = {};
    const bump = (k: string) => () => {
      calls[k] = (calls[k] ?? 0) + 1;
    };
    return {
      calls,
      globalAlpha: 1,
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      clearRect: bump("clearRect"),
      beginPath: bump("beginPath"),
      moveTo: bump("moveTo"),
      lineTo: bump("lineTo"),
      stroke: bump("stroke"),
      arc: bump("arc"),
      fill: bump("fill"),
    };
  }

  it("clears, links close nodes, and fills every node", () => {
    const ctx = fakeCtx();
    // Two nodes 10px apart (< maxd) -> one link; both drawn as dots.
    const nodes = [
      { x: 10, y: 10, vx: 0, vy: 0 },
      { x: 20, y: 10, vx: 0, vy: 0 },
    ];
    drawFrame(ctx, nodes, 100, 100, 1);
    expect(ctx.calls.clearRect).toBe(1);
    expect(ctx.calls.stroke).toBe(1); // one link
    expect(ctx.calls.fill).toBe(2); // two nodes
    expect(ctx.strokeStyle).toBe(CONSTELLATION_LINK);
    expect(ctx.fillStyle).toBe(CONSTELLATION_NODE);
  });

  it("draws no link when nodes are farther apart than maxd", () => {
    const ctx = fakeCtx();
    const nodes = [
      { x: 0, y: 0, vx: 0, vy: 0 },
      { x: 500, y: 500, vx: 0, vy: 0 },
    ];
    drawFrame(ctx, nodes, 600, 600, 1);
    expect(ctx.calls.stroke ?? 0).toBe(0);
    expect(ctx.calls.fill).toBe(2);
  });
});

describe("prefersReducedMotion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is true when the media query matches", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    expect(prefersReducedMotion()).toBe(true);
  });

  it("is false when the media query does not match", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    expect(prefersReducedMotion()).toBe(false);
  });
});
