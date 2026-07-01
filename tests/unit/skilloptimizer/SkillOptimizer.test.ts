import { describe, it, expect, vi } from "vitest";
import { SkillOptimizer } from "../../../modules/coding/skilloptimizer/SkillOptimizer.js";
import { zeroSessionMetrics } from "../../../modules/coding/evaluation/GoldenTaskRunner.js";
import type { GoldenTaskResult } from "../../../modules/coding/evaluation/GoldenTaskSuite.js";
import type { GoldenTaskSpec } from "../../../modules/coding/evaluation/goldenTaskLoader.js";
import type { SplitGoldenTaskSpec } from "../../../modules/coding/evaluation/goldenSplit.js";
import type { Skill } from "../../../core/skills/SkillCatalog.js";
import type {
  FailureDiagnoser,
  OptimizerRollout,
  ProposedSkillEdit,
  RejectedEditBufferPort,
  SkillEditApprovalGate,
  SkillEditProposer,
  SkillFileIO,
  SkillOptimizerConfig,
  SkillOptimizerDeps,
  SkillOverride,
  SkillPathResolver,
} from "../../../modules/coding/skilloptimizer/types.js";

/**
 * v1.7.0 Phase 3 (adoption-self-optimizing-skills S2 / SO003) -- unit tests for
 * the bounded-edit optimizer loop, with every collaborator injected as a
 * deterministic fake. Proves: a validation-improving edit is accepted and
 * (pending approval) applied; a regressing edit is buffered; NO skill file is
 * written without the approval signal; the learning-rate budget caps edit
 * volume; the runaway budget caps rounds; a path escape is refused; and the
 * held-out `test` split can never reach the loop.
 */

const SKILL_PATH = "/catalog/skill-x/SKILL.md";
const FRONTMATTER = "---\nname: skill-x\nversion: 1.0.0\n---\n";
const BODY = "Original skill instructions.\n";

function makeSkill(body = BODY): Skill {
  return {
    id: "skill-x",
    displayName: "Skill X",
    path: SKILL_PATH,
    provenance: { source: "builtin", contentHash: "hash" },
    frontmatter: {},
    body,
  };
}

function spec(id: string, split: SplitGoldenTaskSpec["split"]): SplitGoldenTaskSpec {
  return {
    id,
    name: `Task ${id}`,
    category: "refactor",
    description: `do ${id}`,
    initialState: `snapshots/${id}`,
    expectedFilesChanged: [],
    successCriteria: [],
    maxIterations: 5,
    timeoutSeconds: 60,
    modelTier: "any",
    tags: [],
    split,
  };
}

function res(taskId: string, passed: boolean): GoldenTaskResult {
  return { taskId, passed, traceId: "", metrics: zeroSessionMetrics(), failures: passed ? [] : ["x"], durationMs: 1 };
}

const SMALL_EDIT: ProposedSkillEdit = {
  skillId: "skill-x",
  ops: [{ kind: "add", text: "Run the linter before finishing." }],
  rationale: "tasks failed lint",
};

// ---- fakes -----------------------------------------------------------------

type RolloutFn = (tasks: readonly GoldenTaskSpec[], override?: SkillOverride) => GoldenTaskResult[];

function makeRollout(fn: RolloutFn): { rollout: OptimizerRollout; calls: Array<{ ids: string[]; hasOverride: boolean }> } {
  const calls: Array<{ ids: string[]; hasOverride: boolean }> = [];
  return {
    calls,
    rollout: {
      run: async (tasks, override) => {
        calls.push({ ids: tasks.map((t) => t.id), hasOverride: override !== undefined });
        return fn(tasks, override);
      },
    },
  };
}

function makeDiagnoser(text = "the skill omits a lint step"): FailureDiagnoser {
  return { diagnose: async () => text };
}

function makeProposer(edit: ProposedSkillEdit | null): SkillEditProposer {
  return { propose: async () => edit };
}

function makeBuffer(): RejectedEditBufferPort & { records: Array<{ skillId: string; editHash: string; reason: string; validationDelta: number; content: string }> } {
  const records: Array<{ skillId: string; editHash: string; reason: string; validationDelta: number; content: string }> = [];
  return {
    records,
    has: (skillId, editHash) => records.some((r) => r.skillId === skillId && r.editHash === editHash),
    record: (input) => {
      records.push(input);
      return input;
    },
  };
}

function makeIo(): SkillFileIO & { writes: Array<{ path: string; content: string }>; store: Record<string, string> } {
  const store: Record<string, string> = { [SKILL_PATH]: FRONTMATTER + BODY };
  const writes: Array<{ path: string; content: string }> = [];
  return {
    store,
    writes,
    read: (p) => {
      const v = store[p];
      if (v === undefined) throw new Error(`no such file: ${p}`);
      return v;
    },
    write: (p, c) => {
      store[p] = c;
      writes.push({ path: p, content: c });
    },
  };
}

function makeApproval(approve: boolean): SkillEditApprovalGate & { gate: ReturnType<typeof vi.fn> } {
  const gate = vi.fn(async () => approve);
  return { gate, requestApproval: gate };
}

