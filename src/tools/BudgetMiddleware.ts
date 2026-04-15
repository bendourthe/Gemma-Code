import type { HardwareTierId } from "../config/HardwareTier.types.js";
import type { SessionBudget, BudgetState, BudgetCheckResult } from "./BudgetMiddleware.types.js";

export class BudgetMiddleware {
  private _sessionTokensUsed = 0;
  private _currentTurnTokens = 0;
  private _iterationsUsed = 0;
  private _warningIssued = false;

  constructor(private readonly _budget: SessionBudget) {}

  /** Get a readonly snapshot of the current budget state. */
  getState(): BudgetState {
    return {
      sessionTokensUsed: this._sessionTokensUsed,
      currentTurnTokens: this._currentTurnTokens,
      iterationsUsed: this._iterationsUsed,
      warningIssued: this._warningIssued,
    };
  }

  /**
   * Check whether the next iteration is allowed.
   * Call before each AgentLoop iteration.
   */
  checkPreTurn(): BudgetCheckResult {
    if (this._iterationsUsed >= this._budget.maxIterations) {
      return { allowed: false, reason: "Iteration limit reached", action: "stop" };
    }
    if (this._sessionTokensUsed >= this._budget.maxSessionTokens) {
      return { allowed: false, reason: "Session token budget exceeded", action: "compact" };
    }
    return { allowed: true };
  }

  /**
   * Record token usage from a completed turn.
   * Call after each model response with the estimated token count.
   */
  recordTurnTokens(tokens: number): BudgetCheckResult {
    this._currentTurnTokens = tokens;
    this._sessionTokensUsed += tokens;

    if (tokens > this._budget.maxTurnTokens) {
      return { allowed: false, reason: "Turn token limit exceeded", action: "truncate" };
    }

    const warningThreshold = this._budget.maxSessionTokens * (this._budget.warningThresholdPercent / 100);
    if (!this._warningIssued && this._sessionTokensUsed >= warningThreshold) {
      this._warningIssued = true;
    }

    return { allowed: true };
  }

  /** Record that one iteration has completed. */
  recordIteration(): void {
    this._iterationsUsed++;
  }

  /** Reset all state for a new session. */
  reset(): void {
    this._sessionTokensUsed = 0;
    this._currentTurnTokens = 0;
    this._iterationsUsed = 0;
    this._warningIssued = false;
  }
}

/**
 * Create a session budget based on the hardware tier.
 *
 * Tier 1 (constrained): tight limits for 6-8 GB VRAM
 * Tier 2 (balanced): moderate limits for 12-16 GB VRAM
 * Tier 3 (full): generous limits for 24+ GB VRAM
 */
export function createSessionBudget(tierId: HardwareTierId, contextWindow: number): SessionBudget {
  switch (tierId) {
    case 1:
      return {
        maxSessionTokens: Math.floor(contextWindow * 0.65),
        maxTurnTokens: 4096,
        maxIterations: 10,
        warningThresholdPercent: 80,
      };
    case 2:
      return {
        maxSessionTokens: Math.floor(contextWindow * 0.70),
        maxTurnTokens: 8192,
        maxIterations: 20,
        warningThresholdPercent: 80,
      };
    case 3:
      return {
        maxSessionTokens: Math.floor(contextWindow * 0.75),
        maxTurnTokens: 16384,
        maxIterations: 30,
        warningThresholdPercent: 80,
      };
  }
}
