// ---------------------------------------------------------------------------
// v1.7.0 Phase 3 (adoption-self-optimizing-skills S2 / SO003) -- a cheap
// pre-rollout edit critic built on the existing `CriticAgent`.
//
// Before the optimizer spends a (costly) validation rollout measuring a
// proposed edit, the critic gives an advisory verdict on whether the edit even
// plausibly addresses the diagnosis. It composes the existing `CriticAgent`,
// reusing its fail-open discipline: a parse failure approves, deferring the
// real decision to the load-bearing held-out validation gate. A clear reject
// short-circuits the rollout and buffers the edit, saving compute.
//
// Boundary: vscode-free; the LLM is reached only through the injected
// `CriticReviewer` (the production `CriticAgent` holds the `OllamaClient` port).
// ---------------------------------------------------------------------------

import type { CriticReviewer } from "../orchestration/CriticAgent.js";
import type { TaskNode } from "../orchestration/TaskDAG.js";
import { renderEditDiff } from "./skillEdit.js";
import type { EditCritic, EditCriticVerdict, ProposedSkillEdit } from "./types.js";

/** Reviews a proposed skill edit against the diagnosis via the existing critic. */
export class CriticEditReviewer implements EditCritic {
  constructor(private readonly _critic: CriticReviewer) {}

  async review(edit: ProposedSkillEdit, diagnosis: string): Promise<EditCriticVerdict> {
    const node: TaskNode = {
      id: `skill-edit:${edit.skillId}`,
      title: `Improve skill "${edit.skillId}" to fix the diagnosed failures`,
      description: diagnosis,
      type: "code",
      dependencies: [],
      status: "running",
      retryCount: 0,
      maxRetries: 0,
    };
    const verdict = await this._critic.review(node, renderEditDiff(edit));
    return { approved: verdict.approved, feedback: verdict.feedback };
  }
}
