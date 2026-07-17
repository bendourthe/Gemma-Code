// ---------------------------------------------------------------------------
// v1.7.0 Phase 3 (adoption-self-optimizing-skills S2 / SO003) -- the
// bounded-edit skill optimizer loop.
//
// The reverse-engineered SkillOpt/GEPA loop, composed from the existing spine:
//
//   rollout(train)            -- Phase 1 runner: scored GoldenTaskResults
//     -> reflect(failing)      -- ReflexionEngine/CriticAgent (which skill text drove the failures)
//     -> propose bounded edit  -- under a textual learning-rate budget
//     -> held-out validation   -- Phase 2 validationGate over the validation split
//     -> on accept: human-approval-gated overwrite (pathGuard/ActionClassifier/ConfirmationGate)
//     -> on reject: RejectedEditBuffer (content-addressed, redacted)
//
// Safety invariants (the load-bearing guardrails):
//   - NO skill file is ever written without an explicit human-approval signal.
//   - An accepted edit is classified (write_file -> DESTRUCTIVE) and its path is
//     resolved inside the catalog root (fail-closed on traversal) before the
//     approval prompt.
//   - Trajectory text is treated as untrusted input and run through redactSecrets.
//   - The whole loop is bounded by the v0.3.0 runaway-prevention BudgetMiddleware,
//     and each edit is bounded by the per-round textual learning-rate budget.
//   - A re-proposed (already-attempted or already-buffered) edit halts the loop
//     ("no-progress") so it can never spin.
//
// Boundary: vscode-free. Every vscode-coupled collaborator is reached through an
// injected seam (the same discipline the Phase 1 runner used for AgentDriver).
// ---------------------------------------------------------------------------

import { BudgetMiddleware } from "../../../src/tools/BudgetMiddleware.js";
import { redactSecrets } from "../../../core/observability/redactSecrets.js";
import type { ToolCall } from "../../../src/tools/types.js";
import { classifyAction } from "../guardrails/ActionClassifier.js";
import { assertNoTestSplit } from "../evaluation/goldenSplit.js";
import { evaluateValidationGate } from "../evaluation/validationGate.js";
import type { GoldenTaskResult } from "../evaluation/GoldenTaskSuite.js";
import type { GoldenTaskSpec } from "../evaluation/goldenTaskLoader.js";
import {
  applySkillEditOps,
  editChangedChars,
  hashSkillEdit,
  reassembleSkillFile,
  renderEditDiff,
  serializeSkillEdit,
  withinLearningRate,
} from "./skillEdit.js";
import type {
  FailingTrajectory,
  ProposedSkillEdit,
  RoundOutcome,
  SkillOptimizationResult,
  SkillOptimizationRound,
  SkillOptimizerConfig,
  SkillOptimizerDeps,
  StopReason,
  OptimizeInput,
} from "./types.js";
import type { Skill } from "../../../core/skills/SkillCatalog.js";

const DEFAULT_MINIBATCH_SIZE = 3;

interface ApplyOutcome {
  readonly applied: boolean;
  readonly approved: boolean;
  /** Set when the write was refused because the path escaped the catalog root. */
  readonly pathRejected?: boolean;
  readonly reason: string;
}

/**
 * The bounded-edit skill optimizer. Construct once with its collaborators, then
 * call `optimize` per target skill.
 */
export class SkillOptimizer {
  constructor(
    private readonly _deps: SkillOptimizerDeps,
    private readonly _config: SkillOptimizerConfig,
  ) {
    if (_config.maxRounds < 1) {
      throw new Error("SkillOptimizer: maxRounds must be >= 1");
    }
    if (_config.learningRate.maxOps < 1 || _config.learningRate.maxChangedChars < 1) {
      throw new Error("SkillOptimizer: learningRate.maxOps and maxChangedChars must be >= 1");
    }
  }

