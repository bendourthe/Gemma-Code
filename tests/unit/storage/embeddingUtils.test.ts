import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  cosineSimilarityNormalized,
  deserializeEmbedding,
  deserializeEmbeddingF32,
  sanitizeFtsQuery,
  serializeEmbedding,
} from "../../../src/storage/embeddingUtils.js";

describe("embeddingUtils", () => {
  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    });

    it("returns -1 for opposite vectors", () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
    });

    it("returns 0 for orthogonal vectors", () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    });

    it("returns 0 for empty or mismatched vectors", () => {
      expect(cosineSimilarity([], [])).toBe(0);
      expect(cosineSimilarity([1, 2], [1])).toBe(0);
    });

    it("returns 0 when either vector has zero norm", () => {
      expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });

    it("accepts Float32Array and Float64Array", () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float64Array([1, 2, 3]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
    });
  });

  describe("cosineSimilarityNormalized", () => {
    it("maps identical vectors to 1", () => {
      expect(cosineSimilarityNormalized([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    });

    it("maps opposite vectors to 0", () => {
      expect(cosineSimilarityNormalized([1, 0], [-1, 0])).toBeCloseTo(0, 6);
    });

    it("maps orthogonal vectors to 0.5", () => {
      expect(cosineSimilarityNormalized([1, 0], [0, 1])).toBeCloseTo(0.5, 6);
    });

    it("returns 0.5 for empty / mismatched / zero-norm vectors (preserves prior scorer behavior)", () => {
      expect(cosineSimilarityNormalized([], [])).toBe(0.5);
      expect(cosineSimilarityNormalized([1], [1, 2])).toBe(0.5);
      expect(cosineSimilarityNormalized([0, 0, 0], [1, 2, 3])).toBe(0.5);
    });
  });

  describe("serializeEmbedding / deserializeEmbedding", () => {
    it("round-trips a vector through Float64 buffer storage", () => {
      const original = [0.1, 0.5, -1.25, 3.14159];
      const buf = serializeEmbedding(original);
      const restored = deserializeEmbedding(buf);
      expect(restored).toHaveLength(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(restored[i]).toBeCloseTo(original[i]!, 6);
      }
    });

    it("deserializes to Float32 with acceptable precision loss", () => {
      const original = [0.1, 0.5, -1.25];
      const buf = serializeEmbedding(original);
      const f32 = deserializeEmbeddingF32(buf);
      expect(f32).toBeInstanceOf(Float32Array);
      expect(f32.length).toBe(3);
      expect(f32[0]).toBeCloseTo(0.1, 5);
    });
  });

  describe("sanitizeFtsQuery", () => {
    it("quotes each word for literal matching", () => {
      expect(sanitizeFtsQuery("hello world")).toBe('"hello" "world"');
    });

    it("strips FTS5 operator characters", () => {
      expect(sanitizeFtsQuery('foo* "bar" (baz)')).toBe('"foo" "bar" "baz"');
    });

    it("strips bool keywords", () => {
      expect(sanitizeFtsQuery("alpha AND beta OR gamma NOT delta")).toBe(
        '"alpha" "beta" "gamma" "delta"',
      );
    });

    it("returns empty string for empty input or pure operators", () => {
      expect(sanitizeFtsQuery("")).toBe("");
      expect(sanitizeFtsQuery('"*"')).toBe("");
      expect(sanitizeFtsQuery("AND OR")).toBe("");
    });
  });
});
