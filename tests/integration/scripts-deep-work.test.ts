/**
 * v0.9.0 Phase 5 sub-task 5.1 -- integration tests for the deep-work CLI.
 *
 * The runner shells out to `gh` and `git` which are stateful, networked, and
 * not safe to exercise inside `npm test` (the agent is not authorized to
 * push, and `gh` requires an authenticated user). Instead this suite covers:
 *
 *  - The pure helpers exported by `shared.mjs` (slug + branch + path
 *    derivation, the porcelain parser, the prompt assembler).
 *  - The dispatcher (`cli.mjs main`) help / unknown command paths.
 *  - The `pick.mjs formatIssueMenu` renderer against synthetic data.
 *  - The `status.mjs formatWorktreeTable` renderer against synthetic rows.
 *
 * A separate manual smoke (Phase 5.5) exercises the real `start` -> `status`
 * -> `cleanup` lifecycle on a throwaway issue.
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import * as path from "node:path";

import {
  slugify,
  deriveBranchName,
  deriveWorktreePath,
  parseWorktreeListPorcelain,
  buildDeepWorkPrompt,
  parseFlagArgs,
} from "../../scripts/deep-work/shared.mjs";
import { formatIssueMenu } from "../../scripts/deep-work/pick.mjs";
import { formatWorktreeTable } from "../../scripts/deep-work/status.mjs";
import { main } from "../../scripts/deep-work/cli.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(REPO_ROOT, "scripts", "deep-work", "cli.mjs");

describe("shared helpers", () => {
  it("slugify caps to 40 chars and trims trailing dashes", () => {
    const long = "A".repeat(60) + " name";
    const out = slugify(long);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("-")).toBe(false);
  });

  it("slugify falls back to `issue` on empty input", () => {
    expect(slugify("")).toBe("issue");
    expect(slugify(null)).toBe("issue");
    expect(slugify("!@#$%")).toBe("issue");
  });

  it("deriveBranchName follows feat/issue-<n>-<slug>", () => {
    expect(deriveBranchName(42, "Add cool feature")).toBe(
      "feat/issue-42-add-cool-feature",
    );
  });

  it("deriveWorktreePath follows worktrees/issue-<n>-<slug>", () => {
    expect(deriveWorktreePath(7, "Wire scheduler")).toBe(
      "worktrees/issue-7-wire-scheduler",
    );
  });
});

describe("parseFlagArgs", () => {
  it("captures positional + --force + --yes + --agent", () => {
    const out = parseFlagArgs(["42", "--force", "--yes", "--agent", "claude"]);
    expect(out.positional).toEqual(["42"]);
    expect(out.force).toBe(true);
    expect(out.yes).toBe(true);
    expect(out.agent).toBe("claude");
  });

  it("recognizes --first and --agent=<name>", () => {
    const out = parseFlagArgs(["--first", "--agent=codex"]);
    expect(out.first).toBe(true);
    expect(out.agent).toBe("codex");
  });
});

describe("parseWorktreeListPorcelain", () => {
  it("parses the primary checkout + a feature worktree", () => {
    const stdout = [
      "worktree /repo",
      "HEAD 0123456789abcdef0123456789abcdef01234567",
      "branch refs/heads/main",
      "",
      "worktree /repo/worktrees/issue-42-cool-feature",
      "HEAD fedcba9876543210fedcba9876543210fedcba98",
      "branch refs/heads/feat/issue-42-cool-feature",
    ].join("\n");
    const rows = parseWorktreeListPorcelain(stdout);
    expect(rows).toHaveLength(2);
    expect(rows[0].path).toBe("/repo");
    expect(rows[0].branch).toBe("refs/heads/main");
    expect(rows[1].branch).toBe("refs/heads/feat/issue-42-cool-feature");
  });

  it("flags detached / bare records", () => {
    const stdout = [
      "worktree /repo",
      "HEAD 0123456789abcdef0123456789abcdef01234567",
      "detached",
      "",
      "worktree /tmp/bare",
      "bare",
    ].join("\n");
    const rows = parseWorktreeListPorcelain(stdout);
    expect(rows[0].detached).toBe(true);
    expect(rows[1].bare).toBe(true);
  });

  it("returns [] on empty input", () => {
    expect(parseWorktreeListPorcelain("")).toEqual([]);
  });
});

describe("buildDeepWorkPrompt", () => {
  const baseIssue = {
    number: 42,
    title: "Wire reflect worker into scheduler",
    body: "We need to wire ReflectJob.",
    url: "https://github.com/bendourthe/Gemma-Code/issues/42",
    labels: [{ name: "phase-6" }, { name: "memory" }],
    state: "OPEN",
  };

  it("includes the worktree path, branch, title, body, labels", () => {
    const prompt = buildDeepWorkPrompt({
      issue: baseIssue,
      worktreePath: "worktrees/issue-42-wire-reflect-worker-into-schedu",
      branchName: "feat/issue-42-wire-reflect-worker-into-schedu",
    });
    expect(prompt).toContain("#42");
    expect(prompt).toContain("Wire reflect worker into scheduler");
    expect(prompt).toContain("worktrees/issue-42-");
    expect(prompt).toContain("feat/issue-42-");
    expect(prompt).toMatch(/Labels:\s+phase-6, memory/);
    expect(prompt).toContain("Strict TypeScript");
    expect(prompt).toContain("Zod");
  });

  it("handles missing body / url gracefully", () => {
    const prompt = buildDeepWorkPrompt({
      issue: { number: 9, title: "tiny", body: null, url: null, labels: null },
      worktreePath: "worktrees/issue-9-tiny",
      branchName: "feat/issue-9-tiny",
    });
    expect(prompt).toContain("#9");
    expect(prompt).toContain("(empty)");
    expect(prompt).toContain("(unknown)");
  });
});

describe("formatIssueMenu", () => {
  it("renders an empty-state message when no issues are open", () => {
    expect(formatIssueMenu([])).toMatch(/no open issues/);
  });

  it("renders a numbered menu with labels and a hint", () => {
    const issues = [
      { number: 7, title: "Wire reflect worker", labels: [{ name: "phase-6" }, "memory"] },
      { number: 12, title: "Trim oversized SKILL.md", labels: [] },
    ];
    const out = formatIssueMenu(issues);
    expect(out).toMatch(/#7/);
    expect(out).toMatch(/#12/);
    expect(out).toMatch(/labels: phase-6, memory/);
    expect(out).toMatch(/npm run deep-work start/);
    expect(out).toMatch(/--first/);
  });
});

describe("formatWorktreeTable", () => {
  it("renders an empty-state message when no worktrees", () => {
    expect(formatWorktreeTable([])).toMatch(/no worktrees/);
  });

  it("renders the primary + feature rows with short head sha", () => {
    const rows = [
      {
        path: "/repo",
        branch: "refs/heads/main",
        head: "0123456789abcdef",
        dirty: false,
      },
      {
        path: "/repo/worktrees/issue-42",
        branch: "refs/heads/feat/issue-42-foo",
        head: "fedcba9876543210",
        dirty: true,
      },
    ];
    const out = formatWorktreeTable(rows);
    expect(out).toMatch(/path/);
    expect(out).toMatch(/branch/);
    expect(out).toMatch(/head/);
    expect(out).toMatch(/dirty/);
    expect(out).toMatch(/main/);
    expect(out).toMatch(/feat\/issue-42-foo/);
    expect(out).toMatch(/0123456/);
    expect(out).toMatch(/fedcba9/);
    expect(out).toMatch(/yes/);
  });
});

describe("cli main", () => {
  it("prints usage on --help and exits 0", async () => {
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
      expect(written.join("")).toMatch(/gemma-code deep-work runner/);
    } finally {
      // @ts-expect-error -- restore
      process.stdout.write = orig;
    }
  });

  it("prints usage and exits 0 when no args are passed", async () => {
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-expect-error -- monkey-patch
    process.stdout.write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };
    try {
      const code = await main(["node", "cli.mjs"]);
      expect(code).toBe(0);
      expect(written.join("")).toMatch(/deep-work/);
    } finally {
      // @ts-expect-error -- restore
      process.stdout.write = orig;
    }
  });

  it("rejects an unknown command with exit 2", async () => {
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
      const code = await main(["node", "cli.mjs", "nonsense"]);
      expect(code).toBe(2);
      expect(errs.join("")).toMatch(/unknown command/);
    } finally {
      // @ts-expect-error -- restore
      process.stderr.write = origErr;
      // @ts-expect-error -- restore
      process.stdout.write = origOut;
    }
  });
});

describe("scripts/deep-work/cli.mjs --help spawn smoke", () => {
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
    expect(result.stdout).toMatch(/gemma-code deep-work runner/);
  });
});
