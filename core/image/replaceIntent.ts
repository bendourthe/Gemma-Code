/**
 * v2.1.0 Phase 4 -- parse "replace / remove / recolor the X" studio edits.
 * v2.4.2 Phase 3 -- "make that X <color|adj>" is a whole-image restyle (no SAM2).
 */

export type ReplaceAction = "replace" | "remove" | "recolor";
export type ReplaceScope = "object" | "image";

export interface ReplaceIntent {
  readonly action: ReplaceAction;
  readonly object: string;
  readonly replacement?: string;
  readonly ambiguous: boolean;
  readonly scope: ReplaceScope;
}

const REPLACE_RE =
  /\b(replace|swap|change)\s+(?:the\s+|a\s+|an\s+)?(.+?)\s+with\s+(?:a\s+|an\s+|the\s+)?(.+)$/i;
const REMOVE_RE = /\b(remove|erase|delete)\s+(?:the\s+|a\s+|an\s+)?(.+)$/i;
const RECOLOR_RE =
  /\b(recolor|re-colour|recolour|paint)\s+(?:the\s+|a\s+|an\s+)?(.+?)\s+(?:to|as)\s+(.+)$/i;
// v2.4.4 Phase 3.2: allow trailing sentence punctuation. "Make the puppy
// black." parsed as no intent at all, so the send fell through to a plain
// txt2img of the ORIGINAL prompt -- the exact reprint in field screenshot 3.
const MAKE_RESTYLE_RE =
  /\bmake\s+(?:that|the|this)\s+(.+?)\s+(black|white|red|blue|green|yellow|orange|purple|pink|brown|grey|gray|gold|silver|navy|teal|cyan|beige|cream|darker|brighter|dark|bright|night|snowy|vintage|cinematic|warm|cool|golden|moody)\s*[.!?]*\s*$/i;

const AMBIGUOUS = /\b(people|them|these|those|cars|dogs|cats|ones)\b/i;

function objectIntent(
  action: ReplaceAction,
  object: string,
  replacement?: string,
): ReplaceIntent {
  return {
    action,
    object,
    ...(replacement ? { replacement } : {}),
    ambiguous: AMBIGUOUS.test(object),
    scope: "object",
  };
}

export function parseReplaceIntent(text: string): ReplaceIntent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const replace = trimmed.match(REPLACE_RE);
  if (replace?.[2] && replace[3]) {
    return objectIntent("replace", replace[2].trim(), replace[3].trim());
  }
  const recolor = trimmed.match(RECOLOR_RE);
  if (recolor?.[2] && recolor[3]) {
    return objectIntent("recolor", recolor[2].trim(), recolor[3].trim());
  }
  const restyle = trimmed.match(MAKE_RESTYLE_RE);
  if (restyle?.[1] && restyle[2]) {
    const object = restyle[1].trim();
    return {
      action: "recolor",
      object,
      replacement: restyle[2].trim(),
      ambiguous: AMBIGUOUS.test(object),
      scope: "image",
    };
  }
  const remove = trimmed.match(REMOVE_RE);
  if (remove?.[2]) {
    return objectIntent("remove", remove[2].trim());
  }
  return null;
}

/** Object-local replace/remove/recolor may call SAM2. Whole-image restyles must not. */
export function usesSegment(intent: ReplaceIntent): boolean {
  return intent.scope === "object";
}

export function inpaintPromptFor(intent: ReplaceIntent): string {
  if (intent.action === "remove") return `Remove the ${intent.object} and fill the area naturally`;
  if (intent.action === "recolor") {
    return `Recolor the ${intent.object} to ${intent.replacement ?? "the requested color"}`;
  }
  return `Replace the ${intent.object} with ${intent.replacement ?? "the requested object"}`;
}

/** Whole-image restyle: keep composition, change color/fur. Never a new subject. */
export function restylePromptFor(intent: ReplaceIntent): string {
  const color = intent.replacement ?? "the requested color";
  return `Keep the same composition, pose, and background. Change the ${intent.object}'s fur and color to ${color}. Do not generate a different ${intent.object}.`;
}
