import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BudgetEnforcer } from "../../../src/safety/BudgetEnforcer.js";
import type { BudgetEnforcerConfig } from "../../../src/safety/BudgetEnforcer.js";

function makeConfig(overrides?: Partial<BudgetEnforcerConfig>): BudgetEnforcerConfig {
  return {
    maxSessionTokens: 1000,
    maxSessionMinutes: 30,
    maxSingleTurnTokens: 200,
    onBudgetWarning: vi.fn(),
    onBudgetExceeded: vi.fn(),
    ...overrides,
  };
}

describe("BudgetEnforcer", () => {
  let enforcer: BudgetEnforcer;
  let config: BudgetEnforcerConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    config = makeConfig();
    enforcer = new BudgetEnforcer(config);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks token accumulation via recordInput and recordOutput", () => {
    // 40 chars / 4 = 10 tokens each
    enforcer.recordInput("a".repeat(40));
    enforcer.recordOutput("b".repeat(40));

    const status = enforcer.checkBudget();
    expect(status.tokensUsed).toBe(20);
    expect(status.tokensRemaining).toBe(980);
    expect(status.withinBudget).toBe(true);
  });

  it("fires warning callback at 80% token usage (once)", () => {
    // 800 tokens = 3200 chars -> 80% of 1000
    enforcer.recordInput("x".repeat(3200));

    enforcer.checkBudget();
    expect(config.onBudgetWarning).toHaveBeenCalledOnce();
    expect((config.onBudgetWarning as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toContain("Budget warning");

    // Second check should not fire again.
    enforcer.checkBudget();
    expect(config.onBudgetWarning).toHaveBeenCalledOnce();
  });

  it("fires exceeded callback at 100% token usage", () => {
    // 1000 tokens = 4000 chars
    enforcer.recordOutput("z".repeat(4000));

    const status = enforcer.checkBudget();
    expect(status.withinBudget).toBe(false);
    expect(config.onBudgetExceeded).toHaveBeenCalledOnce();
    expect((config.onBudgetExceeded as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toContain("token budget exceeded");
  });

  it("fires exceeded callback when time budget is exceeded", () => {
    // Advance 31 minutes.
    vi.advanceTimersByTime(31 * 60 * 1000);

    const status = enforcer.checkBudget();
    expect(status.withinBudget).toBe(false);
    expect(config.onBudgetExceeded).toHaveBeenCalledOnce();
    expect((config.onBudgetExceeded as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toContain("time budget exceeded");
  });

  it("fires warning at 80% time usage", () => {
    // Advance 24 minutes = 80% of 30
    vi.advanceTimersByTime(24 * 60 * 1000);

    enforcer.checkBudget();
    expect(config.onBudgetWarning).toHaveBeenCalledOnce();
    expect((config.onBudgetWarning as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toContain("Time usage");
  });

  it("reports correct minutes elapsed and remaining", () => {
    vi.advanceTimersByTime(10 * 60 * 1000); // 10 minutes

    const status = enforcer.checkBudget();
    expect(status.minutesElapsed).toBeCloseTo(10, 0);
    expect(status.minutesRemaining).toBeCloseTo(20, 0);
  });

  it("reset clears all state", () => {
    enforcer.recordInput("x".repeat(3200)); // 800 tokens
    enforcer.checkBudget();
    expect(config.onBudgetWarning).toHaveBeenCalledOnce();

    enforcer.reset();

    const status = enforcer.checkBudget();
    expect(status.tokensUsed).toBe(0);
    expect(status.warningIssued).toBe(false);
    expect(status.withinBudget).toBe(true);
  });

  it("getUsageReport returns formatted string", () => {
    enforcer.recordInput("a".repeat(400));  // 100 tokens
    enforcer.recordOutput("b".repeat(200)); // 50 tokens
    vi.advanceTimersByTime(5 * 60 * 1000);

    const report = enforcer.getUsageReport();
    expect(report).toContain("Tokens: 150 / 1000");
    expect(report).toContain("input: 100");
    expect(report).toContain("output: 50");
    expect(report).toContain("5.0 / 30 minutes");
  });

  it("within budget when under all limits", () => {
    enforcer.recordInput("a".repeat(40));
    const status = enforcer.checkBudget();
    expect(status.withinBudget).toBe(true);
    expect(config.onBudgetWarning).not.toHaveBeenCalled();
    expect(config.onBudgetExceeded).not.toHaveBeenCalled();
  });

  it("handles ceil rounding for token estimation", () => {
    // 5 chars -> ceil(5/4) = 2 tokens
    enforcer.recordInput("hello");
    const status = enforcer.checkBudget();
    expect(status.tokensUsed).toBe(2);
  });
});