  /**
   * Run the optimization loop against one skill. Never overwrites a skill file
   * without human approval; never reaches the `test` split.
   */
  async optimize(input: OptimizeInput): Promise<SkillOptimizationResult> {
    // Defense-in-depth contamination guard: the optimizer must never see `test`.
    assertNoTestSplit([...input.train, ...input.validation]);

    const skill = input.target;
    const minibatchSize = this._config.minibatchSize ?? DEFAULT_MINIBATCH_SIZE;
    const specById = new Map<string, GoldenTaskSpec>(input.train.map((t) => [t.id, t]));

    // The runaway-prevention budget caps the number of rounds.
    const budget = new BudgetMiddleware({
      maxIterations: this._config.maxRounds,
      maxSessionTokens: Number.MAX_SAFE_INTEGER,
      maxTurnTokens: Number.MAX_SAFE_INTEGER,
      warningThresholdPercent: 100,
    });

    const originalContent = this._deps.io.read(skill.path);
    let currentBody = input.target.body;

    let baselineValidation = await this._deps.rollout.run(input.validation);

    const rounds: SkillOptimizationRound[] = [];
    const attempted = new Set<string>();
    let appliedCount = 0;
    let acceptedCount = 0;
    let rejectedCount = 0;
    let stopReason: StopReason = "budget-exhausted";

    for (;;) {
      const pre = budget.checkPreTurn();
      if (!pre.allowed) {
        stopReason = "budget-exhausted";
        break;
      }
      budget.recordIteration();
      const round = budget.getState().iterationsUsed;

      // 1. Roll out the train split and surface failing trajectories.
      const trainResults = await this._deps.rollout.run(input.train);
      const failing = trainResults.filter((r) => !r.passed);
      if (failing.length === 0) {
        stopReason = "no-failing-tasks";
        break;
      }

      // 2. Reflect on a minibatch of failures (redacted, untrusted input).
      const minibatch = failing.slice(0, minibatchSize).map((r) => toTrajectory(r, specById));
      const diagnosis = await this._deps.diagnoser.diagnose(minibatch);

      // 3. Propose a bounded edit.
      const proposed = await this._deps.proposer.propose({
        skillId: skill.id,
        skillBody: currentBody,
        diagnosis,
        budget: this._config.learningRate,
      });
      if (!proposed) {
        rounds.push(record(round, skill.id, "no-proposal", "the proposer returned no actionable edit"));
        stopReason = "no-progress";
        break;
      }

      const editHash = hashSkillEdit(proposed);
      if (attempted.has(editHash) || this._deps.buffer.has(skill.id, editHash)) {
        rounds.push(
          record(
            round,
            skill.id,
            "no-proposal",
            "the proposer re-produced an already-attempted or buffered edit; halting to avoid a loop",
            editHash,
          ),
        );
        stopReason = "no-progress";
        break;
      }
      attempted.add(editHash);

      // 3b. Enforce the textual learning-rate budget.
      if (!withinLearningRate(proposed, this._config.learningRate)) {
        const reason = `exceeds learning-rate budget (${proposed.ops.length} ops / ${editChangedChars(proposed.ops)} chars vs ${this._config.learningRate.maxOps} ops / ${this._config.learningRate.maxChangedChars} chars)`;
        this._bufferReject(proposed, editHash, reason, 0, diagnosis);
        rejectedCount++;
        rounds.push(record(round, skill.id, "rejected-budget", reason, editHash));
        continue;
      }

      // 3c. Optional cheap critic pre-filter.
      if (this._deps.editCritic) {
        const verdict = await this._deps.editCritic.review(proposed, diagnosis);
        if (!verdict.approved) {
          const reason = `critic rejected: ${verdict.feedback}`;
          this._bufferReject(proposed, editHash, reason, 0, diagnosis);
          rejectedCount++;
          rounds.push(record(round, skill.id, "rejected-critic", reason, editHash));
          continue;
        }
      }

      // 4. Apply to a candidate body and measure on the held-out validation split.
      const candidateBody = applySkillEditOps(currentBody, proposed.ops);
      const afterValidation = await this._deps.rollout.run(input.validation, {
        skillId: skill.id,
        body: candidateBody,
      });
      const gate = evaluateValidationGate(baselineValidation, afterValidation, this._config.gate);
      if (!gate.accepted) {
        this._bufferReject(proposed, editHash, gate.reason, gate.aggregateDelta, diagnosis);
        rejectedCount++;
        rounds.push(record(round, skill.id, "rejected-gate", gate.reason, editHash, gate));
        continue;
      }

      // 5. Accepted by the held-out gate -> route through the approval guardrail.
      acceptedCount++;
      const apply = await this._applyAcceptedEdit(skill, proposed, originalContent, candidateBody);
      if (apply.pathRejected) {
        rounds.push(record(round, skill.id, "rejected-path", apply.reason, editHash, gate, apply.approved, false));
        stopReason = "no-progress";
        break;
      }
      if (apply.applied) {
        appliedCount++;
        currentBody = candidateBody; // subsequent edits build on the applied body
        baselineValidation = afterValidation; // a real improvement becomes the new baseline
        rounds.push(
          record(round, skill.id, "accepted-applied", `accepted + written after approval: ${gate.reason}`, editHash, gate, true, true),
        );
        continue;
      }
      // Accepted by the gate but the human withheld approval: do not write, and
      // halt (re-proposing the same edit would only spin).
      rounds.push(
        record(round, skill.id, "accepted-not-approved", "cleared the held-out gate but human approval was withheld; not written", editHash, gate, false, false),
      );
      stopReason = "no-progress";
      break;
    }

    return { skillId: skill.id, rounds, appliedCount, acceptedCount, rejectedCount, stopReason };
  }

