// ---------------------------------------------------------------------------
// v1.7.0 SO001.P1.A -- the production AgentDriver.
//
// Adapts the vscode-free `HeadlessAgentSession` to the `AgentDriver` seam the
// `GoldenTaskRunner` consumes in live mode, so the golden suite (and the
// optimizer rollout / candidate scorer built on it) can drive the real agent
// loop against a snapshot in plain Node. This closes the Phase 1 deferral: the
// runner no longer needs a test-injected fake driver to run live.
//
// The driver optionally carries a `skillBody` override so the optimizer can
// evaluate a candidate skill edit without writing a file (the composition root
// constructs one driver per candidate; see OptimizerRollout / CandidateScorer).
// ---------------------------------------------------------------------------

import type {
  AgentDriver,
  AgentDriverContext,
  AgentRunOutcome,
} from "../evaluation/GoldenTaskRunner.js";
import type { LLMClient } from "../llm/types.js";
import { createHeadlessTools, type HeadlessTool } from "./headlessTools.js";
import { HeadlessAgentSession, type HeadlessAgentEvent } from "./HeadlessAgentSession.js";

export interface HeadlessAgentDriverOptions {
  /** Vendor-neutral LLM port (constructed by a composition root). */
  readonly llm: LLMClient;
  /** Registry model id to run against. */
  readonly model: string;
  /** Override the tool set (defaults to the full headless tool set). */
  readonly tools?: HeadlessTool[];
  /** Extra base instructions folded into the system prompt. */
  readonly systemInstructions?: string;
  /** Optional candidate skill body injected into the system prompt (optimizer). */
  readonly skillBody?: string;
  /** Injectable clock for deterministic duration in tests (default: Date.now). */
  readonly now?: () => number;
  /** Optional per-run event sink (the desktop sidecar streams these). */
  readonly onEvent?: (event: HeadlessAgentEvent) => void;
}

/**
 * Production `AgentDriver` over the headless runtime. Construct once per model
 * (or per candidate skill body); `run` is invoked by the `GoldenTaskRunner`.
 */
export class HeadlessAgentDriver implements AgentDriver {
  private readonly _session: HeadlessAgentSession;
  private readonly _opts: HeadlessAgentDriverOptions;
  private readonly _now: () => number;

  constructor(opts: HeadlessAgentDriverOptions) {
    this._session = new HeadlessAgentSession(opts.llm, opts.tools ?? createHeadlessTools());
    this._opts = opts;
    this._now = opts.now ?? (() => Date.now());
  }

  async run(ctx: AgentDriverContext): Promise<AgentRunOutcome> {
    const start = this._now();
    const result = await this._session.run({
      task: ctx.task.description,
      workdir: ctx.workdir,
      model: this._opts.model,
      systemInstructions: this._opts.systemInstructions,
      skillBody: this._opts.skillBody,
      maxIterations: ctx.task.maxIterations,
      signal: ctx.signal,
      onEvent: this._opts.onEvent,
    });
    const totalDurationMs = Math.max(0, this._now() - start);
    return {
      metrics: {
        totalDurationMs,
        toolStepCount: result.toolCalls,
        llmCallCount: result.llmCalls,
      },
      ...(result.finishReason === "error" && result.error !== undefined
        ? { error: result.error }
        : {}),
    };
  }
}
