import { describe, expect, it, vi } from "vitest";

import { zeroSessionMetrics } from "../../../modules/coding/evaluation/GoldenTaskRunner.js";
import type { GoldenTaskResult } from "../../../modules/coding/evaluation/GoldenTaskSuite.js";
import type { GoldenTaskSpec } from "../../../modules/coding/evaluation/goldenTaskLoader.js";
import {
  HeadlessCandidateProducer,
  HeadlessCandidatePromoter,
  HeadlessCandidateScorer,
} from "../../../modules/coding/skilloptimizer/HeadlessCandidateSeams.js";
import type {
  OptimizerRollout,
  ProposedSkillEdit,
  SkillEditProposer,
  SkillFileIO,
} from "../../../modules/coding/skilloptimizer/types.js";

const BUDGET = { maxOps: 3, maxChangedChars: 500 };
const SKILL_ID = "coding/demo";
const BASE_BODY = "Base skill body.";

function proposerReturning(byDiagnosis: Record<string, ProposedSkillEdit | null>): SkillEditProposer {
  return { propose: async (input) => byDiagnosis[input.diagnosis] ?? null };
}

function taskResult(taskId: string, passed: boolean): GoldenTaskResult {
  return { taskId, passed, traceId: "", metrics: zeroSessionMetrics(), failures: [], durationMs: 1 };
}

function spec(id: string): GoldenTaskSpec {
  return {
    id,
    name: id,
    category: "codegen",
    description: id,
    initialState: `snapshots/${id}`,
    expectedFilesChanged: [],
    successCriteria: [],
    maxIterations: 3,
    timeoutSeconds: 10,
    modelTier: "balanced",
    tags: [],
  };
}

describe("HeadlessCandidateProducer (SO005.P4.A)", () => {
  it("produces one distinct candidate per non-null proposal", async () => {
    const proposer = proposerReturning({
      "diag-a": { skillId: SKILL_ID, ops: [{ kind: "add", text: "\nRULE A" }], rationale: "add A" },
      "diag-b": { skillId: SKILL_ID, ops: [{ kind: "add", text: "\nRULE B" }], rationale: "add B" },
      "diag-c": null,
    });
    const producer = new HeadlessCandidateProducer({
      proposer,
      skillId: SKILL_ID,
      baseBody: BASE_BODY,
      diagnoses: ["diag-a", "diag-b", "diag-c"],
      budget: BUDGET,
    });
    const candidates = await producer.produce();
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.label)).toEqual(["add A", "add B"]);
    expect(candidates[0]?.body).toContain("RULE A");
    expect(new Set(candidates.map((c) => c.id)).size).toBe(2);
  });

  it("de-duplicates identical edits", async () => {
    const same: ProposedSkillEdit = {
      skillId: SKILL_ID,
      ops: [{ kind: "add", text: "\nSAME" }],
      rationale: "dupe",
    };
    const producer = new HeadlessCandidateProducer({
      proposer: proposerReturning({ x: same, y: same }),
      skillId: SKILL_ID,
      baseBody: BASE_BODY,
      diagnoses: ["x", "y"],
      budget: BUDGET,
    });
    expect(await producer.produce()).toHaveLength(1);
  });
});

describe("HeadlessCandidateScorer (SO005.P4.A)", () => {
  it("maps rollout results to a per-task vector and a held-out aggregate", async () => {
    const rollout: OptimizerRollout = {
      run: async () => [
        taskResult("t1", true),
        taskResult("t2", false),
        taskResult("v1", true),
        taskResult("v2", true),
      ],
    };
    const scorer = new HeadlessCandidateScorer({
      rollout,
      tasks: [spec("t1"), spec("t2"), spec("v1"), spec("v2")],
      heldOutTaskIds: new Set(["v1", "v2"]),
    });
    const score = await scorer.score(
      { id: "c1", skillId: SKILL_ID, body: "x" },
      null,
    );
    expect(score.candidateId).toBe("c1");
    expect(score.perTask).toEqual({ t1: 1, t2: 0, v1: 1, v2: 1 });
    expect(score.heldOut).toBe(1); // both held-out tasks passed
  });

  it("passes the candidate body to the rollout as a skill override", async () => {
    const run = vi.fn(async () => [taskResult("v1", true)]);
    const scorer = new HeadlessCandidateScorer({
      rollout: { run },
      tasks: [spec("v1")],
      heldOutTaskIds: new Set(["v1"]),
    });
    await scorer.score({ id: "c1", skillId: SKILL_ID, body: "CANDIDATE BODY" }, null);
    expect(run).toHaveBeenCalledWith([expect.objectContaining({ id: "v1" })], {
      skillId: SKILL_ID,
      body: "CANDIDATE BODY",
    });
  });
});

describe("HeadlessCandidatePromoter (SO005.P4.B)", () => {
  function memIo(store: Record<string, string>): SkillFileIO & { writes: string[] } {
    const writes: string[] = [];
    return {
      writes,
      read: (p) => {
        const v = store[p];
        if (v === undefined) throw new Error(`no such file: ${p}`);
        return v;
      },
      write: (p, c) => {
        store[p] = c;
        writes.push(p);
      },
    };
  }

  it("merges an approved candidate body into the live catalog, preserving frontmatter", async () => {
    const store: Record<string, string> = {
      "/cat/demo.md": "---\nname: demo\n---\nOLD BODY",
    };
    const io = memIo(store);
    const promoter = new HeadlessCandidatePromoter({ io, skillPathFor: () => "/cat/demo.md" });
    const ok = await promoter.promote({ id: "c1", skillId: SKILL_ID, body: "NEW BODY" }, null);
    expect(ok).toBe(true);
    expect(store["/cat/demo.md"]).toContain("name: demo");
    expect(store["/cat/demo.md"]).toContain("NEW BODY");
    expect(store["/cat/demo.md"]).not.toContain("OLD BODY");
  });

  it("aborts (writes nothing) when the checkpoint fails", async () => {
    const store: Record<string, string> = { "/cat/demo.md": "---\nname: demo\n---\nOLD" };
    const io = memIo(store);
    const promoter = new HeadlessCandidatePromoter({
      io,
      skillPathFor: () => "/cat/demo.md",
      checkpoint: async () => false,
    });
    const ok = await promoter.promote({ id: "c1", skillId: SKILL_ID, body: "NEW" }, null);
    expect(ok).toBe(false);
    expect(io.writes).toHaveLength(0);
    expect(store["/cat/demo.md"]).toContain("OLD");
  });

  it("fails closed when the skill file cannot be read", async () => {
    const io = memIo({});
    const promoter = new HeadlessCandidatePromoter({ io, skillPathFor: () => "/missing.md" });
    const ok = await promoter.promote({ id: "c1", skillId: SKILL_ID, body: "NEW" }, null);
    expect(ok).toBe(false);
  });
});
