import { describe, it, expect } from "vitest";
import {
  HeuristicComplexityClassifier,
  defaultComplexityClassifier,
} from "../../../src/orchestration/ComplexityClassifier.js";

describe("HeuristicComplexityClassifier", () => {
  const c = new HeuristicComplexityClassifier();

  it("classifies single-line refactor as simple when starts with simple prefix", () => {
    const r = c.classify("explain the auth refactor");
    expect(r.complex).toBe(false);
    expect(r.reason).toContain("simple-prefix");
  });

  it("classifies multi-line complex task with trigger keyword as complex", () => {
    const r = c.classify("Please refactor the login flow into a stateful service");
    expect(r.complex).toBe(true);
    expect(r.reason).toContain("trigger:refactor");
  });

  it("classifies short generic request as not complex", () => {
    const r = c.classify("fix typo in README");
    expect(r.complex).toBe(false);
    expect(r.reason).toBe("default");
  });

  it("uses length threshold for boundary case", () => {
    // 199 chars: just under
    const justUnder = "a".repeat(199);
    expect(c.classify(justUnder).complex).toBe(false);

    // 201 chars: just over -> complex by length
    const justOver = "a".repeat(201);
    const r = c.classify(justOver);
    expect(r.complex).toBe(true);
    expect(r.reason).toContain("length:201");
  });

  it("simple prefix takes precedence over trigger keyword", () => {
    // Has "refactor" trigger but starts with "explain" -> simple
    const r = c.classify("explain how to refactor the storage layer");
    expect(r.complex).toBe(false);
  });

  it("defaultComplexityClassifier is the heuristic implementation", () => {
    const r = defaultComplexityClassifier.classify("rewrite the parser");
    expect(r.complex).toBe(true);
  });
});
