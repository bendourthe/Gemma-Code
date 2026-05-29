/**
 * v1.2.0 Phase 7 sub-task 7.1 -- End-to-end token-usage benchmark for the
 * Coding pillar after the 2026-05 ecosystem adoption.
 *
 * Workload (5 plan-script steps + the implicit signature-inspection that
 * codegraph collapses into the first phase):
 *
 *   1. Find all callers of `redactSecrets`.
 *   2. Run the test suite.
 *   3. Inspect one failing test.
 *   4. Propose a fix and edit the file.
 *   5. Re-run the test suite.
 *
 * The benchmark composes the two large adoption deltas: the codegraph MCP
 * surface from Phase 3 (collapsing step 1 from `grep + N read_file` to
 * `codegraph_callers + codegraph_context`) and the `CommandCompressor`
 * from Phase 2 (compressing the two pytest runs). Steps 3 and 4 (inspect
 * + edit) are common to both arms.
 *
 * The "without adoption" arm is a deterministic simulation that mirrors
 * the path the agent would take against a pre-Phase-1 checkout (a single
 * `grep_codebase` step plus per-file reads to locate callers, and
 * uncompressed test-suite output flowing back into the model context).
 * The simulation reads the same fixture bytes the post-adoption arm
 * reads so the baseline is apples-to-apples.
 *
 * Tokens are approximated by UTF-8 byte length; both arms use the same
 * proxy, so the delta is fair. The plan path
 * `tests/benchmarks/coding-pillar-token-usage.ts` was forward-looking; the
 * Phase 2 and Phase 3 stability gates already ship under
 * `tests/integration/coding-pillar/`, so this test lives next to its
 * siblings (Phase 2.5 `command-compressor-benchmark.test.ts`, Phase 3.6
 * `tests/integration/codegraph/benchmark.test.ts`).
 *
 * Plan reference: docs/versions/v1/v1.2.0/plans/adoption-ecosystem-2026-05.md sub-task 7.1
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { CommandCompressor } from "../../../core/observability/CommandCompressor.js";
import { CodeGraphMcpServer } from "../../../core/codegraph/mcp/index.js";
import { SqliteGraphStore } from "../../../core/codegraph/store/index.js";
import { RepoScanner } from "../../../core/codegraph/scanner/index.js";

const FIXTURE_REPO = path.resolve(
  __dirname,
  "..",
  "..",
  "fixtures",
  "codegraph-benchmark-repo",
);
const RESULTS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "fixtures",
  "coding-pillar-token-usage-results",
  "2026-05-26",
);

interface WorkloadStep {
  readonly step: number;
  readonly label: string;
  readonly tool: string;
  readonly tokenBytes: number;
}

interface WorkloadRun {
  readonly arm: "with-adoption" | "without-adoption";
  readonly toolCalls: number;
  readonly tokenBytes: number;
  readonly steps: readonly WorkloadStep[];
}

function buildPytestPassOutput(): string {
  const lines: string[] = [];
  for (let i = 0; i < 400; i += 1) {
    lines.push("PASSED tests/unit/test_alpha.py::test_alpha_path_one");
  }
  for (let i = 0; i < 199; i += 1) {
    lines.push("PASSED tests/unit/test_beta.py::test_beta_path_two");
  }
  lines.push(
    "FAILED tests/unit/test_beta.py::test_beta_path_three - AssertionError: expected 1, got 0",
  );
  lines.push("599 passed, 1 failed in 12.34s");
  return lines.join("\n");
}

function buildPytestRetryOutput(): string {
  return [
    "PASSED tests/unit/test_beta.py::test_beta_path_three",
    "1 passed in 0.42s",
  ].join("\n");
}

function buildFailingTestSource(): string {
  return [
    "import pytest",
    "from src.redact import redactSecrets",
    "",
    "def test_beta_path_three() -> None:",
    "    sanitized = redactSecrets(\"secret-payload\")",
    "    assert sanitized == \"[REDACTED]\"",
  ].join("\n");
}

function buildPatch(): string {
  return [
    "--- a/tests/unit/test_beta.py",
    "+++ b/tests/unit/test_beta.py",
    "@@",
    '-    assert sanitized == "[REDACTED]"',
    '+    assert sanitized.startswith("[REDACTED]")',
    "",
  ].join("\n");
}

async function runWithAdoptionArm(homeFn: () => string): Promise<WorkloadRun> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phase7-token-with-"));
  const dbPath = path.join(dir, "graph.db");
  const store = new SqliteGraphStore({ dbPath });
  const scanner = new RepoScanner({ store });
  scanner.scan(FIXTURE_REPO);
  const server = new CodeGraphMcpServer({ store });
  const compressor = new CommandCompressor({ nexusHomeFn: homeFn });

  const steps: WorkloadStep[] = [];
  try {
    const callers = await server.invokeTool("codegraph_callers", {
      symbolName: "redactSecrets",
    });
    steps.push({
      step: 1,
      label: "Find callers of redactSecrets",
      tool: "codegraph_callers",
      tokenBytes: (callers.result ?? "").length,
    });
    const ctx = await server.invokeTool("codegraph_context", {
      symbolName: "redactSecrets",
    });
    steps.push({
      step: 2,
      label: "Inspect signature of redactSecrets",
      tool: "codegraph_context",
      tokenBytes: (ctx.result ?? "").length,
    });

    const pytestRun1 = compressor.compress(
      "pytest -q",
      buildPytestPassOutput(),
      1,
    );
    steps.push({
      step: 3,
      label: "Run the test suite",
      tool: "run_terminal:pytest",
      tokenBytes: pytestRun1.compressedBytes,
    });

    const inspect = compressor.compress(
      "cat tests/unit/test_beta.py",
      buildFailingTestSource(),
      0,
    );
    steps.push({
      step: 4,
      label: "Inspect failing test source",
      tool: "read_file",
      tokenBytes: inspect.compressedBytes,
    });

    steps.push({
      step: 5,
      label: "Apply proposed fix",
      tool: "write_file",
      tokenBytes: Buffer.byteLength(buildPatch(), "utf8"),
    });

    const pytestRun2 = compressor.compress(
      "pytest -q tests/unit/test_beta.py::test_beta_path_three",
      buildPytestRetryOutput(),
      0,
    );
    steps.push({
      step: 6,
      label: "Re-run the test suite",
      tool: "run_terminal:pytest",
      tokenBytes: pytestRun2.compressedBytes,
    });
  } finally {
    store.close();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  const tokenBytes = steps.reduce((acc, s) => acc + s.tokenBytes, 0);
  return {
    arm: "with-adoption",
    toolCalls: steps.length,
    tokenBytes,
    steps,
  };
}

function runWithoutAdoptionArm(): WorkloadRun {
  const steps: WorkloadStep[] = [];

  const callerFiles = fs
    .readdirSync(FIXTURE_REPO)
    .filter((f) => f.endsWith(".ts") && f !== "redact.ts");

  const grepOutput = callerFiles
    .map((f) => fs.readFileSync(path.join(FIXTURE_REPO, f), "utf-8"))
    .join("\n");
  steps.push({
    step: 1,
    label: "grep for redactSecrets references",
    tool: "grep_codebase",
    tokenBytes: Buffer.byteLength(grepOutput, "utf8"),
  });
  callerFiles.forEach((f, idx) => {
    const body = fs.readFileSync(path.join(FIXTURE_REPO, f), "utf-8");
    steps.push({
      step: 2 + idx,
      label: `Inspect caller ${f}`,
      tool: "read_file",
      tokenBytes: Buffer.byteLength(body, "utf8"),
    });
  });
  const def = fs.readFileSync(path.join(FIXTURE_REPO, "redact.ts"), "utf-8");
  steps.push({
    step: steps.length + 1,
    label: "Inspect redactSecrets definition",
    tool: "read_file",
    tokenBytes: Buffer.byteLength(def, "utf8"),
  });

  steps.push({
    step: steps.length + 1,
    label: "Run the test suite",
    tool: "run_terminal:pytest",
    tokenBytes: Buffer.byteLength(buildPytestPassOutput(), "utf8"),
  });

  steps.push({
    step: steps.length + 1,
    label: "Inspect failing test source",
    tool: "read_file",
    tokenBytes: Buffer.byteLength(buildFailingTestSource(), "utf8"),
  });

  steps.push({
    step: steps.length + 1,
    label: "Apply proposed fix",
    tool: "write_file",
    tokenBytes: Buffer.byteLength(buildPatch(), "utf8"),
  });

  steps.push({
    step: steps.length + 1,
    label: "Re-run the test suite",
    tool: "run_terminal:pytest",
    tokenBytes: Buffer.byteLength(buildPytestRetryOutput(), "utf8"),
  });

  const tokenBytes = steps.reduce((acc, s) => acc + s.tokenBytes, 0);
  return {
    arm: "without-adoption",
    toolCalls: steps.length,
    tokenBytes,
    steps,
  };
}

describe("Phase 7.1 end-to-end Coding-pillar token-usage benchmark", () => {
  it("post-adoption arm uses at most 70% of pre-adoption tokens and 70% of tool calls", async () => {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase7-token-home-"));
    try {
      const without = runWithoutAdoptionArm();
      const withArm = await runWithAdoptionArm(() => homeDir);

      const tokenRatio = withArm.tokenBytes / without.tokenBytes;
      const toolCallRatio = withArm.toolCalls / without.toolCalls;

      fs.writeFileSync(
        path.join(RESULTS_DIR, "without-adoption.json"),
        JSON.stringify(without, null, 2),
        "utf8",
      );
      fs.writeFileSync(
        path.join(RESULTS_DIR, "with-adoption.json"),
        JSON.stringify(withArm, null, 2),
        "utf8",
      );
      fs.writeFileSync(
        path.join(RESULTS_DIR, "summary.json"),
        JSON.stringify(
          {
            capturedAt: "2026-05-28",
            workload: [
              "Find all callers of redactSecrets",
              "Run the test suite",
              "Inspect one failing test",
              "Propose a fix and edit the file",
              "Re-run the test suite",
            ],
            fixtureRepo: "tests/fixtures/codegraph-benchmark-repo/",
            withoutAdoption: {
              tokenBytes: without.tokenBytes,
              toolCalls: without.toolCalls,
            },
            withAdoption: {
              tokenBytes: withArm.tokenBytes,
              toolCalls: withArm.toolCalls,
            },
            tokenRatio: Number(tokenRatio.toFixed(4)),
            tokenRatioPercent: `${(tokenRatio * 100).toFixed(2)}%`,
            tokenDeltaPercent: `${((1 - tokenRatio) * 100).toFixed(2)}%`,
            toolCallRatio: Number(toolCallRatio.toFixed(4)),
            toolCallRatioPercent: `${(toolCallRatio * 100).toFixed(2)}%`,
            toolCallDeltaPercent: `${((1 - toolCallRatio) * 100).toFixed(2)}%`,
            stabilityGates: {
              tokenRatioMax: 0.7,
              toolCallRatioMax: 0.7,
              passed: tokenRatio <= 0.7 && toolCallRatio <= 0.7,
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      expect(tokenRatio).toBeLessThanOrEqual(0.7);
      expect(toolCallRatio).toBeLessThanOrEqual(0.7);
    } finally {
      try {
        fs.rmSync(homeDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });
});
