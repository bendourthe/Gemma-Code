import { describe, it, expect, vi } from "vitest";
import { CandidateFrontier } from "../../../modules/coding/skilloptimizer/CandidateFrontier.js";
import { ActionRisk } from "../../../modules/coding/guardrails/ActionClassifier.js";
import type {
  CandidateFrontierConfig,
  CandidateFrontierDeps,
  CandidateProducer,
  CandidatePromoter,
  CandidateScorer,
  CandidateWorkspaceManager,
  PerTaskScores,
  SkillCandidate,
} from "../../../modules/coding/skilloptimizer/types.js";

/**
 * v1.7.0 Phase 4 (adoption-self-optimizing-skills S3 / SO005) -- unit tests for
 * the Pareto-frontier candidate manager, every collaborator injected as a
 * deterministic fake. Proves: non-dominated selection over a fixture score
 * matrix; the hard candidate cap holds; the lowest incumbent is replaced ONLY on
 * a held-out win; NO branch is promoted without the human-approval signal; the
 * ephemeral worktree is auto-cleaned per candidate; and isolation degrades
 * gracefully when unavailable.
 */

const SKILL_ID = "skill-x";
const SKILL_PATH = "/catalog/skill-x/SKILL.md";

function candidate(id: string): SkillCandidate {
  return { id, skillId: SKILL_ID, body: `body-${id}`, label: `edit ${id}` };
}

function makeProducer(cands: readonly SkillCandidate[]): CandidateProducer {
  return { produce: async () => cands };
}

interface ScoreSpec {
  readonly perTask: PerTaskScores;
  readonly heldOut: number;
}

function makeScorer(specs: Record<string, ScoreSpec>): CandidateScorer & {
  calls: Array<{ id: string; isolated: boolean }>;
} {
  const calls: Array<{ id: string; isolated: boolean }> = [];
  return {
    calls,
    score: async (cand, workspace) => {
      calls.push({ id: cand.id, isolated: workspace !== null });
      const spec = specs[cand.id];
      if (spec === undefined) throw new Error(`no score spec for ${cand.id}`);
      return { candidateId: cand.id, perTask: spec.perTask, heldOut: spec.heldOut };
    },
  };
}

function makeWorkspaces(available = true): CandidateWorkspaceManager & {
  created: string[];
  cleaned: string[];
} {
  const created: string[] = [];
  const cleaned: string[] = [];
  return {
    created,
    cleaned,
    create: async (cand) => {
      if (!available) return null;
      created.push(cand.id);
      return { candidateId: cand.id, branch: `nexus/skill-candidate/${SKILL_ID}/${cand.id}`, path: `/wt/${cand.id}` };
    },
    cleanup: async (workspace) => {
      cleaned.push(workspace.candidateId);
      return true;
    },
  };
}

function makeApproval(approve: boolean): { requestApproval: ReturnType<typeof vi.fn> } {
  return { requestApproval: vi.fn(async () => approve) };
}

function makePromoter(result = true): CandidatePromoter & { promote: ReturnType<typeof vi.fn> } {
  const promote = vi.fn(async () => result);
  return { promote };
}

function deps(over: Partial<CandidateFrontierDeps>): CandidateFrontierDeps {
  return {
    producer: makeProducer([]),
    workspaces: makeWorkspaces(),
    scorer: makeScorer({}),
    approvalGate: makeApproval(true),
    promoter: makePromoter(),
    ...over,
  };
}

function config(over: Partial<CandidateFrontierConfig> = {}): CandidateFrontierConfig {
  return { maxCandidates: 4, skillId: SKILL_ID, skillPath: SKILL_PATH, ...over };
}

