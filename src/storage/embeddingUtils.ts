/**
 * Shared utilities for embedding serialization, cosine similarity, and FTS5
 * query sanitization. Consolidates implementations previously duplicated across
 * MemoryStore, EpisodicMemory, RelevanceScorer, and ChatHistoryStore.
 *
 * Cosine convention: `cosineSimilarity` returns the raw cosine in `[-1, 1]`.
 * Callers that want a non-negative similarity score should call
 * `cosineSimilarityNormalized`, which maps the raw cosine into `[0, 1]`.
 */

/** Serialize an embedding vector to a Float64-backed Buffer for SQLite BLOB storage. */
export function serializeEmbedding(vec: readonly number[]): Buffer {
  return Buffer.from(new Float64Array(vec).buffer);
}

/** Deserialize a Float64-backed Buffer back into a number[] vector. */
export function deserializeEmbedding(buf: Buffer): number[] {
  const arr = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  return Array.from(arr);
}

/** Deserialize directly to Float32 for faster cosine math (accepts loss of precision). */
export function deserializeEmbeddingF32(buf: Buffer): Float32Array {
  const f64 = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  return Float32Array.from(f64);
}

/**
 * Raw cosine similarity in `[-1, 1]`. Returns 0 for empty / mismatched vectors.
 * Accepts any array-like numeric input (number[], Float32Array, Float64Array).
 */
export function cosineSimilarity(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Cosine similarity normalized to `[0, 1]`. Equivalent to
 * `(cosineSimilarity(a, b) + 1) / 2`. Returns 0.5 for empty / mismatched
 * vectors, matching the prior RelevanceScorer behavior so the prompt scoring
 * pipeline does not regress.
 */
export function cosineSimilarityNormalized(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number {
  if (a.length !== b.length || a.length === 0) return 0.5;
  const raw = cosineSimilarity(a, b);
  // When both norms collapse to 0, cosineSimilarity returns 0; preserve the
  // historical neutral score of 0.5 in that case.
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (Math.sqrt(normA) * Math.sqrt(normB) === 0) return 0.5;
  return (raw + 1) / 2;
}

/**
 * Sanitize a free-text query for safe inclusion in an FTS5 MATCH clause.
 * Strips FTS5 operators and bool keywords, then quotes each remaining word
 * so the query matches each token literally (no operator interpretation).
 */
export function sanitizeFtsQuery(query: string): string {
  const cleaned = query
    .replace(/[*"(){}[\]^~]/g, "")
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, "")
    .trim();
  if (!cleaned) return "";
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.map((w) => `"${w}"`).join(" ");
}
