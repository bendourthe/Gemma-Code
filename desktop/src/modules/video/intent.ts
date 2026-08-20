/**
 * v1.15.0 Phase 6 (Issue 5) -- video-generation intent inference.
 *
 * The video analogue of `modules/image/intent.ts`: the chat composer produces
 * (prompt text + attached images) and this pure function picks the endpoint:
 *
 *   - photo + audio, avatar enabled -> audio2video
 *   - no image -> text2video
 *   - >=1 image -> image2video (the first attachment animates)
 *
 * The old per-model `mode` field and the mode `<select>` are gone; intent is
 * attachment-inferred. As on the image side the protocol requires a non-empty
 * prompt, so an image-only request gets a sensible default.
 */

import { partitionAttachments } from "../../shared/chat";
import type { VideoMode } from "./videoClient";

export interface VideoComposerInput {
  readonly text: string;
  readonly attachments: readonly string[];
  /** When true, photo+audio routes to the talking-head mode. */
  readonly avatarEnabled?: boolean;
}

export interface VideoIntent {
  readonly mode: VideoMode;
  readonly prompt: string;
  readonly sourceImage?: string;
  readonly sourceAudio?: string;
  readonly blockedReason?: string;
}

const DEFAULT_PROMPTS: Record<VideoMode, string> = {
  text2video: "Generate a video",
  image2video: "Animate this image",
  audio2video: "Generate a talking-head video",
};

export function inferVideoIntent(input: VideoComposerInput): VideoIntent {
  const text = input.text.trim();
  const { images, audio } = partitionAttachments(input.attachments);
  const photo = images[0] ?? (audio.length === 0 ? input.attachments[0] : undefined);
  const track = audio[0];

  if (input.avatarEnabled && track && !photo) {
    return {
      mode: "audio2video",
      prompt: text || DEFAULT_PROMPTS.audio2video,
      sourceAudio: track,
      blockedReason: "Avatar mode needs a reference photo and an audio track.",
    };
  }

  if (input.avatarEnabled && photo && track) {
    return {
      mode: "audio2video",
      prompt: text || DEFAULT_PROMPTS.audio2video,
      sourceImage: photo,
      sourceAudio: track,
    };
  }

  const mode: VideoMode = photo ? "image2video" : "text2video";
  return {
    mode,
    prompt: text || DEFAULT_PROMPTS[mode],
    ...(photo ? { sourceImage: photo } : {}),
  };
}
