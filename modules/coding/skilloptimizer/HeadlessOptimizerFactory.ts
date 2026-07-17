// ---------------------------------------------------------------------------
// v1.12.0 Phase 2 (adoption-ecosystem-2026-07 L1 / EM005) -- the production
// composition root for the v1.7.0 skill self-optimization loop.
//
// The engine (SkillOptimizer + its seams) shipped in v1.7.0 but had NO
// production factory: only tests ever constructed a runnable SkillOptimizer
// (the RT.P7.C / SO003.P3.D forward-tier gap). This module assembles a runnable
// SkillOptimizer from the shipped headless seams (HeadlessOptimizerRollout, the
// ReflexionEngine-backed diagnoser, the LLM proposer, the optional CriticAgent
// pre-filter, the fs path resolver + I/O) over an injected LLMClient PORT -- it
// never imports the concrete OllamaClient/OllamaHttp, so it stays inside the
// `no-llm-outside-llm-folder` rule; the CLI composition root creates the real
// client and injects it here.
//
// The human-approval-before-overwrite gate is a REQUIRED dependency: there is
// no default that writes. The two bundled gates below are the terminal cases
// (deny-all for dry-run, approve-all only for automation / tests); an
// interactive gate is supplied by the caller (the CLI's readline prompt).
//
// Boundary: vscode-free; pure assembly over injected seams.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { dirname, relative } from "node:path";
import { SkillOptimizer } from "./SkillOptimizer.js";
import { CandidateFrontier } from "./CandidateFrontier.js";
import { HeadlessOptimizerRollout } from "./HeadlessOptimizerRollout.js";
import {
  HeadlessCandidateProducer,
  HeadlessCandidatePromoter,
  HeadlessCandidateScorer,
} from "./HeadlessCandidateSeams.js";
import { WorktreeCandidateManager } from "./frontierWorktree.js";
import { ReflexionDiagnoser } from "./ReflexionDiagnoser.js";
import { LlmSkillEditProposer } from "./SkillEditProposer.js";
import { CriticEditReviewer } from "./EditCritic.js";
import { RootSkillPathResolver, fsSkillFileIO } from "./io.js";
import { ReflexionEngine } from "../orchestration/ReflexionEngine.js";
import { CriticAgent } from "../orchestration/CriticAgent.js";
import type { GitRunner } from "../agents/WorktreeManager.js";
import type { SplitGoldenTaskSpec } from "../evaluation/goldenSplit.js";
import type { LLMClient, LLMOptions } from "../llm/types.js";
import type {
  FailingTrajectory,
  LearningRateBudget,
  RejectedEditBufferPort,
  SkillEditApprovalGate,
  SkillEditApprovalRequest,
  SkillOptimizerConfig,
  SkillOptimizerDeps,
} from "./types.js";

/** Options for assembling a runnable {@link SkillOptimizer}. */
export interface HeadlessSkillOptimizerOptions {
  /** The resident LLM client PORT (created + injected by the composition root; never imported here). */
  readonly llm: LLMClient;
  /** Model id the rollout, diagnoser, proposer, and critic all run on. */
  readonly model: string;
  /** Golden-task snapshot root the rollout materializes worktrees from. */
  readonly snapshotRoot: string;
  /** Path-guard root: the skill file write is contained to this directory (fail-closed). */
  readonly catalogRoot: string;
  /** The rejected-edit buffer (production: core/memory/RejectedEditBuffer). */
  readonly buffer: RejectedEditBufferPort;
  /** REQUIRED human-approval gate -- no skill file is overwritten without an affirmative. */
  readonly approvalGate: SkillEditApprovalGate;
  /** Per-run optimizer config (rounds, learning-rate budget, gate). */
  readonly config: SkillOptimizerConfig;
  /** Add the CriticAgent cheap pre-rollout filter (default false: measure every proposal). */
  readonly withCritic?: boolean;
  /** Sampling options for the reflection / proposal / critic calls (default {}). */
  readonly llmOptions?: LLMOptions;
  /** Init a git baseline in each snapshot worktree (default false). */
  readonly initGit?: boolean;
  readonly now?: () => number;
}