  /**
   * Route an accepted edit through the guardrail chain and overwrite the skill
   * file ONLY on an explicit human-approval signal. Returns whether the file was
   * written. A path that escapes the catalog root is refused (fail-closed) and
   * never written.
   */
  private async _applyAcceptedEdit(
    skill: Skill,
    proposed: ProposedSkillEdit,
    originalContent: string,
    candidateBody: string,
  ): Promise<ApplyOutcome> {
    const newContent = reassembleSkillFile(originalContent, candidateBody);

    // Classify the write (a skill overwrite is a DESTRUCTIVE write_file).
    const toolCall: ToolCall = {
      tool: "write_file",
      id: `skill-opt:${skill.id}`,
      parameters: { path: skill.path, content: newContent },
    };
    const classification = classifyAction(toolCall);

    // Path-guard: resolve inside the catalog root; refuse a traversal.
    let resolvedPath: string;
    try {
      resolvedPath = this._deps.pathResolver.resolve(skill.path);
    } catch (err) {
      return { applied: false, approved: false, pathRejected: true, reason: `path rejected: ${(err as Error).message}` };
    }

    // The one and only gate to a write: explicit human approval.
    const approved = await this._deps.approvalGate.requestApproval({
      skillId: skill.id,
      skillPath: resolvedPath,
      diff: renderEditDiff(proposed),
      classification,
      newContent,
    });
    if (!approved) {
      return { applied: false, approved: false, reason: "human approval withheld" };
    }

    this._deps.io.write(resolvedPath, newContent);
    return { applied: true, approved: true, reason: "written after approval" };
  }

  /** Record a rejected edit in the buffer (content + reason redacted on write). */
  private _bufferReject(
    edit: ProposedSkillEdit,
    editHash: string,
    reason: string,
    validationDelta: number,
    diagnosis: string,
  ): void {
    this._deps.buffer.record({
      skillId: edit.skillId,
      editHash,
      reason,
      validationDelta,
      content: redactSecrets(`${serializeSkillEdit(edit)}\n--- diagnosis ---\n${diagnosis}`),
    });
  }
}

/** Normalize a failing scored result into a redacted trajectory for reflection. */
function toTrajectory(r: GoldenTaskResult, specById: Map<string, GoldenTaskSpec>): FailingTrajectory {
  const spec = specById.get(r.taskId);
  return {
    taskId: r.taskId,
    taskName: spec?.name ?? r.taskId,
    taskDescription: spec?.description ?? "",
    failures: r.failures.map((f) => redactSecrets(f)),
  };
}

/** Build a round record (keeps the loop body terse). */
function record(
  round: number,
  skillId: string,
  outcome: RoundOutcome,
  reason: string,
  editHash?: string,
  gate?: SkillOptimizationRound["gate"],
  approved?: boolean,
  applied?: boolean,
): SkillOptimizationRound {
  return { round, skillId, outcome, reason, editHash, gate, approved, applied };
}
