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
  /**
   * The exact write-ready file content this edit would produce (frontmatter +
   * edited body). Set by the optimizer's write path so a capturing gate can bind
   * a later (out-of-band) approval to the precise previewed bytes -- e.g. the
   * desktop two-call preview/apply flow (EM.P2.A). Optional: gates that approve
   * inline (CLI readline, auto gates) ignore it, and the frontier promotion path
   * does not set it.
   */
  readonly newContent?: string;
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

// ---------------------------------------------------------------------------
// v1.7.0 Phase 4 (adoption-self-optimizing-skills S3 / SO005) -- Pareto-frontier
// candidate management on git branches.
//
// The evolutionary (GEPA/EvoSkill) layer on top of the Phase 3 single-file loop:
// the optimizer produces >= 2 skill-edit CANDIDATES, each is materialized on its
// own git branch (worktree-isolated) and scored across the diverse task set, and
// the non-dominated (Pareto) set is kept -- candidates that each win on different
// tasks all survive. A bounded population (the hard candidate cap, mirroring the
// swarm worker cap + the GPU/VRAM gate) is maintained by the EvoSkill replacement
// rule: a challenger replaces the lowest-held-out incumbent ONLY when it beats it
// on the held-out split. A winning branch is NEVER auto-merged -- it is surfaced
// for explicit human approval (reusing the Phase 3 approval gate).
//
// Boundary: vscode-free. The branch materialization, candidate scoring (over the
// Phase 1 runner), candidate production (over the Phase 3 optimizer), and the
// live-catalog merge are all reached through injected seams -- the same
// discipline the rest of this module uses.
// ---------------------------------------------------------------------------

/** A per-task objective score vector (task id -> score in [0,1]); the Pareto axes. */
export type PerTaskScores = Readonly<Record<string, number>>;

/** A skill-edit candidate variant produced by the optimizer, before scoring. */
export interface SkillCandidate {
  /** Stable id (the content hash of the underlying edit, or a caller-supplied id). */
  readonly id: string;
  readonly skillId: string;
  /** The candidate skill `.md` body (frontmatter is applied at materialization). */
  readonly body: string;
  /** Optional human-readable label (e.g. the edit rationale) shown at approval. */
  readonly label?: string;
}

/** An isolated git branch + worktree materialized for one candidate. */
export interface CandidateWorkspace {
  readonly candidateId: string;
  /** The branch the candidate lives on (the ref survives the worktree auto-clean). */
  readonly branch: string;
  /** Absolute path to the ephemeral worktree checkout. */
  readonly path: string;
}

/**
 * A candidate's measured scores across the diverse task set.
 *  - `perTask`: the Pareto objective vector (task id -> [0,1] score).
 *  - `heldOut`: the aggregate held-out (validation) score used for the bounded
 *    population's replacement rule.
 */
export interface CandidateScore {
  readonly candidateId: string;
  readonly perTask: PerTaskScores;
  readonly heldOut: number;
}

/** Produces the raw candidate variants the frontier ranks (>= 2 to be useful). */
export interface CandidateProducer {
  produce(): Promise<readonly SkillCandidate[]>;
}

/**
 * Materializes a candidate on its own git branch (in an isolated worktree) and
 * cleans the ephemeral worktree up afterwards (the branch ref is retained for a
 * later, approved merge). The composition root wires this over the v1.5.0
 * `WorktreeManager` + `GitSafetyNet`; tests inject a fake. Every operation is
 * fault-tolerant: `create` returns null when isolation is unavailable (git-less
 * or non-repo) so the frontier degrades to a baseline-catalog score instead of
 * throwing.
 */
export interface CandidateWorkspaceManager {
  create(candidate: SkillCandidate): Promise<CandidateWorkspace | null>;
  /** Remove the ephemeral worktree (returns whether it was removed). */
  cleanup(workspace: CandidateWorkspace): Promise<boolean>;
}

