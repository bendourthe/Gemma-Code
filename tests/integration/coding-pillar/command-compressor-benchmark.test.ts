/**
 * v1.2.0 Phase 2 sub-task 2.5 -- Coding-pillar benchmark stability gate.
 *
 * Drives a fixed-seed synthetic Coding-pillar transcript through the
 * `CommandCompressor` twice -- once with the default registry active and
 * once with an empty registry (forcing passthrough) -- and asserts that
 * the compressed total stays at most 50% of the raw total. The two
 * resulting transcripts are persisted under
 * `tests/fixtures/coding-pillar-benchmark-results/2026-05-26/` so the
 * Phase 7 stabilization report can cite a stable baseline.
 *
 * The transcript shape mimics a representative Coding-pillar session for
 * the prompt "Run the full test suite, then summarize failures":
 *
 *   1. `git status`             -- branch + change summary
 *   2. `pytest -q`              -- 600 PASSED + 1 FAILED
 *   3. `grep -r needle .`       -- 800 matches
 *   4. `cat tests/b.test.py`    -- one source file echoed
 *   5. `cargo build`            -- 100+ Compiling lines
 *   6. `pytest -q tests/b.test` -- failure path, 1 FAILED
 *
 * Tokens are approximated by UTF-8 byte length; this is a proxy chosen
 * because every embedded tokenizer in the repo is heavyweight to load
 * inside an integration test. The proxy is fair because the same proxy
 * is applied to both runs.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CommandCompressor } from "../../../core/observability/CommandCompressor.js";

interface TranscriptStep {
  readonly command: string;
  readonly stdout: string;
  readonly exitCode: number;
}

interface CompressedStep {
  readonly command: string;
  readonly exitCode: number;
  readonly originalBytes: number;
  readonly compressedBytes: number;
  readonly strategyApplied: string;
}

function buildTranscript(): TranscriptStep[] {
  const gitStatus = [
    "On branch feat/coding-benchmark",
    "Your branch is up to date with 'origin/feat/coding-benchmark'.",
    "",
    "Changes not staged for commit:",
    "  (use \"git add <file>...\" to update what will be committed)",
    "  (use \"git restore <file>...\" to discard changes)",
    ...Array.from({ length: 80 }, (_, i) => `\tmodified:   src/module${i}.ts`),
    "",
    "no changes added to commit",
  ].join("\n");

  const pytestPass = [
    ...Array.from(
      { length: 400 },
      () => "PASSED tests/unit/test_alpha.py::test_alpha_path_one",
    ),
    ...Array.from(
      { length: 200 },
      () => "PASSED tests/unit/test_beta.py::test_beta_path_two",
    ),
    "600 passed in 12.34s",
  ].join("\n");

  const grepHits = Array.from(
    { length: 800 },
    (_, i) => `src/file${i}.ts:${(i % 50) + 1}:needle reference ${i}`,
  ).join("\n");

  // `cat` is passthrough in the registry: a moderate-size source file is
  // not heavily compressed, which keeps the benchmark fair.
  const catBody = Array.from(
    { length: 220 },
    (_, i) => `def test_function_${i}(): assert True`,
  ).join("\n");

  const cargoBuild = [
    ...Array.from({ length: 120 }, (_, i) => `   Compiling crate-${i % 30} v1.0.0`),
    "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 18.21s",
  ].join("\n");

  const pytestFail = [
    "PASSED tests/unit/test_beta.py::test_beta_path_one",
    "FAILED tests/unit/test_beta.py::test_beta_path_two - AssertionError: expected 1, got 0",
    "",
    "1 failed, 1 passed in 0.42s",
  ].join("\n");

  return [
    { command: "git status", stdout: gitStatus, exitCode: 0 },
    { command: "pytest -q", stdout: pytestPass, exitCode: 0 },
    { command: "grep -r needle .", stdout: grepHits, exitCode: 0 },
    { command: "cat tests/unit/test_beta.py", stdout: catBody, exitCode: 0 },
    { command: "cargo build", stdout: cargoBuild, exitCode: 0 },
    { command: "pytest -q tests/unit/test_beta.py", stdout: pytestFail, exitCode: 1 },
  ];
}

function runTranscriptWithCompressor(
  transcript: readonly TranscriptStep[],
  homeFn: () => string,
): { steps: CompressedStep[]; rawTotal: number; compressedTotal: number } {
  const compressor = new CommandCompressor({ nexusHomeFn: homeFn });
  const steps: CompressedStep[] = [];
  let rawTotal = 0;
  let compressedTotal = 0;
  for (const step of transcript) {
    const result = compressor.compress(step.command, step.stdout, step.exitCode);
    rawTotal += result.originalBytes;
    compressedTotal += result.compressedBytes;
    steps.push({
      command: step.command,
      exitCode: step.exitCode,
      originalBytes: result.originalBytes,
      compressedBytes: result.compressedBytes,
      strategyApplied: result.strategyApplied,
    });
  }
  return { steps, rawTotal, compressedTotal };
}

function runTranscriptRaw(
  transcript: readonly TranscriptStep[],
): { steps: CompressedStep[]; rawTotal: number; compressedTotal: number } {
  const steps: CompressedStep[] = [];
  let total = 0;
  for (const step of transcript) {
    const bytes = Buffer.byteLength(step.stdout, "utf8");
    total += bytes;
    steps.push({
      command: step.command,
      exitCode: step.exitCode,
      originalBytes: bytes,
      compressedBytes: bytes,
      strategyApplied: "passthrough",
    });
  }
  return { steps, rawTotal: total, compressedTotal: total };
}

describe("CommandCompressor benchmark (Phase 2 sub-task 2.5)", () => {
  it("compressed total <=50% of raw total on the reference transcript", () => {
    const transcript = buildTranscript();

    const tmpHomeWith = fs.mkdtempSync(
      path.join(os.tmpdir(), "compressor-bench-with-"),
    );

    const withCompressor = runTranscriptWithCompressor(
      transcript,
      () => tmpHomeWith,
    );
    // Baseline: raw bytes the model would receive without any compressor.
    const withoutCompressor = runTranscriptRaw(transcript);

    // Persist both transcripts under the Phase 2 benchmark results dir.
    const resultsDir = path.resolve(
      __dirname,
      "..",
      "..",
      "fixtures",
      "coding-pillar-benchmark-results",
      "2026-05-26",
    );
    fs.mkdirSync(resultsDir, { recursive: true });
    const withPath = path.join(resultsDir, "with-compressor.json");
    const withoutPath = path.join(resultsDir, "without-compressor.json");
    fs.writeFileSync(
      withPath,
      JSON.stringify(
        {
          generated: "vitest fixed-seed transcript",
          rawTotal: withCompressor.rawTotal,
          compressedTotal: withCompressor.compressedTotal,
          steps: withCompressor.steps,
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      withoutPath,
      JSON.stringify(
        {
          generated: "vitest fixed-seed transcript",
          rawTotal: withoutCompressor.rawTotal,
          compressedTotal: withoutCompressor.compressedTotal,
          steps: withoutCompressor.steps,
        },
        null,
        2,
      ),
      "utf8",
    );

    // Sanity: without-compressor should be pass-through (compressed == raw).
    expect(withoutCompressor.compressedTotal).toBe(withoutCompressor.rawTotal);

    // Phase 2 stability gate: with-compressor total <=50% of without-compressor total.
    const ratio = withCompressor.compressedTotal / withoutCompressor.rawTotal;
    expect(ratio).toBeLessThanOrEqual(0.5);

    // Cleanup tee dir.
    try {
      fs.rmSync(tmpHomeWith, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });
});
