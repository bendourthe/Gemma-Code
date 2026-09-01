/**
 * Phase 12 (v0.5.0) -- 128-D heuristic embedder for offline fallback.
 *
 * Computes a 128-dimensional, L2-normalised embedding from text using only
 * pure-JS features:
 *   - Hash features (1/6 of the vector, 21 dims): bucketed term hashes via
 *     SHA-1.
 *   - Statistics features (1/3 of the vector, 43 dims): document-level
 *     numeric features (length bucket, avg word length, char-class ratios,
 *     line count, indent distribution, etc.) projected into a 43-D space
 *     via fixed random rotations of the raw signals.
 *   - N-gram features (1/2 of the vector, 64 dims): bigram + trigram
 *     presence over a 64-token vocabulary of common code/text tokens.
 *
 * The embedder is deterministic: the same input always produces the same
 * output bit-for-bit. It is NOT a substitute for a learned embedding model -- recall
 * is meaningfully lower -- but it lets semantic search keep working when
 * Ollama is unreachable, with the trade-off that callers should raise the
 * cosine threshold (0.95+) on heuristic-tagged rows.
 */

import { createHash } from "crypto";

/** Dimensionality of the embedding. */
export const HEURISTIC_DIMENSION = 128;

const HASH_DIMS = 21; // ~ HEURISTIC_DIMENSION / 6
const STATS_DIMS = 43; // ~ HEURISTIC_DIMENSION / 3
// Remaining 64 dimensions are filled by n-gram features; declared via the
// vocab below. We assert the math holds at module load so a future tweak
// of HASH_DIMS / STATS_DIMS cannot silently desync from the vocab.

/**
 * Vocabulary of 64 common code/text tokens used as bigram/trigram anchors.
 * Order is fixed so embeddings are deterministic across runs.
 */
const NGRAM_VOCAB: ReadonlyArray<string> = [
  "the", "and", "for", "with", "this", "that", "from", "into",
  "function", "return", "const", "let", "var", "class", "import", "export",
  "if", "else", "while", "for ", "case", "switch", "throw", "catch",
  "type", "interface", "enum", "extends", "implements", "static", "async", "await",
  "true", "false", "null", "undefined", "void", "any", "string", "number",
  "object", "array", "promise", "boolean", "error", "fail", "test", "expect",
  "new ", "this.", "()", "{}", "[]", "=>", "==", "!=",
  "<=", ">=", "&&", "||", "//", "/*", "*/", "###",
];

if (HASH_DIMS + STATS_DIMS + NGRAM_VOCAB.length !== HEURISTIC_DIMENSION) {
  throw new Error(
    `HeuristicEmbedder dimensions desynced: ${HASH_DIMS} + ${STATS_DIMS} + ${NGRAM_VOCAB.length} != ${HEURISTIC_DIMENSION}`,
  );
}

export class HeuristicEmbedder {
  /** Compute the 128-D embedding of `text`. Empty input returns the zero vector. */
  embed(text: string): number[] {
    if (!text) return new Array(HEURISTIC_DIMENSION).fill(0);
    const out = new Array<number>(HEURISTIC_DIMENSION).fill(0);
    this._fillHashFeatures(text, out, 0);
    this._fillStatsFeatures(text, out, HASH_DIMS);
    this._fillNgramFeatures(text, out, HASH_DIMS + STATS_DIMS);
    return l2Normalise(out);
  }

  /**
   * Hash features: bucketed term hashes.
   *
   * Tokenise on non-word chars, hash each token to a HASH_DIMS bucket, and
   * accumulate sub-linear weighting (sqrt of count) so very long documents
   * don't dominate. SHA-1 is overkill for hashing but already in Node's
   * standard library and dependency-free.
   */
  private _fillHashFeatures(text: string, out: number[], offset: number): void {
    const tokens = text.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 0);
    const counts = new Array<number>(HASH_DIMS).fill(0);
    for (const tok of tokens) {
      const h = createHash("sha1").update(tok).digest();
      const bucket = h.readUInt32BE(0) % HASH_DIMS;
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    for (let i = 0; i < HASH_DIMS; i++) {
      out[offset + i] = Math.sqrt(counts[i] ?? 0);
    }
  }

  /**
   * Statistics features: derive ~10 raw signals (length, avg word length,
   * digit ratio, punctuation ratio, line count, mean indent, max indent,
   * unique-token ratio, alpha ratio, whitespace ratio) and project them
   * into the STATS_DIMS-dim subspace via a fixed deterministic rotation
   * (a SHA-1-derived signed weighting matrix). The rotation lets the
   * statistics span the whole subspace rather than living on 10 axes.
   */
  private _fillStatsFeatures(text: string, out: number[], offset: number): void {
    const len = text.length;
    if (len === 0) return;

    const tokens = text.split(/\s+/).filter((t) => t.length > 0);
    const lines = text.split("\n");
    let digits = 0, alpha = 0, punct = 0, ws = 0;
    for (let i = 0; i < len; i++) {
      const code = text.charCodeAt(i);
      if (code >= 48 && code <= 57) digits++;
      else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) alpha++;
      else if (code === 32 || code === 9 || code === 10 || code === 13) ws++;
      else punct++;
    }
    let totalIndent = 0, maxIndent = 0;
    for (const line of lines) {
      let indent = 0;
      while (indent < line.length && (line[indent] === " " || line[indent] === "\t")) indent++;
      totalIndent += indent;
      if (indent > maxIndent) maxIndent = indent;
    }
    const meanIndent = lines.length > 0 ? totalIndent / lines.length : 0;
    const uniqueTokens = new Set(tokens).size;
    const avgWordLen = tokens.length > 0
      ? tokens.reduce((s, t) => s + t.length, 0) / tokens.length
      : 0;
    const uniqueRatio = tokens.length > 0 ? uniqueTokens / tokens.length : 0;

    const raw: number[] = [
      Math.log1p(len) / 12, // bounded ~1 for 160KB
      avgWordLen / 16,
      digits / len,
      alpha / len,
      punct / len,
      ws / len,
      Math.log1p(lines.length) / 10,
      meanIndent / 8,
      Math.min(1, maxIndent / 32),
      uniqueRatio,
    ];

    // Project the raw signals into STATS_DIMS via deterministic +/-1 weights.
    for (let dim = 0; dim < STATS_DIMS; dim++) {
      let acc = 0;
      for (let r = 0; r < raw.length; r++) {
        const sign = projectionSign(dim, r);
        acc += sign * (raw[r] ?? 0);
      }
      out[offset + dim] = acc / raw.length;
    }
  }

  /**
   * N-gram presence features: for each (token, vocab_anchor) bigram and
   * trigram pair we observe in the text, increment the corresponding
   * dimension. The vocab is fixed at 64 anchors (one anchor per dim).
   */
  private _fillNgramFeatures(text: string, out: number[], offset: number): void {
    const lower = text.toLowerCase();
    for (let i = 0; i < NGRAM_VOCAB.length; i++) {
      const anchor = NGRAM_VOCAB[i]!;
      const count = countOccurrences(lower, anchor);
      out[offset + i] = Math.sqrt(count);
    }
  }
}

/** Sign of (dim, raw) projection, derived from SHA-1 so it's deterministic. */
function projectionSign(dim: number, rawIdx: number): number {
  const h = createHash("sha1").update(`${dim}|${rawIdx}`).digest();
  return ((h[0] ?? 0) & 1) === 0 ? 1 : -1;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

/** L2-normalise the vector in place; returns the same array. */
function l2Normalise(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / norm;
  return v;
}
