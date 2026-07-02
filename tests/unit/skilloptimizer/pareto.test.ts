import { describe, it, expect } from "vitest";
import {
  dominates,
  highestByHeldOut,
  lowestByHeldOut,
  paretoFrontier,
} from "../../../modules/coding/skilloptimizer/pareto.js";
import type {
  CandidateScore,
  PerTaskScores,
} from "../../../modules/coding/skilloptimizer/types.js";

/**
 * v1.7.0 Phase 4 (adoption-self-optimizing-skills S3 / SO005) -- unit tests for
 * the pure Pareto / EvoSkill selection core over fixture score matrices. Proves:
 * strict Pareto domination; the non-dominated set keeps diverse winners and drops
 * dominated candidates; and the held-out extremes used by the replacement rule
 * are deterministic (id tie-break).
 */

function cs(id: string, perTask: PerTaskScores, heldOut: number): CandidateScore {
  return { candidateId: id, perTask, heldOut };
}

describe("dominates", () => {
  it("is true when a is >= b everywhere and strictly greater somewhere", () => {
    expect(dominates({ t1: 1, t2: 1 }, { t1: 1, t2: 0 })).toBe(true);
    expect(dominates({ t1: 1, t2: 1 }, { t1: 0, t2: 0 })).toBe(true);
  });

  it("is false when a is worse on any shared task", () => {
    expect(dominates({ t1: 1, t2: 0 }, { t1: 0, t2: 1 })).toBe(false);
    expect(dominates({ t1: 0, t2: 0 }, { t1: 1, t2: 1 })).toBe(false);
  });

  it("is false for identical vectors (mutually non-dominated)", () => {
    expect(dominates({ t1: 1, t2: 1 }, { t1: 1, t2: 1 })).toBe(false);
  });

  it("is false when the vectors share no task", () => {
    expect(dominates({ t1: 1 }, { t2: 1 })).toBe(false);
    expect(dominates({}, {})).toBe(false);
  });
});

describe("paretoFrontier", () => {
  it("keeps diverse winners that each win a different task", () => {
    const scores = [
      cs("a", { t1: 1, t2: 0 }, 0.5),
      cs("b", { t1: 0, t2: 1 }, 0.5),
    ];
    expect(paretoFrontier(scores).sort()).toEqual(["a", "b"]);
  });

  it("drops a candidate dominated by another", () => {
    const scores = [
      cs("a", { t1: 1, t2: 1 }, 1),
      cs("b", { t1: 1, t2: 0 }, 0.5), // dominated by a
      cs("c", { t1: 0, t2: 1 }, 0.5), // dominated by a
    ];
    expect(paretoFrontier(scores)).toEqual(["a"]);
  });

  it("keeps both candidates when their vectors are identical", () => {
    const scores = [
      cs("a", { t1: 1, t2: 0 }, 0.5),
      cs("b", { t1: 1, t2: 0 }, 0.5),
    ];
    expect(paretoFrontier(scores).sort()).toEqual(["a", "b"]);
  });

  it("returns the single candidate when there is only one, and [] when empty", () => {
    expect(paretoFrontier([cs("solo", { t1: 1 }, 1)])).toEqual(["solo"]);
    expect(paretoFrontier([])).toEqual([]);
  });

  it("keeps a three-way non-dominated set", () => {
    const scores = [
      cs("a", { t1: 1, t2: 0, t3: 0 }, 0.33),
      cs("b", { t1: 0, t2: 1, t3: 0 }, 0.33),
      cs("c", { t1: 0, t2: 0, t3: 1 }, 0.33),
      cs("d", { t1: 0, t2: 0, t3: 0 }, 0), // dominated by all
    ];
    expect(paretoFrontier(scores).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("lowestByHeldOut / highestByHeldOut", () => {
  const scores = [
    cs("a", { t1: 1 }, 0.2),
    cs("b", { t1: 1 }, 0.6),
    cs("c", { t1: 1 }, 0.4),
  ];

  it("finds the lowest and highest by held-out score", () => {
    expect(lowestByHeldOut(scores)?.candidateId).toBe("a");
    expect(highestByHeldOut(scores)?.candidateId).toBe("b");
  });

  it("breaks ties deterministically by the smallest candidate id", () => {
    const tied = [cs("z", { t1: 1 }, 0.5), cs("m", { t1: 1 }, 0.5), cs("a", { t1: 1 }, 0.5)];
    expect(lowestByHeldOut(tied)?.candidateId).toBe("a");
    expect(highestByHeldOut(tied)?.candidateId).toBe("a");
  });

  it("restricts the highest to an allowed id set (the Pareto frontier)", () => {
    // b is the global max but is excluded; c is the best allowed candidate.
    const allowed = new Set(["a", "c"]);
    expect(highestByHeldOut(scores, allowed)?.candidateId).toBe("c");
  });

  it("returns undefined for an empty input or an empty allowed set", () => {
    expect(lowestByHeldOut([])).toBeUndefined();
    expect(highestByHeldOut([])).toBeUndefined();
    expect(highestByHeldOut(scores, new Set())).toBeUndefined();
  });
});
