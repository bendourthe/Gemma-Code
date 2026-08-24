/**
 * v2.1.0 Phase 2 -- cheap-first escalation policy (Switchyard-derived).
 *
 * Planner/critic pin to the strong model. Worker steps start on the Phase 1
 * `role: worker-candidate` model. Per-turn thresholds escalate; hysteresis
 * and a session swap budget prevent thrash. Cooldown wins conflicts.
 *
 * GPU swap cost is applied by the caller via {@link applySwapGate}; this
 * module stays vscode-free and does not import core/scheduler (DAG tests
 * stub the gate).
 */

import type { TelemetryBus } from "../../../../core/telemetry/TelemetryBus.js";
import type { SwapOutcome } from "../../../../core/scheduler/modelSwap.js";
import {
  computeRoutingSignals,
  type RoutingRole,
  type RoutingSignals,
  type RoutingTurnEvent,
} from "./RoutingSignals.js";

export interface RoutingPolicyConfig {
  readonly consecutiveToolErrors: number;
  readonly identicalActionRepeats: number;
  readonly stepsWithoutProgress: number;
  readonly sessionEscalations: number;
  readonly sessionEscalationWindow: number;
  readonly minTurnsOnModel: number;
  readonly swapBudget: number;
  readonly cooldownTurns: number;
}

export const DEFAULT_ROUTING_POLICY: RoutingPolicyConfig = Object.freeze({
  consecutiveToolErrors: 3,
  identicalActionRepeats: 2,
  stepsWithoutProgress: 8,
  sessionEscalations: 2,
  sessionEscalationWindow: 8,
  minTurnsOnModel: 2,
  swapBudget: 4,
  cooldownTurns: 2,
});

export type RoutingAction = "hold" | "escalate" | "de-escalate" | "pin";

export interface RoutingDecision {
  readonly sessionId: string;
  readonly turn: number;
  readonly role: RoutingRole;
  readonly action: RoutingAction;
  readonly modelId: string;
  readonly previousModelId: string;
  readonly reason: string;
  readonly signals: RoutingSignals;
  readonly notice?: string;
  readonly swapOutcome?: SwapOutcome;
  readonly deferred?: boolean;
  readonly keepWorkerResident?: boolean;
}

export interface RoutingModels {
  readonly workerId: string;
  readonly strongId: string;
  readonly installed: ReadonlySet<string>;
}

export interface SessionRoutingState {
  currentModelId: string;
  currentTier: "worker" | "strong";
  turnsOnModel: number;
  swapCount: number;
  turnEscalations: number[];
  sessionPinned: boolean;
  cooldownUntilTurn: number;
  deferredEscalate: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

/**
 * Load policy config. Malformed input yields compiled defaults (never throws).
 */
export function parseRoutingConfig(raw: unknown): {
  readonly config: RoutingPolicyConfig;
  readonly rejected: boolean;
} {
  if (raw === undefined || raw === null) {
    return { config: DEFAULT_ROUTING_POLICY, rejected: false };
  }
  if (!isRecord(raw)) {
    return { config: DEFAULT_ROUTING_POLICY, rejected: true };
  }
  return {
    rejected: false,
    config: {
      consecutiveToolErrors: positiveInt(
        raw.consecutiveToolErrors,
        DEFAULT_ROUTING_POLICY.consecutiveToolErrors,
      ),
      identicalActionRepeats: positiveInt(
        raw.identicalActionRepeats,
        DEFAULT_ROUTING_POLICY.identicalActionRepeats,
      ),
      stepsWithoutProgress: positiveInt(
        raw.stepsWithoutProgress,
        DEFAULT_ROUTING_POLICY.stepsWithoutProgress,
      ),
      sessionEscalations: positiveInt(
        raw.sessionEscalations,
        DEFAULT_ROUTING_POLICY.sessionEscalations,
      ),
      sessionEscalationWindow: positiveInt(
        raw.sessionEscalationWindow,
        DEFAULT_ROUTING_POLICY.sessionEscalationWindow,
      ),
      minTurnsOnModel: positiveInt(
        raw.minTurnsOnModel,
        DEFAULT_ROUTING_POLICY.minTurnsOnModel,
      ),
      swapBudget: positiveInt(raw.swapBudget, DEFAULT_ROUTING_POLICY.swapBudget),
      cooldownTurns: positiveInt(
        raw.cooldownTurns,
        DEFAULT_ROUTING_POLICY.cooldownTurns,
      ),
    },
  };
}

export function pickWorkerCandidate(
  entries: ReadonlyArray<{ readonly id: string; readonly role?: string; readonly tags?: readonly string[] }>,
  installed?: ReadonlySet<string>,
): string | undefined {
  const candidates = entries.filter(
    (e) => e.role === "worker-candidate" || e.tags?.includes("worker-candidate"),
  );
  const prefer = [...candidates].sort((a, b) => {
    const aOff = a.id.includes("offload") ? 1 : 0;
    const bOff = b.id.includes("offload") ? 1 : 0;
    return aOff - bOff;
  });
  if (installed && installed.size > 0) {
    return prefer.find((c) => installed.has(c.id))?.id ?? prefer[0]?.id;
  }
  return prefer[0]?.id;
}

function signalsTrip(signals: RoutingSignals, cfg: RoutingPolicyConfig): boolean {
  return (
    signals.consecutiveToolErrors >= cfg.consecutiveToolErrors ||
    signals.identicalActionRepeats >= cfg.identicalActionRepeats ||
    signals.stepsWithoutProgress >= cfg.stepsWithoutProgress
  );
}

function signalsQuiet(signals: RoutingSignals, cfg: RoutingPolicyConfig): boolean {
  return (
    signals.consecutiveToolErrors === 0 &&
    signals.identicalActionRepeats < cfg.identicalActionRepeats &&
    signals.stepsWithoutProgress < Math.max(2, Math.floor(cfg.stepsWithoutProgress / 2))
  );
}

function installedOr(id: string, installed: ReadonlySet<string>, fallback: string): {
  id: string;
  missing: boolean;
} {
  if (installed.size === 0 || installed.has(id)) return { id, missing: false };
  return { id: fallback, missing: true };
}

export class EscalationPolicy {
  private readonly _sessions = new Map<string, SessionRoutingState>();
  private readonly _cfg: RoutingPolicyConfig;
  private readonly _rejectedConfig: boolean;

