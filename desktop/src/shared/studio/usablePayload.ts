/**
 * v2.2.4 Phase 4 -- reject empty or decorative studio completes before the
 * chat bubble mounts a grey rectangle.
 *
 * A complete event with no bytes, whitespace, or a 1x1 PNG is an error, not
 * a successful image. Catalog-test stubs that are valid base64 but not a PNG
 * still pass this gate; <img onError> remains the decode backstop.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isUsableImageBase64(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  const compact = trimmed.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return false;
  let bytes: Uint8Array;
  try {
    const stripped = compact.replace(/=+$/, "");
    const padded = stripped + "=".repeat((4 - (stripped.length % 4)) % 4);
    const bin = atob(padded);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  } catch {
    return false;
  }
  if (bytes.length === 0) return false;
  if (hasPngSignature(bytes)) {
    const size = pngIhdrSize(bytes);
    if (size && size.width <= 1 && size.height <= 1) return false;
  }
  return true;
}

export function isUsableVideoPath(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return false;
  return raw.trim().length > 0;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function pngIhdrSize(bytes: Uint8Array): { width: number; height: number } | null {
  // signature (8) + chunk length (4) + "IHDR" (4) + width (4) + height (4)
  if (bytes.length < 24) return null;
  const width = readU32(bytes, 16);
  const height = readU32(bytes, 20);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}
