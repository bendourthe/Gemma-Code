import { describe, expect, it } from "vitest";

import { classifyAction, ActionRisk } from "../../../modules/coding/guardrails/ActionClassifier.js";
import type { ToolCall } from "../../../src/tools/types.js";

function makeCall(command: string): ToolCall {
  return { tool: "run_terminal", id: "c1", parameters: { command } };
}

describe("ActionClassifier sandbox boost", () => {
  it("does not raise confirmation when execSandbox is off", () => {
    const c = classifyAction(makeCall("echo hello"), { execSandboxEnabled: false });
    expect(c.enhancedConfirmation).toBe(false);
    expect(c.risk).toBe(ActionRisk.REVERSIBLE);
  });

  it("raises enhanced confirmation when sandbox is on but not confined", () => {
    const c = classifyAction(makeCall("echo hello"), { execSandboxEnabled: true });
    if (c.reason.includes("confined (") && !c.reason.includes("partial")) {
      expect(c.enhancedConfirmation).toBe(false);
    } else {
      expect(c.enhancedConfirmation).toBe(true);
      expect(c.reason).toMatch(/unconfined|partial/);
    }
  });

  it("does not boost a blocked command", () => {
    const c = classifyAction(makeCall("rm -rf /"), { execSandboxEnabled: true });
    expect(c.risk).toBe(ActionRisk.BLOCKED);
    expect(c.enhancedConfirmation).toBe(false);
  });
});
