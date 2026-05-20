/**
 * v1.1.0 Phase 5.2 -- BM25 English stop-word list.
 *
 * Source: a conservative subset of the NLTK English stop-word list, trimmed
 * to high-frequency function words that contribute nothing to BM25 ranking.
 * Intentionally small (~120 entries) so unusual but meaningful tokens
 * ("python", "vector", "memory", named entities) are retained.
 *
 * The list is exported as a frozen `Set<string>` for O(1) membership checks
 * during tokenization. The default tokenizer that consumes it is in
 * `Bm25Index.ts`; callers that want their own tokenization rules can read
 * `STOPWORDS` directly.
 */

const _STOPWORDS: ReadonlyArray<string> = [
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "don",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
];

export const STOPWORDS: ReadonlySet<string> = new Set(_STOPWORDS);

/**
 * Default tokenizer used by `Bm25Index`. Case-folds, splits on non-alnum
 * characters, drops stop-words and single-character tokens. Exposed so
 * tests can assert tokenization independent of indexing.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  for (const tok of lower.split(/[^a-z0-9]+/u)) {
    if (tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    out.push(tok);
  }
  return out;
}
