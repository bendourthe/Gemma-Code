#!/usr/bin/env node
/**
 * Benchmark regression gate for Gemma Code nightly CI.
 *
 * Usage:
 *   node scripts/check-bench-regressions.mjs \
 *     --baseline tests/benchmarks/baselines/v0.4.0.json \
 *     [--floor tests/benchmarks/baselines/v0.3.0.json] \
 *     --current bench-results.json \
 *     [--regression-pct 20] \
 *     [--update-baseline]
 *
 * `--floor` is consulted only for benchmarks missing from the primary baseline,
 * letting v0.4.0 supersede v0.3.0 while still catching regressions against
 * older numbers for metrics that have not been re-measured yet.
 *
 * Exits 0 on success, 1 on regression (unless --update-baseline is set).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { argv, exit } from "node:process";

function parseArgs() {
  const args = { regressionPct: 20, exclude: [] };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    switch (key) {
      case "--baseline":
        args.baseline = argv[++i];
        break;
      case "--floor":
        args.floor = argv[++i];
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
      case "--fail-on-regression":
        // v0.9.0 Phase 7 (sub-task 7.5) -- explicit opt-in alias for the
        // PR-time fast-bench gate. The script already exits 1 on regression
        // by default; this flag makes the CI workflow's intent self-documenting
        // and forward-compatible if the default behaviour is ever softened.
        args.failOnRegression = true;
        break;
      case "--exclude":
        // Regex pattern; repeatable. Matching benches are silently skipped
        // (still listed once under [info] so the suppression is visible).
        args.exclude.push(new RegExp(argv[++i]));
        break;
      default:
        console.error(`Unknown argument: ${key}`);
        exit(2);
    }
  }
  if (!args.baseline || !args.current) {
    console.error("Usage: --baseline <path> --current <path> [--floor <path>] [--regression-pct N] [--exclude <regex>] [--update-baseline] [--fail-on-regression]");
    exit(2);
  }
  return args;
}

/**
 * Extract { [benchName]: { hz, mean, rme } } from a vitest JSON bench report.
 * Handles both the legacy { files: [{ tasks: [{ result: { benchmark } }] }] }
 * shape (vitest <= 1.5) and the current { files: [{ groups: [{ benchmarks: [...] }] }] }
 * shape (vitest >= 1.6, which emits benchmark stats directly on each entry).
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
    for (const group of file.groups ?? []) {
      for (const b of group.benchmarks ?? []) {
        if (typeof b?.hz === "number") {
          bench[b.name] = { hz: b.hz, mean: b.mean, rme: b.rme };
        }
      }
    }
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
    process.stdout.write(`Baseline updated with ${Object.keys(currentBench).length} benchmarks at ${args.baseline}\n`);
    exit(0);
  }

  if (!existsSync(args.baseline)) {
    console.error(`Baseline not found: ${args.baseline}. Run with --update-baseline to seed.`);
    exit(2);
  }
  const baselineReport = JSON.parse(readFileSync(args.baseline, "utf-8"));
  const baseline = baselineReport.benchmarks ?? {};
  const regressionPct = baselineReport.thresholds?.regressionPct ?? args.regressionPct;

  // Optional floor baseline: an older (strict) set of numbers used only for
  // benchmarks the primary baseline does not cover yet. Lets v0.4.0 take over
  // as the preferred reference without losing v0.3.0's coverage.
  let floor = {};
  if (args.floor && existsSync(args.floor)) {
    const floorReport = JSON.parse(readFileSync(args.floor, "utf-8"));
    floor = floorReport.benchmarks ?? {};
  }

  const regressions = [];
  const improvements = [];
  const missing = [];
  const excluded = [];

  const isExcluded = (name) => args.exclude.some((re) => re.test(name));

  for (const [name, cur] of Object.entries(currentBench)) {
    let base = baseline[name];
    let baseSource = "baseline";
    if (!base || typeof base.hz !== "number" || base.hz === 0) {
      base = floor[name];
      baseSource = "floor";
    }
    if (!base || typeof base.hz !== "number" || base.hz === 0) {
      missing.push(name);
      continue;
    }
    // baseSource tag is kept for future debug output; baseline resolution is
    // deliberately silent unless a regression fires.
    void baseSource;
    // hz (ops/s) higher is better. Regression means current hz dropped.
    const deltaPct = ((cur.hz - base.hz) / base.hz) * 100;
    if (isExcluded(name)) {
      excluded.push({ name, baselineHz: base.hz, currentHz: cur.hz, deltaPct });
      continue;
    }
    if (deltaPct < -regressionPct) {
      regressions.push({ name, baselineHz: base.hz, currentHz: cur.hz, deltaPct });
    } else if (deltaPct > 50) {
      improvements.push({ name, baselineHz: base.hz, currentHz: cur.hz, deltaPct });
    }
  }

  if (excluded.length > 0) {
    process.stdout.write(`\n[info] ${excluded.length} benchmark(s) excluded from the gate (see --exclude):\n`);
    for (const e of excluded) {
      const arrow = e.deltaPct >= 0 ? "+" : "";
      process.stdout.write(`  ~ ${e.name}: ${e.baselineHz.toFixed(2)} -> ${e.currentHz.toFixed(2)} hz (${arrow}${e.deltaPct.toFixed(1)}%)\n`);
    }
  }

  if (missing.length > 0) {
    process.stdout.write(`\n[info] ${missing.length} benchmark(s) have no baseline entry (new or renamed):\n`);
    for (const m of missing) process.stdout.write(`  - ${m}\n`);
  }

  if (improvements.length > 0) {
    process.stdout.write(`\n[info] ${improvements.length} improvement(s) over baseline:\n`);
    for (const i of improvements) {
      process.stdout.write(`  + ${i.name}: ${i.baselineHz.toFixed(2)} -> ${i.currentHz.toFixed(2)} hz (+${i.deltaPct.toFixed(1)}%)\n`);
    }
  }

  if (regressions.length > 0) {
    console.error(`\n[error] ${regressions.length} regression(s) exceed the ${regressionPct}% threshold:`);
    for (const r of regressions) {
      console.error(`  - ${r.name}: ${r.baselineHz.toFixed(2)} -> ${r.currentHz.toFixed(2)} hz (${r.deltaPct.toFixed(1)}%)`);
    }
    exit(1);
  }

  process.stdout.write(`\n[ok] No regressions beyond ${regressionPct}% across ${Object.keys(currentBench).length} benchmarks.\n`);
  exit(0);
}

main();
