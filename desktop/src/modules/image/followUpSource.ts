/**
 * v2.4.2 Phase 3 -- turn the last usable PNG into source bytes the sidecar
 * already accepts (data URL or raw base64). Filesystem paths stay a last
 * resort for remounted sessions; the Python decoder opens existing files.
 */

export const FOLLOWUP_IMG2IMG_STRENGTH = 0.45;
/**
 * v2.4.4 Phase 3.2: raised from 0.7. Field screenshot 3 showed 0.7 returning
 * a picture indistinguishable from the source, and the restyle prompt already
 * pins composition, pose, and background, so a higher denoise changes the fur
 * without drifting to a different animal.
 */
export const RESTYLE_IMG2IMG_STRENGTH = 0.85;
export const SAM2_MODEL_ID = "sam2:hiera-tiny";
export const MISSING_RESTYLE_SOURCE_TEXT =
  "No previous image in this session to restyle. Generate or attach an image first.";

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

/**
 * v2.4.4 Phase 3.1 (T010) -- the restyle send decision, as data.
 *
 * Two cycles shipped a restyle that reprinted the source, and neither could
 * be diagnosed from the UI because the mode, the prompt, the strength, and
 * the source were each decided at a different point in a long submit handler.
 * Deciding them here makes the whole shape assertable in one place, and makes
 * "this was silently a txt2img of the original prompt" a test failure.
 */
export interface RestyleRequestPlan {
  readonly mode: "img2img";
  readonly prompt: string;
  readonly strength: number;
  readonly sourceImage: string;
}

export function planRestyleRequest(input: {
  readonly restylePrompt: string;
  readonly sourceImage: string | null | undefined;
}): RestyleRequestPlan | null {
  const source = input.sourceImage?.trim();
  // Fail closed: no source bytes means there is nothing to restyle, and a
  // txt2img fallback here is exactly what reprints a fresh subject.
  if (!source) return null;
  if (!input.restylePrompt.trim()) return null;
  return {
    mode: "img2img",
    prompt: input.restylePrompt,
    strength: RESTYLE_IMG2IMG_STRENGTH,
    sourceImage: source,
  };
}
