/**
 * v2.0.0 Phase 1 -- classify a composer attachment so Chat can route
 * images to vision, audio to STT, and everything else to document parse.
 */

import { mimeFromDataUrl } from "./dataUrl";

export type AttachmentKind = "image" | "video" | "audio" | "document";

export function isAudioDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith("data:audio/");
}

export function classifyDataUrl(dataUrl: string): AttachmentKind {
  if (isAudioDataUrl(dataUrl)) return "audio";
  if (dataUrl.startsWith("data:image/")) return "image";
  if (dataUrl.startsWith("data:video/")) return "video";
  const mime = mimeFromDataUrl(dataUrl);
  if (mime?.startsWith("audio/")) return "audio";
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  return "document";
}

export function partitionAttachments(attachments: readonly string[]): {
  readonly images: readonly string[];
  readonly video: readonly string[];
  readonly audio: readonly string[];
  readonly documents: readonly string[];
} {
  const images: string[] = [];
  const video: string[] = [];
  const audio: string[] = [];
  const documents: string[] = [];
  for (const item of attachments) {
    const kind = classifyDataUrl(item);
    if (kind === "image") images.push(item);
    else if (kind === "video") video.push(item);
    else if (kind === "audio") audio.push(item);
    else documents.push(item);
  }
  return { images, video, audio, documents };
}
