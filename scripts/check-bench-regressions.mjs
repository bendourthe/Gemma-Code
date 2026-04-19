#!/usr/bin/env node
/**
 * Benchmark regression gate for Gemma Code nightly CI.
 *
 * Usage:
 *   node scripts/check-bench-regressions.mjs \
 *     --baseline tests/benchmarks/baselines/v0.3.0.json \
 *     --current bench-results.json \
 *     [--regression-pct 20] \
 *     [--update-baseline]
 *
 * Exits 0 on success, 1 on regression (unless --update-baseline is set).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { argv, exit } from "node:process";

function parseArgs() {
  const args = { regressionPct: 20 };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    switch (key) {
      case "--baseline":
        args.baseline = argv[++i];
        break;
      case "--current":
        args.current = argv[++i];
        break;
      case "--regression-pct":
        args.regressionPct = Number(argv[++i]);
        break;
      case "--update-baseline":
        args.updateBaseline = true;
        break;
      default:
        console.error(`Unknown argument: ${key}`);
        exit(2);
    }
  }
  if (!args.baseline || !args.current) {
    console.error("Usage: --baseline <path> --current <path> [--regression-pct N] [--update-baseline]");
    exit(2);
  }
  return args;
}

/**
 * Extract { [benchName]: { hz, mean, rme } } from a vitest JSON bench report.
 * Vitest bench JSON has the shape { files: [{ result: { tasks: [{ name, result: { benchmark: {...} }}] }}] }.
 */
function extractBenchmarks(report) {
  const bench = {};
  const walkTasks = (tasks) => {
    for (const t of tasks ?? []) {
      if (t.result?.benchmark) {
        bench[t.name] = {
          hz: t.result.benchmark.hz,
          mean: t.result.benchmark.mean,
          rme: t.result.benchmark.rme,
        };
      }
      if (t.tasks) walkTasks(t.tasks);
    }
  };
  for (const file of report.files ?? []) {
    walkTasks(file.result?.tasks ?? file.tasks ?? []);
  }
  return bench;
}

function main() {
  const args = parseArgs();

  if (!existsSync(args.current)) {
    console.error(`Current results file not found: ${args.current}`);
    exit(2);
  }
  const currentReport = JSON.parse(readFileSync(args.current, "utf-8"));
  const currentBench = extractBenchmarks(currentReport);

  if (args.updateBaseline) {
    const baselineObj = existsSync(args.baseline)
      ? JSON.parse(readFileSync(args.baseline, "utf-8"))
      : { thresholds: { regressionPct: args.regressionPct }, benchmarks: {} };
    baselineObj.createdAt = new Date().toISOString();
    baselineObj.benchmarks = currentBench;
    writeFileSync(args.baseline, JSON.stringify(baselineObj, null, 2) + "\n");
    console.log(`Baseline updated with ${Object.keys(currentBench).length} benchmarks at ${args.baseline}`);
    exit(0);
  }

  if (!existsSync(args.baseline)) {
    console.error(`Baseline not found: ${args.baseline}. Run with --update-baseline to seed.`);
    exit(2);
  }
  const baselineReport = JSON.parse(readFileSync(args.baseline, "utf-8"));
  const baseline = baselineReport.benchmarks ?? {};
  const regressionPct = baselineReport.thresholds?.regressionPct ?? args.regressionPct;

  const regressions = [];
  const improvements = [];
  const missing = [];

  for (const [name, cur] of Object.entries(currentBench)) {
    const base = baseline[name];
    if (!base || typeof base.hz !== "number" || base.hz === 0) {
      missing.push(name);
      continue;
    }
    // hz (ops/s) higher is better. Regression means current hz dropped.
    const deltaPct = ((cur.hz - base.hz) / base.hz) * 100;
    if (deltaPct < -regressionPct) {
      regressions.push({ name, baselineHz: base.hz, currentHz: cur.hz, deltaPct });
    } else if (deltaPct > 50) {
      improvements.push({ name, baselineHz: base.hz, currentHz: cur.hz, deltaPct });
    }
  }

  if (missing.length > 0) {
    console.log(`\n[info] ${missing.length} benchmark(s) have no baseline entry (new or renamed):`);
    for (const m of missing) console.log(`  - ${m}`);
  }

  if (improvements.length > 0) {
    console.log(`\n[info] ${improvements.length} improvement(s) over baseline:`);
    for (const i of improvements) {
      console.log(`  + ${i.name}: ${i.baselineHz.toFixed(2)} -> ${i.currentHz.toFixed(2)} hz (+${i.deltaPct.toFixed(1)}%)`);
    }
  }

  if (regressions.length > 0) {
    console.error(`\n[error] ${regressions.length} regression(s) exceed the ${regressionPct}% threshold:`);
    for (const r of regressions) {
      console.error(`  - ${r.name}: ${r.baselineHz.toFixed(2)} -> ${r.currentHz.toFixed(2)} hz (${r.deltaPct.toFixed(1)}%)`);
    }
    exit(1);
  }

  console.log(`\n[ok] No regressions beyond ${regressionPct}% across ${Object.keys(currentBench).length} benchmarks.`);
  exit(0);
}

main();
