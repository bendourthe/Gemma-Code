/**
 * v1.3.0 Phase 4 (adoption-skill-cleaner T011) -- content-similarity detector.
 *
 * Implements insight I-08 from
 * `docs/versions/v1/v1.3.0/comparison-skill-cleaner.md`: surface near-duplicate
 * skills whose names differ but whose bodies overlap above a configurable
 * Jaccard threshold. The `SkillAuditor` (T013) consumes `findSimilarPairs` to
 * populate the `duplicates.bySimilarity` report.
 *
 * The comparison runs over the normalised Markdown body (code blocks and
 * frontmatter stripped, whitespace collapsed) rather than the one-line
 * description, so two skills with identical bodies but different descriptions
 * still register as near-duplicates.
 *
 * Cost: for a ~230-skill catalog this is O(N^2) ~= 26,000 normalized-body
 * comparisons -- single-digit milliseconds, no indexing needed.
 *
 * v1.4.0 Phase 8 (gap T013.P3.D, CLOSED not-a-cost-driver): the MinHash / LSH
 * pre-filter was to be added "if the full-catalog benchmark shows similarity as
 * a cost driver". At the current catalog size the exact all-pairs Jaccard pass
 * is negligible (O(N^2) over a few hundred items), so the pre-filter is not
 * warranted and is not added. The trigger condition is a materially larger
 * catalog (roughly an order of magnitude); reopen with a fresh benchmark then.
 */

import type { Skill } from "./SkillCatalog.js";

/**
 * Normalise a Markdown skill body for similarity comparison: strip any leading
 * frontmatter block, remove fenced/indented code blocks (which are often
 * boilerplate and would inflate similarity), lowercase, and collapse all
 * whitespace runs to a single space. Returns a trimmed single-line string.
 */
export function normalizeBody(body: string): string {
  let text = body;
  // Drop a leading `---\n ... \n---` frontmatter block if one survived into the body.
  text = text.replace(/^﻿?\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  // Strip fenced code blocks (``` ... ``` or ~~~ ... ~~~).
  text = text.replace(/(^|\n)\s*(```|~~~)[\s\S]*?\2[ \t]*(?=\n|$)/g, " ");
  // Strip inline code spans.
  text = text.replace(/`[^`\n]*`/g, " ");
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Return the set of `k`-character shingles over `text`. The input is first
 * lowercased and whitespace-collapsed to single spaces. Inputs shorter than
 * `k` characters yield a single shingle (the whole string) when non-empty, or
 * an empty set when empty.
 */
export function shingles(text: string, k = 5): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const out = new Set<string>();
  if (normalized.length === 0) return out;
  if (normalized.length <= k) {
    out.add(normalized);
    return out;
  }
  for (let i = 0; i + k <= normalized.length; i += 1) {
    out.add(normalized.slice(i, i + k));
  }
  return out;
}

/**
 * Jaccard similarity `|a ∩ b| / |a ∪ b|`. Returns `0` when both sets are empty
 * (vacuously "no overlap to report") and `0` when exactly one is empty.
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  // Iterate the smaller set for the membership test.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const shingle of small) {
    if (large.has(shingle)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface SimilarPair {
  a: string;
  b: string;
  score: number;
}

/**
 * Return every pair of skill IDs whose normalised-body Jaccard similarity is at
 * least `threshold` (default 0.85), sorted by descending score. Each skill's
 * shingle set is computed once and reused across the O(N^2) comparison.
 */
export function findSimilarPairs(
  skills: ReadonlyArray<Skill>,
  threshold = 0.85,
): SimilarPair[] {
  const sets = skills.map((s) => shingles(normalizeBody(s.body)));
  const pairs: SimilarPair[] = [];
  for (let i = 0; i < skills.length; i += 1) {
    for (let j = i + 1; j < skills.length; j += 1) {
      const score = jaccard(sets[i]!, sets[j]!);
      if (score >= threshold) {
        pairs.push({ a: skills[i]!.id, b: skills[j]!.id, score });
      }
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  return pairs;
}