/**
 * Assemble a runnable {@link SkillOptimizer} from the shipped v1.7.0 seams. The
 * caller owns the LLM client, the rejected-edit buffer, and the approval gate;
 * everything else is constructed here from those three plus the config.
 */
export function createHeadlessSkillOptimizer(
  options: HeadlessSkillOptimizerOptions,
): SkillOptimizer {
  const { llm, model, snapshotRoot, catalogRoot, buffer, approvalGate, config } = options;
  const llmOptions = options.llmOptions ?? {};
  const rollout = new HeadlessOptimizerRollout({
    llm,
    model,
    snapshotRoot,
    initGit: options.initGit ?? false,
    ...(options.now ? { now: options.now } : {}),
  });
  const diagnoser = new ReflexionDiagnoser(new ReflexionEngine(llm, model, llmOptions, null));
  const proposer = new LlmSkillEditProposer(llm, model, llmOptions);
  const pathResolver = new RootSkillPathResolver(catalogRoot);
  const editCritic = options.withCritic
    ? new CriticEditReviewer(new CriticAgent(llm, model, llmOptions))
    : undefined;

  const deps: SkillOptimizerDeps = editCritic
    ? { rollout, diagnoser, proposer, buffer, approvalGate, pathResolver, io: fsSkillFileIO, editCritic }
    : { rollout, diagnoser, proposer, buffer, approvalGate, pathResolver, io: fsSkillFileIO };

  return new SkillOptimizer(deps, config);
}

/**
 * Terminal deny-all gate: every proposed overwrite is declined. This is the
 * dry-run gate -- the loop still rolls out, reflects, proposes, and clears the
 * held-out gate, but no skill file is ever written.
 */
export const autoDenyApprovalGate: SkillEditApprovalGate = {
  requestApproval: async () => false,
};

/**
 * Terminal approve-all gate: every gate-clearing edit is written. For
 * non-interactive automation (an explicit `--apply --yes`) and tests ONLY --
 * never a default (the loop proposes; a human, or an explicit automation opt-in,
 * accepts).
 */
export const autoApproveApprovalGate: SkillEditApprovalGate = {
  requestApproval: async () => true,
};

/** A captured proposed skill-file overwrite: the write-ready content + how it renders. */
export interface CapturedSkillEdit {
  readonly skillId: string;
  readonly skillPath: string;
  readonly diff: string;
  /** The exact write-ready file content (empty only if the engine did not supply it). */
  readonly newContent: string;
}

/**
 * An approval gate that RECORDS each proposed overwrite and DENIES it (returns
 * false), so the loop proposes + gate-clears edits but writes nothing. Used by
 * an out-of-band approval flow (the desktop two-call preview/apply, EM.P2.A):
 * preview runs the loop with this gate and surfaces `captured` for review; apply
 * later writes the chosen `newContent` via a path-guarded io. It relies on the
 * optimizer populating `SkillEditApprovalRequest.newContent`.
 */
export class CapturingApprovalGate implements SkillEditApprovalGate {
  readonly captured: CapturedSkillEdit[] = [];

