/**
 * v2.1.0 Phase 4 -- Chat attachment validation at the boundary.
 *
 * Rejects malformed or unsupported payloads before bytes reach a model.
 */

export type ChatAttachmentKind = "image" | "video" | "audio" | "document" | "rejected";

export interface AttachmentVerdict {
  readonly kind: ChatAttachmentKind;
  readonly reason?: string;
}

const IMAGE_MAGIC = [
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46] },
];

export function kindFromMime(mime: string | undefined): Exclude<ChatAttachmentKind, "rejected"> {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

export function validateImageBytes(bytes: Uint8Array, declaredMime?: string): AttachmentVerdict {
  if (bytes.length < 8) {
    return { kind: "rejected", reason: "Attachment is empty or truncated." };
  }
  const matched = IMAGE_MAGIC.find((entry) =>
    entry.bytes.every((b, i) => bytes[i] === b),
  );
  if (!matched) {
    return { kind: "rejected", reason: "Unsupported or malformed image. Use PNG, JPEG, WebP, or GIF." };
  }
  if (declaredMime && declaredMime.startsWith("image/") && declaredMime !== "image/*") {
    const declared = declaredMime.toLowerCase();
    if (declared !== matched.mime && !(declared === "image/jpg" && matched.mime === "image/jpeg")) {
      return { kind: "rejected", reason: `Declared type ${declaredMime} does not match the file bytes.` };
    }
  }
  return { kind: "image" };
}

export function pngPixelCount(bytes: Uint8Array): number | null {
  if (bytes.length < 24) return null;
  const png = IMAGE_MAGIC[0];
  if (!png || !png.bytes.every((b, i) => bytes[i] === b)) return null;
  const width = readU32(bytes, 16);
  const height = readU32(bytes, 20);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  return width * height;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}
