// ---------------------------------------------------------------------------
// v1.7.0 Phase 3 (adoption-self-optimizing-skills S2 + S6 / SO003 + SO004) --
// shared types for the bounded-edit skill optimizer.
//
// The optimizer reverse-engineers the SkillOpt/GEPA loop onto Nexus's existing
// spine: it rolls out the train split via the Phase 1 runner, reflects on
// failing trajectories with the existing `ReflexionEngine`/`CriticAgent`,
// proposes BOUNDED add/delete/replace edits to a skill `.md` under a textual
// learning-rate budget, accepts an edit ONLY when the Phase 2 held-out
// `validationGate` passes, buffers rejects in the Phase 2 `RejectedEditBuffer`,
// and -- crucially -- requires explicit HUMAN APPROVAL before any skill file is
// overwritten.
//
// Boundary: vscode-free. Every collaborator that is vscode-coupled (the real
// agent loop, the webview `ConfirmationGate`, `pathGuard.workspaceRoot`) is
// reached through an injected seam here -- the same discipline the Phase 1
// runner used for its `AgentDriver`. The composition root supplies the real
// implementations; tests supply deterministic fakes.
// ---------------------------------------------------------------------------

import type { ActionClassification } from "../guardrails/ActionClassifier.js";
import type { GoldenTaskResult } from "../evaluation/GoldenTaskSuite.js";
import type { GoldenTaskSpec } from "../evaluation/goldenTaskLoader.js";
import type { SplitGoldenTaskSpec } from "../evaluation/goldenSplit.js";
import type {
  ValidationGateOptions,
  ValidationGateReport,
} from "../evaluation/validationGate.js";
import type { Skill } from "../../../core/skills/SkillCatalog.js";

// ---------------------------------------------------------------------------
// Edit model
// ---------------------------------------------------------------------------

/** The three bounded edit operations the optimizer may propose on a skill body. */
export type SkillEditKind = "add" | "delete" | "replace";

/**
 * A single bounded edit operation on a skill `.md` body.
 *  - `add`: append `text` (or, when `match` is set, insert `text` after the
 *    first occurrence of `match`).
 *  - `delete`: remove the first occurrence of `match`.
 *  - `replace`: substitute the first occurrence of `match` with `text`.
 *
 * Operations are applied to the body text only; the YAML frontmatter is never
 * touched by the optimizer.
 */
export interface SkillEditOp {
  readonly kind: SkillEditKind;
  /** Substring to match for `delete`/`replace` (and optional anchor for `add`). */
  readonly match?: string;
  /** Text to insert (`add`) or substitute in (`replace`). */
  readonly text?: string;
}

/** A bounded edit proposal for one skill, produced by the {@link SkillEditProposer}. */
export interface ProposedSkillEdit {
  readonly skillId: string;
  readonly ops: readonly SkillEditOp[];
  /** Why the optimizer believes this edit fixes the diagnosed failures. */
  readonly rationale: string;
}

/**
 * The textual "learning rate" -- a hard cap on how much a single round may
 * change, so the optimizer takes small, reviewable steps rather than rewriting
 * a skill wholesale. An edit that exceeds either bound is rejected (and
 * buffered), never silently truncated.
 */
export interface LearningRateBudget {
  /** Maximum number of edit ops accepted in one round. */
  readonly maxOps: number;
  /** Maximum total changed characters (sum of inserted + removed text) per round. */
  readonly maxChangedChars: number;
}

// ---------------------------------------------------------------------------
// Rollout seam (over the Phase 1 runner + the deferred real AgentDriver)
// ---------------------------------------------------------------------------

/** A candidate skill body substituted for a rollout while measuring an edit. */
export interface SkillOverride {
  readonly skillId: string;
  readonly body: string;
}

/**
 * Runs a set of golden tasks and returns their scored results. When
 * `skillOverride` is present, the candidate skill body is substituted for the
 * run (the driver materializes it into the agent's skill catalog) so the gate
 * can measure the edit; without an override the live baseline catalog is used.
 *
 * The composition root implements this over the Phase 1 `GoldenTaskRunner` +
 * the real `AgentDriver` (deferred -- see `SO001.P1.A`); tests inject a
 * deterministic fake.
 */
export interface OptimizerRollout {
  run(
    tasks: readonly GoldenTaskSpec[],
    skillOverride?: SkillOverride,
  ): Promise<readonly GoldenTaskResult[]>;
}

// ---------------------------------------------------------------------------
// Reflection / proposal / critique seams
// ---------------------------------------------------------------------------

/** A single failing task, normalized for reflection. Failure text is redacted upstream. */
export interface FailingTrajectory {
  readonly taskId: string;
  readonly taskName: string;
  readonly taskDescription: string;
  /** Already-redacted failure strings from the scored result. */
  readonly failures: readonly string[];
}

/**
 * Diagnoses which skill text drove a minibatch of failing trajectories.
 * Default implementation composes the existing `ReflexionEngine`; the returned
 * string is the aggregated, secret-redacted analysis fed to the proposer.
 */
export interface FailureDiagnoser {
  diagnose(failures: readonly FailingTrajectory[]): Promise<string>;
}

/** Input handed to the {@link SkillEditProposer}. */
export interface ProposeInput {
  readonly skillId: string;
  /** Current skill body (markdown after the frontmatter). */
  readonly skillBody: string;
  /** Aggregated, redacted failure diagnosis from the {@link FailureDiagnoser}. */
  readonly diagnosis: string;
  /** The learning-rate budget the proposer must respect. */
  readonly budget: LearningRateBudget;
}

