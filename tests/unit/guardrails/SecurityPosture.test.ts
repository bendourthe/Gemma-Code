import { describe, it, expect } from "vitest";
import { PermissionTier } from "../../../modules/coding/guardrails/permissionTierMap.js";
import {
  confirmationRequiredForPosture,
  composePassStateGating,
  composeVerificationEnabled,
  mustScreenOrigin,
  parseSecurityPosture,
  SECURITY_POSTURE_IDS,
  SECURITY_POSTURE_POLICIES,
} from "../../../modules/coding/guardrails/SecurityPosture.js";
import { shouldRequireConfirmation } from "../../../modules/coding/guardrails/PermissionTiers.js";
import { HARD_DENIALS } from "../../../modules/coding/guardrails/policy.js";
import { classifyAction, ActionRisk } from "../../../modules/coding/guardrails/ActionClassifier.js";
import type { ToolCall } from "../../../src/tools/types.js";

describe("SecurityPosture", () => {
  it("parses known ids and defaults unknown to standard", () => {
    expect(parseSecurityPosture("strict")).toBe("strict");
    expect(parseSecurityPosture("unattended")).toBe("unattended");
    expect(parseSecurityPosture("nope")).toBe("standard");
  });

  it("never drops DANGEROUS below the floor in any posture", () => {
    for (const id of SECURITY_POSTURE_IDS) {
      expect(confirmationRequiredForPosture(PermissionTier.DANGEROUS, id)).toBe(true);
      expect(shouldRequireConfirmation("run_terminal", { run_terminal: 0 }, id)).toBe(true);
    }
  });

  it("Unattended skips CONFIRM but not DANGEROUS", () => {
    expect(confirmationRequiredForPosture(PermissionTier.CONFIRM, "unattended")).toBe(false);
    expect(shouldRequireConfirmation("write_file", undefined, "unattended")).toBe(false);
    expect(shouldRequireConfirmation("run_terminal", undefined, "unattended")).toBe(true);
  });

  it("Strict and Standard still confirm CONFIRM-tier tools", () => {
    expect(shouldRequireConfirmation("write_file", undefined, "strict")).toBe(true);
    expect(shouldRequireConfirmation("write_file", undefined, "standard")).toBe(true);
  });

  it("AUTO_APPROVE never prompts in any posture", () => {
    for (const id of SECURITY_POSTURE_IDS) {
      expect(confirmationRequiredForPosture(PermissionTier.AUTO_APPROVE, id)).toBe(false);
      expect(shouldRequireConfirmation("read_file", undefined, id)).toBe(false);
      expect(shouldRequireConfirmation("hash_file", undefined, id)).toBe(false);
    }
  });

  it("web / mcp / browser origins are always screened", () => {
    for (const id of SECURITY_POSTURE_IDS) {
      expect(mustScreenOrigin("web_fetch", id)).toBe(true);
      expect(mustScreenOrigin("mcp_tool", id)).toBe(true);
      expect(mustScreenOrigin("browser_snapshot", id)).toBe(true);
      expect(mustScreenOrigin("stt_transcript", id)).toBe(true);
    }
    expect(mustScreenOrigin("terminal", "standard")).toBe(false);
    expect(mustScreenOrigin("terminal", "strict")).toBe(true);
  });

  it("hard denials stay BLOCKED under every posture", () => {
    const cmd = HARD_DENIALS.find((d) => d.id === "git-reset-hard")!.pattern + " HEAD";
    for (const _id of SECURITY_POSTURE_IDS) {
      const result = classifyAction({
        tool: "run_terminal",
        id: "t",
        parameters: { command: cmd },
      } as ToolCall);
      expect(result.risk).toBe(ActionRisk.BLOCKED);
    }
  });

  it("Strict forces verification and pass-state on", () => {
    expect(composePassStateGating("strict", false)).toBe(true);
    expect(composeVerificationEnabled("strict", false)).toBe(true);
    expect(composePassStateGating("unattended", false)).toBe(false);
  });

  it("documents each posture in plain language", () => {
    for (const id of SECURITY_POSTURE_IDS) {
      expect(SECURITY_POSTURE_POLICIES[id].summary.length).toBeGreaterThan(40);
      expect(SECURITY_POSTURE_POLICIES[id].summary.toLowerCase()).toContain("hard-denied");
    }
    expect(SECURITY_POSTURE_POLICIES.unattended.summary.toLowerCase()).toContain("not a no-floor");
  });
});