/**
 * Scores a candidate across the diverse task set. When `workspace` is present the
 * candidate runs on its isolated branch; when null (isolation unavailable) the
 * scorer falls back to a baseline-catalog measurement. The composition root wires
 * this over the Phase 1 `GoldenTaskRunner` (via the `OptimizerRollout` seam);
 * tests inject a deterministic fake.
 */
export interface CandidateScorer {
  score(
    candidate: SkillCandidate,
    workspace: CandidateWorkspace | null,
  ): Promise<CandidateScore>;
}

/**
 * Promotes an APPROVED winning candidate branch into the live skill catalog. This
 * is the ONLY merge path and is reachable ONLY after an explicit human-approval
 * signal -- the frontier never auto-merges. The composition root wires this over
 * `GitSafetyNet` (checkpoint + merge the branch); tests inject a fake. Deferred at
 * the composition root, mirroring the Phase 3 write guardrail.
 */
export interface CandidatePromoter {
  promote(
    candidate: SkillCandidate,
    workspace: CandidateWorkspace | null,
  ): Promise<boolean>;
}

/** Collaborators injected into the {@link CandidateFrontier}. */
export interface CandidateFrontierDeps {
  readonly producer: CandidateProducer;
  readonly workspaces: CandidateWorkspaceManager;
  readonly scorer: CandidateScorer;
  /** Reused from Phase 3: brokers explicit human approval before any promotion. */
  readonly approvalGate: SkillEditApprovalGate;
  readonly promoter: CandidatePromoter;
}

/** Per-run frontier configuration. */
export interface CandidateFrontierConfig {
  /**
   * Hard cap on the retained candidate population. Mirrors the swarm worker cap +
   * the GPU/VRAM gate: at a composition root this is set from the hardware tier's
   * `maxConcurrentSubAgents`. Candidates beyond the cap must win a replacement.
   */
  readonly maxCandidates: number;
  /**
   * The held-out margin a challenger must EXCEED to replace the lowest incumbent
   * (default 0 -- a strict improvement; a tie does not replace).
   */
  readonly replacementMargin?: number;
  /** The skill the frontier is optimizing (all candidates share this id). */
  readonly skillId: string;
  /** Path-guarded skill file the approved winner would eventually be merged into. */
  readonly skillPath: string;
}

/** What happened to a produced candidate against the bounded population. */
export type CandidateAdmission =
  | "admitted" // population under the cap; added
  | "replaced-lowest" // beat the lowest incumbent on held-out; swapped in
  | "rejected-cap"; // population at the cap and did not beat the lowest incumbent

/** The record for one evaluated candidate. */
export interface CandidateRecord {
  readonly candidate: SkillCandidate;
  /**
   * The isolated branch/worktree the candidate ran on (null when isolation was
   * unavailable and it was scored against the baseline catalog). The worktree is
   * auto-cleaned after scoring; the branch ref persists here for promotion.
   */
  readonly workspace: CandidateWorkspace | null;
  readonly score: CandidateScore;
  readonly admission: CandidateAdmission;
}

/** The full result of a frontier evolution pass. */
export interface FrontierResult {
  readonly skillId: string;
  /** Every candidate evaluated, in production order (includes `rejected-cap`). */
  readonly evaluated: readonly CandidateRecord[];
  /** The retained population after the cap + replacement rule (never larger than the cap). */
  readonly population: readonly CandidateRecord[];
  /** The non-dominated (Pareto) candidate ids across the diverse tasks. */
  readonly frontier: readonly string[];
  /** The winner surfaced for approval (highest held-out among the frontier), if any. */
  readonly winnerId?: string;
  /** Whether human approval to promote the winner was requested. */
  readonly approvalRequested: boolean;
  /** Whether the human approved promotion (false when withheld or not requested). */
  readonly approved: boolean;
  /** Whether the winning branch was promoted (ONLY ever true after approval). */
  readonly promoted: boolean;
}