const passResolver: SkillPathResolver = { resolve: (p) => p };
const throwResolver: SkillPathResolver = {
  resolve: () => {
    throw new Error("resolves outside the skill catalog root");
  },
};

const TRAIN = [spec("t1", "train")];
const VALIDATION = [spec("v1", "validation")];

function deps(over: Partial<SkillOptimizerDeps>): SkillOptimizerDeps {
  return {
    rollout: makeRollout(() => [])!.rollout,
    diagnoser: makeDiagnoser(),
    proposer: makeProposer(SMALL_EDIT),
    buffer: makeBuffer(),
    approvalGate: makeApproval(true),
    pathResolver: passResolver,
    io: makeIo(),
    ...over,
  };
}

const CONFIG: SkillOptimizerConfig = {
  maxRounds: 5,
  learningRate: { maxOps: 2, maxChangedChars: 200 },
};

// ---- tests -----------------------------------------------------------------

describe("SkillOptimizer.optimize", () => {
  it("accepts a validation-improving edit and applies it after approval", async () => {
    const { rollout } = makeRollout((tasks, override) => {
      if (override) return [res("v1", true)]; // candidate validation improves
      if (tasks[0]?.id === "v1") return [res("v1", false)]; // baseline validation
      return [res("t1", false)]; // train: failing -> drives a proposal
    });
    const io = makeIo();
    const approval = makeApproval(true);
    const opt = new SkillOptimizer(
      deps({ rollout, io, approvalGate: approval, proposer: makeProposer(SMALL_EDIT) }),
      CONFIG,
    );

    const result = await opt.optimize({ target: makeSkill(), train: TRAIN, validation: VALIDATION });

    expect(result.acceptedCount).toBe(1);
    expect(result.appliedCount).toBe(1);
    expect(approval.gate).toHaveBeenCalledTimes(1);
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]!.path).toBe(SKILL_PATH);
    // The written file preserves the frontmatter and carries the edited body.
    expect(io.writes[0]!.content).toContain("name: skill-x");
    expect(io.writes[0]!.content).toContain("Run the linter before finishing.");
    expect(result.rounds[0]!.outcome).toBe("accepted-applied");
  });

  it("buffers a regressing edit and never writes it", async () => {
    const { rollout } = makeRollout((tasks, override) => {
      if (override) return [res("v1", false)]; // candidate regresses
      if (tasks[0]?.id === "v1") return [res("v1", true)]; // baseline passing
      return [res("t1", false)];
    });
    const io = makeIo();
    const buffer = makeBuffer();
    const opt = new SkillOptimizer(deps({ rollout, io, buffer }), CONFIG);

    const result = await opt.optimize({ target: makeSkill(), train: TRAIN, validation: VALIDATION });

    expect(result.rejectedCount).toBe(1);
    expect(result.appliedCount).toBe(0);
    expect(io.writes).toHaveLength(0);
    expect(buffer.records).toHaveLength(1);
    expect(buffer.records[0]!.skillId).toBe("skill-x");
    expect(buffer.records[0]!.reason).toMatch(/^rejected:/);
    expect(result.rounds[0]!.outcome).toBe("rejected-gate");
  });

  it("never writes a skill file when human approval is withheld", async () => {
    const { rollout } = makeRollout((tasks, override) => {
      if (override) return [res("v1", true)]; // edit would improve...
      if (tasks[0]?.id === "v1") return [res("v1", false)];
      return [res("t1", false)];
    });
    const io = makeIo();
    const approval = makeApproval(false); // ...but the human declines
    const opt = new SkillOptimizer(deps({ rollout, io, approvalGate: approval }), CONFIG);

    const result = await opt.optimize({ target: makeSkill(), train: TRAIN, validation: VALIDATION });

    expect(result.acceptedCount).toBe(1); // cleared the held-out gate
    expect(result.appliedCount).toBe(0); // but was not written
    expect(approval.gate).toHaveBeenCalledTimes(1);
    expect(io.writes).toHaveLength(0);
    expect(result.rounds[0]!.outcome).toBe("accepted-not-approved");
    expect(result.rounds[0]!.approved).toBe(false);
  });

  it("rejects an over-budget edit before any validation rollout (learning-rate cap)", async () => {
    const overBudget: ProposedSkillEdit = {
      skillId: "skill-x",
      ops: [
        { kind: "add", text: "a".repeat(60) },
        { kind: "add", text: "b".repeat(60) },
        { kind: "add", text: "c".repeat(60) },
      ],
      rationale: "rewrite everything",
    };
    const { rollout, calls } = makeRollout((tasks, override) => {
      if (override) return [res("v1", true)];
      if (tasks[0]?.id === "v1") return [res("v1", false)];
      return [res("t1", false)];
    });
    const io = makeIo();
    const buffer = makeBuffer();
    const opt = new SkillOptimizer(
      deps({ rollout, io, buffer, proposer: makeProposer(overBudget) }),
      { maxRounds: 5, learningRate: { maxOps: 1, maxChangedChars: 50 } },
    );

    const result = await opt.optimize({ target: makeSkill(), train: TRAIN, validation: VALIDATION });

    expect(result.rejectedCount).toBe(1);
    expect(result.appliedCount).toBe(0);
    expect(io.writes).toHaveLength(0);
    expect(buffer.records[0]!.reason).toMatch(/exceeds learning-rate budget/);
    expect(result.rounds[0]!.outcome).toBe("rejected-budget");
    // No candidate (override) validation rollout was spent on an over-budget edit.
    expect(calls.some((c) => c.hasOverride)).toBe(false);
  });

  it("bounds the number of rounds by the runaway budget", async () => {
    let n = 0;
    const { rollout } = makeRollout((tasks, override) => {
      if (override) return [res("v1", false)]; // always regress -> never accepted
      if (tasks[0]?.id === "v1") return [res("v1", true)];
      return [res("t1", false)];
    });
    // A fresh distinct edit each round so the no-progress halt never fires; only
    // the runaway budget can stop the loop.
    const proposer: SkillEditProposer = {
      propose: async () => ({ skillId: "skill-x", ops: [{ kind: "add", text: `note ${n++}` }], rationale: "r" }),
    };
    const opt = new SkillOptimizer(
      deps({ rollout, proposer }),
      { maxRounds: 3, learningRate: { maxOps: 2, maxChangedChars: 200 } },
    );

    const result = await opt.optimize({ target: makeSkill(), train: TRAIN, validation: VALIDATION });

    expect(result.stopReason).toBe("budget-exhausted");
    expect(result.rounds).toHaveLength(3);
    expect(result.rejectedCount).toBe(3);
  });

  it("refuses to write when the path escapes the catalog root (fail-closed)", async () => {
    const { rollout } = makeRollout((tasks, override) => {
      if (override) return [res("v1", true)];
      if (tasks[0]?.id === "v1") return [res("v1", false)];
      return [res("t1", false)];
    });
    const io = makeIo();
    const opt = new SkillOptimizer(deps({ rollout, io, pathResolver: throwResolver }), CONFIG);

    const result = await opt.optimize({ target: makeSkill(), train: TRAIN, validation: VALIDATION });

    expect(io.writes).toHaveLength(0);
    expect(result.appliedCount).toBe(0);
    expect(result.rounds[0]!.outcome).toBe("rejected-path");
    expect(result.stopReason).toBe("no-progress");
  });

  it("stops immediately when no train task is failing", async () => {
    const { rollout } = makeRollout(() => [res("t1", true)]); // train all-passing
    const opt = new SkillOptimizer(deps({ rollout }), CONFIG);
    const result = await opt.optimize({ target: makeSkill(), train: TRAIN, validation: VALIDATION });
    expect(result.stopReason).toBe("no-failing-tasks");
    expect(result.rounds).toHaveLength(0);
    expect(result.appliedCount).toBe(0);
  });

  it("skips a proposal and short-circuits the cheap critic before a rollout", async () => {
    const { rollout, calls } = makeRollout((tasks, override) => {
      if (override) return [res("v1", true)];
      if (tasks[0]?.id === "v1") return [res("v1", false)];
      return [res("t1", false)];
    });
    const buffer = makeBuffer();
    const opt = new SkillOptimizer(
      deps({ rollout, buffer, editCritic: { review: async () => ({ approved: false, feedback: "off-target" }) } }),
      CONFIG,
    );
    const result = await opt.optimize({ target: makeSkill(), train: TRAIN, validation: VALIDATION });
    expect(result.rejectedCount).toBe(1);
    expect(result.rounds[0]!.outcome).toBe("rejected-critic");
    expect(buffer.records[0]!.reason).toMatch(/critic rejected/);
    expect(calls.some((c) => c.hasOverride)).toBe(false); // no rollout spent
  });

  it("halts with no-progress when the proposer returns no actionable edit", async () => {
    const { rollout } = makeRollout((tasks, override) => {
      if (override) return [res("v1", true)];
      if (tasks[0]?.id === "v1") return [res("v1", false)];
      return [res("t1", false)];
    });
    const opt = new SkillOptimizer(deps({ rollout, proposer: makeProposer(null) }), CONFIG);
    const result = await opt.optimize({ target: makeSkill(), train: TRAIN, validation: VALIDATION });
    expect(result.rounds[0]!.outcome).toBe("no-proposal");
    expect(result.stopReason).toBe("no-progress");
    expect(result.appliedCount).toBe(0);
  });

  it("throws if a held-out `test` split task reaches the loop (contamination guard)", async () => {
    const opt = new SkillOptimizer(deps({}), CONFIG);
    await expect(
      opt.optimize({ target: makeSkill(), train: TRAIN, validation: [spec("leak", "test")] }),
    ).rejects.toThrow(/contamination guard/);
  });

  it("rejects an invalid configuration at construction", () => {
    expect(() => new SkillOptimizer(deps({}), { maxRounds: 0, learningRate: { maxOps: 1, maxChangedChars: 1 } })).toThrow(/maxRounds/);
    expect(() => new SkillOptimizer(deps({}), { maxRounds: 1, learningRate: { maxOps: 0, maxChangedChars: 1 } })).toThrow(/learningRate/);
  });
});
