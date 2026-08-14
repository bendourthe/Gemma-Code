/**
 * v1.16.0 Phase 2.3 (adoption item A2) -- per-model analytics rendering.
 *
 * The plan's stability gate for 2.2 is exactly two things: a correct per-model
 * breakdown across two models, and a clean empty state with no data. Both are
 * asserted here, plus the "missing renders as a dash, never as 0" rule that keeps
 * a non-reporting runtime from looking like a broken one.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  ModelAnalyticsSection,
  formatBytes,
  formatMs,
  formatRate,
} from "../src/modules/coding/panels/ModelAnalyticsSection";
import type { PerModelMetricSummaryT } from "../sidecar/src/protocol";

function summary(over: Partial<PerModelMetricSummaryT> = {}): PerModelMetricSummaryT {
  return {
    model: "gemma4:12b",
    requestCount: 3,
    totalTokens: 300,
    avgTokensPerSec: 42.5,
    medianTtftMs: 120,
    lastMemoryBytes: 8 * 1024 * 1024 * 1024,
    lastAt: 1000,
    allCountsReported: true,
    ...over,
  };
}

describe("ModelAnalyticsSection", () => {
  it("shows a clean empty state with no data", () => {
    render(<ModelAnalyticsSection perModel={[]} />);
    expect(screen.getByTestId("trace-model-analytics-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("trace-model-analytics-table")).not.toBeInTheDocument();
  });

  it("renders a correct breakdown across two models", () => {
    render(
      <ModelAnalyticsSection
        perModel={[
          summary({ model: "gemma4:12b", requestCount: 3, avgTokensPerSec: 42.5 }),
          summary({ model: "qwen3:8b", requestCount: 1, avgTokensPerSec: 61, totalTokens: 90 }),
        ]}
      />,
    );
    const first = screen.getByTestId("trace-model-row-gemma4:12b");
    expect(first.textContent).toContain("gemma4:12b");
    expect(first.textContent).toContain("3");
    expect(first.textContent).toContain("42.5");
    expect(first.textContent).toContain("120 ms");
    expect(first.textContent).toContain("300");
    expect(first.textContent).toContain("8.0 GiB");

    const second = screen.getByTestId("trace-model-row-qwen3:8b");
    expect(second.textContent).toContain("61.0");
    expect(second.textContent).toContain("90");
  });

  it("renders absent metrics as a dash rather than zero", () => {
    render(
      <ModelAnalyticsSection
        perModel={[
          summary({
            avgTokensPerSec: null,
            medianTtftMs: null,
            lastMemoryBytes: null,
            totalTokens: 0,
          }),
        ]}
      />,
    );
    const row = screen.getByTestId("trace-model-row-gemma4:12b");
    expect(row.textContent).toContain("—");
    expect(row.textContent).not.toMatch(/\b0\b/);
  });

  it("marks a model whose counts were estimated", () => {
    render(<ModelAnalyticsSection perModel={[summary({ allCountsReported: false })]} />);
    expect(screen.getByTestId("trace-model-estimated-gemma4:12b")).toBeInTheDocument();
  });

  it("omits the estimated marker when every count was reported", () => {
    render(<ModelAnalyticsSection perModel={[summary({ allCountsReported: true })]} />);
    expect(screen.queryByTestId("trace-model-estimated-gemma4:12b")).not.toBeInTheDocument();
  });
});

describe("formatters", () => {
  it("formats a rate to one decimal", () => {
    expect(formatRate(42.456)).toBe("42.5");
  });

  it("formats sub-second latency in ms and longer latency in seconds", () => {
    expect(formatMs(120.4)).toBe("120 ms");
    expect(formatMs(1500)).toBe("1.50 s");
  });

  it("formats bytes in binary units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(8 * 1024 * 1024 * 1024)).toBe("8.0 GiB");
  });

  it.each([formatRate, formatMs, formatBytes])("renders null as a dash", (fn) => {
    expect(fn(null)).toBe("—");
  });
});
