/**
 * v0.8.0 Phase 2 (item G1) -- prompt-injection scanner.
 *
 * Catches the most common indirect-prompt-injection patterns at memory
 * boundaries: when an agent saves text into `MemoryStore.save()` (cross-
 * session SQL memory) and when `MemoryFiles` reads `Memory.md` / `Context.md`
 * back into a prompt. The patterns are deliberately conservative -- we
 * tolerate plenty of false positives because (a) blocking a legitimate
 * "ignore previous instructions" sentence in a code comment costs one
 * commit message, while (b) accepting a real injection silently can leak
 * tools the user did not intend to run.
 *
 * Pattern sources:
 *   - `agent/prompt_builder.py:_scan_context_content` (hermes-agent)
 *   - `tools/memory_tool.py:_MEMORY_THREAT_PATTERNS` (hermes-agent)
 *
 * Scan return: `{ ok, findings }`. Callers decide whether to throw, redact,
 * or log -- see the boundary wirings in `MemoryStore` and `MemoryFiles`.
 */

export type FindingKind =
  | "injection-pattern"
  | "system-tag"
  | "code-exec-call"
  | "large-base64"
  | "invisible-unicode";

export interface Finding {
  readonly kind: FindingKind;
  readonly pattern: string;
  readonly excerpt: string;
  /** UTF-16 code-unit index of the match start. */
  readonly index: number;
}

export interface ScanResult {
  readonly ok: boolean;
  readonly findings: readonly Finding[];
}

// ---------------------------------------------------------------------------
// Pattern table
// ---------------------------------------------------------------------------

interface PatternRow {
  readonly kind: FindingKind;
  readonly label: string;
  readonly re: RegExp;
}

const INJECTION_PATTERNS: readonly PatternRow[] = [
  {
    kind: "injection-pattern",
    label: "ignore previous instructions",
    re: /\bignore\s+(?:all\s+|the\s+|your\s+)?previous\s+(?:instructions?|context|prompts?)\b/i,
  },
  {
    kind: "injection-pattern",
    label: "disregard the above",
    re: /\bdisregard\s+(?:the\s+|all\s+)?(?:above|previous|prior)\b/i,
  },
  {
    kind: "injection-pattern",
    label: "you are now",
    re: /\byou\s+are\s+now\s+(?:a|an|the|in\b)/i,
  },
  {
    kind: "injection-pattern",
    label: "forget what you were told",
    re: /\bforget\s+(?:everything|all|what)\s+(?:you|was|were)\b/i,
  },
  {
    kind: "system-tag",
    label: "<system> outside our delimiters",
    re: /<\/?system\b[^>]*>/i,
  },
  {
    kind: "code-exec-call",
    label: "eval(",
    re: /\beval\s*\(/,
  },
  {
    kind: "code-exec-call",
    label: "process.exit",
    re: /\bprocess\s*\.\s*exit\s*\(/,
  },
];

/**
 * Codepoints we never tolerate in memory content. Zero-width and
 * bidirectional formatting chars are common steganography in LLM
 * injection attacks because the human eye never sees them.
 *
 * Ranges:
 *   U+200B - U+200F   zero-width space + zero-width joiner + LTR/RTL marks
 *   U+202A - U+202E   bidi explicit formatting overrides
 *   U+E0000 - U+E007F tag characters (encoded as surrogate pair pairs)
 */
const INVISIBLE_UNICODE_RE = /[​-‏‪-‮]|\uDB40[\uDC00-\uDDFF]/;

/** Match a base64-ish blob (length >= 4 KB) that is not just code text. */
const LARGE_BASE64_RE = /(?:[A-Za-z0-9+/=]){4096,}/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan `text` for prompt-injection patterns + invisible-unicode +
 * suspiciously large base64 blobs. Returns the full list of matches so
 * callers can log everything that fired before deciding to throw or
 * redact.
 */
export function scan(text: string): ScanResult {
  if (!text) return { ok: true, findings: [] };

  const findings: Finding[] = [];

  for (const row of INJECTION_PATTERNS) {
    const m = row.re.exec(text);
    if (m) {
      findings.push({
        kind: row.kind,
        pattern: row.label,
        excerpt: excerptAround(text, m.index, m[0]?.length ?? 0),
        index: m.index,
      });
    }
  }

  const inv = INVISIBLE_UNICODE_RE.exec(text);
  if (inv) {
    findings.push({
      kind: "invisible-unicode",
      pattern: "invisible-unicode codepoint",
      excerpt: excerptAround(text, inv.index, inv[0]?.length ?? 0),
      index: inv.index,
    });
  }

  const b64 = LARGE_BASE64_RE.exec(text);
  if (b64) {
    findings.push({
      kind: "large-base64",
      pattern: "base64 blob >= 4 KB",
      excerpt: `[base64 blob, ${b64[0]!.length} chars omitted]`,
      index: b64.index,
    });
  }

  return { ok: findings.length === 0, findings };
}

/**
 * Strip invisible-unicode codepoints from `text`. Used by the read-path
 * fail-open mode so legacy memory content stays readable without
 * harboring zero-width injection payloads.
 */
export function redactInvisibleUnicode(text: string): string {
  if (!text) return text;
  return text
    .replace(/[​-‏‪-‮]/g, "")
    .replace(/\uDB40[\uDC00-\uDDFF]/g, "");
}

/**
 * Build a short error message summarising the findings. Useful for
 * thrown errors at the write boundary so the user can see which pattern
 * tripped without spelunking the logger.
 */
export function summarize(findings: readonly Finding[]): string {
  if (findings.length === 0) return "(no findings)";
  const head = findings.slice(0, 3).map((f) => `${f.kind}: ${f.pattern}`).join("; ");
  return findings.length > 3 ? `${head}; +${findings.length - 3} more` : head;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function excerptAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 16);
  const end = Math.min(text.length, index + len + 16);
  return text.slice(start, end);
}
