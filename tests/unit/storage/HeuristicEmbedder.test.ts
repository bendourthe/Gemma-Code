import { describe, expect, it } from "vitest";
import {
  HEURISTIC_DIMENSION,
  HeuristicEmbedder,
} from "../../../src/storage/HeuristicEmbedder.js";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Both inputs are L2-normalised, so dot product == cosine similarity.
  return dot;
}

describe("HeuristicEmbedder", () => {
  const e = new HeuristicEmbedder();

  it("returns the configured dimension", () => {
    const v = e.embed("hello world");
    expect(v).toHaveLength(HEURISTIC_DIMENSION);
  });

  it("is deterministic for the same input", () => {
    const v1 = e.embed("function add(a, b) { return a + b; }");
    const v2 = e.embed("function add(a, b) { return a + b; }");
    expect(v1).toEqual(v2);
  });

  it("returns the zero vector for empty input", () => {
    const v = e.embed("");
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it("L2-normalises non-empty inputs", () => {
    const v = e.embed("the quick brown fox jumps over the lazy dog");
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeGreaterThan(0.99);
    expect(norm).toBeLessThan(1.01);
  });

  it("yields high cosine for paraphrases of the same idea", () => {
    const a = e.embed(
      "The function returns the sum of two numbers and handles overflow.",
    );
    const b = e.embed(
      "This function returns the sum of two numbers and handles overflow cases.",
    );
    expect(cosine(a, b)).toBeGreaterThan(0.5);
  });

  it("yields low cosine for unrelated text", () => {
    const a = e.embed("function add(a, b) { return a + b; }");
    const b = e.embed("the cat sat on the mat near the window");
    expect(cosine(a, b)).toBeLessThan(0.5);
  });
});
