/**
 * v2.1.0 Phase 4 -- catalog vision capability + visual-token budget defaults.
 *
 * `vision: true` is the chat-attachment gate. It is not implied by every
 * `modalities` row that lists `image` (OCR / diffusion / SAM2 are image
 * consumers, not VLMs). Omitted `vision` on an LLM with `image` in
 * modalities still counts as vision-capable so Gemma 12B keeps working.
 */

export interface VisualTokenBudget {
  readonly maxImages: number;
  readonly maxPixels: number;
  readonly maxVideoFrames: number;
  readonly maxVideoSeconds: number;
}

export const DEFAULT_VISUAL_TOKEN_BUDGET: VisualTokenBudget = {
  maxImages: 1,
  maxPixels: 1024 * 1024,
  maxVideoFrames: 8,
  maxVideoSeconds: 8,
};

export interface VisionSource {
  readonly id?: string;
  readonly type?: string;
  readonly vision?: boolean;
  readonly modalities?: readonly string[];
  readonly visualTokenBudget?: Partial<VisualTokenBudget>;
}

export function modelAcceptsVision(model: VisionSource | undefined): boolean {
  if (!model) return false;
  if (model.vision === false) return false;
  if (model.vision === true) return true;
  if (model.type && NON_CHAT_VISION_TYPES.has(model.type)) return false;
  return Boolean(model.modalities?.includes("image"));
}

const NON_CHAT_VISION_TYPES = new Set([
  "image",
  "video",
  "audio",
  "document",
  "controlnet",
  "vae",
  "embed",
]);

export function resolveVisualTokenBudget(model: VisionSource | undefined): VisualTokenBudget {
  const over = model?.visualTokenBudget ?? {};
  return {
    maxImages: over.maxImages ?? DEFAULT_VISUAL_TOKEN_BUDGET.maxImages,
    maxPixels: over.maxPixels ?? DEFAULT_VISUAL_TOKEN_BUDGET.maxPixels,
    maxVideoFrames: over.maxVideoFrames ?? DEFAULT_VISUAL_TOKEN_BUDGET.maxVideoFrames,
    maxVideoSeconds: over.maxVideoSeconds ?? DEFAULT_VISUAL_TOKEN_BUDGET.maxVideoSeconds,
  };
}

/** Guidance when a non-vision model would otherwise receive image bytes. */
export function nonVisionAttachmentGuidance(altDisplayName?: string): string {
  if (altDisplayName) {
    return `This model cannot see images. Switch to ${altDisplayName} in the picker, or send the text only.`;
  }
  return "This model cannot see images. Install a vision-capable model from Settings > Models, or send the text only.";
}
