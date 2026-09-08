/**
 * v2.4.8 follow-up (2026-09-07) -- how far along a generation is, in words.
 *
 * Operator report: a Wan video sat on "Crafting..." for fifteen minutes with
 * nothing to say whether it was working or wedged. A job now reports its
 * sampling steps, so the bar and the estimate below it are measured rather
 * than guessed: the remaining time comes from this run's own step rate. The
 * up-front figure (shown before the first step lands) is a cost model, and it
 * is replaced by the measured one as soon as there is a rate to measure.
 */

import type { ChatMessage } from "./types";

type Progress = NonNullable<ChatMessage["progress"]>;

/**
 * Rough cost model, calibrated on the operator's RTX 3080 Ti laptop from two
 * real runs: RealVisXL at 1024x1024 x 14 steps took 64 s end to end, and Wan
 * 2.1 T2V 1.3B at 854x480 x 96 frames x 30 steps ran past 17 minutes. It is a
 * starting figure for one GPU class, not a promise -- the live estimate from
 * the measured step rate supersedes it within a step or two.
 */
export const MODEL_LOAD_SECONDS = 25;
export const IMAGE_SECONDS_PER_STEP_MP = 2.6;
export const VIDEO_SECONDS_PER_STEP_MP_FRAME = 0.9;

export interface GenerationCost {
  readonly pillar: "image" | "video";
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  /** Video only: total frames sampled. */
  readonly frames?: number;
}

/** Seconds a job of this shape usually takes, model load included. */
export function estimateGenerationSeconds(cost: GenerationCost): number {
  const megapixels = Math.max(0, (cost.width * cost.height) / 1_000_000);
  const steps = Math.max(0, cost.steps);
  const sampling =
    cost.pillar === "video"
      ? steps * megapixels * Math.max(1, cost.frames ?? 1) * VIDEO_SECONDS_PER_STEP_MP_FRAME
      : steps * megapixels * IMAGE_SECONDS_PER_STEP_MP;
  return Math.round(MODEL_LOAD_SECONDS + sampling);
}

/** "45 s" / "3 min" / "1 h 5 min". Rounded, never false-precise. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${Math.max(1, total)} s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "0:07" / "4:12" / "1:02:30" -- a running clock, always exact. */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const s = String(total % 60).padStart(2, "0");
  const m = Math.floor(total / 60);
  if (m < 60) return `${m}:${s}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}`;
}

/** Fraction 0-1 of the current phase, or null when nothing is countable. */
export function phaseFraction(progress: Progress | undefined): number | null {
  if (!progress) return null;
  if (progress.total > 0 && progress.step > 0) {
    return Math.min(1, progress.step / progress.total);
  }
  if (progress.totalBytes && progress.totalBytes > 0) {
    const loaded = progress.loadedBytes ?? 0;
    return Math.min(1, Math.max(0, loaded / progress.totalBytes));
  }
  return null;
}

/**
 * Seconds left, measured from this run's own step rate.
 *
 * `elapsedSeconds` is time spent sampling (not the whole job), so the rate is
 * this model on this GPU at these settings. Null until a step has completed.
 */
export function stepEtaSeconds(
  progress: Progress | undefined,
  elapsedSeconds: number,
): number | null {
  if (!progress || progress.total <= 0 || progress.step <= 0) return null;
  if (elapsedSeconds <= 0) return null;
  const done = Math.min(progress.step, progress.total);
  if (done >= progress.total) return 0;
  const perStep = elapsedSeconds / done;
  return Math.round(perStep * (progress.total - done));
}

export interface ProgressLines {
  /** Step or load position plus the time left, when either is known. */
  readonly primary: string | null;
  /** The running clock, with the up-front estimate while nothing is measured. */
  readonly secondary: string | null;
}

/**
 * The two lines under the bar.
 *
 * `samplingElapsed` counts only the generating phase; `totalElapsed` counts
 * the whole job (what the clock shows).
 */
export function progressLines(input: {
  readonly progress: Progress | undefined;
  readonly totalElapsed: number | null;
  readonly samplingElapsed: number | null;
  readonly estimateSeconds?: number | undefined;
}): ProgressLines {
  const { progress, totalElapsed, samplingElapsed, estimateSeconds } = input;
  const parts: string[] = [];
  let measured = false;

  if (progress && progress.total > 0 && progress.step > 0) {
    parts.push(`Step ${Math.min(progress.step, progress.total)} of ${progress.total}`);
    const eta = stepEtaSeconds(progress, samplingElapsed ?? 0);
    if (eta !== null && eta > 0) {
      parts.push(`about ${formatDuration(eta)} left`);
      measured = true;
    } else if (eta === 0) {
      parts.push("finishing");
      measured = true;
    }
  } else if (progress?.stage === "loading" && typeof progress.etaS === "number" && progress.etaS > 0) {
    parts.push(`about ${formatDuration(progress.etaS)} left`);
    measured = true;
  }

  const clock: string[] = [];
  if (totalElapsed !== null) clock.push(`${formatElapsed(totalElapsed)} elapsed`);
  // The cost model is only worth showing while nothing has been measured yet.
  if (!measured && estimateSeconds && estimateSeconds > 0) {
    clock.push(`usually about ${formatDuration(estimateSeconds)}`);
  }

  return {
    primary: parts.length > 0 ? parts.join(" · ") : null,
    secondary: clock.length > 0 ? clock.join(" · ") : null,
  };
}
