/**
 * v2.0 DF-11 -- opt-in classifier for short imperatives.
 *
 * Abstains unless the text is a short, high-confidence shell-shaped command.
 * Never drops a permission tier: the proposed call still goes through
 * ConfirmationGate at its normal baseline. Off unless `enabled` is true.
 */

export interface RoutedCommand {
  readonly tool: "run_terminal";
  readonly parameters: { readonly command: string };
  readonly confidence: number;
}

const SHORT_MAX = 120;

const PATTERNS: readonly { readonly re: RegExp; readonly command: string }[] = [
  { re: /^(run|execute)\s+(the\s+)?tests?\b/i, command: "npm test" },
  { re: /^(run|execute)\s+(the\s+)?linter?\b/i, command: "npm run lint" },
  { re: /^(run|execute)\s+(the\s+)?build\b/i, command: "npm run build" },
  { re: /^git\s+status\b/i, command: "git status" },
];

export function classifyShortImperative(
  text: string,
  opts: { readonly enabled?: boolean } = {},
): RoutedCommand | null {
  if (opts.enabled !== true) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > SHORT_MAX) return null;
  if (trimmed.includes("\n")) return null;
  for (const row of PATTERNS) {
    if (row.re.test(trimmed)) {
      return {
        tool: "run_terminal",
        parameters: { command: row.command },
        confidence: 0.9,
      };
    }
  }
  return null;
}
