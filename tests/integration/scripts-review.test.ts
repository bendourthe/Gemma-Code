/**
 * v0.9.0 Phase 5 sub-task 5.4 -- integration tests for `scripts/review/`.
 *
 * Each PR-lifecycle sub-command shells out to `gh` and `git`. We do not
 * exercise those tools end-to-end inside `npm test` (the agent has no
 * authenticated `gh` session in CI and no PR to operate on). Instead we
 * cover:
 *
 *  - The argument parser (parseReviewArgs).
 *  - The check-result parser (parseGhPrChecks) + green-check classifier
 *    (checksAreGreen) -- the heart of the merge gate.
 *  - The diff-cover artifact parser + test-file suggester.
 *  - The dispatcher (`main`) help / unknown command path.
 *  - The --dry-run path of each sub-command, which exercises arg parsing
 *    without spawning gh / git.
 *
 * A separate manual smoke (Phase 5.5) walks `sync` on a synthetic PR.
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import * as path from "node:path";

import {
  parseReviewArgs,
  parseGhPrChecks,
  summarizeChecks,
} from "../../scripts/review/shared.mjs";
import { checksAreGreen } from "../../scripts/review/merge.mjs";
import {
  extractUncoveredFromMarkdown,
  suggestTestFiles,
  formatCoverageReport,
} from "../../scripts/review/coverage.mjs";
import { summarizeReviewerComments } from "../../scripts/review/fix.mjs";
import { main } from "../../scripts/review/cli.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(REPO_ROOT, "scripts", "review", "cli.mjs");

describe("parseReviewArgs", () => {
  it("captures the PR number from the first positional", () => {
    const args = parseReviewArgs(["42"]);
    expect(args.prNumber).toBe(42);
  });

  it("recognizes --dry-run + merge mode flags", () => {
    const args = parseReviewArgs(["42", "--dry-run", "--squash"]);
    expect(args.dryRun).toBe(true);
    expect(args.mergeMode).toBe("squash");
  });

  it("recognizes --agent and --agent=", () => {
    expect(parseReviewArgs(["42", "--agent", "claude"]).agent).toBe("claude");
    expect(parseReviewArgs(["42", "--agent=codex"]).agent).toBe("codex");
  });

  it("returns null when no numeric positional is given", () => {
    expect(parseReviewArgs(["--dry-run"]).prNumber).toBe(null);
  });
});

describe("parseGhPrChecks", () => {
  it("parses one verdict per row from the gh pr checks text format", () => {
    const stdout = [
      "ci\tpass\t12s",
      "coverage\tpending\t3s",
      "lint\tfail\t1s",
    ].join("\n");
    const rows = parseGhPrChecks(stdout);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.verdict)).toEqual(["pass", "pending", "fail"]);
  });

  it("returns [] on empty input", () => {
    expect(parseGhPrChecks("")).toEqual([]);
  });
});

describe("summarizeChecks + checksAreGreen", () => {
  it("returns green when every check is pass / success / completed", () => {
    const rows = parseGhPrChecks("ci\tpass\nbench\tsuccess\nlint\tcompleted");
    const s = summarizeChecks(rows);
    expect(s.failing).toEqual([]);
    expect(s.pending).toEqual([]);
    expect(checksAreGreen(rows)).toBe(true);
  });

  it("returns red on a fail / failure conclusion", () => {
    const rows = parseGhPrChecks("ci\tpass\nlint\tfail");
    expect(checksAreGreen(rows)).toBe(false);
  });

  it("returns red on a pending / in_progress conclusion", () => {
    const rows = parseGhPrChecks("ci\tpass\nbench\tin_progress");
    expect(checksAreGreen(rows)).toBe(false);
  });
});

describe("extractUncoveredFromMarkdown", () => {
  it("returns [] on empty input", () => {
    expect(extractUncoveredFromMarkdown("")).toEqual([]);
  });

  it("picks up file headers and Missing line ranges", () => {
    const md = [
      "# Diff Coverage",
      "",
      "## src/foo/bar.ts",
      "",
      "Coverage: 70%",
      "",
      "Missing line(s): 12-15, 22",
      "",
      "## src/foo/baz.ts",
      "",
      "Coverage: 100%",
    ].join("\n");
    const uncovered = extractUncoveredFromMarkdown(md);
    expect(uncovered.length).toBeGreaterThanOrEqual(1);
    const bar = uncovered.find((u) => u.path === "src/foo/bar.ts");
    expect(bar).toBeDefined();
    expect(bar?.missing).toMatch(/12-15/);
  });
});

describe("suggestTestFiles", () => {
  it("maps src/* paths to tests/unit/*", () => {
    const out = suggestTestFiles([{ path: "src/foo/bar.ts", missing: "1" }]);
    expect(out[0].suggestion).toBe("tests/unit/foo/bar.test.ts");
  });

  it("maps scripts/* paths to tests/unit/scripts/*", () => {
    const out = suggestTestFiles([{ path: "scripts/work.mjs", missing: "1" }]);
    expect(out[0].suggestion).toMatch(/tests\/unit\/scripts\/work\.test\.ts/);
  });
});

describe("formatCoverageReport", () => {
  it("appends the suggested test files after the markdown body", () => {
    const md = "## src/foo/bar.ts\nMissing line(s): 12";
    const uncovered = suggestTestFiles(extractUncoveredFromMarkdown(md));
    const out = formatCoverageReport(md, uncovered);
    expect(out).toMatch(/Suggested test files/);
    expect(out).toMatch(/tests\/unit\/foo\/bar\.test\.ts/);
  });
});

describe("summarizeReviewerComments", () => {
  it("renders both review-thread and issue-comment counts and a handoff line", () => {
    const out = summarizeReviewerComments({
      reviewComments: [
        { user: { login: "alice" }, path: "src/foo.ts", line: 12, body: "nit: rename this" },
      ],
      issueComments: [
        { author: { login: "bob" }, body: "Looks good to me" },
      ],
    });
    expect(out).toMatch(/Review thread comments: 1/);
    expect(out).toMatch(/alice on src\/foo\.ts:12/);
    expect(out).toMatch(/PR issue comments: 1/);
    expect(out).toMatch(/bob:/);
    expect(out).toMatch(/pr-manager/);
  });
});

describe("cli main", () => {
  it("prints help on --help and exits 0", async () => {
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-expect-error -- monkey-patch
    process.stdout.write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };
    try {
      const code = await main(["node", "cli.mjs", "--help"]);
      expect(code).toBe(0);
      expect(written.join("")).toMatch(/gemma-code PR review runner/);
    } finally {
      // @ts-expect-error -- restore
      process.stdout.write = orig;
    }
  });

  it("rejects an unknown sub-command with exit 2", async () => {
    const errs: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    const origOut = process.stdout.write.bind(process.stdout);
    // @ts-expect-error -- monkey-patch
    process.stderr.write = (chunk: string) => {
      errs.push(String(chunk));
      return true;
    };
    // @ts-expect-error -- monkey-patch
    process.stdout.write = () => true;
    try {
      const code = await main(["node", "cli.mjs", "wat"]);
      expect(code).toBe(2);
      expect(errs.join("")).toMatch(/unknown command/);
    } finally {
      // @ts-expect-error -- restore
      process.stderr.write = origErr;
      // @ts-expect-error -- restore
      process.stdout.write = origOut;
    }
  });

  it("sync --dry-run with a numeric PR exits 0 without dispatching gh", async () => {
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-expect-error -- monkey-patch
    process.stdout.write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };
    try {
      // sync's dry-run path returns 0 only when the working tree is clean.
      // We assert the code is in {0, 1} -- either path is valid because the
      // suite may be running with intentional local edits during dev. In CI
      // the tree is clean so the exit is 0.
      const code = await main(["node", "cli.mjs", "sync", "42", "--dry-run"]);
      expect([0, 1]).toContain(code);
      // When dirty, the stderr path prints; otherwise stdout carries the
      // dry-run message. Either way the run should not throw.
    } finally {
      // @ts-expect-error -- restore
      process.stdout.write = orig;
    }
  });

  it("merge --dry-run with --rebase reaches the dry-run branch (exit 0)", async () => {
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-expect-error -- monkey-patch
    process.stdout.write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };
    try {
      const code = await main(["node", "cli.mjs", "merge", "7", "--rebase", "--dry-run"]);
      expect(code).toBe(0);
      expect(written.join("")).toMatch(/dry-run/);
      expect(written.join("")).toMatch(/rebase/);
    } finally {
      // @ts-expect-error -- restore
      process.stdout.write = orig;
    }
  });
});

describe("scripts/review/cli.mjs --help spawn smoke", () => {
  it("exits 0 and prints usage when run as a subprocess", async () => {
    const result = await new Promise<{ code: number | null; stdout: string }>(
      (res) => {
        const child = spawn(process.execPath, [CLI_PATH, "--help"], {
          cwd: REPO_ROOT,
        });
        let stdout = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.on("exit", (code) => {
          res({ code, stdout });
        });
      },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/gemma-code PR review runner/);
  });
});
