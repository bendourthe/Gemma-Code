/**
 * v2.1.0 Phase 4 -- parse "replace / remove / recolor the X" studio edits.
 */

export type ReplaceAction = "replace" | "remove" | "recolor";

export interface ReplaceIntent {
  readonly action: ReplaceAction;
  readonly object: string;
  readonly replacement?: string;
  readonly ambiguous: boolean;
}

const REPLACE_RE =
  /\b(replace|swap|change)\s+(?:the\s+|a\s+|an\s+)?(.+?)\s+with\s+(?:a\s+|an\s+|the\s+)?(.+)$/i;
const REMOVE_RE = /\b(remove|erase|delete)\s+(?:the\s+|a\s+|an\s+)?(.+)$/i;
const RECOLOR_RE =
  /\b(recolor|re-colour|recolour|paint)\s+(?:the\s+|a\s+|an\s+)?(.+?)\s+(?:to|as)\s+(.+)$/i;

const AMBIGUOUS = /\b(people|them|these|those|cars|dogs|cats|ones)\b/i;

export function parseReplaceIntent(text: string): ReplaceIntent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const replace = trimmed.match(REPLACE_RE);
  if (replace?.[2] && replace[3]) {
    const object = replace[2].trim();
    return {
      action: "replace",
      object,
      replacement: replace[3].trim(),
      ambiguous: AMBIGUOUS.test(object),
    };
  }
  const recolor = trimmed.match(RECOLOR_RE);
  if (recolor?.[2] && recolor[3]) {
    const object = recolor[2].trim();
    return {
      action: "recolor",
      object,
      replacement: recolor[3].trim(),
      ambiguous: AMBIGUOUS.test(object),
    };
  }
  const remove = trimmed.match(REMOVE_RE);
  if (remove?.[2]) {
    const object = remove[2].trim();
    return { action: "remove", object, ambiguous: AMBIGUOUS.test(object) };
  }
  return null;
}

export function inpaintPromptFor(intent: ReplaceIntent): string {
  if (intent.action === "remove") return `Remove the ${intent.object} and fill the area naturally`;
  if (intent.action === "recolor") {
    return `Recolor the ${intent.object} to ${intent.replacement ?? "the requested color"}`;
  }
  return `Replace the ${intent.object} with ${intent.replacement ?? "the requested object"}`;
}
