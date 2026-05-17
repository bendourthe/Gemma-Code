import { describe, it, expect, vi } from "vitest";
import {
  runAuditWorker,
  runTestgapsWorker,
  runReflectWorker,
  parseGemmaCheckJson,
  formatAuditFindings,
  formatReflectManifest,
  formatTestgapsOutput,
} from "../../../src/agents/BackgroundWorkers.js";
import type { ReflectJob, ReflectManifest } from "../../../src/storage/ReflectJob.js";

/**
 * v0.7.0 Phase 7 (C34) -- background worker tests.
 *
 * All process spawns are intercepted via the injectable `runner` callback so
 * the tests are pure and fast. Real `gemma-check` / `vitest` execution is
 * covered by the integration suite.
 */

describe("BackgroundWorkers.parseGemmaCheckJson", () => {
  it("returns an empty findings list for empty stdout", () => {
    expect(parseGemmaCheckJson("")).toEqual({ findings: [] });
    expect(parseGemmaCheckJson("   \n")).toEqual({ findings: [] });
  });

  it("parses well-formed JSON output", () => {
    const json = JSON.stringify({
      findings: [
        { rule: "no-eval", file: "src/foo.ts", line: 12, message: "Avoid eval", severity: "error" },
      ],
    });
    expect(parseGemmaCheckJson(json)).toEqual({
      findings: [
        { rule: "no-eval", file: "src/foo.ts", line: 12, message: "Avoid eval", severity: "error" },
      ],
    });
  });

  it("returns null when JSON parse fails", () => {
    expect(parseGemmaCheckJson("not json")).toBeNull();
  });

  it("falls back to empty findings when the schema is unexpected", () => {
    expect(parseGemmaCheckJson("{}")).toEqual({ findings: [] });
    expect(parseGemmaCheckJson("[]")).toEqual({ findings: [] });
  });
});

describe("BackgroundWorkers.formatAuditFindings", () => {
  it("emits a clean-suite summary when no findings and exit 0", () => {
    const output = formatAuditFindings([], ["src/a.ts", "src/b.ts"], 0, "");
    expect(output).toContain("gemma-check clean on 2 file(s)");
  });

  it("includes stderr when exit is non-zero with no findings", () => {
    const output = formatAuditFindings([], ["src/a.ts"], 2, "fatal: bad invocation");
    expect(output).toContain("gemma-check exited 2");
    expect(output).toContain("fatal: bad invocation");
  });

  it("renders findings with rule, severity, location, and message", () => {
    const finding = {
      rule: "no-secret",
      file: "src/conf.ts",
      line: 7,
      message: "Hardcoded API key",
      severity: "error",
    };
    const output = formatAuditFindings([finding], ["src/conf.ts"], 1, "");
    expect(output).toContain("**no-secret**");
    expect(output).toContain("[error]");
    expect(output).toContain("`src/conf.ts:7`");
    expect(output).toContain("Hardcoded API key");
  });
});

describe("BackgroundWorkers.formatTestgapsOutput", () => {
  it("reports an empty-output failure when stdout is blank", () => {
    const output = formatTestgapsOutput("", "Coverage subprocess failed", 1, ["tests/a.test.ts"]);
    expect(output).toContain("vitest exited 1");
    expect(output).toContain("Coverage subprocess failed");
  });

  it("summarizes pass/fail counts from valid JSON", () => {
    const report = JSON.stringify({
      numTotalTests: 12,
      numPassedTests: 11,
      numFailedTests: 1,
    });
    const output = formatTestgapsOutput(report, "", 1, ["tests/a.test.ts"]);
    expect(output).toContain("11/12 passed");
    expect(output).toContain("1 failed");
  });

  it("lists uncovered branches by file when coverage map is present", () => {
    const report = JSON.stringify({
      numTotalTests: 3,
      numPassedTests: 3,
      numFailedTests: 0,
      coverageMap: {
        "src/foo.ts": { b: { "0": [1, 0], "1": [0, 0] } },
      },
    });
    const output = formatTestgapsOutput(report, "", 0, ["tests/foo.test.ts"]);
    expect(output).toContain("Uncovered branches:");
    expect(output).toContain("src/foo.ts");
    expect(output).toContain("3 uncovered branch(es)");
  });
});

