export interface SessionBudget {
  readonly maxSessionTokens: number;
  readonly maxTurnTokens: number;
  readonly maxIterations: number;
  readonly warningThresholdPercent: number;
}

export interface BudgetState {
  readonly sessionTokensUsed: number;
  readonly currentTurnTokens: number;
  readonly iterationsUsed: number;
  readonly warningIssued: boolean;
}

export type BudgetCheckResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string; readonly action: "compact" | "stop" | "truncate" };
