import { PermissionTier } from "./permissionTierMap.js";

/**
 * Named security-posture dial (v1.19.1 Phase 2.5).
 *
 * Pure composition over PermissionTiers (floor clamp), ConfirmationGate, and
 * AgentLoop verification / inbound screening. There is no "no floor" mode:
 * DANGEROUS tools always confirm, and Phase 2.1 hard denials apply in every
 * posture. Unattended means fewer confirmations *above* the floor (CONFIRM
 * tools skip the prompt), never auto-approval of DANGEROUS.
 *
 * Boundary: vscode-free. Sidecar / CLI import this file, not PermissionTiers.ts.
 */

export type SecurityPostureId = "strict" | "standard" | "unattended";

export const SECURITY_POSTURE_IDS: readonly SecurityPostureId[] = [
  "strict",
  "standard",
  "unattended",
];

export interface SecurityPosturePolicy {
  readonly id: SecurityPostureId;
  readonly label: string;
  readonly summary: string;
  /**
   * Screen every successful tool result (strict) or only externally originated
   * content (standard / unattended). Web / MCP / browser origins are never
   * skipped in any posture.
   */
  readonly screenAllToolResults: boolean;
  /** Skip CONFIRM-tier prompts. DANGEROUS still confirms (the floor). */
  readonly suppressConfirmAboveFloor: boolean;
  /** Force pass-state gating even if the operator setting is off. */
  readonly forcePassStateGating: boolean;
  /** Force auto-verification even if the operator setting is off. */
  readonly forceVerification: boolean;
  /** Allow the operator to turn pass-state / verification off (unattended). */
  readonly allowDisableVerification: boolean;
}

export const SECURITY_POSTURE_POLICIES: Readonly<
  Record<SecurityPostureId, SecurityPosturePolicy>
> = Object.freeze({
  strict: Object.freeze({
    id: "strict",
    label: "Strict",
    summary:
      "Confirm every file edit and terminal command. Screen all tool output for prompt injection. Keep verification and pass-state gating on. Hard-denied commands never run.",
    screenAllToolResults: true,
    suppressConfirmAboveFloor: false,
    forcePassStateGating: true,
    forceVerification: true,
    allowDisableVerification: false,
  }),
  standard: Object.freeze({
    id: "standard",
    label: "Standard",
    summary:
      "Confirm edits and dangerous tools. Screen web, MCP, and browser results. Verification follows your existing settings. Hard-denied commands never run.",
    screenAllToolResults: false,
    suppressConfirmAboveFloor: false,
    forcePassStateGating: false,
    forceVerification: false,
    allowDisableVerification: true,
  }),
  unattended: Object.freeze({
    id: "unattended",
    label: "Unattended",
    summary:
      "Fewer confirmation prompts on reversible edits so long-running jobs can proceed. Dangerous tools (terminal, web fetch) still require confirmation. Hard-denied commands never run. This is not a no-floor mode.",
    screenAllToolResults: false,
    suppressConfirmAboveFloor: true,
    forcePassStateGating: false,
    forceVerification: false,
    allowDisableVerification: true,
  }),
});

export function parseSecurityPosture(raw: unknown): SecurityPostureId {
  if (raw === "strict" || raw === "standard" || raw === "unattended") return raw;
  return "standard";
}

export function getSecurityPosturePolicy(id: SecurityPostureId): SecurityPosturePolicy {
  return SECURITY_POSTURE_POLICIES[id];
}

/**
 * Whether the confirmation gate must prompt, given a *clamped* permission
 * tier (floor already applied) and the active posture.
 *
 * Invariants:
 * - AUTO_APPROVE never prompts.
 * - DANGEROUS always prompts (the floor).
 * - CONFIRM prompts unless the posture suppresses confirmations above the floor.
 */
export function confirmationRequiredForPosture(
  clampedTier: PermissionTier,
  posture: SecurityPostureId,
): boolean {
  if (clampedTier === PermissionTier.AUTO_APPROVE) return false;
  if (clampedTier === PermissionTier.DANGEROUS) return true;
  return !SECURITY_POSTURE_POLICIES[posture].suppressConfirmAboveFloor;
}

/** Compose pass-state gating: strict forces it on; otherwise honour the setting. */
export function composePassStateGating(
  posture: SecurityPostureId,
  settingEnabled: boolean,
): boolean {
  const policy = SECURITY_POSTURE_POLICIES[posture];
  if (policy.forcePassStateGating) return true;
  return settingEnabled;
}

/** Compose auto-verification the same way. */
export function composeVerificationEnabled(
  posture: SecurityPostureId,
  settingEnabled: boolean,
): boolean {
  const policy = SECURITY_POSTURE_POLICIES[posture];
  if (policy.forceVerification) return true;
  return settingEnabled;
}

/**
 * Whether this origin class must be screened before it enters model context.
 * Web / MCP / reserved browser snapshots are never skippable.
 */
export function mustScreenOrigin(
  origin: string,
  posture: SecurityPostureId,
): boolean {
  if (origin === "web_fetch" || origin === "mcp_tool" || origin === "browser_snapshot" || origin === "stt_transcript") {
    return true;
  }
  return SECURITY_POSTURE_POLICIES[posture].screenAllToolResults;
}
