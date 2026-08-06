/**
 * v1.15.0 Phase 5 (Issue 5) -- image-generation intent inference.
 *
 * Replaces the four mode tabs: the chat composer produces (prompt text +
 * attached images + an optional painted mask), and this pure function maps that
 * to one of the four diffusion modes:
 *
 *   - no image                       -> txt2img
 *   - image + a painted mask         -> inpaint
 *   - image + "outpaint/extend" text -> outpaint
 *   - image (otherwise)              -> img2img
 *
 * The sidecar protocol requires a non-empty prompt, so an image-only request
 * (the user dropped an image and typed nothing) gets a sensible mode-specific
 * default prompt rather than a placeholder.
 */

import type { ImageMode } from "./diffusionClient";

export type OutpaintDirection = "left" | "right" | "top" | "bottom";

export interface ComposerInput {
  readonly text: string;
  readonly attachments: readonly string[];
  /** A painted inpaint mask (data URL), when the user marked a region. */
  readonly mask?: string | null;
}

export interface ImageIntent {
  readonly mode: ImageMode;
  readonly prompt: string;
  readonly sourceImage?: string;
  readonly mask?: string;
  readonly direction?: OutpaintDirection;
  readonly pixels?: number;
}

const OUTPAINT_RE = /\b(outpaint|extend|expand|widen|zoom\s*out)\b/i;

/** Mode-specific default prompt for an image-only request (protocol needs >=1 char). */
const DEFAULT_PROMPTS: Record<ImageMode, string> = {
  txt2img: "Generate an image",
  img2img: "Recreate this image",
  inpaint: "Fill the masked area to match the image",
  outpaint: "Extend this image naturally",
};

const DEFAULT_OUTPAINT_PIXELS = 128;

export function inferImageIntent(input: ComposerInput): ImageIntent {
  const text = input.text.trim();
  const hasImage = input.attachments.length > 0;
  const source = hasImage ? input.attachments[0] : undefined;

  let mode: ImageMode;
  if (!hasImage) mode = "txt2img";
  else if (input.mask) mode = "inpaint";
  else if (OUTPAINT_RE.test(text)) mode = "outpaint";
  else mode = "img2img";

  const prompt = text || DEFAULT_PROMPTS[mode];

  return {
    mode,
    prompt,
    ...(source ? { sourceImage: source } : {}),
    ...(mode === "inpaint" && input.mask ? { mask: input.mask } : {}),
    ...(mode === "outpaint"
      ? { direction: outpaintDirection(text), pixels: DEFAULT_OUTPAINT_PIXELS }
      : {}),
  };
}

function outpaintDirection(text: string): OutpaintDirection {
  const t = text.toLowerCase();
  if (/\bleft\b/.test(t)) return "left";
  if (/\bright\b/.test(t)) return "right";
  if (/\b(top|up)\b/.test(t)) return "top";
  if (/\b(bottom|down)\b/.test(t)) return "bottom";
  return "right";
}
