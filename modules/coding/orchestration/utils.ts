/**
 * Shared utilities for the orchestration layer.
 */

/**
 * Extract a JSON value from LLM output that may contain markdown fences,
 * preamble text, or trailing explanations.
 *
 * Strategy order:
 * 1. Direct JSON.parse of the trimmed string.
 * 2. Extract from ```json ... ``` or ``` ... ``` fences.
 * 3. Find the first `[` to the last `]` (array) or first `{` to last `}` (object).
 * 4. Return null if all strategies fail.
 */
export function extractJsonFromLlmOutput(raw: string): unknown | null {
  const trimmed = raw.trim();

  // Strategy 1: Direct parse.
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to next strategy.
  }

  // Strategy 2: Fenced code blocks.
  const fencePattern = /```(?:json)?\s*\n?([\s\S]*?)```/;
  const fenceMatch = fencePattern.exec(trimmed);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Continue to next strategy.
    }
  }

  // Strategy 3: Greedy bracket matching.
  // Try array first, then object.
  const arrayResult = _extractBracketPair(trimmed, "[", "]");
  if (arrayResult !== null) return arrayResult;

  const objectResult = _extractBracketPair(trimmed, "{", "}");
  if (objectResult !== null) return objectResult;

  return null;
}

function _extractBracketPair(
  text: string,
  open: string,
  close: string,
): unknown | null {
  const first = text.indexOf(open);
  const last = text.lastIndexOf(close);
  if (first === -1 || last === -1 || last <= first) return null;

  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
}
