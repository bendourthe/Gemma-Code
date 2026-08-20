/**
 * v2.0.0 Phase 1 -- Chat affordance gating from catalog `modalities`.
 *
 * Image attach for vision-chat is enabled only when the selected model
 * declares `image`. Audio attach (transcribe-then-chat) is available for
 * any text model; the modalities field only changes the tooltip copy.
 * Native audio-token reasoning is out of scope until a fitting local
 * model exists (known-gap).
 */

export type ChatModality = "text" | "image" | "audio";

export interface ModalitySource {
  readonly id?: string;
  readonly modalities?: readonly string[];
}

export function modelHasModality(
  model: ModalitySource | undefined,
  modality: ChatModality,
): boolean {
  return Boolean(model?.modalities?.includes(modality));
}

/** Vision-chat image attach: on only when the catalog lists `image`. */
export function imageAttachmentAffordance(model: ModalitySource | undefined): {
  readonly enabled: boolean;
  readonly tooltip: string;
} {
  if (modelHasModality(model, "image")) {
    return {
      enabled: true,
      tooltip: "Attach an image for the selected vision model. Bytes stay on this machine.",
    };
  }
  return {
    enabled: false,
    tooltip:
      "This model cannot see images. Choose a vision-capable model from Settings > Models, or attach a PDF / Office document to parse it as text.",
  };
}

/**
 * Transcribe-then-chat is available for any text model. Copy changes when
 * the selected model lists `audio` (native audio tokens -- not yet used).
 */
export function audioAttachmentCopy(model: ModalitySource | undefined): string {
  if (modelHasModality(model, "audio")) {
    return "Attach or record audio. Native audio-token reasoning is not wired yet; the clip is transcribed locally first.";
  }
  return "Attach or record audio. It is transcribed on-device, then sent as labelled text.";
}

export const AUDIO_ACCEPT = ["audio/*", ".wav", ".mp3", ".webm", ".ogg", ".m4a", ".flac"].join(",");

/**
 * Chat composer accept list. Documents always; images only when vision is
 * enabled; audio always (STT bridge). Image Studio must not use this.
 */
export function chatComposerAccept(opts: { allowImages: boolean; allowAudio: boolean }): string {
  const parts = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx",
    ".pptx",
    ".xlsx",
  ];
  if (opts.allowImages) parts.push("image/*");
  if (opts.allowAudio) parts.push(...AUDIO_ACCEPT.split(","));
  return parts.join(",");
}
