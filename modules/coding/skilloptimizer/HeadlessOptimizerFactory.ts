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

import { SkillOptimizer } from "./SkillOptimizer.js";
import { HeadlessOptimizerRollout } from "./HeadlessOptimizerRollout.js";
import { ReflexionDiagnoser } from "./ReflexionDiagnoser.js";
import { LlmSkillEditProposer } from "./SkillEditProposer.js";
import { CriticEditReviewer } from "./EditCritic.js";
import { RootSkillPathResolver, fsSkillFileIO } from "./io.js";
import { ReflexionEngine } from "../orchestration/ReflexionEngine.js";
import { CriticAgent } from "../orchestration/CriticAgent.js";
import type { LLMClient, LLMOptions } from "../llm/types.js";
import type {
  RejectedEditBufferPort,
  SkillEditApprovalGate,
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
