/**
 * v2.4.2 Phase 3 -- turn the last usable PNG into source bytes the sidecar
 * already accepts (data URL or raw base64). Filesystem paths stay a last
 * resort for remounted sessions; the Python decoder opens existing files.
 */

export const FOLLOWUP_IMG2IMG_STRENGTH = 0.45;
export const SAM2_MODEL_ID = "sam2:hiera-tiny";

export function pngToDataUrl(pngBase64: string): string {
  const trimmed = pngBase64.trim();
  if (trimmed.toLowerCase().startsWith("data:")) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

export function stripToRawImageBytes(source: string): string {
  const comma = source.indexOf(",");
  return comma >= 0 ? source.slice(comma + 1) : source;
}

export function resolveFollowUpSourceImage(input: {
  readonly attachment?: string | null;
  readonly lastPngBase64?: string | null;
  readonly lastOutputRef?: string | null;
}): string | null {
  const attached = input.attachment?.trim();
  if (attached) {
    return attached.toLowerCase().startsWith("data:") || attached.includes(",")
      ? attached
      : pngToDataUrl(attached);
  }
  const png = input.lastPngBase64?.trim();
  if (png) return pngToDataUrl(png);
  const ref = input.lastOutputRef?.trim();
  if (!ref) return null;
  return ref;
}
