/**
 * v1.18.0 Phase 5 (OI-A3) -- ACP confirmation adapter.
 *
 * ACP-originated tool calls use the same classifiers as the UI:
 * `classifyAction` + the vscode-free permission-tier map (`resolveTier`).
 *
 * Unattended confirmation (the ACP HTTP hop cannot answer
 * `session/request_permission` in this phase) FAIL-CLOSES: the tool is
 * refused immediately. It does not wait on `ConfirmationGate`'s 60s timeout
 * and it does not auto-approve. Parking in an ask inbox is Phase 4 work
 * (not landed); see known-gaps DF for this cycle.
 *
 * `# DEVIATION:` ConfirmationGate itself posts to a webview. ACP uses this
 * adapter so the sidecar bundle stays vscode-free while still sharing the
 * classifier + tier map.
 */

import { ActionRisk, classifyAction } from "../../../../modules/coding/guardrails/ActionClassifier.js";
import type { HeadlessConfirmFn } from "../../../../modules/coding/runtime/headlessGuards.js";
import { PermissionTier, resolveTier } from "../../../../modules/coding/runtime/headlessGuards.js";
import type { ToolCall } from "../../../../src/tools/types.js";

export const ACP_FAIL_CLOSED_REASON =
  "Unattended ACP confirmation fail-closed: the driving editor is not available to approve, and the ask inbox is not landed (v1.18 Phase 4). Refusing rather than auto-approving or waiting 60s.";

export interface AcpConfirmationRecord {
  readonly toolName: string;
  readonly tier: PermissionTier;
  readonly risk: ActionRisk;
  readonly decided: "fail-closed" | "approved" | "denied" | "blocked";
}

export interface AcpConfirmationOptions {
  /**
   * Test seam. When omitted, CONFIRM/DANGEROUS tools are refused (fail-closed).
   * Must never default to true in production.
   */
  readonly decide?: (toolName: string, tier: PermissionTier) => Promise<boolean>;
  readonly onRecord?: (record: AcpConfirmationRecord) => void;
}

/**
 * Classify a proposed ACP tool call. BLOCKED actions never reach `confirm`.
 */
export function classifyAcpCall(toolName: string, args: Readonly<Record<string, unknown>>): {
  readonly risk: ActionRisk;
  readonly reason: string;
  readonly tier: PermissionTier;
} {
  const call: ToolCall = {
    id: "acp",
    tool: toolName as ToolCall["tool"],
    parameters: { ...args },
    source: "local-agent",
  };
  const classification = classifyAction(call);
  return {
    risk: classification.risk,
    reason: classification.reason,
    tier: resolveTier(toolName),
  };
}

/**
 * Host `confirm` callback for `createHeadlessTools({ guards: { confirm } })`.
 * AUTO_APPROVE tools never invoke this (headlessGuards skips them).
 */
export function createAcpConfirm(opts: AcpConfirmationOptions = {}): HeadlessConfirmFn {
  return async (toolName, _summary, _detail) => {
    const tier = resolveTier(toolName);
    if (opts.decide) {
      const approved = await opts.decide(toolName, tier);
      opts.onRecord?.({
        toolName,
        tier,
        risk: ActionRisk.DESTRUCTIVE,
        decided: approved ? "approved" : "denied",
      });
      return approved;
    }
    opts.onRecord?.({
      toolName,
      tier,
      risk: ActionRisk.DESTRUCTIVE,
      decided: "fail-closed",
    });
    return false;
  };
}

export { PermissionTier, ActionRisk };
