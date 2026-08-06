/**
 * v1.15.0 Phase 6 (Issue 5) -- video-generation intent inference.
 *
 * The video analogue of `modules/image/intent.ts`: the chat composer produces
 * (prompt text + attached images) and this pure function picks the endpoint:
 *
 *   - no image -> text2video
 *   - >=1 image -> image2video (the first attachment animates)
 *
 * The old per-model `mode` field and the mode `<select>` are gone; intent is
 * attachment-inferred. As on the image side the protocol requires a non-empty
 * prompt, so an image-only request gets a sensible default.
 */

import type { VideoMode } from "./videoClient";

export interface VideoComposerInput {
  readonly text: string;
  readonly attachments: readonly string[];
}

export interface VideoIntent {
  readonly mode: VideoMode;
  readonly prompt: string;
  readonly sourceImage?: string;
}

const DEFAULT_PROMPTS: Record<VideoMode, string> = {
  text2video: "Generate a video",
  image2video: "Animate this image",
};

export function inferVideoIntent(input: VideoComposerInput): VideoIntent {
  const text = input.text.trim();
  const source = input.attachments[0];
  const mode: VideoMode = source ? "image2video" : "text2video";
  return {
    mode,
    prompt: text || DEFAULT_PROMPTS[mode],
    ...(source ? { sourceImage: source } : {}),
  };
}
