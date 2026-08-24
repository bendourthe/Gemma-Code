/**
 * v2.1.0 Phase 4 -- downselect images/video frames so a turn cannot OOM VRAM.
 */

import { pngPixelCount, validateImageBytes } from "./attachments.js";
import type { VisualTokenBudget } from "./vision.js";

export interface BudgetedImage {
  readonly bytes: Uint8Array;
  readonly mime: string;
}

export interface VisualBudgetResult {
  readonly images: BudgetedImage[];
  readonly notices: string[];
  readonly rejected: string[];
}

export function enforceVisualBudget(
  images: readonly BudgetedImage[],
  budget: VisualTokenBudget,
): VisualBudgetResult {
  const notices: string[] = [];
  const rejected: string[] = [];
  const kept: BudgetedImage[] = [];
  for (const image of images) {
    const verdict = validateImageBytes(image.bytes, image.mime);
    if (verdict.kind === "rejected") {
      rejected.push(verdict.reason ?? "rejected");
      continue;
    }
    const pixels = pngPixelCount(image.bytes);
    if (pixels !== null && pixels > budget.maxPixels) {
      notices.push(
        `Image ${pixels}px exceeds the ${budget.maxPixels}px visual-token budget and was skipped.`,
      );
      continue;
    }
    if (kept.length >= budget.maxImages) {
      notices.push(
        `Kept the first ${budget.maxImages} image(s); extra attachments were skipped to stay in VRAM budget.`,
      );
      continue;
    }
    kept.push(image);
  }
  return { images: kept, notices, rejected };
}

export function capVideoFrames(frameCount: number, budget: VisualTokenBudget): {
  readonly keep: number;
  readonly notice?: string;
} {
  const keep = Math.min(frameCount, budget.maxVideoFrames);
  if (frameCount > budget.maxVideoFrames) {
    return {
      keep,
      notice: `Sampled ${keep} of ${frameCount} video frames (max ${budget.maxVideoFrames}).`,
    };
  }
  return { keep };
}
