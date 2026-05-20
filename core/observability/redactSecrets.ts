/**
 * v1.1.0 Phase 4.4 -- shared secret-redaction utility.
 *
 * Consolidates the secret patterns historically maintained inside
 * `src/observability/TraceFile.ts` so the same scrubber can gate both
 * trace writes AND memory-row writes (closes agentmemory A7 from the
 * v1.1.0 comparison). The function is intentionally string-in / string-
 * out so it can be applied at any boundary: SQLite insert, JSONL append,
 * telemetry payload, panel render.
 *
 * Patterns covered:
 *   - AWS access keys (`AKIA...`, `ASIA...`, `AGPA...`, `AROA...`)
 *   - GitHub PATs (`ghp_...`, `gho_...`, `ghu_...`, `ghs_...`,
 *     `ghr_...`, `github_pat_...`)
 *   - Slack tokens (`xoxa-`, `xoxb-`, `xoxc-`, `xoxe-`, `xoxo-`,
 *     `xoxp-`, `xoxr-`, `xoxs-`)
 *   - JSON Web Tokens (`eyJ<header>.<payload>.<signature>`)
 *   - SSH / PEM private-key headers (`-----BEGIN ... PRIVATE KEY-----`
 *     ... `-----END ... PRIVATE KEY-----`)
 *   - Generic env-style secret values (`NAME=<base64-ish>`)
 *
 * The function is conservative: it only replaces matches; everything
 * else is passed through verbatim. Empty / null inputs round-trip
 * unchanged so callers can apply it unconditionally.
 */

export const REDACTED = "<redacted>";

const PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  // AWS access keys (20 chars, prefix-anchored).
  { name: "aws-access-key", re: /\b(?:AKIA|ASIA|AGPA|AROA|AIDA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g },
  // GitHub PATs (classic + fine-grained).
  { name: "github-pat-classic", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: "github-pat-fine-grained", re: /\bgithub_pat_[A-Za-z0-9_]{82,}\b/g },
  // Slack tokens (Slack docs list 8 prefixes; min length 32 chars after prefix).
  { name: "slack-token", re: /\bxox[abcepors]-[A-Za-z0-9-]{10,}\b/g },
  // JSON Web Tokens (three base64url segments separated by `.`). The first
  // segment must begin with `eyJ` (the base64url-encoded `{"` prefix).
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // PEM-style private-key blocks (single-line and multi-line).
  {
    name: "pem-private-key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  // Env-style assignments where the value looks high-entropy (>= 16 chars
  // of base64 / hex). Replaces the value only; keeps the name.
  {
    name: "env-secret",
    re: /\b([A-Z][A-Z0-9_]{2,})=([A-Za-z0-9+/=_-]{16,})\b/g,
  },
];

/**
 * Replace every secret pattern in `text` with `<redacted>`. Returns the
 * input unchanged when no patterns match. Env-style assignments keep
 * the variable name (e.g. `OPENAI_API_KEY=<redacted>` rather than
 * `<redacted>`) so the log line remains diagnostically useful.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { name, re } of PATTERNS) {
    if (name === "env-secret") {
      out = out.replace(re, (_, varName: string) => `${varName}=${REDACTED}`);
    } else {
      out = out.replace(re, REDACTED);
    }
  }
  return out;
}

/**
 * Diagnostic helper: returns the list of pattern names that fired
 * against `text`. Used by tests and the audit CLI to surface which
 * categories of secrets are being scrubbed.
 */
export function detectSecretCategories(text: string): readonly string[] {
  if (!text) return [];
  const hits: string[] = [];
  for (const { name, re } of PATTERNS) {
    // Clone the regex so .test() does not leak global-state advance.
    const clone = new RegExp(re.source, re.flags);
    if (clone.test(text)) hits.push(name);
  }
  return hits;
}
