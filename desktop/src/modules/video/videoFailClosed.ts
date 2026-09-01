/**
 * v2.4.2 Phase 4 -- a video turn that cannot produce a playable clip is an
 * error. Empty assistant content is only legal when a durable mediaRef exists.
 */

export const EMPTY_VIDEO_CLIP =
  "Generation failed: video generation completed without a playable clip.";

export const VIDEO_WEIGHTS_HINT = "Install the video model from Settings > Models.";

export function formatVideoFailure(raw: string): string {
  const trimmed = raw.trim();
  const body = trimmed.length > 0 ? trimmed : EMPTY_VIDEO_CLIP;
  const prefixed = /^generation failed:/i.test(body) ? body : `Generation failed: ${body}`;
  if (
    /weights? missing|not installed|weights unavailable/i.test(prefixed) &&
    !/settings > models/i.test(prefixed)
  ) {
    return `${prefixed} ${VIDEO_WEIGHTS_HINT}`;
  }
  return prefixed;
}

export function persistableAssistant(input: {
  readonly content?: string;
  readonly mediaRef?: string | null;
}): { content: string; mediaRef?: string } {
  const mediaRef = input.mediaRef?.trim();
  const content = (input.content ?? "").trim();
  if (mediaRef) {
    return { content, mediaRef };
  }
  return { content: content.length > 0 ? content : EMPTY_VIDEO_CLIP };
}
