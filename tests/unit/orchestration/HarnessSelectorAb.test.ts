import { describe, it, expect } from "vitest";
import type { AbReport } from "../../../modules/coding/orchestration/PanelAbHarness.js";
import type { GoldenTaskSpec } from "../../../modules/coding/evaluation/goldenTaskLoader.js";
import { HarnessSelector, defaultHarnessSelector, DEFAULT_HARNESS_PROFILE, toPromptOverlay } from "../../../modules/coding/orchestration/HarnessSelector.js";
import {
  DEFAULT_HARNESS_SELECTOR_POLICY,
  HARNESS_SELECTOR_SHIPPED_DEFAULT,
  decideHarnessDefault,
  liveHarnessKnobs,
  overlayParsesToolCalls,
  runHarnessAb,
  type HarnessRollout,
} from "../../../modules/coding/orchestration/HarnessSelectorAb.js";
import {
  LFM_CONTEXT_VERIFIED,
  LFM_LIVE_EMISSION_STATUS,
  LFM_MALFORMED_UNCLOSED,
  LFM_PARSE_GOLDEN,
  LFM_PROSE_ONLY,
} from "./fixtures/lfmToolCallFixtures.js";

function spec(id: string): GoldenTaskSpec {
  return { id, name: id, category: "bug-fix", description: `task ${id}` } as unknown as GoldenTaskSpec;
}

// A selector that resolves the model under test to the WEAK tier, so the
// selected scaffold ("detailed") differs from the one-size default ("concise").
const weakSelector = new HarnessSelector((name) =>
  name === "tiny" ? { id: "tiny", vramGb: 3, tags: ["lightweight"] } : undefined,
);

// A rollout where only the selected (detailed) scaffold passes -- a clean net win.
const selectedWinsRollout: HarnessRollout = {
  run: async (_spec, overlay) => ({
    passed: overlay.promptStyle === "detailed",
    durationMs: 100,
  }),
};

function report(partial: Partial<AbReport>): AbReport {
  return {
    comparisons: [],
    panelWins: 0,
    singleWins: 0,
    ties: 0,
    aggregateQualityDelta: 0,
    latencyMultiplier: 1,
    taskCount: 0,
    ...partial,
  };
}

describe("HarnessSelectorAb -- runHarnessAb (H1)", () => {
  it("reports the selected scaffold winning every task when only it passes", async () => {
    const validation = [spec("a"), spec("b"), spec("c")];
    const rep = await runHarnessAb({ modelName: "tiny", validation }, selectedWinsRollout, weakSelector);
    expect(rep.taskCount).toBe(3);
    expect(rep.panelWins).toBe(3);
    expect(rep.singleWins).toBe(0);
    expect(rep.aggregateQualityDelta).toBeCloseTo(1, 5);
    expect(rep.latencyMultiplier).toBeCloseTo(1, 5);
  });

  it("produces an empty report for an empty validation split", async () => {
    const rep = await runHarnessAb({ modelName: "tiny", validation: [] }, selectedWinsRollout, weakSelector);
    expect(rep.taskCount).toBe(0);
  });
});

describe("HarnessSelectorAb -- decideHarnessDefault (H1 gate)", () => {
  it("enables by default on a clean net win at acceptable latency", () => {
    const decision = decideHarnessDefault(
      report({ panelWins: 3, singleWins: 0, aggregateQualityDelta: 1, latencyMultiplier: 1, taskCount: 3 }),
    );
    expect(decision.enableByDefault).toBe(true);
    expect(decision.rationale).toContain("net win");
  });

  it("stays opt-in when there is no net win", () => {
    const decision = decideHarnessDefault(
      report({ panelWins: 1, singleWins: 2, aggregateQualityDelta: 0.5, latencyMultiplier: 1, taskCount: 3 }),
    );
    expect(decision.enableByDefault).toBe(false);
    expect(decision.rationale).toContain("no net win");
  });

  it("stays opt-in when the quality delta is below the bar", () => {
    const decision = decideHarnessDefault(
      report({ panelWins: 2, singleWins: 1, aggregateQualityDelta: 0.01, latencyMultiplier: 1, taskCount: 3 }),
    );
    expect(decision.enableByDefault).toBe(false);
    expect(decision.rationale).toContain("quality delta");
  });

  it("stays opt-in when the selected scaffold is materially slower", () => {
    const decision = decideHarnessDefault(
      report({ panelWins: 3, singleWins: 0, aggregateQualityDelta: 1, latencyMultiplier: 5, taskCount: 3 }),
    );
    expect(decision.enableByDefault).toBe(false);
    expect(decision.rationale).toContain("latency");
  });

  it("stays opt-in when no A/B tasks were run", () => {
    const decision = decideHarnessDefault(report({ taskCount: 0 }));
    expect(decision.enableByDefault).toBe(false);
    expect(decision.rationale).toContain("no A/B tasks");
  });
});

