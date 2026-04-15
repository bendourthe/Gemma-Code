import { describe, it, expect } from "vitest";
import { BudgetMiddleware, createSessionBudget } from "../../../src/tools/BudgetMiddleware.js";
import type { SessionBudget } from "../../../src/tools/BudgetMiddleware.types.js";

function makeBudget(overrides?: Partial<SessionBudget>): SessionBudget {
  return {
    maxSessionTokens: 10000,
    maxTurnTokens: 2000,
    maxIterations: 5,
    warningThresholdPercent: 80,
    ...overrides,
  };
}

describe("BudgetMiddleware", () => {
  describe("checkPreTurn", () => {
    it("allows turn when under budget", () => {
      const mw = new BudgetMiddleware(makeBudget());
      const result = mw.checkPreTurn();
      expect(result.allowed).toBe(true);
    });

    it("returns 'stop' when iterations are exhausted", () => {
      const mw = new BudgetMiddleware(makeBudget({ maxIterations: 3 }));
      mw.recordIteration();
      mw.recordIteration();
      mw.recordIteration();

      const result = mw.checkPreTurn();
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.action).toBe("stop");
        expect(result.reason).toContain("Iteration limit");
      }
    });

    it("returns 'compact' when session tokens are exceeded", () => {
      const mw = new BudgetMiddleware(makeBudget({ maxSessionTokens: 100 }));
      mw.recordTurnTokens(150);

      const result = mw.checkPreTurn();
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.action).toBe("compact");
        expect(result.reason).toContain("token budget");
      }
    });
  });

  describe("recordTurnTokens", () => {
    it("returns 'truncate' when turn exceeds maxTurnTokens", () => {
      const mw = new BudgetMiddleware(makeBudget({ maxTurnTokens: 500 }));
      const result = mw.recordTurnTokens(600);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.action).toBe("truncate");
      }
    });

    it("returns allowed when turn is within limits", () => {
      const mw = new BudgetMiddleware(makeBudget());
      const result = mw.recordTurnTokens(100);
      expect(result.allowed).toBe(true);
    });

    it("issues warning at threshold (only once)", () => {
      const mw = new BudgetMiddleware(makeBudget({ maxSessionTokens: 1000, warningThresholdPercent: 80 }));

      // 700 tokens = 70% -> no warning yet
      mw.recordTurnTokens(700);
      expect(mw.getState().warningIssued).toBe(false);

      // +200 = 900 tokens = 90% -> warning issued
      mw.recordTurnTokens(200);
      expect(mw.getState().warningIssued).toBe(true);
    });

    it("accumulates session tokens across multiple turns", () => {
      const mw = new BudgetMiddleware(makeBudget());
      mw.recordTurnTokens(300);
      mw.recordTurnTokens(400);
      expect(mw.getState().sessionTokensUsed).toBe(700);
    });
  });

  describe("recordIteration", () => {
    it("increments iteration count", () => {
      const mw = new BudgetMiddleware(makeBudget());
      expect(mw.getState().iterationsUsed).toBe(0);
      mw.recordIteration();
      expect(mw.getState().iterationsUsed).toBe(1);
      mw.recordIteration();
      expect(mw.getState().iterationsUsed).toBe(2);
    });
  });

  describe("getState", () => {
    it("returns correct snapshot", () => {
      const mw = new BudgetMiddleware(makeBudget());
      mw.recordTurnTokens(500);
      mw.recordIteration();

      const state = mw.getState();
      expect(state.sessionTokensUsed).toBe(500);
      expect(state.currentTurnTokens).toBe(500);
      expect(state.iterationsUsed).toBe(1);
      expect(state.warningIssued).toBe(false);
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      const mw = new BudgetMiddleware(makeBudget({ maxSessionTokens: 100 }));
      mw.recordTurnTokens(90);
      mw.recordIteration();

      mw.reset();

      const state = mw.getState();
      expect(state.sessionTokensUsed).toBe(0);
      expect(state.currentTurnTokens).toBe(0);
      expect(state.iterationsUsed).toBe(0);
      expect(state.warningIssued).toBe(false);

      // After reset, checkPreTurn should allow again
      expect(mw.checkPreTurn().allowed).toBe(true);
    });
  });
});

describe("createSessionBudget", () => {
  it("creates tier 1 budget with constrained limits", () => {
    const budget = createSessionBudget(1, 32768);
    expect(budget.maxSessionTokens).toBe(Math.floor(32768 * 0.65));
    expect(budget.maxTurnTokens).toBe(4096);
    expect(budget.maxIterations).toBe(10);
    expect(budget.warningThresholdPercent).toBe(80);
  });

  it("creates tier 2 budget with balanced limits", () => {
    const budget = createSessionBudget(2, 131072);
    expect(budget.maxSessionTokens).toBe(Math.floor(131072 * 0.70));
    expect(budget.maxTurnTokens).toBe(8192);
    expect(budget.maxIterations).toBe(20);
  });

  it("creates tier 3 budget with generous limits", () => {
    const budget = createSessionBudget(3, 262144);
    expect(budget.maxSessionTokens).toBe(Math.floor(262144 * 0.75));
    expect(budget.maxTurnTokens).toBe(16384);
    expect(budget.maxIterations).toBe(30);
  });
});
