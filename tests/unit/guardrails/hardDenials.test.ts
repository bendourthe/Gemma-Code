import { describe, it, expect } from "vitest";
import { HARD_DENIALS, BLOCKED_PATTERNS } from "../../../modules/coding/guardrails/policy.js";
import { isBlocked, findBlockedPattern } from "../../../src/tools/commandBlocklist.js";
import { classifyAction, ActionRisk } from "../../../modules/coding/guardrails/ActionClassifier.js";
import {
  confirmationRequiredForPosture,
  SECURITY_POSTURE_IDS,
} from "../../../modules/coding/guardrails/SecurityPosture.js";
import {
  getPermissionTier,
  shouldRequireConfirmation,
} from "../../../modules/coding/guardrails/PermissionTiers.js";
import { PermissionTier } from "../../../modules/coding/guardrails/permissionTierMap.js";
import type { ToolCall } from "../../../src/tools/types.js";

function makeCall(command: string): ToolCall {
  return { tool: "run_terminal", id: "t1", parameters: { command } };
}

const SHAPES: ReadonlyArray<{ id: string; command: string }> = [
  { id: "rm-rf-any", command: "rm -rf ./tmp" },
  { id: "rm-fr-any", command: "rm -fr ./build" },
  { id: "rmdir-s", command: "rmdir /s foo" },
  { id: "git-reset-hard", command: "git reset --hard HEAD~1" },
  { id: "git-push-force-long", command: "git push --force origin main" },
  { id: "git-push-force-short", command: "git push -f origin main" },
  { id: "git-filter-branch", command: "git filter-branch --all" },
  { id: "git-filter-repo", command: "git filter-repo --force" },
  { id: "git-rebase-interactive", command: "git rebase -i HEAD~3" },
  { id: "drop-table", command: "DROP TABLE users" },
  { id: "drop-database", command: "drop database app" },
  { id: "truncate-table", command: "TRUNCATE TABLE sessions" },
  { id: "remove-item-recurse", command: "Remove-Item -Recurse .\\out" },
];

describe("v1.19.1 hard denials", () => {
  it("derives BLOCKED_PATTERNS from HARD_DENIALS without dropping entries", () => {
    expect(BLOCKED_PATTERNS).toEqual(HARD_DENIALS.map((d) => d.pattern));
    expect(HARD_DENIALS.length).toBeGreaterThan(14);
  });

  it.each(SHAPES.map((s) => [s.id, s.command]))(
    "blocks shape %s via isBlocked / ActionClassifier",
    (_id, command) => {
      expect(isBlocked(command)).toBe(true);
      expect(findBlockedPattern(command)).not.toBeNull();
      expect(classifyAction(makeCall(command)).risk).toBe(ActionRisk.BLOCKED);
    },
  );

  it("does not unblock previously blocked catastrophic commands", () => {
    expect(isBlocked("rm -rf /")).toBe(true);
    expect(findBlockedPattern("rm -rf /")).toBe("rm -rf /");
    expect(isBlocked("mkfs.ext4 /dev/sda1")).toBe(true);
  });

  it("does not block read-only git and echo", () => {
    expect(isBlocked("git status")).toBe(false);
    expect(isBlocked("git reset HEAD~1")).toBe(false);
    expect(isBlocked("echo hello")).toBe(false);
  });

  it("survives every posture and a max-permissive override matrix", () => {
    const overrides = { run_terminal: 0 };
    for (const posture of SECURITY_POSTURE_IDS) {
      for (const shape of SHAPES) {
        expect(classifyAction(makeCall(shape.command)).risk).toBe(ActionRisk.BLOCKED);
        const clamped = getPermissionTier("run_terminal", overrides);
        expect(clamped).toBeGreaterThanOrEqual(PermissionTier.CONFIRM);
        expect(shouldRequireConfirmation("run_terminal", overrides, posture)).toBe(true);
        expect(confirmationRequiredForPosture(PermissionTier.DANGEROUS, posture)).toBe(true);
      }
    }
  });
});
