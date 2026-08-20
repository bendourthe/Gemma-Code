/**
 * v2.0.0 Phase 1 -- data-URL helpers for Chat vision / audio attachments.
 *
 * Ollama's `/api/chat` `images` array wants raw base64, not a `data:` URL.
 * The same strip is used before STT so the sidecar never has to guess.
 */

/** True when `value` is a `data:` URL (any MIME). */
export function isDataUrl(value: string): boolean {
  return value.startsWith("data:");
}

/**
 * Return the raw base64 payload of a data URL. Passes through strings that
 * are already raw base64 so callers can apply this unconditionally.
 */
export function stripDataUrlPrefix(value: string): string {
  const marker = "base64,";
  const index = value.indexOf(marker);
  return index >= 0 ? value.slice(index + marker.length) : value;
}

/** MIME type from a data URL (`image/png`, `audio/webm`, ...), or null. */
export function mimeFromDataUrl(value: string): string | null {
  if (!value.startsWith("data:")) return null;
  const semi = value.indexOf(";");
  const comma = value.indexOf(",");
  const end = semi >= 0 ? semi : comma;
  if (end < 5) return null;
  const mime = value.slice(5, end).trim().toLowerCase();
  return mime.length > 0 ? mime : null;
}
