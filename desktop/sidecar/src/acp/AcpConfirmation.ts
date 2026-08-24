/**
 * v1.18.0 Phase 5 (OI-A3) + Phase 4 (OW-A1) -- ACP confirmation adapter.
 *
 * ACP-originated tool calls use the same classifiers as the UI:
 * `classifyAction` + the vscode-free permission-tier map (`resolveTier`).
 *
 * Unattended confirmation parks in the ask inbox when one is supplied.
 * Without an inbox it FAIL-CLOSES: the tool is refused immediately. It does
 * not wait on ConfirmationGate's 60s timeout and it does not auto-approve.
 *
 * `# DEVIATION:` ConfirmationGate itself posts to a webview. ACP uses this
 * adapter so the sidecar bundle stays vscode-free while still sharing the
 * classifier + tier map.
 */

import type { AskInbox } from "../../../../modules/coding/autonomy/AskInbox.js";
import { createParkingConfirm } from "../../../../modules/coding/autonomy/parkingConfirm.js";
import { ActionRisk, classifyAction } from "../../../../modules/coding/guardrails/ActionClassifier.js";
import type { HeadlessConfirmFn } from "../../../../modules/coding/runtime/headlessGuards.js";
import { PermissionTier, resolveTier } from "../../../../modules/coding/runtime/headlessGuards.js";
import type { ToolCall } from "../../../../src/tools/types.js";
import { isExecSandboxEnabled } from "../../../../modules/coding/sandbox/index.js";

export const ACP_FAIL_CLOSED_REASON =
  "Unattended ACP confirmation fail-closed: the driving editor is not available to approve, and no ask inbox is configured. Refusing rather than auto-approving or waiting 60s.";

export interface AcpConfirmationRecord {
  readonly toolName: string;
  readonly tier: PermissionTier;
  readonly risk: ActionRisk;
  readonly decided: "fail-closed" | "approved" | "denied" | "blocked" | "parked" | "expired";
}

export interface AcpConfirmationOptions {
  /**
   * Test seam. When omitted, CONFIRM/DANGEROUS tools park (inbox) or refuse
   * (fail-closed). Must never default to true in production.
   */
  readonly decide?: (toolName: string, tier: PermissionTier) => Promise<boolean>;
  readonly onRecord?: (record: AcpConfirmationRecord) => void;
  /** Phase 4 ask inbox. Production always passes the process inbox. */
  readonly inbox?: AskInbox;
  readonly runId?: string;
  readonly sessionId?: string;
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
  const classification = classifyAction(call, {
    execSandboxEnabled: isExecSandboxEnabled(),
  });
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
  if (opts.decide) {
    return async (toolName, _summary, _detail) => {
      const tier = resolveTier(toolName);
      const approved = await opts.decide!(toolName, tier);
      opts.onRecord?.({
        toolName,
        tier,
        risk: ActionRisk.DESTRUCTIVE,
        decided: approved ? "approved" : "denied",
      });
      return approved;
    };
  }
  if (opts.inbox) {
    const parked = createParkingConfirm({
      inbox: opts.inbox,
      runMode: "headless",
      runId: opts.runId ?? "acp",
      sessionId: opts.sessionId,
    });
    return async (toolName, summary, detail, args) => {
      opts.onRecord?.({
        toolName,
        tier: resolveTier(toolName),
        risk: ActionRisk.DESTRUCTIVE,
        decided: "parked",
      });
      const approved = await parked(toolName, summary, detail, args);
      opts.onRecord?.({
        toolName,
        tier: resolveTier(toolName),
        risk: ActionRisk.DESTRUCTIVE,
        decided: approved ? "approved" : "denied",
      });
      return approved;
    };
  }
  return async (toolName, _summary, _detail) => {
    const tier = resolveTier(toolName);
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
