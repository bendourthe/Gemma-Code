import { describe, it, expect } from "vitest";
import {
  shingles,
  jaccard,
  normalizeBody,
  findSimilarPairs,
} from "../../../../core/skills/SkillSimilarity.js";
import type { Skill } from "../../../../core/skills/SkillCatalog.js";

const HASH = "0".repeat(64);

function skill(id: string, body: string): Skill {
  return {
    id,
    displayName: id,
    category: "test",
    path: `/skills/${id}/SKILL.md`,
    provenance: { source: "builtin", contentHash: HASH },
    frontmatter: {},
    body,
  };
}

describe("shingles", () => {
  it("produces overlapping k-character shingles", () => {
    const set = shingles("abcdef", 5);
    expect(set).toEqual(new Set(["abcde", "bcdef"]));
  });

  it("lowercases and collapses whitespace before shingling", () => {
    const set = shingles("AB   CD", 3);
    expect(set.has("ab ")).toBe(true);
    expect(set.has(" cd")).toBe(true);
  });

  it("returns a single whole-string shingle when shorter than k", () => {
    expect(shingles("abc", 5)).toEqual(new Set(["abc"]));
  });

  it("returns an empty set for empty input", () => {
    expect(shingles("", 5).size).toBe(0);
    expect(shingles("   ", 5).size).toBe(0);
  });
});

describe("jaccard", () => {
  it("returns 1.0 for identical sets", () => {
    const a = shingles("the quick brown fox", 5);
    expect(jaccard(a, new Set(a))).toBe(1);
  });

  it("returns 0.0 for disjoint sets", () => {
    expect(jaccard(new Set(["aaaaa"]), new Set(["bbbbb"]))).toBe(0);
  });

  it("returns 0 when both sets are empty", () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it("computes a fractional overlap", () => {
    // {a,b,c} vs {b,c,d}: intersection 2, union 4 -> 0.5
    expect(jaccard(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]))).toBe(0.5);
  });
});

describe("normalizeBody", () => {
  it("strips fenced code blocks and collapses whitespace", () => {
    const body = "# Title\n\nSome   text.\n\n```ts\nconst x = 1;\n```\n\nMore text.";
    const out = normalizeBody(body);
    expect(out).not.toContain("const x");
    expect(out).toContain("some text.");
    expect(out).not.toMatch(/\s{2,}/);
  });

  it("strips a leading frontmatter block if present", () => {
    const body = "---\nname: foo\n---\nActual body here.";
    expect(normalizeBody(body)).toBe("actual body here.");
  });
});

describe("findSimilarPairs", () => {
  it("scores identical bodies at 1.0", () => {
    const body = "This is a reasonably long skill body that shingles cleanly.";
    const pairs = findSimilarPairs([skill("a", body), skill("b", body)]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.a).toBe("a");
    expect(pairs[0]!.b).toBe("b");
    expect(pairs[0]!.score).toBe(1);
  });

  it("ignores disjoint bodies (score below threshold)", () => {
    const pairs = findSimilarPairs([
      skill("a", "The quick brown fox jumps over the lazy dog repeatedly."),
      skill("b", "Zebras quietly munch jungle vines while xylophones play softly."),
    ]);
    expect(pairs).toEqual([]);
  });

  it("flags a near-duplicate pair above the 0.85 threshold", () => {
    // A long base body with a tiny appended delta keeps the shingle overlap
    // well above 0.85 (a small addition to a large body barely moves Jaccard).
    const base =
      "This skill performs a comprehensive audit of the entire skill catalog and " +
      "produces a structured five-section report covering token budget pressure, " +
      "over-long descriptions, name collisions, content-similarity duplicates, and " +
      "skills with no recent usage evidence found in the session replay logs.";
    const nearDup = base + " End.";
    const pairs = findSimilarPairs([skill("a", base), skill("b", nearDup)], 0.85);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    expect(pairs[0]!.score).toBeGreaterThanOrEqual(0.85);
  });

  it("sorts results by descending score", () => {
    const base = "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.";
    const close = base + " nu";
    const far = base.slice(0, 30) + " completely different tail content here entirely.";
    const pairs = findSimilarPairs(
      [skill("a", base), skill("b", close), skill("c", far)],
      0.1,
    );
    for (let i = 1; i < pairs.length; i += 1) {
      expect(pairs[i - 1]!.score).toBeGreaterThanOrEqual(pairs[i]!.score);
    }
  });
});
