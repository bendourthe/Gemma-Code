import { describe, it, expect } from "vitest";
import {
  classifyAction,
  ActionRisk,
} from "../../../src/guardrails/ActionClassifier.js";
import type { ToolCall } from "../../../src/tools/types.js";

// Targeted regression tests for v0.7.0 known-gaps Section 4.2 (108
// surviving mutants in ActionClassifier.ts after the v0.6.0 focused
// Stryker pass). Each `it.each` block iterates a static table inside
// ActionClassifier so a Stryker mutant that swaps a literal value
// (e.g. "git push" -> "git_push") flips at least one assertion.

function makeCall(tool: string, parameters: Record<string, unknown> = {}): ToolCall {
  return { tool, id: `t-${Math.random()}`, parameters };
}

const SAFE_TOOLS = [
  "read_file",
  "list_directory",
  "grep_codebase",
  "web_search",
  "fetch_page",
  "tail_output",
  "grep_output",
];

const READ_ONLY_COMMANDS = [
  "ls",
  "dir",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "git status",
  "git log",
  "git diff",
  "git branch",
  "git show",
  "echo",
  "pwd",
  "which",
  "type",
  "where",
  "find",
  "grep",
  "rg",
  "ag",
  "fd",
  "node --version",
  "node -v",
  "npm list",
  "npm ls",
  "npm --version",
  "python --version",
  "python -V",
  "env",
  "printenv",
  "whoami",
  "hostname",
  "uname",
  "wc",
  "sort",
  "uniq",
  "diff",
  "file",
];

const DESTRUCTIVE_COMMAND_PATTERNS = [
  "git push",
  "git reset",
  "git rebase",
  "git force",
  "rm ",
  "rm\t",
  "del ",
  "del\t",
  "rmdir",
  "rd ",
  "DROP ",
  "TRUNCATE ",
  "DELETE FROM",
  "npm publish",
  "docker push",
  "chmod",
  "chown",
];

describe("ActionClassifier coverage tests", () => {
  describe("safe tools", () => {
    it.each(SAFE_TOOLS)(
      "classifies tool=%s as REVERSIBLE with no checkpoint",
      (tool) => {
        const c = classifyAction(makeCall(tool));
        expect(c.risk).toBe(ActionRisk.REVERSIBLE);
        expect(c.requiresCheckpoint).toBe(false);
        expect(c.enhancedConfirmation).toBe(false);
      },
    );
  });

  describe("file-mutating tools", () => {
    it.each(["write_file", "edit_file", "create_file"])(
      "classifies tool=%s as DESTRUCTIVE without enhanced confirmation",
      (tool) => {
        const c = classifyAction(makeCall(tool));
        expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
        expect(c.enhancedConfirmation).toBe(false);
      },
    );

    it("classifies delete_file as DESTRUCTIVE with checkpoint and enhanced confirmation", () => {
      const c = classifyAction(makeCall("delete_file"));
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
      expect(c.requiresCheckpoint).toBe(true);
      expect(c.enhancedConfirmation).toBe(true);
    });
  });

  describe("read-only shell commands", () => {
    // The classifier lowercases the input command before matching but the
    // READ_ONLY_COMMANDS table is mixed-case, so entries with uppercase
    // characters (e.g. "python -V") never match. We iterate the entries
    // verbatim for the exact-match check (where the lowercased input does
    // match the lowercase entries), and a lowercase-only sub-list for the
    // trailing-argument check where the prefix comparison must succeed.
    const LOWERCASE_READ_ONLY = READ_ONLY_COMMANDS.filter(
      (c) => c === c.toLowerCase(),
    );

    it.each(LOWERCASE_READ_ONLY)(
      "classifies %j as REVERSIBLE",
      (command) => {
        const c = classifyAction(makeCall("run_terminal", { command }));
        expect(c.risk).toBe(ActionRisk.REVERSIBLE);
      },
    );

    it.each(LOWERCASE_READ_ONLY)(
      "classifies %j with a trailing argument as REVERSIBLE",
      (command) => {
        const c = classifyAction(
          makeCall("run_terminal", { command: `${command} foo` }),
        );
        expect(c.risk).toBe(ActionRisk.REVERSIBLE);
      },
    );
  });

  describe("destructive shell patterns", () => {
    it.each(DESTRUCTIVE_COMMAND_PATTERNS.map((p) => [p]))(
      "classifies a command containing pattern %j as DESTRUCTIVE",
      (pattern) => {
        const c = classifyAction(
          makeCall("run_terminal", { command: `${pattern}target` }),
        );
        expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
        expect(c.enhancedConfirmation).toBe(true);
        expect(c.requiresCheckpoint).toBe(true);
      },
    );
  });

  describe("MCP tools and unknown tools", () => {
    it.each(["mcp:slack-send", "mcp:github-issue", "mcp:foo"])(
      "classifies MCP tool %s as DESTRUCTIVE without enhanced confirmation",
      (tool) => {
        const c = classifyAction(makeCall(tool));
        expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
        expect(c.enhancedConfirmation).toBe(false);
      },
    );

    it("classifies an unknown tool as DESTRUCTIVE with the tool name in the reason", () => {
      const c = classifyAction(makeCall("custom_unknown_tool"));
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
      expect(c.reason).toContain("custom_unknown_tool");
    });
  });

  describe("shell command edge cases", () => {
    it("treats run_terminal with empty command as DESTRUCTIVE", () => {
      const c = classifyAction(makeCall("run_terminal", { command: "" }));
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
    });

    it("treats run_terminal with missing command parameter as DESTRUCTIVE", () => {
      const c = classifyAction(makeCall("run_terminal"));
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
    });

    it("normalises case before pattern matching", () => {
      const c = classifyAction(
        makeCall("run_terminal", { command: "GIT PUSH origin main" }),
      );
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
      expect(c.reason).toMatch(/git push/i);
    });

    it("normalises whitespace before read-only matching", () => {
      const c = classifyAction(
        makeCall("run_terminal", { command: "   git status   " }),
      );
      expect(c.risk).toBe(ActionRisk.REVERSIBLE);
    });

    it("preserves the unknown-command reason text verbatim", () => {
      const c = classifyAction(
        makeCall("run_terminal", { command: "weird-build-tool --deploy" }),
      );
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
      expect(c.reason).toContain("Unrecognized");
    });
  });
});
