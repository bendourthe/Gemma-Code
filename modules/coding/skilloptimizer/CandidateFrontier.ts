// ---------------------------------------------------------------------------
// v1.7.0 Phase 4 (adoption-self-optimizing-skills S3 / SO005) -- the
// Pareto-frontier candidate manager.
//
// The evolutionary (GEPA/EvoSkill) layer on top of the Phase 3 single-file loop:
//
//   produce candidates          -- CandidateProducer (over the Phase 3 optimizer): >= 2 variants
//     -> for each candidate:
//          materialize on its own git branch  -- CandidateWorkspaceManager (worktree-isolated)
//          score across the diverse task set   -- CandidateScorer (over the Phase 1 runner)
//          auto-clean the ephemeral worktree   -- branch ref survives for promotion
//          admit into a bounded population      -- EvoSkill replacement rule + hard cap
//     -> select the non-dominated (Pareto) set  -- pareto.ts
//     -> surface the winner for HUMAN APPROVAL   -- never auto-merge (Phase 3 approval gate)
//     -> on approval: promote the winning branch -- CandidatePromoter (the ONLY merge path)
//
// Safety invariants (the load-bearing guardrails):
//   - NO branch is ever merged into the live catalog without an explicit human
//     approval signal (the promoter is unreachable otherwise).
//   - The population never exceeds the hard candidate cap (mirrors the swarm
//     worker cap + the GPU/VRAM gate); a challenger only displaces the lowest
//     incumbent when it beats it on the HELD-OUT split.
//   - Candidates are scored one at a time and each ephemeral worktree is
//     auto-cleaned immediately after scoring, so at most one worktree is live at
//     once (the single-GPU discipline the A/B harness uses).
//   - Fault-tolerant isolation: a null workspace (git-less / non-repo) degrades to
//     a baseline-catalog score instead of throwing.
//
// Boundary: vscode-free. Every side-effecting collaborator is an injected seam.
// ---------------------------------------------------------------------------

import { classifyAction } from "../guardrails/ActionClassifier.js";
import type { ToolCall } from "../../../src/tools/types.js";
import { highestByHeldOut, lowestByHeldOut, paretoFrontier } from "./pareto.js";
import type {
  CandidateAdmission,
  CandidateFrontierConfig,
  CandidateFrontierDeps,
  CandidateRecord,
  CandidateScore,
  FrontierResult,
  SkillCandidate,
} from "./types.js";

/**
 * The Pareto-frontier candidate manager. Construct once with its collaborators,
 * then call `evolve` to rank a batch of produced candidates. Never merges a
 * winning branch without human approval.
 */
export class CandidateFrontier {
  constructor(
    private readonly _deps: CandidateFrontierDeps,
    private readonly _config: CandidateFrontierConfig,
  ) {
    if (_config.maxCandidates < 1) {
      throw new Error("CandidateFrontier: maxCandidates must be >= 1");
    }
  }

  /**
   * Produce, isolate, score, and rank candidates; select the non-dominated set;
   * and surface the winner for human approval. Returns the full pass result. No
   * branch is promoted unless the approval gate returns true.
   */
  async evolve(): Promise<FrontierResult> {
    const candidates = await this._deps.producer.produce();

    const evaluated: CandidateRecord[] = [];
    const population: CandidateRecord[] = [];

    for (const candidate of candidates) {
      const record = await this._evaluate(candidate, population);
      evaluated.push(record);
    }

    const frontierIds = paretoFrontier(population.map((r) => r.score));
    const winner = highestByHeldOut(
      population.map((r) => r.score),
      new Set(frontierIds),
    );

    if (winner === undefined) {
      return {
        skillId: this._config.skillId,
        evaluated,
        population,
        frontier: frontierIds,
        approvalRequested: false,
        approved: false,
        promoted: false,
      };
    }

    const winnerRecord = population.find((r) => r.candidate.id === winner.candidateId)!;
    const { approved, promoted } = await this._surfaceForApproval(winnerRecord, frontierIds);

    return {
      skillId: this._config.skillId,
      evaluated,
      population,
      frontier: frontierIds,
      winnerId: winner.candidateId,
      approvalRequested: true,
      approved,
      promoted,
    };
  }

