import { describe, it, expect } from "vitest";
import {
  parsePermissionsDeny,
  evaluateDeny,
} from "../../../../core/storage/PermissionsDeny.js";

describe("parsePermissionsDeny", () => {
  it("returns empty rules for null / empty input", () => {
    expect(parsePermissionsDeny(null).rules).toEqual([]);
    expect(parsePermissionsDeny("").rules).toEqual([]);
  });

  it("parses tool: pattern lines", () => {
    const parsed = parsePermissionsDeny(`
      # destructive bash
      run_terminal: rm -rf *
      run_terminal: git push *
      # path-shaped writes
      write_file: docs/archive/**
    `);
    expect(parsed.rules).toHaveLength(3);
    expect(parsed.rules[0]).toMatchObject({
      toolName: "run_terminal",
      pattern: "rm -rf *",
    });
    expect(parsed.rules[2]).toMatchObject({
      toolName: "write_file",
      pattern: "docs/archive/**",
    });
  });

  it("skips comments + blank lines + malformed lines", () => {
    const parsed = parsePermissionsDeny(`
      # comment
      run_terminal: rm -rf *

      bad-line-without-colon

      : missing-tool
      missing-pattern:
    `);
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0]?.toolName).toBe("run_terminal");
  });
});

describe("evaluateDeny", () => {
  it("denies a run_terminal call matching a pattern", () => {
    const list = parsePermissionsDeny("run_terminal: rm -rf *");
    const v = evaluateDeny("run_terminal", "rm -rf node_modules", list);
    expect(v.denied).toBe(true);
    expect(v.rule?.pattern).toBe("rm -rf *");
  });

  it("does not deny a non-matching tool name", () => {
    const list = parsePermissionsDeny("run_terminal: rm -rf *");
    expect(evaluateDeny("read_file", "rm -rf node_modules", list).denied).toBe(false);
  });

  it("does not deny a non-matching argument", () => {
    const list = parsePermissionsDeny("run_terminal: rm -rf *");
    expect(evaluateDeny("run_terminal", "ls -la", list).denied).toBe(false);
  });

  it("supports a wildcard tool name (*: pattern)", () => {
    const list = parsePermissionsDeny("*: dangerous-tool");
    expect(evaluateDeny("write_file", "dangerous-tool", list).denied).toBe(true);
    expect(evaluateDeny("anything_else", "dangerous-tool", list).denied).toBe(true);
  });

  it("matches path-shaped patterns segment-aware (** spans /)", () => {
    const list = parsePermissionsDeny("write_file: docs/archive/**");
    expect(evaluateDeny("write_file", "docs/archive/old.md", list).denied).toBe(true);
    expect(evaluateDeny("write_file", "docs/archive/sub/x.md", list).denied).toBe(true);
    expect(evaluateDeny("write_file", "docs/active/x.md", list).denied).toBe(false);
  });

  it("matches command-shaped patterns greedy (* spans whitespace)", () => {
    const list = parsePermissionsDeny("run_terminal: git push *");
    expect(evaluateDeny("run_terminal", "git push origin main --force", list).denied).toBe(true);
    expect(evaluateDeny("run_terminal", "git status", list).denied).toBe(false);
  });

  it("returns the first matching rule (line-order)", () => {
    const list = parsePermissionsDeny(`
      run_terminal: rm -rf *
      run_terminal: rm *
    `);
    const v = evaluateDeny("run_terminal", "rm -rf node_modules", list);
    expect(v.denied).toBe(true);
    expect(v.rule?.line).toBe(2);
  });
});
