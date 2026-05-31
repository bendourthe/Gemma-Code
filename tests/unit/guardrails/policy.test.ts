import { describe, it, expect } from "vitest";
import { BLOCKED_PATTERNS } from "../../../modules/coding/guardrails/policy.js";
import { classifyAction, ActionRisk } from "../../../modules/coding/guardrails/ActionClassifier.js";
import type { ToolCall } from "../../../src/tools/types.js";

function makeCall(tool: string, parameters: Record<string, unknown>): ToolCall {
  return { tool, id: `t-${Math.random()}`, parameters };
}

describe("guardrails/policy BLOCKED_PATTERNS", () => {
  // The block list itself is a static lookup table; if any entry rotates
  // values silently the only behavioural witness is the ActionClassifier
  // returning BLOCKED for the literal pattern. v0.7.0 known-gaps Section
  // 4.1: this regression test pins the contract by exercising every
  // pattern through the public API so a Stryker mutant that changes a
  // table entry surfaces as a failing test.

  it("exposes a non-empty list of blocked patterns", () => {
    expect(BLOCKED_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of BLOCKED_PATTERNS) {
      expect(pattern).toBeTypeOf("string");
      expect(pattern.length).toBeGreaterThan(0);
    }
  });

  it.each(BLOCKED_PATTERNS.map((p) => [p]))(
    "classifies %j as BLOCKED via the ActionClassifier",
    (pattern) => {
      const result = classifyAction(makeCall("run_terminal", { command: pattern }));
      expect(result.risk).toBe(ActionRisk.BLOCKED);
    },
  );

  it("treats every blocked pattern with case-insensitive surrounding whitespace", () => {
    for (const pattern of BLOCKED_PATTERNS) {
      const wrapped = `   ${pattern.toUpperCase()}   `;
      const result = classifyAction(makeCall("run_terminal", { command: wrapped }));
      expect(result.risk).toBe(ActionRisk.BLOCKED);
    }
  });

  it("does not block obviously-safe read-only commands", () => {
    for (const safe of ["git status", "ls -la", "echo hi", "cat README.md"]) {
      const result = classifyAction(makeCall("run_terminal", { command: safe }));
      expect(result.risk).not.toBe(ActionRisk.BLOCKED);
    }
  });

  it("blocks command lines that embed a blocked pattern as a substring", () => {
    // A wrapper script invoking `rm -rf /` mid-command must still be
    // caught -- the classifier matches at substring level. This pins the
    // current behaviour against silent mutation.
    const result = classifyAction(
      makeCall("run_terminal", { command: "bash -c 'rm -rf /'" }),
    );
    expect(result.risk).toBe(ActionRisk.BLOCKED);
  });
});
