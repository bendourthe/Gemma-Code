/**
 * Custom Vitest 1.x reporter that writes benchmark results to a JSON file.
 *
 * Why this exists:
 *   `vitest bench` in Vitest 1.x only ships two built-in reporters: `default`
 *   (table) and `verbose`. There is no `json` benchmark reporter -- the
 *   `BenchmarkReportsMap` constant in `vitest/dist/vendor/index.*.js` only
 *   wires up TableReporter and VerboseReporter. Passing `--reporter=json` to
 *   `vitest bench` therefore fails with "Failed to load custom Reporter from
 *   json". The nightly CI's regression gate (`scripts/check-bench-regressions.mjs`)
 *   needs JSON, so we ship our own minimal reporter.
 *
 * Output shape (matches what `extractBenchmarks` in check-bench-regressions.mjs walks):
 *   {
 *     "files": [
 *       {
 *         "name": "<file path>",
 *         "result": { "tasks": [
 *           { "name": "<bench name>", "result": { "benchmark": { "hz", "mean", "rme", ... } }, "tasks": [...] }
 *         ] }
 *       }
 *     ]
 *   }
 *
 * Usage:
 *   vitest bench --reporter=./scripts/vitest-bench-json-reporter.mjs --outputFile=bench-results.json
 *
 *   When `--outputFile` is set, Vitest passes the path to the reporter via
 *   `ctx.config.benchmark.outputFile` (or the top-level `outputFile`). We
 *   honour both, falling back to "bench-results.json" if neither is set.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

function serializeTask(task) {
  const out = { name: task.name, mode: task.mode };
  // Include the task type when it is meaningful (suite vs test/benchmark).
  if (task.type) out.type = task.type;
  if (task.result) {
    out.result = {
      state: task.result.state,
      benchmark: task.result.benchmark
        ? {
            // Tinybench fields surfaced by Vitest's bench mode.
            hz: task.result.benchmark.hz,
            mean: task.result.benchmark.mean,
            min: task.result.benchmark.min,
            max: task.result.benchmark.max,
            p75: task.result.benchmark.p75,
            p99: task.result.benchmark.p99,
            p995: task.result.benchmark.p995,
            p999: task.result.benchmark.p999,
            rme: task.result.benchmark.rme,
            samples: task.result.benchmark.samples?.length ?? 0,
          }
        : undefined,
    };
  }
  if (Array.isArray(task.tasks) && task.tasks.length > 0) {
    out.tasks = task.tasks.map(serializeTask);
  }
  return out;
}

function serializeFile(file) {
  return {
    name: file.name,
    filepath: file.filepath,
    result: {
      state: file.result?.state,
      tasks: (file.tasks ?? []).map(serializeTask),
    },
  };
}

export default class BenchJsonReporter {
  onInit(ctx) {
    this.ctx = ctx;
  }

  onFinished(files, errors) {
    const config = this.ctx?.config ?? {};
    const outputFile =
      config.benchmark?.outputFile ??
      config.outputFile ??
      "bench-results.json";
    const target = typeof outputFile === "string" ? outputFile : "bench-results.json";
    const absolute = resolve(config.root ?? process.cwd(), target);

    const payload = {
      generatedAt: new Date().toISOString(),
      vitestVersion: this.ctx?.version ?? null,
      files: (files ?? []).map(serializeFile),
      errors: (errors ?? []).map((e) => ({
        message: e?.message,
        stack: e?.stack,
      })),
    };

    writeFileSync(absolute, JSON.stringify(payload, null, 2) + "\n", "utf-8");
    process.stdout.write(`[bench-json-reporter] wrote ${absolute}\n`);
  }
}
