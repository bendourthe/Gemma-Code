import { describe, expect, it } from "vitest";
import {
  ORB_MAX_DPR,
  ORB_SIZE_HERO,
  ORB_SIZE_INLINE,
  clampOrbDpr,
  createOrbDots,
  drawOrbFrame,
  orbDotCount,
  orbPixelSize,
  stepOrbDots,
  type OrbCtx2D,
} from "../src/components/agentState/orbEngine";

describe("orbEngine", () => {
  it("sizes the hero and inline presets", () => {
    expect(orbPixelSize("hero")).toBe(ORB_SIZE_HERO);
    expect(orbPixelSize("inline")).toBe(ORB_SIZE_INLINE);
    expect(ORB_SIZE_HERO).toBe(64);
    expect(ORB_SIZE_INLINE).toBe(20);
    expect(orbDotCount("hero")).toBeGreaterThan(orbDotCount("inline"));
  });

  it("caps device-pixel-ratio at 2", () => {
    expect(clampOrbDpr(1)).toBe(1);
    expect(clampOrbDpr(3)).toBe(ORB_MAX_DPR);
    expect(clampOrbDpr(0)).toBe(1);
    expect(clampOrbDpr(Number.NaN)).toBe(1);
  });

  it("steps idle and working into distinct geometries", () => {
    const idle = createOrbDots(8, () => 0.5);
    const working = createOrbDots(8, () => 0.5);
    stepOrbDots(idle, "idle", 1);
    stepOrbDots(working, "working", 1);
    expect(idle[0]?.angle).not.toBe(working[0]?.angle);
    expect(idle[0]?.radius).not.toBe(working[0]?.radius);
  });

  it("gives each mapped state a distinct first-dot radius after one second", () => {
    const states = [
      "idle",
      "working",
      "searching",
      "solving",
      "listening",
      "composing",
      "shaping",
    ] as const;
    const radii = states.map((state) => {
      const dots = createOrbDots(8, () => 0.25);
      stepOrbDots(dots, state, 1);
      return dots[0]?.radius ?? 0;
    });
    expect(new Set(radii).size).toBe(states.length);
  });

  it("draws dots through the canvas seam", () => {
    const ops: string[] = [];
    const ctx: OrbCtx2D = {
      globalAlpha: 1,
      fillStyle: "",
      clearRect: () => ops.push("clear"),
      beginPath: () => ops.push("begin"),
      arc: () => ops.push("arc"),
      fill: () => ops.push("fill"),
    };
    const dots = createOrbDots(4, () => 0);
    stepOrbDots(dots, "composing", 0.5);
    drawOrbFrame(ctx, dots, 64, 1, "#22d3ee", "composing", 0.5);
    drawOrbFrame(ctx, dots, 64, 1, "#8a92a6", "idle", 0);
    drawOrbFrame(ctx, dots, 64, 1, "#22d3ee", "searching", 0.2);
    expect(ops[0]).toBe("clear");
    expect(ops.filter((op) => op === "arc").length).toBeGreaterThanOrEqual(4);
    expect(ctx.globalAlpha).toBe(1);
  });
});