describe("BackgroundWorkers.runAuditWorker", () => {
  it("short-circuits with empty success when no files are modified", async () => {
    const runner = vi.fn();
    const result = await runAuditWorker([], { runner });
    expect(result).toEqual({ success: true, output: "", toolCallCount: 0 });
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns an error when the nexus-check script is missing", async () => {
    const runner = vi.fn();
    const result = await runAuditWorker(["src/foo.ts"], {
      runner,
      scriptPath: null,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("nexus-check");
    expect(runner).not.toHaveBeenCalled();
  });

  it("invokes gemma-check and reports a clean run", async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ findings: [] }),
      stderr: "",
      exitCode: 0,
    });
    const result = await runAuditWorker(["src/foo.ts"], {
      runner,
      scriptPath: "fake-script.mjs",
      cwd: "/repo",
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe("");
    expect(runner).toHaveBeenCalledOnce();
    const args = runner.mock.calls[0]![1] as string[];
    expect(args).toContain("--json");
    expect(args).toContain("src/foo.ts");
  });

  it("surfaces findings as a markdown summary", async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        findings: [
          { rule: "todo-found", file: "src/foo.ts", line: 4, message: "Unfinished TODO" },
        ],
      }),
      stderr: "",
      exitCode: 1,
    });
    const result = await runAuditWorker(["src/foo.ts"], {
      runner,
      scriptPath: "fake-script.mjs",
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("Audit Worker");
    expect(result.output).toContain("todo-found");
    expect(result.output).toContain("Unfinished TODO");
  });

  it("captures runner errors and returns success=false", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("ENOENT"));
    const result = await runAuditWorker(["src/foo.ts"], {
      runner,
      scriptPath: "fake-script.mjs",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("ENOENT");
  });
});

describe("BackgroundWorkers.runTestgapsWorker", () => {
  it("short-circuits with empty success when no source files are modified", async () => {
    const runner = vi.fn();
    const result = await runTestgapsWorker(["docs/CHANGELOG.md"], { runner });
    expect(result.success).toBe(true);
    expect(result.output).toBe("");
    expect(runner).not.toHaveBeenCalled();
  });

  it("skips source files that look like test files", async () => {
    const runner = vi.fn();
    const result = await runTestgapsWorker(["tests/unit/foo.test.ts"], { runner });
    expect(result.success).toBe(true);
    expect(runner).not.toHaveBeenCalled();
  });

  it("reports no matching test files when none exist on disk", async () => {
    const runner = vi.fn();
    const result = await runTestgapsWorker(["src/nonexistent-xyz.ts"], {
      runner,
      cwd: "/repo",
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("No matching test files");
    expect(runner).not.toHaveBeenCalled();
  });
});

// v0.9.0 Phase 2.5 ---------------------------------------------------------

describe("BackgroundWorkers.runReflectWorker (Phase 2.5)", () => {
  function makeManifest(overrides: Partial<ReflectManifest> = {}): ReflectManifest {
    return {
      version: 1,
      id: "manifest-1",
      createdAt: new Date(1_700_000_000_000).toISOString(),
      lookbackMs: 24 * 60 * 60 * 1000,
      clusters: [
        { actionKey: "edit::src", events: [], occurrences: 4, firstSeen: 1, lastSeen: 2 },
        { actionKey: "test::tests", events: [], occurrences: 3, firstSeen: 3, lastSeen: 4 },
      ],
      lessons: [
        { id: "lesson-1", actionKey: "edit::src", clusterSize: 4, lesson: "ship smaller diffs", generatedAt: 0 },
      ],
      hardwareTier: "balanced",
      manifestPath: "/tmp/manifest-1.json",
      ...overrides,
    };
  }

  it("returns a not-initialized error when no ReflectJob is wired", async () => {
    const result = await runReflectWorker(null);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not initialized/i);
  });

  it("skips on constrained hardware tiers", async () => {
    const job = { dryRun: vi.fn() } as unknown as ReflectJob;
    const result = await runReflectWorker(job, { hardwareTier: "constrained" });
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/Skipped: hardware tier 'constrained'/);
    expect(job.dryRun).not.toHaveBeenCalled();
  });

  it("skips when the cadence window has not elapsed", async () => {
    const dry = vi.fn();
    const job = { dryRun: dry } as unknown as ReflectJob;
    const result = await runReflectWorker(job, {
      cadenceMs: 60_000,
      cadence: {
        read: () => ({ lastRunAt: 1_000 }),
        write: () => {},
      },
      now: () => 2_000,
    });
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/Skipped: next eligible run/);
    expect(dry).not.toHaveBeenCalled();
  });

  it("runs ReflectJob.dryRun and formats the manifest when cadence passes", async () => {
    const writes: Array<{ lastRunAt: number }> = [];
    const job = {
      dryRun: vi.fn().mockResolvedValue(makeManifest()),
    } as unknown as ReflectJob;
    const result = await runReflectWorker(job, {
      cadenceMs: 1_000,
      cadence: {
        read: () => ({ lastRunAt: 0 }),
        write: (state) => writes.push(state),
      },
      now: () => 5_000,
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("Reflect Worker");
    expect(result.output).toMatch(/proposed 1 lesson/);
    expect(writes).toEqual([{ lastRunAt: 5_000 }]);
  });

  it("formats an empty manifest as a zero-cluster note", () => {
    const empty = makeManifest({ clusters: [], lessons: [] });
    const body = formatReflectManifest(empty);
    expect(body).toContain("0 recurring action clusters");
  });
});
