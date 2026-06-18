/**
 * PanelRouter -- the opt-in budget-panel routing heuristic (comparison item F4).
 *
 * v1.6.0 adoption-openrouter-fusion Phase 4 (OF011). This is the model-routing
 * surface that operationalises Fusion's core economic claim for Nexus: for a
 * task flagged as benefiting from higher reliability, escalate to a diverse
 * small-model *panel* (fused by the local judge via `PanelExecutor`) instead of
 * selecting a single larger model that may not fit the user's VRAM.
 *
 * The capability ships **opt-in** behind `nexus.llm.panelRouting` (default off).
 * Per the comparison's gating, the default flips to on **only** on a measured
 * net win from the local A/B harness (OF010, `PanelAbHarness.decidePanelRoutingDefault`);
 * until such a win is recorded the conservative no-degradation default is off.
 * The shipped default decision is recorded in `PANEL_ROUTING_SHIPPED_DEFAULT`.
 *
 * Latency honesty (matching Fusion's own 2-3x disclosure): a panel is slower
 * than a single model -- it runs N panelists plus a judge. The heuristic only
 * escalates when the caller explicitly flags a task as reliability-sensitive,
 * so the slower path is never taken silently for ordinary requests.
 *
 * The decision (`decidePanelRoute`) is a pure function so every branch is
 * testable without a model; `PanelRouter` is the thin stateful wrapper that
 * delegates a `panel` decision to an injected `PanelExecutor` (which the
 * composition root builds with the Phase 3 `GpuScheduler` co-residency backend,
 * closing OF007.P3.A) and reports a `single` decision back to the caller.
 */

import type { PanelExecutor, PanelRunResult } from "../orchestration/PanelExecutor.js";

// ---------------------------------------------------------------------------
// Decision types
// ---------------------------------------------------------------------------

/** Inputs to one routing decision. */
export interface PanelRouteInput {
  /** The task / prompt being routed. */
  readonly task: string;
  /**
   * Caller signal that this task benefits from higher reliability. This is the
   * escalation trigger: ordinary tasks are never routed to a (slower) panel.
   */
  readonly highReliability?: boolean;
  /** The single model that would otherwise be selected for the task. */
  readonly singleModel: string;
  /** The distinct small-model panel available to escalate to. */
  readonly panelSpec: readonly string[];
}

/** The opt-in routing configuration (sourced from `nexus.llm.panelRouting`). */
export interface PanelRoutingConfig {
  /** The opt-in master switch. Default off (see `PANEL_ROUTING_SHIPPED_DEFAULT`). */
  readonly enabled: boolean;
  /** Minimum distinct panelists required to consider a panel. Floored at 2. */
  readonly minPanelSize?: number;
}

/** A routing decision: escalate to a panel, or stay on the single model. */
export type PanelRouteDecision =
  | { readonly kind: "panel"; readonly panel: readonly string[]; readonly reason: string }
  | { readonly kind: "single"; readonly model: string; readonly reason: string };

/** The result of routing: the decision, plus the panel run when one occurred. */
export interface PanelRouteResult {
  readonly decision: PanelRouteDecision;
  /** The fused panel run, or `null` when the decision was to use the single model. */
  readonly run: PanelRunResult | null;
}

/**
 * The default state of `nexus.llm.panelRouting` shipped in v1.6.0. Recorded as
 * a named constant (not just a magic `false` in two config files) so the
 * "default matches the A/B result" contract (OF011/OF012) has a single source
 * of truth that the package.json + settings defaults and the OF012 test all
 * reference. It is `false` because no local A/B net win has been measured yet
 * (the A/B harness, OF010, requires installed local models to run); enabling it
 * by default before a measured win would violate the no-degradation gate.
 */
export const PANEL_ROUTING_SHIPPED_DEFAULT = false;

/** Lowest panel size that can ever be a panel (a "panel" of one is a single model). */
export const MIN_PANEL_SIZE = 2;

// ---------------------------------------------------------------------------
// Pure decision function
// ---------------------------------------------------------------------------

/** Collapse a raw spec to its distinct, non-empty model ids, in order. */
function distinctModels(spec: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of spec) {
    const id = raw.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Decide whether to escalate a task to a small-model panel or keep it on the
 * single model. Pure and total. The panel is chosen only when ALL of:
 *   - panel routing is enabled (the opt-in `nexus.llm.panelRouting` switch);
 *   - the caller flagged the task as benefiting from higher reliability;
 *   - at least `minPanelSize` (>= 2) distinct panelists are available.
 * Otherwise the single model is used, with a reason explaining which gate held.
 */
export function decidePanelRoute(
  input: PanelRouteInput,
  config: PanelRoutingConfig,
): PanelRouteDecision {
  const single = (reason: string): PanelRouteDecision => ({
    kind: "single",
    model: input.singleModel,
    reason,
  });

  if (!config.enabled) {
    return single("panel routing disabled (opt-in nexus.llm.panelRouting is off)");
  }
  if (!input.highReliability) {
    return single("task not flagged as benefiting from higher reliability");
  }
  const panel = distinctModels(input.panelSpec);
  const minSize = Math.max(MIN_PANEL_SIZE, config.minPanelSize ?? MIN_PANEL_SIZE);
  if (panel.length < minSize) {
    return single(
      `panel too small: ${panel.length} distinct model(s), need >= ${minSize}`,
    );
  }
  return {
    kind: "panel",
    panel,
    reason: `escalated to a ${panel.length}-model panel for higher reliability`,
  };
}

// ---------------------------------------------------------------------------
// PanelRouter
// ---------------------------------------------------------------------------

export interface PanelRouterOptions {
  /**
   * The panel executor used when a `panel` decision is made. The composition
   * root builds this with the Phase 3 `GpuScheduler` co-residency backend so
   * the fan-out runs concurrently when VRAM permits (OF007.P3.A).
   */
  readonly executor: PanelExecutor;
  readonly config: PanelRoutingConfig;
}

export class PanelRouter {
  private readonly _executor: PanelExecutor;
  private readonly _config: PanelRoutingConfig;

  constructor(options: PanelRouterOptions) {
    this._executor = options.executor;
    this._config = options.config;
  }

  /** The decision for `input`, without running anything (pure delegation). */
  decide(input: PanelRouteInput): PanelRouteDecision {
    return decidePanelRoute(input, this._config);
  }

  /**
   * Route `input`: run the panel through the executor on a `panel` decision, or
   * return a `single` decision with no run. A `single` decision means the caller
   * proceeds with `decision.model` on its normal single-model path.
   */
  async route(input: PanelRouteInput): Promise<PanelRouteResult> {
    const decision = this.decide(input);
    if (decision.kind === "single") {
      return { decision, run: null };
    }
    const run = await this._executor.run(input.task, decision.panel);
    return { decision, run };
  }
}
