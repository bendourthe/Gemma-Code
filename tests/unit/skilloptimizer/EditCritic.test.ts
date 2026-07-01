import { describe, it, expect, vi } from "vitest";
import type { CriticReviewer, CriticVerdict } from "../../../modules/coding/orchestration/CriticAgent.js";
import type { TaskNode } from "../../../modules/coding/orchestration/TaskDAG.js";
import { CriticEditReviewer } from "../../../modules/coding/skilloptimizer/EditCritic.js";
import type { ProposedSkillEdit } from "../../../modules/coding/skilloptimizer/types.js";

/**
 * v1.7.0 Phase 3 (adoption-self-optimizing-skills S2 / SO003) -- unit tests for
 * the CriticAgent-backed edit critic: it maps the critic verdict through and
 * reviews the rendered edit against the diagnosis.
 */

const edit: ProposedSkillEdit = {
  skillId: "s1",
  ops: [{ kind: "add", text: "Always run the linter." }],
  rationale: "tasks failed lint",
};

function fakeCritic(verdict: CriticVerdict): { reviewer: CriticReviewer; review: ReturnType<typeof vi.fn> } {
  const review = vi.fn(async (_node: TaskNode, _output: string): Promise<CriticVerdict> => verdict);
  return { reviewer: { review }, review };
}

describe("CriticEditReviewer", () => {
  it("passes through an approving verdict", async () => {
    const { reviewer } = fakeCritic({ approved: true, feedback: "looks good" });
    const result = await new CriticEditReviewer(reviewer).review(edit, "diagnosis text");
    expect(result).toEqual({ approved: true, feedback: "looks good" });
  });

  it("passes through a rejecting verdict and reviews the rendered edit against the diagnosis", async () => {
    const { reviewer, review } = fakeCritic({ approved: false, feedback: "does not address the failure" });
    const result = await new CriticEditReviewer(reviewer).review(edit, "the skill omits a lint step");
    expect(result.approved).toBe(false);
    expect(result.feedback).toBe("does not address the failure");

    const [node, output] = review.mock.calls[0]!;
    expect(node.description).toBe("the skill omits a lint step");
    expect(output).toContain("Always run the linter.");
  });
});