  constructor(
    config: unknown = DEFAULT_ROUTING_POLICY,
    private readonly _telemetry?: TelemetryBus,
    private readonly _log: (msg: string) => void = () => undefined,
  ) {
    const parsed = parseRoutingConfig(config);
    this._cfg = parsed.config;
    this._rejectedConfig = parsed.rejected;
    if (parsed.rejected) {
      this._log("routing policy config rejected; using compiled defaults");
    }
  }

  get config(): RoutingPolicyConfig {
    return this._cfg;
  }

  get usedDefaultsAfterReject(): boolean {
    return this._rejectedConfig;
  }

  state(sessionId: string): SessionRoutingState | undefined {
    return this._sessions.get(sessionId);
  }

  reset(sessionId?: string): void {
    if (sessionId) this._sessions.delete(sessionId);
    else this._sessions.clear();
  }

  /**
   * Choose the model for this role/turn. Session affinity keeps the incumbent
   * until policy says otherwise. Does not consult the GPU scheduler.
   */
  decide(input: {
    readonly sessionId: string;
    readonly turn: number;
    readonly role: RoutingRole;
    readonly events: readonly RoutingTurnEvent[];
    readonly models: RoutingModels;
  }): RoutingDecision {
    const signals = computeRoutingSignals(input.events, input.sessionId);
    const models = input.models;
    const workerCheck = installedOr(models.workerId, models.installed, models.strongId);
    const strongCheck = installedOr(models.strongId, models.installed, workerCheck.id);

    let state = this._sessions.get(input.sessionId);
    if (!state) {
      state = {
        currentModelId: workerCheck.id,
        currentTier: "worker",
        turnsOnModel: 0,
        swapCount: 0,
        turnEscalations: [],
        sessionPinned: false,
        cooldownUntilTurn: 0,
        deferredEscalate: false,
      };
      this._sessions.set(input.sessionId, state);
    }

    const previous = state.currentModelId;
    let action: RoutingAction = "hold";
    let desired = previous;
    let reason = "affinity";
    let notice: string | undefined;
    let deferred = false;

    if (input.role === "planner" || input.role === "critic") {
      desired = strongCheck.id;
      action = desired === previous ? "pin" : "pin";
      reason = "role-pin-strong";
      if (strongCheck.missing) {
        notice = "strong-unavailable";
        desired = workerCheck.id;
        reason = "strong-unavailable-stay-worker";
      }
    } else {
      if (workerCheck.missing && state.currentTier === "worker") {
        notice = "worker-unavailable";
      }

      const inCooldown = input.turn < state.cooldownUntilTurn;
      const overBudget = state.swapCount >= this._cfg.swapBudget;
      const recent = state.turnEscalations.filter(
        (t) => input.turn - t <= this._cfg.sessionEscalationWindow,
      );
      if (recent.length >= this._cfg.sessionEscalations) {
        state.sessionPinned = true;
      }

      const trip = signalsTrip(signals, this._cfg) || state.deferredEscalate;

      if (inCooldown && trip && state.currentTier === "worker") {
        action = "hold";
        desired = previous;
        reason = "cooldown-holds";
        deferred = true;
        state.deferredEscalate = true;
      } else if (overBudget && trip && state.currentTier === "worker") {
        action = "hold";
        desired = previous;
        reason = "swap-budget";
        notice = notice ?? "swap-budget-exhausted";
      } else if (trip && state.currentTier === "worker") {
        if (strongCheck.missing) {
          action = "hold";
          desired = previous;
          reason = "strong-unavailable";
          notice = "strong-unavailable";
        } else {
          action = "escalate";
          desired = strongCheck.id;
          reason = this._tripReason(signals);
          state.deferredEscalate = false;
        }
      } else if (
        state.currentTier === "strong" &&
        input.role === "worker" &&
        !state.sessionPinned &&
        state.turnsOnModel >= this._cfg.minTurnsOnModel &&
        signalsQuiet(signals, this._cfg)
      ) {
        action = "de-escalate";
        desired = workerCheck.id;
        reason = "recovered";
        if (workerCheck.missing) {
          action = "hold";
          desired = previous;
          reason = "worker-unavailable";
          notice = "worker-unavailable";
        }
      } else if (state.sessionPinned && state.currentTier === "worker" && !strongCheck.missing) {
        action = "escalate";
        desired = strongCheck.id;
        reason = "session-pin";
      } else {
        action = "hold";
        desired = previous;
        reason = "affinity";
      }
    }

    const decision: RoutingDecision = {
      sessionId: input.sessionId,
      turn: input.turn,
      role: input.role,
      action,
      modelId: desired,
      previousModelId: previous,
      reason,
      signals,
      notice,
      deferred,
    };
    return decision;
  }