/**
 * Proposes a bounded edit from a diagnosis + the current skill body. Returns
 * `null` when no actionable edit can be produced (fail-closed: no edit beats a
 * bad edit). Default implementation calls the local `OllamaClient` port.
 */
export interface SkillEditProposer {
  propose(input: ProposeInput): Promise<ProposedSkillEdit | null>;
}

/** An advisory verdict on a proposed edit, before a (costly) validation rollout. */
export interface EditCriticVerdict {
  readonly approved: boolean;
  readonly feedback: string;
}

/**
 * Reviews a proposed edit against the diagnosis as a cheap pre-rollout filter.
 * Default implementation composes the existing `CriticAgent` (fail-open: a
 * parse failure approves, deferring to the load-bearing held-out gate).
 */
export interface EditCritic {
  review(edit: ProposedSkillEdit, diagnosis: string): Promise<EditCriticVerdict>;
}

// ---------------------------------------------------------------------------
// Guardrail seams (composition root adapts pathGuard + ConfirmationGate)
// ---------------------------------------------------------------------------

/** The request shown to the human before a skill file is overwritten. */
export interface SkillEditApprovalRequest {
  readonly skillId: string;
  /** Path-guarded absolute path that will be written. */
  readonly skillPath: string;
  /** Human-readable summary of the proposed edit (the diff the loop proposes). */
  readonly diff: string;
  /** The `ActionClassifier` verdict for the write (always DESTRUCTIVE for a skill overwrite). */
  readonly classification: ActionClassification;
}

/**
 * Brokers explicit human approval to overwrite a skill file. Returns `true`
 * ONLY on an affirmative human signal. The composition root adapts the webview
 * `ConfirmationGate.request`; tests inject a stub.
 */
export interface SkillEditApprovalGate {
  requestApproval(request: SkillEditApprovalRequest): Promise<boolean>;
}

/**
 * Resolves + validates that a skill path stays inside the skill-catalog root,
 * throwing on an escape (a path-traversal attempt). The composition root wires
 * `pathGuard.resolveInsideWorkspace(path, catalogRoot)`; the bundled default is
 * a vscode-free containment check.
 */
export interface SkillPathResolver {
  resolve(skillPath: string): string;
}

/** Minimal file I/O seam so the loop can be unit-tested without touching disk. */
export interface SkillFileIO {
  read(path: string): string;
  write(path: string, content: string): void;
}

// ---------------------------------------------------------------------------
// Optimizer construction + invocation
// ---------------------------------------------------------------------------

/** Collaborators injected into the {@link SkillOptimizer}. */
export interface SkillOptimizerDeps {
  readonly rollout: OptimizerRollout;
  readonly diagnoser: FailureDiagnoser;
  readonly proposer: SkillEditProposer;
  readonly buffer: RejectedEditBufferPort;
  readonly approvalGate: SkillEditApprovalGate;
  readonly pathResolver: SkillPathResolver;
  readonly io: SkillFileIO;
  /** Optional cheap pre-rollout filter. When omitted, every proposal is measured. */
  readonly editCritic?: EditCritic;
}

/**
 * The slice of the Phase 2 `RejectedEditBuffer` the optimizer needs. Declared
 * structurally so the loop depends on the capability, not the concrete class.
 */
export interface RejectedEditBufferPort {
  has(skillId: string, editHash: string): boolean;
  record(input: {
    skillId: string;
    editHash: string;
    reason: string;
    validationDelta: number;
    content: string;
  }): unknown;
}

/** Per-run optimizer configuration. */
export interface SkillOptimizerConfig {
  /** Runaway-prevention bound: caps optimizer rounds (reuses the v0.3.0 budget). */
  readonly maxRounds: number;
  /** The textual learning-rate budget enforced per round. */
  readonly learningRate: LearningRateBudget;
  /** Failing-trajectory minibatch size per reflection (default 3). */
  readonly minibatchSize?: number;
  /** Held-out validation gate tuning (default: any improvement, zero regressions). */
  readonly gate?: ValidationGateOptions;
}

/** A target skill plus the optimizer-visible task splits to drive it. */
export interface OptimizeInput {
  /** The skill whose `.md` the optimizer is allowed to edit. */
  readonly target: Skill;
  /** Train split: rolled out to surface failing trajectories. */
  readonly train: readonly SplitGoldenTaskSpec[];
  /** Validation split: the held-out gate (the optimizer never sees `test`). */
  readonly validation: readonly SplitGoldenTaskSpec[];
}

/** What happened to a single round's proposed edit. */
export type RoundOutcome =
  | "accepted-applied"
  | "accepted-not-approved"
  | "rejected-gate"
  | "rejected-budget"
  | "rejected-critic"
  | "rejected-path"
  | "no-proposal";

/** The result of one optimizer round. */
export interface SkillOptimizationRound {
  readonly round: number;
  readonly skillId: string;
  readonly outcome: RoundOutcome;
  readonly editHash?: string;
  readonly gate?: ValidationGateReport;
  readonly approved?: boolean;
  readonly applied?: boolean;
  /** Human-readable explanation of the outcome. */
  readonly reason: string;
}

/** Why the optimizer loop stopped. */
export type StopReason =
  | "no-failing-tasks"
  | "budget-exhausted"
  | "no-progress";

/** The full result of an optimizer run. */
export interface SkillOptimizationResult {
  readonly skillId: string;
  readonly rounds: readonly SkillOptimizationRound[];
  /** Edits written to disk after human approval. */
  readonly appliedCount: number;
  /** Edits that cleared the held-out gate (whether or not approved). */
  readonly acceptedCount: number;
  /** Edits buffered (gate / budget / critic rejections). */
  readonly rejectedCount: number;
  readonly stopReason: StopReason;
}
