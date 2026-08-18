/**
 * v1.18.0 Phase 4 (OW-A1, OW-A2) -- vscode-free types for the ask inbox and
 * scheduled agent runs. Interactive VS Code confirmation stays on
 * ConfirmationGate's 60s webview path; only headless and scheduled runs park.
 */

import type { ActionRisk } from "../guardrails/ActionClassifier.js";
import type { PermissionTier } from "../guardrails/permissionTierMap.js";

/** Interactive sessions never park; they keep the 60s webview prompt. */
export type AskRunMode = "interactive" | "headless" | "scheduled";

export type AskState = "pending" | "approved" | "denied" | "expired";

export interface ParkedAsk {
  readonly id: string;
  readonly state: AskState;
  readonly runMode: "headless" | "scheduled";
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly decidedAt?: number;
  readonly decisionReason?: string;
  readonly toolName: string;
  readonly summary: string;
  readonly detail: string;
  readonly args: Record<string, unknown>;
  readonly risk: ActionRisk;
  readonly classificationReason: string;
  readonly parkedTier: PermissionTier;
  readonly sessionId?: string;
  readonly runId: string;
}

export interface ParkAskInput {
  readonly toolName: string;
  readonly summary: string;
  readonly detail?: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly runMode: "headless" | "scheduled";
  readonly runId: string;
  readonly sessionId?: string;
  readonly ttlMs?: number;
}

export interface ReplayResult {
  readonly allowed: boolean;
  readonly reason: string;
  readonly currentTier: PermissionTier;
  readonly floorClamped: boolean;
}

export interface ApproveResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly replay?: ReplayResult;
  /**
   * Always false from the inbox: the live waiter re-enters the tool path.
   * A missing waiter is fail-safe (no blind re-execution).
   */
  readonly executed: false;
}

export const DEFAULT_ASK_TTL_MS = 24 * 60 * 60 * 1000;

export const MORNING_BRIEF_SCHEDULE_ID = "morning-brief";