  /** Record a no-swap (or already-resident) decision and emit telemetry. */
  acknowledge(decision: RoutingDecision): RoutingDecision {
    this.commit(decision);
    this._publish(decision);
    return decision;
  }

  /** Apply a GPU swap gate. Deferred/degraded keeps the incumbent and queues retry. */
  applySwapGate(
    decision: RoutingDecision,
    swap: {
      readonly outcome: SwapOutcome;
      readonly reason: string;
      readonly keepWorkerResident?: boolean;
    },
  ): RoutingDecision {
    if (decision.modelId === decision.previousModelId) {
      return this.acknowledge({
        ...decision,
        swapOutcome: swap.outcome,
        keepWorkerResident: swap.keepWorkerResident,
      });
    }
    if (swap.outcome !== "honored") {
      const gated: RoutingDecision = {
        ...decision,
        action: "hold",
        modelId: decision.previousModelId,
        reason: `swap-${swap.outcome}:${swap.reason}`,
        swapOutcome: swap.outcome,
        deferred: true,
        keepWorkerResident: swap.keepWorkerResident,
      };
      const state = this._sessions.get(decision.sessionId);
      if (state) {
        state.deferredEscalate = decision.action === "escalate";
        state.turnsOnModel += 1;
      }
      this._publish(gated);
      return gated;
    }
    this.commit(decision);
    const committed = {
      ...decision,
      swapOutcome: swap.outcome as SwapOutcome,
      keepWorkerResident: swap.keepWorkerResident,
    };
    this._publish(committed);
    return committed;
  }

  /** Record a swap that did not need the GPU gate (role pin on already-loaded model). */
  commit(decision: RoutingDecision): void {
    const state = this._sessions.get(decision.sessionId);
    if (!state) return;
    if (decision.modelId === state.currentModelId) {
      state.turnsOnModel += 1;
      return;
    }
    state.currentModelId = decision.modelId;
    if (decision.action === "de-escalate") {
      state.currentTier = "worker";
    } else if (decision.action === "escalate" || decision.role === "planner" || decision.role === "critic" || decision.action === "pin") {
      state.currentTier = "strong";
    }
    if (decision.action === "escalate") {
      state.turnEscalations.push(decision.turn);
    }
    if (decision.action === "escalate" || decision.action === "de-escalate") {
      state.cooldownUntilTurn = decision.turn + this._cfg.cooldownTurns;
    }
    state.turnsOnModel = 1;
    state.swapCount += 1;
    state.deferredEscalate = false;
  }

  private _tripReason(signals: RoutingSignals): string {
    if (signals.consecutiveToolErrors >= this._cfg.consecutiveToolErrors) {
      return "tool-error-streak";
    }
    if (signals.identicalActionRepeats >= this._cfg.identicalActionRepeats) {
      return "identical-action";
    }
    if (signals.stepsWithoutProgress >= this._cfg.stepsWithoutProgress) {
      return "progress-free";
    }
    return "deferred-escalate";
  }

  private _publish(decision: RoutingDecision): void {
    this._telemetry?.publish({
      kind: "routing.decision",
      source: "coding-routing",
      payload: {
        sessionId: decision.sessionId,
        turn: decision.turn,
        role: decision.role,
        action: decision.action,
        modelId: decision.modelId,
        previousModelId: decision.previousModelId,
        reason: decision.reason,
        notice: decision.notice,
        deferred: decision.deferred,
        swapOutcome: decision.swapOutcome,
        signals: decision.signals,
      },
    });
  }
}
