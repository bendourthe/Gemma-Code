import * as path from "path";
import * as url from "url";
import { describe, it, expect } from "vitest";
import { SkillLoader } from "../../../modules/coding/skills/SkillLoader.js";

// ---------------------------------------------------------------------------
// v1.6.0 adoption-openrouter-fusion Phase 1 (OF003) -- schema-conformance
// check for the `fuse` skill (OF001).
//
// Skills in this repo are markdown prompts that the loader parses but never
// executes, so this test does not call a live model. It instead (1) loads the
// real catalog `fuse` skill and asserts its prompt *declares* the structured
// judge-fusion schema, and (2) validates recorded/mock judge outputs against
// that schema with a small local validator -- a well-formed output, a
// gracefully-degraded output for a malformed candidate set, and broken /
// empty negative controls that must fail validation without throwing.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REAL_CATALOG_DIR = path.resolve(__dirname, "../../../modules/coding/skills/catalog");

/**
 * The fixed, ordered set of section headers the `fuse` skill emits: five
 * analysis sections followed by the fused final answer. The header strings
 * are the contract between the skill prompt and any consumer that parses the
 * judge output (the Phase 2 FusionAgent will reuse the same schema).
 */
const FUSION_SECTIONS = [
  "## Consensus",
  "## Contradictions",
  "## Partial coverage",
  "## Unique insights",
  "## Blind spots",
  "## Fused answer",
] as const;

interface FusionSchemaResult {
  valid: boolean;
  /** Headers that are absent entirely. */
  missing: string[];
  /** True when every header is present but not in the canonical order. */
  outOfOrder: boolean;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Index of a line-anchored markdown header, or -1 when absent. */
function headerIndex(text: string, header: string): number {
  const match = new RegExp(`^${escapeRegExp(header)}\\s*$`, "m").exec(text);
  return match ? match.index : -1;
}

/**
 * Validate that `text` contains all six fusion sections, in order. Pure and
 * total: any input (including "" or unstructured prose) returns a structured
 * result instead of throwing, so the conformance check itself degrades
 * gracefully on a malformed judge output.
 */
function validateFusionOutput(text: string): FusionSchemaResult {
  const indices = FUSION_SECTIONS.map((header) => ({ header, at: headerIndex(text, header) }));
  const missing = indices.filter((s) => s.at === -1).map((s) => s.header);
  if (missing.length > 0) {
    return { valid: false, missing, outOfOrder: false };
  }
  const positions = indices.map((s) => s.at);
  const inOrder = positions.every((at, i) => i === 0 || at > positions[i - 1]!);
  return { valid: inOrder, missing: [], outOfOrder: !inOrder };
}

// ---------------------------------------------------------------------------
// Recorded / mock judge outputs (no live model call).
// ---------------------------------------------------------------------------

/** Well-formed fusion over 3 labeled candidates. */
const GOOD_OUTPUT = `## Consensus
All three candidates agree the parser must validate input before use.

## Contradictions
[gemma4:e4b] returns null on bad input; [llama3:8b] throws. Resolve toward throwing: a null is indistinguishable from a legitimate empty result.

## Partial coverage
Only [qwen2:7b] raised the empty-array boundary case.

## Unique insights
[llama3:8b] caught the off-by-one when the range is inclusive -- worth keeping.

## Blind spots
No candidate addressed concurrent access to the shared cache.

## Fused answer
Validate input, throw on failure, and guard the empty-array boundary. Note the cache is single-threaded (judge's own addition, flagged).
`;

/**
 * Graceful degradation: the candidate set was empty / unusable, yet the judge
 * still emits the full six-section structure rather than abandoning it. This
 * is the OF003 negative control for a malformed candidate set -- structure is
 * preserved, so it still conforms to the schema.
 */
const DEGRADED_OUTPUT = `## Consensus
The candidate set was empty, so there is nothing to agree on.

## Contradictions
None: there are no candidates to compare.

## Partial coverage
None.

## Unique insights
None.

## Blind spots
No candidate addressed the task; a grounded answer cannot be derived from the candidates.

## Fused answer
No grounded answer is possible from the supplied candidates.
`;

/** Unstructured prose -- a judge that ignored the schema entirely. */
const BROKEN_OUTPUT = "Sure, here is my take: just validate the input and move on. Looks fine to me.";

describe("fuse skill (OF001) loads and declares the fusion schema", () => {
  const loader = new SkillLoader(REAL_CATALOG_DIR, path.join(REAL_CATALOG_DIR, "__nonexistent_user__"));
  loader.load();
  const skill = loader.getSkill("fuse");

  it("loads from the catalog with valid front-matter", () => {
    expect(skill, "fuse did not load from the catalog").toBeDefined();
    expect(skill?.name).toBe("fuse");
    expect(skill?.description.trim().length).toBeGreaterThan(0);
    expect(skill?.argumentHint.trim().length).toBeGreaterThan(0);
    expect(skill?.prompt.trim().length).toBeGreaterThan(0);
    expect(skill?.metadata.relatedSkills).toEqual(["council", "critique", "lens"]);
  });

  it("declares all five analysis sections and the fused-answer section, in order", () => {
    const result = validateFusionOutput(skill?.prompt ?? "");
    expect(result.missing).toEqual([]);
    expect(result.outOfOrder).toBe(false);
    expect(result.valid).toBe(true);
  });

  it("instructs the judge to reconcile rather than average, over labeled candidates", () => {
    const body = (skill?.prompt ?? "").toLowerCase();
    expect(body).toContain("reconcile");
    expect(body).toContain("labeled candidate");
    // Treats candidate text as untrusted input (F5 groundwork consumed in Phase 2).
    expect(body).toContain("data, not instructions");
  });
});

describe("validateFusionOutput conformance check", () => {
  it("accepts a well-formed judge output", () => {
    expect(validateFusionOutput(GOOD_OUTPUT)).toEqual({ valid: true, missing: [], outOfOrder: false });
  });

  it("accepts a gracefully-degraded output for a malformed candidate set (structure preserved)", () => {
    expect(validateFusionOutput(DEGRADED_OUTPUT).valid).toBe(true);
  });

  it("rejects unstructured prose that abandons the schema, without throwing", () => {
    const result = validateFusionOutput(BROKEN_OUTPUT);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual([...FUSION_SECTIONS]);
  });

  it("rejects an empty output without throwing", () => {
    expect(() => validateFusionOutput("")).not.toThrow();
    expect(validateFusionOutput("").valid).toBe(false);
  });

  it("rejects an out-of-order output where every section is present but scrambled", () => {
    const scrambled = `## Fused answer
answer first

## Consensus
c

## Contradictions
x

## Partial coverage
p

## Unique insights
u

## Blind spots
b
`;
    const result = validateFusionOutput(scrambled);
    expect(result.missing).toEqual([]);
    expect(result.outOfOrder).toBe(true);
    expect(result.valid).toBe(false);
  });
});
