// ---------------------------------------------------------------------------
// v1.7.0 SO003.P3.B -- the production OptimizerRollout.
//
// Implements the `OptimizerRollout` seam the `SkillOptimizer` consumes, over
// the real headless agent (Phase 1 runner + the SO001.P1.A `HeadlessAgentDriver`)
// instead of the injected fake used in the Phase 3 unit tests. For each task it
// runs `runGoldenTask` in live mode against a fresh snapshot copy; when a
// `SkillOverride` is supplied it constructs a driver that injects the candidate
// skill body into the agent's system prompt, so a candidate edit is evaluated
// without ever writing a skill file. Tasks run sequentially -- the single-GPU
// discipline shared with the swarm.
// ---------------------------------------------------------------------------

import { runGoldenTask } from "../evaluation/GoldenTaskRunner.js";
import type { GoldenTaskResult } from "../evaluation/GoldenTaskSuite.js";
import type { GoldenTaskSpec } from "../evaluation/goldenTaskLoader.js";
import type { LLMClient } from "../llm/types.js";
import { HeadlessAgentDriver } from "../runtime/HeadlessAgentDriver.js";
import type { OptimizerRollout, SkillOverride } from "./types.js";

export interface HeadlessOptimizerRolloutOptions {
  /** Vendor-neutral LLM port (constructed by a composition root). */
  readonly llm: LLMClient;
  /** Registry model id the rollout runs against. */
  readonly model: string;
  /** Directory holding `<taskId>/` snapshot subdirectories. */
  readonly snapshotRoot: string;
  /** Extra base instructions folded into every run's system prompt. */
  readonly systemInstructions?: string;
  /** Initialize a git baseline in each snapshot copy (default: false). */
  readonly initGit?: boolean;
  /** Injectable clock for deterministic duration in tests. */
  readonly now?: () => number;
}

/**
 * Production `OptimizerRollout` over the headless agent. Construct once per
 * optimizer session; `run` is called by the loop for the baseline and for each
 * candidate (with a `SkillOverride`).
 */
export class HeadlessOptimizerRollout implements OptimizerRollout {
  constructor(private readonly _opts: HeadlessOptimizerRolloutOptions) {}

  async run(
    tasks: readonly GoldenTaskSpec[],
    skillOverride?: SkillOverride,
  ): Promise<readonly GoldenTaskResult[]> {
    // One driver per rollout call carries the (optional) candidate skill body,
    // so the baseline run and each candidate run are cleanly isolated.
    const driver = new HeadlessAgentDriver({
      llm: this._opts.llm,
      model: this._opts.model,
      systemInstructions: this._opts.systemInstructions,
      skillBody: skillOverride?.body,
      now: this._opts.now,
    });

    const results: GoldenTaskResult[] = [];
    for (const task of tasks) {
      results.push(
        await runGoldenTask(task, {
          mode: "live",
          driver,
          snapshotRoot: this._opts.snapshotRoot,
          initGit: this._opts.initGit ?? false,
          now: this._opts.now,
        }),
      );
    }
    return results;
  }
}
