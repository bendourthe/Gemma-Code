import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  allPassed,
  defaultCommandRunner,
  evaluateCriteria,
  type CommandResult,
  type CommandRunner,
  type GoldenSuccessCriterion,
} from "../../../modules/coding/evaluation/goldenCriteria.js";

/**
 * v1.7.0 Phase 1 (adoption-self-optimizing-skills S1 / SO001) -- unit tests for
 * the declarative success-criteria evaluator (port of evaluator.py). Command-
 * based criteria use an injected fake runner so the suite stays deterministic
 * and cross-platform; one test exercises the real default runner via `node`.
 */

let workdir: string;

beforeEach(async () => {
  workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "golden-criteria-"));
});

afterEach(async () => {
  await fsp.rm(workdir, { recursive: true, force: true });
});

/** A command runner that returns a canned result regardless of input. */
function fixedRunner(result: Partial<CommandResult>): CommandRunner {
  return () => ({ code: 0, stdout: "", stderr: "", timedOut: false, ...result });
}

describe("evaluateCriteria - file criteria", () => {
  it("file_exists passes when the file is present and fails when absent", async () => {
    await fsp.writeFile(path.join(workdir, "present.ts"), "x", "utf8");
    const criteria: GoldenSuccessCriterion[] = [
      { type: "file_exists", target: "present.ts" },
      { type: "file_exists", target: "missing.ts" },
    ];
    const outcomes = await evaluateCriteria(workdir, criteria, fixedRunner({}));
    expect(outcomes[0]!.passed).toBe(true);
    expect(outcomes[1]!.passed).toBe(false);
  });

  it("file_deleted passes only when the file is absent", async () => {
    await fsp.writeFile(path.join(workdir, "still-here.txt"), "x", "utf8");
    const outcomes = await evaluateCriteria(
      workdir,
      [
        { type: "file_deleted", target: "still-here.txt" },
        { type: "file_deleted", target: "gone.txt" },
      ],
      fixedRunner({}),
    );
    expect(outcomes[0]!.passed).toBe(false);
    expect(outcomes[1]!.passed).toBe(true);
  });

  it("file_contains matches a regex pattern and reports a missing file", async () => {
    await fsp.writeFile(path.join(workdir, "src.ts"), "export const transformPayload = 1;", "utf8");
    const outcomes = await evaluateCriteria(
      workdir,
      [
        { type: "file_contains", target: "src.ts", pattern: "transformPayload" },
        { type: "file_contains", target: "src.ts", pattern: "\\?|\\$1|:id" }, // regex, no match
        { type: "file_contains", target: "absent.ts", pattern: "x" },
      ],
      fixedRunner({}),
    );
    expect(outcomes[0]!.passed).toBe(true);
    expect(outcomes[1]!.passed).toBe(false);
    expect(outcomes[2]!.passed).toBe(false);
    expect(outcomes[2]!.detail).toContain("file missing");
  });

  it("file_contains with an invalid regex falls back to a literal substring search", async () => {
    await fsp.writeFile(path.join(workdir, "f.ts"), "value = a[0", "utf8");
    const outcomes = await evaluateCriteria(
      workdir,
      [{ type: "file_contains", target: "f.ts", pattern: "a[0" }], // invalid regex
      fixedRunner({}),
    );
    expect(outcomes[0]!.passed).toBe(true);
  });

  it("file_contains with an empty pattern matches any present file", async () => {
    await fsp.writeFile(path.join(workdir, "any.ts"), "anything", "utf8");
    const outcomes = await evaluateCriteria(
      workdir,
      [{ type: "file_contains", target: "any.ts", pattern: "" }],
      fixedRunner({}),
    );
    expect(outcomes[0]!.passed).toBe(true);
  });
});

