import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillMetrics, formatMetricsTable } from "../../../src/skills/SkillMetrics.js";

describe("SkillMetrics", () => {
  let tmpDir: string;
  let metricsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-skill-metrics-"));
    metricsPath = path.join(tmpDir, "metrics.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records a single invocation and surfaces it via getMetrics", () => {
    let now = 1_700_000_000_000;
    const metrics = new SkillMetrics(metricsPath, null, () => now);
    metrics.recordInvocation("commit", "success", 1234);
    const stats = metrics.getMetrics();
    expect(stats).toHaveLength(1);
    expect(stats[0]!.skill).toBe("commit");
    expect(stats[0]!.invocations).toBe(1);
    expect(stats[0]!.success).toBe(1);
    expect(stats[0]!.successRate).toBeCloseTo(1);
    expect(stats[0]!.avgDurationMs).toBe(1234);
  });

  it("groups multiple outcomes per skill and computes success rate", () => {
    let now = 1_700_000_000_000;
    const metrics = new SkillMetrics(metricsPath, null, () => now);
    metrics.recordInvocation("plan", "success", 100);
    metrics.recordInvocation("plan", "failure", 200);
    metrics.recordInvocation("plan", "user-corrected", 300);
    metrics.recordInvocation("plan", "success", 50);

    const stats = metrics.getMetrics("plan");
    expect(stats).toHaveLength(1);
    expect(stats[0]!.invocations).toBe(4);
    expect(stats[0]!.success).toBe(2);
    expect(stats[0]!.failure).toBe(1);
    expect(stats[0]!.userCorrected).toBe(1);
    expect(stats[0]!.successRate).toBeCloseTo(0.5);
    expect(stats[0]!.avgDurationMs).toBe(Math.round((100 + 200 + 300 + 50) / 4));
  });

  it("prunes events older than the 30-day rolling window", () => {
    let now = 1_700_000_000_000;
    const metrics = new SkillMetrics(metricsPath, null, () => now);
    metrics.recordInvocation("old", "success", 10);
    now += 31 * 24 * 60 * 60 * 1000; // 31 days later
    metrics.recordInvocation("new", "success", 20);
    const stats = metrics.getMetrics();
    expect(stats.find((s) => s.skill === "old")).toBeUndefined();
    expect(stats.find((s) => s.skill === "new")?.invocations).toBe(1);
  });

  it("persists events across instances", () => {
    let now = 1_700_000_000_000;
    const writer = new SkillMetrics(metricsPath, null, () => now);
    writer.recordInvocation("compact", "success", 500);

    const reader = new SkillMetrics(metricsPath, null, () => now);
    const stats = reader.getMetrics();
    expect(stats).toHaveLength(1);
    expect(stats[0]!.skill).toBe("compact");
  });

  it("rejects unknown outcomes", () => {
    const metrics = new SkillMetrics(metricsPath);
    expect(() => metrics.recordInvocation("x", "bogus" as never, 1)).toThrow();
  });

  it("formatMetricsTable renders an empty-state message", () => {
    expect(formatMetricsTable([])).toContain("No skill invocations");
  });

  it("formatMetricsTable renders a row per skill", () => {
    let now = 1_700_000_000_000;
    const metrics = new SkillMetrics(metricsPath, null, () => now);
    metrics.recordInvocation("a", "success", 10);
    metrics.recordInvocation("b", "failure", 20);
    metrics.recordInvocation("b", "success", 30);
    const out = formatMetricsTable(metrics.getMetrics());
    expect(out).toContain("`a`");
    expect(out).toContain("`b`");
    expect(out).toMatch(/\| 2 \|/); // b had 2 invocations
  });
});
