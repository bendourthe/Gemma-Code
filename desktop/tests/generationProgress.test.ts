import { describe, expect, it } from "vitest";
import {
  estimateGenerationSeconds,
  formatDuration,
  formatElapsed,
  phaseFraction,
  progressLines,
  stepEtaSeconds,
} from "../src/shared/chat/generationProgress";

// v2.4.8 follow-up (2026-09-07): a Wan video sat on a rotating word for
// fifteen minutes with no bar, no clock and no estimate. These are the numbers
// behind the block that replaced it.
describe("generationProgress", () => {
  it("formats durations without false precision", () => {
    expect(formatDuration(0)).toBe("1 s");
    expect(formatDuration(12.4)).toBe("12 s");
    expect(formatDuration(59)).toBe("59 s");
    expect(formatDuration(150)).toBe("3 min");
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(3900)).toBe("1 h 5 min");
  });

  it("formats the running clock exactly", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7)).toBe("0:07");
    expect(formatElapsed(252)).toBe("4:12");
    expect(formatElapsed(3750)).toBe("1:02:30");
  });

  it("reads the fraction from steps first, then from bytes", () => {
    expect(phaseFraction({ step: 12, total: 30 })).toBeCloseTo(0.4);
    expect(
      phaseFraction({ step: 0, total: 0, loadedBytes: 2000, totalBytes: 5000 }),
    ).toBeCloseTo(0.4);
    expect(phaseFraction({ step: 0, total: 0 })).toBeNull();
    expect(phaseFraction(undefined)).toBeNull();
    // A runtime that overshoots never pushes the bar past full.
    expect(phaseFraction({ step: 31, total: 30 })).toBe(1);
  });

  it("estimates the remaining time from this run's own step rate", () => {
    // 10 of 30 steps in 100 s -> 10 s a step -> 200 s left.
    expect(stepEtaSeconds({ step: 10, total: 30 }, 100)).toBe(200);
    expect(stepEtaSeconds({ step: 30, total: 30 }, 100)).toBe(0);
    expect(stepEtaSeconds({ step: 0, total: 30 }, 100)).toBeNull();
    expect(stepEtaSeconds({ step: 10, total: 30 }, 0)).toBeNull();
    expect(stepEtaSeconds(undefined, 100)).toBeNull();
  });

  it("prefers the measured estimate and drops the guess once it has one", () => {
    const measured = progressLines({
      progress: { step: 10, total: 30, stage: "generating" },
      totalElapsed: 130,
      samplingElapsed: 100,
      estimateSeconds: 1080,
    });
    expect(measured.primary).toBe("Step 10 of 30 · about 3 min left");
    // The cost model is gone: there is a real rate now.
    expect(measured.secondary).toBe("2:10 elapsed");

    const guessed = progressLines({
      progress: { step: 0, total: 0, stage: "loading" },
      totalElapsed: 8,
      samplingElapsed: null,
      estimateSeconds: 1080,
    });
    expect(guessed.primary).toBeNull();
    expect(guessed.secondary).toBe("0:08 elapsed · usually about 18 min");
  });

  it("uses the runtime's own byte estimate while weights load", () => {
    const lines = progressLines({
      progress: { step: 0, total: 0, stage: "loading", etaS: 12.4 },
      totalElapsed: 5,
      samplingElapsed: null,
      estimateSeconds: 60,
    });
    expect(lines.primary).toBe("about 12 s left");
    expect(lines.secondary).toBe("0:05 elapsed");
  });

  it("says finishing on the last step rather than 0 s left", () => {
    const lines = progressLines({
      progress: { step: 30, total: 30 },
      totalElapsed: 300,
      samplingElapsed: 300,
    });
    expect(lines.primary).toBe("Step 30 of 30 · finishing");
  });

  it("costs a job from its own shape, calibrated on measured runs", () => {
    // Measured: RealVisXL 1024x1024 x 14 steps took 64 s end to end.
    const image = estimateGenerationSeconds({
      pillar: "image",
      width: 1024,
      height: 1024,
      steps: 14,
    });
    expect(image).toBeGreaterThan(50);
    expect(image).toBeLessThan(80);
    // Measured: Wan 854x480 x 96 frames x 30 steps ran about 20 minutes.
    const video = estimateGenerationSeconds({
      pillar: "video",
      width: 854,
      height: 480,
      steps: 30,
      frames: 96,
    });
    expect(video).toBeGreaterThan(900);
    expect(video).toBeLessThan(1500);
    // A video is far dearer than an image of the same frame size.
    expect(video).toBeGreaterThan(image * 5);
  });
});
