/**
 * v1.18.0 Phase 4 (OW-A1) -- approval is never a stored pre-approval.
 * Approving a parked ask re-classifies the frozen args and re-resolves the
 * permission tier (floor-clamp intact) at approval time.
 */

import { ActionRisk, classifyAction } from "../guardrails/ActionClassifier.js";
import { PermissionTier } from "../guardrails/permissionTierMap.js";
import { resolveTier } from "../runtime/headlessGuards.js";
import type { ToolCall } from "../../../src/tools/types.js";
import type { ParkedAsk, ReplayResult } from "./types.js";

export interface ReplayAskOptions {
  readonly classify?: typeof classifyAction;
  readonly resolveTier?: typeof resolveTier;
  readonly permissionOverrides?: Record<string, number>;
}

function asToolCall(ask: ParkedAsk): ToolCall {
  return {
    id: ask.id,
    tool: ask.toolName as ToolCall["tool"],
    parameters: { ...ask.args },
    source: "local-agent",
  };
}

/**
 * Re-enter classifyAction + resolveTier. A BLOCKED classification fails safe.
 * An override that tries to drop CONFIRM/DANGEROUS to AUTO_APPROVE is clamped
 * (the same floor as the live registry). The user's Approve click is the
 * confirmation for the *current* tier; it does not skip the gate.
 */
export function replayAsk(ask: ParkedAsk, opts: ReplayAskOptions = {}): ReplayResult {
  const classify = opts.classify ?? classifyAction;
  const resolve = opts.resolveTier ?? resolveTier;
  const classification = classify(asToolCall(ask));
  const baseline = resolve(ask.toolName);
  const currentTier = resolve(ask.toolName, opts.permissionOverrides);
  const override = opts.permissionOverrides?.[ask.toolName];
  const floorClamped =
    baseline >= PermissionTier.CONFIRM &&
    override !== undefined &&
    override < PermissionTier.CONFIRM &&
    currentTier >= PermissionTier.CONFIRM;

  if (classification.risk === ActionRisk.BLOCKED) {
    return {
      allowed: false,
      reason: classification.reason,
      currentTier,
      floorClamped,
    };
  }

  return {
    allowed: true,
    reason: floorClamped
      ? `Replayed at tier ${PermissionTier[currentTier]} (floor-clamped; AUTO_APPROVE override ignored).`
      : `Replayed at tier ${PermissionTier[currentTier]}.`,
    currentTier,
    floorClamped,
  };
}