describe("HarnessSelectorAb -- live prompt path (v1.18 OI-A5)", () => {
  it("applies the selected overlay when enabled and is byte-identical when disabled", () => {
    const settingsKnobs = {
      promptStyle: "concise" as const,
      thinkingMode: false,
      systemPromptBudgetPercent: 10,
    };
    const off = liveHarnessKnobs(false, settingsKnobs, "tiny", weakSelector);
    expect(off).toBe(settingsKnobs);
    const on = liveHarnessKnobs(true, settingsKnobs, "tiny", weakSelector);
    expect(on).toEqual(weakSelector.overlayForModel("tiny"));
    expect(on.promptStyle).toBe("detailed");
  });
});

describe("HarnessSelectorAb -- shipped default (SO003.P3.A discipline)", () => {
  it("ships opt-in (off) until a live A/B shows a win", () => {
    expect(HARNESS_SELECTOR_SHIPPED_DEFAULT).toBe(false);
  });

  it("uses a conservative default policy", () => {
    expect(DEFAULT_HARNESS_SELECTOR_POLICY.minAggregateQualityDelta).toBeGreaterThan(0);
    expect(DEFAULT_HARNESS_SELECTOR_POLICY.maxLatencyMultiplier).toBeGreaterThanOrEqual(1);
  });
});

describe("HarnessSelectorAb -- LFM fixture parse A/B (v1.19 Phase 2)", () => {
  const lfmSelector = defaultHarnessSelector;
  const validation: GoldenTaskSpec[] = Object.keys(LFM_PARSE_GOLDEN).map((id) => spec(id));
  const parseRollout: HarnessRollout = {
    run: async (task, overlay) => {
      const fixture = LFM_PARSE_GOLDEN[task.id];
      const text = fixture?.text ?? "";
      return { passed: overlayParsesToolCalls(text, overlay), durationMs: 1 };
    },
  };

  it("LFM profile wins or ties default on captured pythonic fixtures", async () => {
    const lfmOverlay = lfmSelector.overlayForModel("lfm2.5:2.6b");
    const defaultOverlay = toPromptOverlay(DEFAULT_HARNESS_PROFILE);
    expect(lfmOverlay.toolCallFormat).toBe("lfm-pythonic");
    expect(defaultOverlay.toolCallFormat).toBeUndefined();
    for (const [id, fixture] of Object.entries(LFM_PARSE_GOLDEN)) {
      expect(overlayParsesToolCalls(fixture.text, lfmOverlay), id).toBe(true);
      expect(overlayParsesToolCalls(fixture.text, defaultOverlay), id).toBe(false);
    }
    const rep = await runHarnessAb(
      { modelName: "lfm2.5:2.6b", validation },
      parseRollout,
      lfmSelector,
    );
    expect(rep.taskCount).toBe(validation.length);
    expect(rep.panelWins).toBeGreaterThan(rep.singleWins);
    expect(rep.aggregateQualityDelta).toBeGreaterThan(0);
    const decision = decideHarnessDefault(rep);
    expect(decision.enableByDefault).toBe(true);
  });

  it("malformed LFM output does not parse under either overlay", () => {
    const lfmOverlay = lfmSelector.overlayForModel("lfm2.5:2.6b");
    const defaultOverlay = toPromptOverlay(DEFAULT_HARNESS_PROFILE);
    expect(overlayParsesToolCalls(LFM_MALFORMED_UNCLOSED, lfmOverlay)).toBe(false);
    expect(overlayParsesToolCalls(LFM_PROSE_ONLY, lfmOverlay)).toBe(false);
    expect(overlayParsesToolCalls(LFM_MALFORMED_UNCLOSED, defaultOverlay)).toBe(false);
  });

  it("records the empirically verified context as 128K", () => {
    expect(LFM_CONTEXT_VERIFIED).toBe(128000);
    expect(LFM_LIVE_EMISSION_STATUS).toBe("observed");
  });
});

describe("HarnessSelectorAb -- Hermes profiles (v1.19.2)", () => {
  it("measures hermes-agentic as the panel arm on a golden split", async () => {
    const validation = [spec("a"), spec("b")];
    const hermesWins: HarnessRollout = {
      run: async (_spec, overlay) => ({
        passed: overlay.toolCallFormat === "llama3-json",
        durationMs: 80,
      }),
    };
    const rep = await runHarnessAb(
      { modelName: "hermes3:8b", validation },
      hermesWins,
      defaultHarnessSelector,
    );
    expect(rep.taskCount).toBe(2);
    expect(rep.panelWins).toBe(2);
    expect(rep.singleWins).toBe(0);
    expect(defaultHarnessSelector.overlayForModel("hermes3:8b").toolCallFormat).toBe("llama3-json");
  });
});
