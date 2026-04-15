import { describe, it, expect, vi, beforeEach } from "vitest";
import { RelevanceScorer } from "../../../src/chat/RelevanceScorer.js";
import type { ScoringContext } from "../../../src/chat/RelevanceScorer.js";
import type { PromptSection } from "../../../src/chat/PromptBuilder.types.js";

function makeSection(overrides: Partial<PromptSection> = {}): PromptSection {
  return {
    id: "test-section",
    content: "Some test content about testing",
    priority: 10,
    alwaysInclude: false,
    estimatedTokens: 50,
    ...overrides,
  };
}

function makeContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    currentTimestamp: Date.now(),
    ...overrides,
  };
}

describe("RelevanceScorer", () => {
  let scorer: RelevanceScorer;

  beforeEach(() => {
    scorer = new RelevanceScorer(null); // no embedder
  });

  // -------------------------------------------------------------------------
  // Static priority scoring
  // -------------------------------------------------------------------------

  describe("_scoreStaticPriority()", () => {
    it("maps priority 0 to 1.0", () => {
      expect(scorer._scoreStaticPriority(0)).toBe(1.0);
    });

    it("maps priority 50 to 0.5", () => {
      expect(scorer._scoreStaticPriority(50)).toBe(0.5);
    });

    it("maps priority 100 to 0.0", () => {
      expect(scorer._scoreStaticPriority(100)).toBe(0.0);
    });

    it("clamps negative priority to 1.0", () => {
      expect(scorer._scoreStaticPriority(-10)).toBe(1.0);
    });

    it("clamps priority > 100 to 0.0", () => {
      expect(scorer._scoreStaticPriority(150)).toBe(0.0);
    });
  });

  // -------------------------------------------------------------------------
  // Temporal recency scoring
  // -------------------------------------------------------------------------

  describe("_scoreTemporalRecency()", () => {
    const now = Date.now();

    it("returns 1.0 for sections relevant within the last hour", () => {
      const score = scorer._scoreTemporalRecency(now - 30 * 60_000, now);
      expect(score).toBe(1.0);
    });

    it("returns 0.8 for sections relevant within the last 6 hours", () => {
      const score = scorer._scoreTemporalRecency(now - 3 * 3600_000, now);
      expect(score).toBe(0.8);
    });

    it("returns 0.5 for sections relevant within the last 24 hours", () => {
      const score = scorer._scoreTemporalRecency(now - 12 * 3600_000, now);
      expect(score).toBe(0.5);
    });

    it("returns 0.2 for sections older than 24 hours", () => {
      const score = scorer._scoreTemporalRecency(now - 48 * 3600_000, now);
      expect(score).toBe(0.2);
    });

    it("returns 0.5 when lastRelevantAt is undefined", () => {
      const score = scorer._scoreTemporalRecency(undefined, now);
      expect(score).toBe(0.5);
    });
  });

  // -------------------------------------------------------------------------
  // User mention scoring
  // -------------------------------------------------------------------------

  describe("_scoreUserMention()", () => {
    it("returns 1.0 when all keywords match", () => {
      const section = makeSection({ id: "testing", content: "Testing framework setup" });
      const score = scorer._scoreUserMention(section, "testing framework");
      expect(score).toBe(1.0);
    });

    it("returns 0.0 when no keywords match", () => {
      const section = makeSection({ id: "auth", content: "Authentication module" });
      const score = scorer._scoreUserMention(section, "database migration");
      expect(score).toBe(0.0);
    });

    it("returns partial score for partial matches", () => {
      const section = makeSection({ content: "Testing and authentication" });
      const score = scorer._scoreUserMention(section, "testing database setup");
      // "testing" matches, "database" and "setup" don't
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it("returns 0.0 when no user message provided", () => {
      const section = makeSection();
      const score = scorer._scoreUserMention(section, undefined);
      expect(score).toBe(0.0);
    });

    it("filters out short words (3 chars or fewer)", () => {
      const section = makeSection({ content: "A big test" });
      // "a" and "big" are filtered (<=3 chars), only "test" (4 chars) remains
      // Actually "big" is 3 chars, filtered. Only "test" passes.
      const score = scorer._scoreUserMention(section, "a big test");
      expect(score).toBe(1.0); // "test" is the only keyword and it matches
    });
  });

  // -------------------------------------------------------------------------
  // Combined scoring
  // -------------------------------------------------------------------------

  describe("scoreSection()", () => {
    it("returns a value between 0 and 1", async () => {
      const section = makeSection();
      const context = makeContext();
      const score = await scorer.scoreSection(section, context);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it("gives higher score to lower priority sections", async () => {
      const highPriority = makeSection({ priority: 5 });
      const lowPriority = makeSection({ priority: 50 });
      const context = makeContext();

      const highScore = await scorer.scoreSection(highPriority, context);
      const lowScore = await scorer.scoreSection(lowPriority, context);
      expect(highScore).toBeGreaterThan(lowScore);
    });

    it("gives higher score when user message matches content", async () => {
      const matchingSection = makeSection({ content: "Database migration guide" });
      const nonMatchingSection = makeSection({ content: "Authentication setup" });
      const context = makeContext({ recentUserMessage: "database migration" });

      const matchScore = await scorer.scoreSection(matchingSection, context);
      const noMatchScore = await scorer.scoreSection(nonMatchingSection, context);
      expect(matchScore).toBeGreaterThan(noMatchScore);
    });

    it("defaults semantic similarity to 0.5 without embedder", async () => {
      // With null embedder, semantic similarity contributes 0.3 * 0.5 = 0.15
      const section = makeSection({ priority: 0 });
      const context = makeContext({ currentQuery: "anything" });
      const score = await scorer.scoreSection(section, context);
      // staticPriority = 1.0, temporal = 0.5, semantic = 0.5, userMention = 0.0
      // Expected: 0.3*1.0 + 0.2*0.5 + 0.3*0.5 + 0.2*0.0 = 0.3 + 0.1 + 0.15 + 0 = 0.55
      expect(score).toBeCloseTo(0.55, 1);
    });
  });

  // -------------------------------------------------------------------------
  // Embedding caching
  // -------------------------------------------------------------------------

  describe("embedding caching", () => {
    it("caches section embeddings to avoid duplicate calls", async () => {
      const embedFn = vi.fn().mockResolvedValue([1, 0, 0]);
      const mockEmbedder = {
        embed: embedFn,
        embedBatch: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(true),
      };

      const embScorer = new RelevanceScorer(mockEmbedder as never);
      const section = makeSection();
      const context = makeContext({ currentQuery: "test query" });

      // Score twice with the same section content.
      await embScorer.scoreSection(section, context);
      await embScorer.scoreSection(section, context);

      // embed should be called once for the query + once for the section = 2 calls.
      // The second scoreSection reuses the cached section embedding.
      expect(embedFn).toHaveBeenCalledTimes(2);
    });

    it("clearCache resets the embedding cache", async () => {
      const embedFn = vi.fn().mockResolvedValue([1, 0, 0]);
      const mockEmbedder = {
        embed: embedFn,
        embedBatch: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(true),
      };

      const embScorer = new RelevanceScorer(mockEmbedder as never);
      const section = makeSection();
      const context = makeContext({ currentQuery: "test query" });

      await embScorer.scoreSection(section, context);
      embScorer.clearCache();
      await embScorer.scoreSection(section, context);

      // After clear, both query and section embeddings are recomputed.
      expect(embedFn).toHaveBeenCalledTimes(4);
    });
  });

  // -------------------------------------------------------------------------
  // Custom weights
  // -------------------------------------------------------------------------

  describe("custom weights", () => {
    it("respects custom weight distribution", async () => {
      // All weight on static priority.
      const priorityOnlyScorer = new RelevanceScorer(null, {
        staticPriority: 1.0,
        temporalRecency: 0.0,
        semanticSimilarity: 0.0,
        userMention: 0.0,
      });

      const section = makeSection({ priority: 0 });
      const context = makeContext();
      const score = await priorityOnlyScorer.scoreSection(section, context);
      expect(score).toBeCloseTo(1.0, 2);
    });
  });
});
