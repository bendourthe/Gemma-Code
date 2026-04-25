const CHARS_PER_TOKEN = 4;

export interface BudgetEnforcerConfig {
  readonly maxSessionTokens: number;
  readonly maxSessionMinutes: number;
  readonly maxSingleTurnTokens: number;
  readonly onBudgetWarning: (msg: string) => void;
  readonly onBudgetExceeded: (msg: string) => void;
}

export interface BudgetStatus {
  readonly withinBudget: boolean;
  readonly tokensUsed: number;
  readonly tokensRemaining: number;
  readonly minutesElapsed: number;
  readonly minutesRemaining: number;
  readonly warningIssued: boolean;
}

/**
 * Session-level budget enforcement for token usage and wall-clock time.
 *
 * Fires a warning callback at 80% of either budget and an exceeded callback
 * at 100%. Designed to compose with (not replace) the existing BudgetMiddleware
 * which handles per-turn and per-iteration limits.
 */
export class BudgetEnforcer {
  private _inputTokens = 0;
  private _outputTokens = 0;
  private _sessionStartTime: number = Date.now();
  private _warningIssued = false;

  private readonly _maxSessionTokens: number;
  private readonly _maxSessionMinutes: number;
  private readonly _maxSingleTurnTokens: number;
  private readonly _onBudgetWarning: (msg: string) => void;
  private readonly _onBudgetExceeded: (msg: string) => void;

  constructor(config: BudgetEnforcerConfig) {
    this._maxSessionTokens = config.maxSessionTokens;
    this._maxSessionMinutes = config.maxSessionMinutes;
    this._maxSingleTurnTokens = config.maxSingleTurnTokens;
    this._onBudgetWarning = config.onBudgetWarning;
    this._onBudgetExceeded = config.onBudgetExceeded;
  }

  /** Record estimated tokens from input text (tool results, user messages). */
  recordInput(text: string): void {
    this._inputTokens += Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /** Record estimated tokens from model output. */
  recordOutput(text: string): void {
    this._outputTokens += Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Check whether the session is still within budget.
   * Fires warning/exceeded callbacks as side effects.
   */
  checkBudget(): BudgetStatus {
    const tokensUsed = this._inputTokens + this._outputTokens;
    const tokensRemaining = Math.max(0, this._maxSessionTokens - tokensUsed);
    const minutesElapsed = (Date.now() - this._sessionStartTime) / 60_000;
    const minutesRemaining = Math.max(0, this._maxSessionMinutes - minutesElapsed);

    const tokenPercent = tokensUsed / this._maxSessionTokens;
    const timePercent = minutesElapsed / this._maxSessionMinutes;

    // Exceeded check (100%).
    if (tokenPercent >= 1) {
      this._onBudgetExceeded(
        `Session token budget exceeded: ${tokensUsed} / ${this._maxSessionTokens} tokens used.`,
      );
      return { withinBudget: false, tokensUsed, tokensRemaining, minutesElapsed, minutesRemaining, warningIssued: this._warningIssued };
    }

    if (timePercent >= 1) {
      this._onBudgetExceeded(
        `Session time budget exceeded: ${minutesElapsed.toFixed(1)} / ${this._maxSessionMinutes} minutes elapsed.`,
      );
      return { withinBudget: false, tokensUsed, tokensRemaining, minutesElapsed, minutesRemaining, warningIssued: this._warningIssued };
    }

    // Warning check (80%).
    if (!this._warningIssued && (tokenPercent >= 0.8 || timePercent >= 0.8)) {
      this._warningIssued = true;
      const reason = tokenPercent >= 0.8
        ? `Token usage at ${(tokenPercent * 100).toFixed(0)}% (${tokensUsed} / ${this._maxSessionTokens})`
        : `Time usage at ${(timePercent * 100).toFixed(0)}% (${minutesElapsed.toFixed(1)} / ${this._maxSessionMinutes} min)`;
      this._onBudgetWarning(`Budget warning: ${reason}. Consider wrapping up.`);
    }

    return { withinBudget: true, tokensUsed, tokensRemaining, minutesElapsed, minutesRemaining, warningIssued: this._warningIssued };
  }

  /** Reset all state for a new session. */
  reset(): void {
    this._inputTokens = 0;
    this._outputTokens = 0;
    this._sessionStartTime = Date.now();
    this._warningIssued = false;
  }

  /** Human-readable usage summary. */
  getUsageReport(): string {
    const tokensUsed = this._inputTokens + this._outputTokens;
    const minutesElapsed = (Date.now() - this._sessionStartTime) / 60_000;
    return [
      `Tokens: ${tokensUsed} / ${this._maxSessionTokens} (input: ${this._inputTokens}, output: ${this._outputTokens})`,
      `Time: ${minutesElapsed.toFixed(1)} / ${this._maxSessionMinutes} minutes`,
    ].join("\n");
  }
}
