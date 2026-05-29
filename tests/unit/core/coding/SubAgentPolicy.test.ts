import { describe, it, expect } from "vitest";
import {
  evaluateExploreToolCall,
  lintExploreSpecialist,
  tokenizeCommandLine,
  EXPLORE_READONLY_TOOLS,
  EXPLORE_READONLY_BASH_COMMANDS,
  EXPLORE_READONLY_GIT_SUBCOMMANDS,
} from "../../../../core/coding/SubAgentPolicy.js";

describe("SubAgentPolicy.evaluateExploreToolCall", () => {
  it("allows any tool call when intent is not 'explore'", () => {
    const decision = evaluateExploreToolCall({
      intent: "implement",
      toolName: "write_file",
    });
    expect(decision.allow).toBe(true);
  });

  it("allows a read tool under explore intent", () => {
    const decision = evaluateExploreToolCall({
      intent: "explore",
      toolName: "read_file",
    });
    expect(decision.allow).toBe(true);
  });

  it("rejects a write tool under explore intent", () => {
    const decision = evaluateExploreToolCall({
      intent: "explore",
      toolName: "write_file",
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("tool-not-in-allowlist");
    expect(decision.message).toMatch(/may not call 'write_file'/);
  });

  it("allows every codegraph_* tool under explore intent", () => {
    const codegraphTools = EXPLORE_READONLY_TOOLS.filter((t) =>
      t.startsWith("codegraph_"),
    );
    expect(codegraphTools.length).toBeGreaterThanOrEqual(8);
    for (const tool of codegraphTools) {
      const decision = evaluateExploreToolCall({ intent: "explore", toolName: tool });
      expect(decision.allow).toBe(true);
    }
  });

  it("rejects run_terminal with empty command", () => {
    const decision = evaluateExploreToolCall({
      intent: "explore",
      toolName: "run_terminal",
      command: "",
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("no-command");
  });

  it("allows run_terminal with a read-only bash command", () => {
    const decision = evaluateExploreToolCall({
      intent: "explore",
      toolName: "run_terminal",
      command: "ls -la src/",
    });
    expect(decision.allow).toBe(true);
  });

  it("rejects run_terminal with a non-allowed bash command", () => {
    const decision = evaluateExploreToolCall({
      intent: "explore",
      toolName: "run_terminal",
      command: "rm -rf node_modules",
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("bash-command-not-allowed");
    expect(decision.message).toMatch(/may not run 'rm'/);
  });

  it("allows 'git status' but rejects 'git push'", () => {
    const ok = evaluateExploreToolCall({
      intent: "explore",
      toolName: "run_terminal",
      command: "git status -s",
    });
    expect(ok.allow).toBe(true);

    const bad = evaluateExploreToolCall({
      intent: "explore",
      toolName: "run_terminal",
      command: "git push origin main",
    });
    expect(bad.allow).toBe(false);
    expect(bad.reason).toBe("git-subcommand-not-allowed");
  });

  it("respects an extraReadOnlyBashCommands override", () => {
    const decision = evaluateExploreToolCall({
      intent: "explore",
      toolName: "run_terminal",
      command: "node --version",
      extraReadOnlyBashCommands: ["node", "ls"],
    });
    expect(decision.allow).toBe(true);
  });

  it("ignores pipes / redirects when parsing the head command", () => {
    const decision = evaluateExploreToolCall({
      intent: "explore",
      toolName: "run_terminal",
      command: "grep -r foo src/ | head -20",
    });
    expect(decision.allow).toBe(true);
  });

  it("rejects an attempt to bypass via pipe-prefix", () => {
    const decision = evaluateExploreToolCall({
      intent: "explore",
      toolName: "run_terminal",
      command: "rm -rf / | grep -v x",
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("bash-command-not-allowed");
  });

  it("rejects an empty command after a leading pipe operator", () => {
    const decision = evaluateExploreToolCall({
      intent: "explore",
      toolName: "run_terminal",
      command: "| grep foo",
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("no-command");
  });
});

describe("SubAgentPolicy.lintExploreSpecialist", () => {
  it("returns no findings for non-explore intents", () => {
    const findings = lintExploreSpecialist({
      intent: "implement",
      toolScope: ["write_file", "edit_file"],
    });
    expect(findings).toEqual([]);
  });

  it("flags an explore specialist that lists a write tool", () => {
    const findings = lintExploreSpecialist({
      intent: "explore",
      toolScope: ["read_file", "write_file"],
      sourcePath: ".claude/agents/bad-explorer.md",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/bad-explorer\.md/);
    expect(findings[0]).toMatch(/write_file/);
  });

  it("emits a confirmation warning when explore + run_terminal coexist", () => {
    const findings = lintExploreSpecialist({
      intent: "explore",
      toolScope: ["read_file", "run_terminal"],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/run_terminal/);
    expect(findings[0]).toMatch(/EXPLORE_READONLY_BASH_COMMANDS/);
  });

  it("returns multiple findings when several write tools coexist", () => {
    const findings = lintExploreSpecialist({
      intent: "explore",
      toolScope: ["read_file", "write_file", "edit_file", "delete_file"],
    });
    expect(findings).toHaveLength(3);
  });
});

describe("SubAgentPolicy.tokenizeCommandLine", () => {
  it("tokenizes a simple command", () => {
    expect(tokenizeCommandLine("git status -s")).toEqual(["git", "status", "-s"]);
  });

  it("handles single + double quoted segments", () => {
    expect(
      tokenizeCommandLine(`grep -r "two words" 'src/foo bar/baz'`),
    ).toEqual(["grep", "-r", "two words", "src/foo bar/baz"]);
  });

  it("stops at the first pipe / redirect / semicolon", () => {
    expect(tokenizeCommandLine("ls -la | head")).toEqual(["ls", "-la"]);
    expect(tokenizeCommandLine("cat foo > bar")).toEqual(["cat", "foo"]);
    expect(tokenizeCommandLine("echo done; rm foo")).toEqual(["echo", "done"]);
  });

  it("respects backslash-escaped characters outside single quotes", () => {
    expect(tokenizeCommandLine("ls foo\\ bar")).toEqual(["ls", "foo bar"]);
  });
});

describe("SubAgentPolicy constants", () => {
  it("never includes a write tool in the explore allowlist", () => {
    for (const tool of EXPLORE_READONLY_TOOLS) {
      expect(tool).not.toMatch(/write|edit|delete|create_file|modify/i);
    }
  });

  it("includes the eight codegraph tools (Phase 3 surface)", () => {
    const codegraphTools = EXPLORE_READONLY_TOOLS.filter((t) => t.startsWith("codegraph_"));
    expect(codegraphTools.length).toBeGreaterThanOrEqual(8);
  });

  it("includes 'git' in the bash command allowlist and 'status' in the git subcommand allowlist", () => {
    expect(EXPLORE_READONLY_BASH_COMMANDS).toContain("git");
    expect(EXPLORE_READONLY_GIT_SUBCOMMANDS).toContain("status");
    expect(EXPLORE_READONLY_GIT_SUBCOMMANDS).not.toContain("push");
  });
});