describe("CandidateFrontier.evolve", () => {
  it("selects the non-dominated set and surfaces the highest held-out winner", async () => {
    const cands = [candidate("a"), candidate("b"), candidate("c")];
    const scorer = makeScorer({
      a: { perTask: { t1: 1, t2: 0 }, heldOut: 0.5 },
      b: { perTask: { t1: 0, t2: 1 }, heldOut: 0.6 },
      c: { perTask: { t1: 0, t2: 0 }, heldOut: 0.1 }, // dominated by both a and b
    });
    const approval = makeApproval(true);
    const promoter = makePromoter(true);
    const frontier = new CandidateFrontier(
      deps({ producer: makeProducer(cands), scorer, approvalGate: approval, promoter }),
      config(),
    );

    const result = await frontier.evolve();

    expect(result.frontier.sort()).toEqual(["a", "b"]);
    expect(result.winnerId).toBe("b"); // highest held-out among the frontier
    expect(result.approvalRequested).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.promoted).toBe(true);
    expect(promoter.promote).toHaveBeenCalledTimes(1);
    expect(promoter.promote.mock.calls[0]![0]).toMatchObject({ id: "b" });
  });

  it("holds the hard candidate cap, replacing the lowest incumbent on a held-out win", async () => {
    const cands = [candidate("a"), candidate("b"), candidate("c"), candidate("d")];
    const scorer = makeScorer({
      a: { perTask: { t1: 1 }, heldOut: 0.2 },
      b: { perTask: { t1: 1 }, heldOut: 0.4 },
      c: { perTask: { t1: 1 }, heldOut: 0.6 }, // beats the lowest (a) -> replaces it
      d: { perTask: { t1: 1 }, heldOut: 0.1 }, // loses to the lowest (b) -> rejected
    });
    const frontier = new CandidateFrontier(
      deps({ producer: makeProducer(cands), scorer }),
      config({ maxCandidates: 2 }),
    );

    const result = await frontier.evolve();

    expect(result.population).toHaveLength(2);
    expect(result.population.map((r) => r.candidate.id).sort()).toEqual(["b", "c"]);
    expect(result.evaluated.map((r) => r.admission)).toEqual([
      "admitted",
      "admitted",
      "replaced-lowest",
      "rejected-cap",
    ]);
  });

  it("rejects a challenger that does not beat the lowest incumbent (cap = 1)", async () => {
    const scorer = makeScorer({
      a: { perTask: { t1: 1 }, heldOut: 0.5 },
      b: { perTask: { t1: 1 }, heldOut: 0.3 },
    });
    const frontier = new CandidateFrontier(
      deps({ producer: makeProducer([candidate("a"), candidate("b")]), scorer }),
      config({ maxCandidates: 1 }),
    );

    const result = await frontier.evolve();

    expect(result.population.map((r) => r.candidate.id)).toEqual(["a"]);
    expect(result.evaluated[1]!.admission).toBe("rejected-cap");
  });

  it("honors the replacement margin (a within-margin gain does not replace)", async () => {
    const scorer = makeScorer({
      a: { perTask: { t1: 1 }, heldOut: 0.5 },
      b: { perTask: { t1: 1 }, heldOut: 0.55 }, // +0.05, within a 0.1 margin -> rejected
    });
    const frontier = new CandidateFrontier(
      deps({ producer: makeProducer([candidate("a"), candidate("b")]), scorer }),
      config({ maxCandidates: 1, replacementMargin: 0.1 }),
    );

    const result = await frontier.evolve();

    expect(result.population.map((r) => r.candidate.id)).toEqual(["a"]);
    expect(result.evaluated[1]!.admission).toBe("rejected-cap");
  });

  it("NEVER promotes a branch when human approval is withheld", async () => {
    const scorer = makeScorer({
      a: { perTask: { t1: 1, t2: 0 }, heldOut: 0.5 },
      b: { perTask: { t1: 0, t2: 1 }, heldOut: 0.6 },
    });
    const approval = makeApproval(false); // human declines
    const promoter = makePromoter(true);
    const frontier = new CandidateFrontier(
      deps({ producer: makeProducer([candidate("a"), candidate("b")]), scorer, approvalGate: approval, promoter }),
      config(),
    );

    const result = await frontier.evolve();

    expect(result.winnerId).toBe("b");
    expect(result.approvalRequested).toBe(true);
    expect(result.approved).toBe(false);
    expect(result.promoted).toBe(false);
    expect(promoter.promote).not.toHaveBeenCalled();
    // The write is surfaced as a DESTRUCTIVE skill overwrite (the Phase 3 discipline).
    expect(approval.requestApproval).toHaveBeenCalledTimes(1);
    const request = approval.requestApproval.mock.calls[0]![0];
    expect(request.skillPath).toBe(SKILL_PATH);
    expect(request.classification.risk).toBe(ActionRisk.DESTRUCTIVE);
    expect(request.diff).toContain("nexus/skill-candidate");
  });

  it("auto-cleans every ephemeral worktree after scoring", async () => {
    const cands = [candidate("a"), candidate("b")];
    const workspaces = makeWorkspaces(true);
    const scorer = makeScorer({
      a: { perTask: { t1: 1 }, heldOut: 0.5 },
      b: { perTask: { t1: 1 }, heldOut: 0.6 },
    });
    const frontier = new CandidateFrontier(
      deps({ producer: makeProducer(cands), workspaces, scorer }),
      config(),
    );

    await frontier.evolve();

    expect(workspaces.created).toEqual(["a", "b"]);
    expect(workspaces.cleaned.sort()).toEqual(["a", "b"]);
  });

  it("degrades gracefully when git isolation is unavailable (null workspace)", async () => {
    const cands = [candidate("a"), candidate("b")];
    const workspaces = makeWorkspaces(false); // isolation unavailable
    const scorer = makeScorer({
      a: { perTask: { t1: 1, t2: 0 }, heldOut: 0.5 },
      b: { perTask: { t1: 0, t2: 1 }, heldOut: 0.6 },
    });
    const frontier = new CandidateFrontier(
      deps({ producer: makeProducer(cands), workspaces, scorer }),
      config(),
    );

    const result = await frontier.evolve();

    expect(workspaces.created).toEqual([]); // no branch created
    expect(workspaces.cleaned).toEqual([]); // nothing to clean
    expect(scorer.calls.every((c) => c.isolated === false)).toBe(true); // scored against baseline
    expect(result.population.every((r) => r.workspace === null)).toBe(true);
    expect(result.frontier.sort()).toEqual(["a", "b"]); // ranking still works
    expect(result.winnerId).toBe("b");
  });

  it("returns no winner and requests no approval when no candidates are produced", async () => {
    const approval = makeApproval(true);
    const frontier = new CandidateFrontier(
      deps({ producer: makeProducer([]), approvalGate: approval }),
      config(),
    );

    const result = await frontier.evolve();

    expect(result.population).toHaveLength(0);
    expect(result.frontier).toEqual([]);
    expect(result.winnerId).toBeUndefined();
    expect(result.approvalRequested).toBe(false);
    expect(result.approved).toBe(false);
    expect(result.promoted).toBe(false);
    expect(approval.requestApproval).not.toHaveBeenCalled();
  });

  it("rejects an invalid configuration at construction", () => {
    expect(() => new CandidateFrontier(deps({}), config({ maxCandidates: 0 }))).toThrow(/maxCandidates/);
  });
});