  /**
   * Materialize one candidate on its own branch, score it across the diverse
   * tasks, auto-clean the ephemeral worktree, and admit it into the bounded
   * population per the EvoSkill replacement rule. Mutates `population` in place.
   */
  private async _evaluate(
    candidate: SkillCandidate,
    population: CandidateRecord[],
  ): Promise<CandidateRecord> {
    const workspace = await this._deps.workspaces.create(candidate);
    let score: CandidateScore;
    try {
      score = await this._deps.scorer.score(candidate, workspace);
    } finally {
      // Auto-clean the ephemeral worktree regardless of outcome; the branch ref
      // persists on the workspace record for a later, approved merge.
      if (workspace !== null) await this._deps.workspaces.cleanup(workspace);
    }

    const admission = this._decideAdmission(population, score);
    const record: CandidateRecord = { candidate, workspace, score, admission };

    if (admission === "admitted") {
      population.push(record);
    } else if (admission === "replaced-lowest") {
      const lowest = lowestByHeldOut(population.map((r) => r.score))!;
      const index = population.findIndex((r) => r.candidate.id === lowest.candidateId);
      population.splice(index, 1, record);
    }
    return record;
  }

  /**
   * The EvoSkill replacement rule + hard cap. Under the cap: admit. At the cap:
   * replace the lowest-held-out incumbent ONLY when the challenger strictly beats
   * it (by the configured margin) on the held-out split; otherwise reject it.
   */
  private _decideAdmission(
    population: readonly CandidateRecord[],
    score: CandidateScore,
  ): CandidateAdmission {
    if (population.length < this._config.maxCandidates) return "admitted";
    const lowest = lowestByHeldOut(population.map((r) => r.score));
    const margin = this._config.replacementMargin ?? 0;
    if (lowest !== undefined && score.heldOut > lowest.heldOut + margin) {
      return "replaced-lowest";
    }
    return "rejected-cap";
  }

  /**
   * Surface the winning candidate for explicit human approval and, ONLY on an
   * affirmative signal, promote its branch into the live catalog. The write is
   * classified DESTRUCTIVE (a skill overwrite) exactly as the Phase 3 loop does.
   */
  private async _surfaceForApproval(
    winner: CandidateRecord,
    frontierIds: readonly string[],
  ): Promise<{ approved: boolean; promoted: boolean }> {
    const toolCall: ToolCall = {
      tool: "write_file",
      id: `skill-frontier:${this._config.skillId}`,
      parameters: { path: this._config.skillPath, content: winner.candidate.body },
    };
    const classification = classifyAction(toolCall);

    const approved = await this._deps.approvalGate.requestApproval({
      skillId: this._config.skillId,
      skillPath: this._config.skillPath,
      diff: renderCandidateSummary(winner, frontierIds),
      classification,
    });
    if (!approved) return { approved: false, promoted: false };

    const promoted = await this._deps.promoter.promote(winner.candidate, winner.workspace);
    return { approved: true, promoted };
  }
}

/** A compact, human-readable summary of the winning candidate, for the approval prompt. */
function renderCandidateSummary(
  winner: CandidateRecord,
  frontierIds: readonly string[],
): string {
  const wins = Object.entries(winner.score.perTask)
    .filter(([, v]) => v > 0)
    .map(([taskId]) => taskId);
  const lines = [
    `Skill: ${winner.candidate.skillId}`,
    `Winning candidate: ${winner.candidate.id}${winner.candidate.label ? ` (${winner.candidate.label})` : ""}`,
    `Branch: ${winner.workspace?.branch ?? "(no isolated branch -- scored against the baseline catalog)"}`,
    `Held-out score: ${winner.score.heldOut.toFixed(3)}`,
    `Passes ${wins.length} task(s): ${wins.join(", ") || "(none)"}`,
    `Pareto frontier size: ${frontierIds.length}`,
    "",
    "Approve to merge this candidate branch into the live skill catalog. Declining leaves the catalog unchanged.",
  ];
  return lines.join("\n");
}