describe("evaluateCriteria - command criteria", () => {
  it("output_contains matches combined stdout+stderr and reports timeouts", async () => {
    const outcomes = await evaluateCriteria(
      workdir,
      [
        { type: "output_contains", target: "echo hi", pattern: "hi" },
        { type: "output_contains", target: "echo hi", pattern: "missing" },
      ],
      fixedRunner({ stdout: "hi\n" }),
    );
    expect(outcomes[0]!.passed).toBe(true);
    expect(outcomes[1]!.passed).toBe(false);

    const timedOut = await evaluateCriteria(
      workdir,
      [{ type: "output_contains", target: "sleep 9999", pattern: "x" }],
      fixedRunner({ timedOut: true }),
    );
    expect(timedOut[0]!.passed).toBe(false);
    expect(timedOut[0]!.detail).toContain("timed out");
  });

  it("test_passes / lint_passes / no_errors pass on exit 0 and fail otherwise", async () => {
    const ok = await evaluateCriteria(
      workdir,
      [
        { type: "test_passes", target: "true" },
        { type: "lint_passes", target: "true" },
        { type: "no_errors", target: "true" },
      ],
      fixedRunner({ code: 0 }),
    );
    expect(ok.every((o) => o.passed)).toBe(true);

    const failed = await evaluateCriteria(
      workdir,
      [{ type: "no_errors", target: "false" }],
      fixedRunner({ code: 1 }),
    );
    expect(failed[0]!.passed).toBe(false);

    const timedOut = await evaluateCriteria(
      workdir,
      [{ type: "test_passes", target: "hang" }],
      fixedRunner({ timedOut: true }),
    );
    expect(timedOut[0]!.passed).toBe(false);
  });

  it("diff_matches runs `git diff` and matches its output", async () => {
    const runner: CommandRunner = (command) => {
      expect(command).toBe("git diff");
      return { code: 0, stdout: "+ added line\n", stderr: "", timedOut: false };
    };
    const outcomes = await evaluateCriteria(
      workdir,
      [
        { type: "diff_matches", target: "ignored", pattern: "added line" },
        { type: "diff_matches", target: "ignored", pattern: "removed line" },
      ],
      runner,
    );
    expect(outcomes[0]!.passed).toBe(true);
    expect(outcomes[1]!.passed).toBe(false);

    const timedOut = await evaluateCriteria(
      workdir,
      [{ type: "diff_matches", target: "x", pattern: "y" }],
      fixedRunner({ timedOut: true }),
    );
    expect(timedOut[0]!.passed).toBe(false);
  });
});

describe("evaluateCriteria - misc", () => {
  it("an unknown criterion type resolves to a failure rather than throwing", async () => {
    const outcomes = await evaluateCriteria(
      workdir,
      [{ type: "bogus" as unknown as GoldenSuccessCriterion["type"], target: "x" }],
      fixedRunner({}),
    );
    expect(outcomes[0]!.passed).toBe(false);
    expect(outcomes[0]!.detail).toContain("unknown criteria type");
  });

  it("allPassed is true for an empty list and reflects mixed outcomes", async () => {
    expect(allPassed([])).toBe(true);
    await fsp.writeFile(path.join(workdir, "a.ts"), "x", "utf8");
    const mixed = await evaluateCriteria(
      workdir,
      [
        { type: "file_exists", target: "a.ts" },
        { type: "file_exists", target: "b.ts" },
      ],
      fixedRunner({}),
    );
    expect(allPassed(mixed)).toBe(false);
  });

  it("defaultCommandRunner executes a real command and captures output + exit code", () => {
    const ok = defaultCommandRunner('node -e "process.stdout.write(\'pong\')"', workdir);
    expect(ok.timedOut).toBe(false);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("pong");

    const nonZero = defaultCommandRunner('node -e "process.exit(3)"', workdir);
    expect(nonZero.code).toBe(3);
  });

  it("defaultCommandRunner reports a non-zero (or negative) code for a missing binary instead of throwing", () => {
    const result = defaultCommandRunner("this-binary-does-not-exist-xyz --nope", workdir);
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    // Ensure the existence of the temp dir was not disturbed.
    expect(fs.existsSync(workdir)).toBe(true);
  });
});
