/**
 * Near-miss probes for grep_codebase (v1.19.1 Phase 2.3). vscode-free helper
 * used by the extension handler (and tests) when an exact search returns
 * nothing.
 */

export interface NearMissMatch {
  readonly file: string;
  readonly line: number;
  readonly content: string;
}

const MAX_PROBES = 5;

/** First alphanumeric token after stripping regex metacharacters, or null. */
export function nearMissToken(pattern: string): string | null {
  const stripped = pattern.replace(/[^\w]+/g, " ").trim();
  if (stripped.length < 2) return null;
  const token = stripped.split(/\s+/)[0];
  if (!token || token.length < 2) return null;
  return token;
}

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function takeNearMisses(
  matches: readonly NearMissMatch[],
  limit: number = MAX_PROBES,
): NearMissMatch[] {
  return matches.slice(0, limit);
}
