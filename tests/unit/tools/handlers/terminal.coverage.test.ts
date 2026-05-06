import { describe, it, expect } from "vitest";
import {
  ALLOWED_COMMANDS,
  isAllowlisted,
  isBlocked,
  findBlockedPattern,
  BLOCKED_PATTERNS,
} from "../../../../src/tools/handlers/terminal.js";

// Targeted regression tests for v0.7.0 known-gaps Section 4.3 (128
// surviving mutants in terminal.ts after the v0.6.0 focused Stryker
// pass). The tests pin the allowlist verdict surface, the
// segment-aware denylist check, and the chained-segment splitter so
// mutants that swap a literal value or short-circuit a check surface
// as failures.

const ALLOWED_COMMAND_NAMES = Object.keys(ALLOWED_COMMANDS);

describe("terminal.isAllowlisted -- per-command coverage", () => {
  it.each(ALLOWED_COMMAND_NAMES)(
    "treats %s as allowlisted on its own",
    (cmd) => {
      expect(isAllowlisted(cmd)).toBe(true);
    },
  );

  it.each(ALLOWED_COMMAND_NAMES)(
    "treats %s with arguments as allowlisted",
    (cmd) => {
      expect(isAllowlisted(`${cmd} --help`)).toBe(true);
    },
  );

  it("rejects an unknown leading command", () => {
    expect(isAllowlisted("doom-emacs --batch")).toBe(false);
  });

  it("rejects a chained command where any segment is unknown", () => {
    expect(isAllowlisted("git status && doom-emacs --batch")).toBe(false);
    expect(isAllowlisted("doom-emacs --batch && git status")).toBe(false);
  });

  it("accepts a chained command where every segment is allowlisted", () => {
    expect(isAllowlisted("git status && npm install")).toBe(true);
    expect(isAllowlisted("ls; cat README.md")).toBe(true);
    expect(isAllowlisted("echo a || echo b")).toBe(true);
    expect(isAllowlisted("ls | cat")).toBe(true);
  });

  it("rejects an empty input string", () => {
    expect(isAllowlisted("")).toBe(false);
    expect(isAllowlisted("   ")).toBe(false);
  });

  it("rejects whitespace-only segments produced by chaining", () => {
    expect(isAllowlisted(";;;")).toBe(false);
    expect(isAllowlisted("&&")).toBe(false);
  });
});

describe("terminal.isBlocked -- segment-aware denylist", () => {
  it.each(BLOCKED_PATTERNS.map((p) => [p]))(
    "rejects a command whose body contains the blocked pattern %j",
    (pattern) => {
      expect(isBlocked(pattern)).toBe(true);
      expect(isBlocked(`bash -c '${pattern}'`)).toBe(true);
    },
  );

  it("rejects a chained command where ANY segment matches a blocked pattern", () => {
    expect(isBlocked("git status && rm -rf /")).toBe(true);
    expect(isBlocked("rm -rf / && echo done")).toBe(true);
    expect(isBlocked("ls; format c:")).toBe(true);
  });

  it("does not reject a safe command lacking any blocked pattern", () => {
    expect(isBlocked("git status")).toBe(false);
    expect(isBlocked("npm install")).toBe(false);
    expect(isBlocked("rm temp.txt")).toBe(false);
  });

  it("normalises repeated whitespace before comparing against patterns", () => {
    expect(isBlocked("rm     -rf    /")).toBe(true);
    expect(isBlocked("rm\t-rf\t/")).toBe(true);
  });

  it("returns the first blocked pattern via findBlockedPattern", () => {
    expect(findBlockedPattern("git status")).toBeNull();
    expect(findBlockedPattern("rm -rf /")).toBe("rm -rf /");
    // chained: the first segment whose pattern matches wins, not a later one.
    const result = findBlockedPattern("git status; rm -rf /");
    expect(result).toBe("rm -rf /");
  });
});

describe("terminal.shellSegments invariants (observed via isAllowlisted/isBlocked)", () => {
  // The internal shellSegments helper is exercised through the public
  // exports. These tests assert the observable separator semantics so a
  // mutant that drops one of `;`, `&&`, `||`, `|`, or `\n` is detected.

  it("recognises ';' as a chain separator", () => {
    expect(isAllowlisted("git status; npm test")).toBe(true);
  });

  it("recognises '&&' as a chain separator", () => {
    expect(isAllowlisted("git status && npm test")).toBe(true);
  });

  it("recognises '||' as a chain separator", () => {
    expect(isAllowlisted("git status || npm test")).toBe(true);
  });

  it("recognises '|' as a chain separator", () => {
    expect(isAllowlisted("git log | cat")).toBe(true);
  });

  it("recognises a newline as a chain separator", () => {
    expect(isAllowlisted("git status\nnpm test")).toBe(true);
  });
});