  async requestApproval(request: SkillEditApprovalRequest): Promise<boolean> {
    this.captured.push({
      skillId: request.skillId,
      skillPath: request.skillPath,
      diff: request.diff,
      newContent: request.newContent ?? "",
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// CandidateFrontier composition root (EM.P2.B) -- the GEPA/EvoSkill layer.
// ---------------------------------------------------------------------------

/** A fail-closed git runner over `git` on PATH; returns null on any error (no repo -> no isolation). */
const nodeGitRunner: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile(
      "git",
      [...args],
      { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });

/** Options for assembling a runnable {@link CandidateFrontier}. */
export interface HeadlessCandidateFrontierOptions {
  readonly llm: LLMClient;
  readonly model: string;
  readonly snapshotRoot: string;
  /** The target skill (id + path + current body); all candidates share this id. */
  readonly skill: { readonly id: string; readonly path: string; readonly body: string };
  /** Train split: rolled out to surface failing trajectories that seed candidate diversity. */
  readonly train: readonly SplitGoldenTaskSpec[];
  /** Validation split: the held-out aggregate the replacement rule + winner selection use. */
  readonly validation: readonly SplitGoldenTaskSpec[];
  /** REQUIRED human-approval gate -- a winning branch is never promoted without an affirmative. */
  readonly approvalGate: SkillEditApprovalGate;
  /** Hard population cap; also bounds how many failing-task seeds become candidates. */
  readonly maxCandidates: number;
  /** The per-candidate textual learning-rate budget. */
  readonly budget: LearningRateBudget;
  /** Git repo root for candidate branch isolation (default: the skill file's directory; degrades if not a repo). */
  readonly workspaceRoot?: string;
  /** Git runner (default: `git` on PATH, fail-closed). */
  readonly gitRunner?: GitRunner;
  readonly llmOptions?: LLMOptions;
  readonly initGit?: boolean;
  readonly now?: () => number;
}

/**
 * Assemble a runnable {@link CandidateFrontier} from the shipped v1.7 seams. This
 * runs an initial train rollout to derive up to `maxCandidates` diverse failure
 * diagnoses (one per failing task) that seed the producer -- so it is async. A
 * passing train split yields no diagnoses -> no candidates -> an empty frontier
 * that promotes nothing. Candidate branch isolation degrades to a body-override
 * measurement when git is unavailable (fault-tolerant).
 */
export async function createHeadlessCandidateFrontier(
  options: HeadlessCandidateFrontierOptions,
): Promise<CandidateFrontier> {
  const { llm, model, snapshotRoot, skill, approvalGate, maxCandidates, budget } = options;
  const llmOptions = options.llmOptions ?? {};
  const rollout = new HeadlessOptimizerRollout({
    llm,
    model,
    snapshotRoot,
    initGit: options.initGit ?? false,
    ...(options.now ? { now: options.now } : {}),
  });
  const diagnoser = new ReflexionDiagnoser(new ReflexionEngine(llm, model, llmOptions, null));
  const proposer = new LlmSkillEditProposer(llm, model, llmOptions);

  // Seed diversity: diagnose each failing train task (capped at the population size).
  const specById = new Map(options.train.map((t) => [t.id, t]));
  const trainResults = await rollout.run(options.train);
  const failing = trainResults.filter((r) => !r.passed).slice(0, maxCandidates);
  const diagnoses: string[] = [];
  for (const result of failing) {
    const spec = specById.get(result.taskId);
    const trajectory: FailingTrajectory = {
      taskId: result.taskId,
      taskName: spec?.name ?? result.taskId,
      taskDescription: spec?.description ?? "",
      failures: result.failures,
    };
    const diagnosis = await diagnoser.diagnose([trajectory]);
    if (diagnosis) diagnoses.push(diagnosis);
  }

  const producer = new HeadlessCandidateProducer({
    proposer,
    skillId: skill.id,
    baseBody: skill.body,
    diagnoses,
    budget,
  });
  const scorer = new HeadlessCandidateScorer({
    rollout,
    tasks: [...options.train, ...options.validation],
    heldOutTaskIds: new Set(options.validation.map((t) => t.id)),
  });
  const workspaceRoot = options.workspaceRoot ?? dirname(skill.path);
  const workspaces = new WorktreeCandidateManager(
    workspaceRoot,
    relative(workspaceRoot, skill.path),
    options.gitRunner ?? nodeGitRunner,
  );
  const promoter = new HeadlessCandidatePromoter({
    io: fsSkillFileIO,
    skillPathFor: () => skill.path,
  });

  return new CandidateFrontier(
    { producer, workspaces, scorer, approvalGate, promoter },
    { maxCandidates, skillId: skill.id, skillPath: skill.path },
  );
}
