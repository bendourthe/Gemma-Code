import { describe, expect, it } from "vitest";

import { replayAsk } from "../../../modules/coding/autonomy/replayAsk.js";
import type { ParkedAsk } from "../../../modules/coding/autonomy/types.js";
import { ActionRisk } from "../../../modules/coding/guardrails/ActionClassifier.js";
import { PermissionTier } from "../../../modules/coding/runtime/headlessGuards.js";

function parkedWrite(overrides: Partial<ParkedAsk> = {}): ParkedAsk {
  return {
    id: "ask-1",
    state: "pending",
    runMode: "headless",
    createdAt: 1,
    expiresAt: 10_000,
    toolName: "write_file",
    summary: "Run write_file?",
    detail: "",
    args: { path: "a.ts", content: "x" },
    risk: ActionRisk.DESTRUCTIVE,
    classificationReason: "writes a file",
    parkedTier: PermissionTier.CONFIRM,
    runId: "run-1",
    ...overrides,
  };
}

describe("replayAsk", () => {
  it("re-enters the gate and floor-clamps an AUTO_APPROVE override on a CONFIRM tool", () => {
    const result = replayAsk(parkedWrite(), {
      permissionOverrides: { write_file: PermissionTier.AUTO_APPROVE },
    });
    expect(result.allowed).toBe(true);
    expect(result.currentTier).toBe(PermissionTier.CONFIRM);
    expect(result.floorClamped).toBe(true);
    expect(result.reason).toMatch(/floor-clamped/i);
  });

  it("honors a BLOCKED classification at approval time (fail safe)", () => {
    const result = replayAsk(parkedWrite({ args: { command: "rm -rf /" }, toolName: "run_terminal" }), {
      classify: () => ({
        risk: ActionRisk.BLOCKED,
        reason: "blocked pattern",
        requiresCheckpoint: false,
        enhancedConfirmation: false,
      }),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/blocked/i);
  });

  it("honors a higher live tier than the parked snapshot", () => {
    const result = replayAsk(parkedWrite(), {
      resolveTier: () => PermissionTier.DANGEROUS,
    });
    expect(result.allowed).toBe(true);
    expect(result.currentTier).toBe(PermissionTier.DANGEROUS);
    expect(result.reason).toMatch(/DANGEROUS/);
  });
});
