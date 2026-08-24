/**
 * v1.18.0 Phase 4 (OW-A2) -- scheduled and headless runs never auto-approve
 * CONFIRM/DANGEROUS work. Constructing such a run throws.
 */

export const NO_AUTO_APPROVE_REASON =
  "NO_AUTO_APPROVE: scheduled and headless runs cannot auto-approve CONFIRM/DANGEROUS actions";

export class AutoApproveForbiddenError extends Error {
  constructor(detail?: string) {
    super(detail ? `${NO_AUTO_APPROVE_REASON} (${detail})` : NO_AUTO_APPROVE_REASON);
    this.name = "AutoApproveForbiddenError";
  }
}

export interface AutoApproveFlags {
  readonly autoApprove?: boolean;
  readonly skipGate?: boolean;
  readonly elevateTier?: boolean;
}

/**
 * Throws when a caller tries to build a scheduled/headless run that would
 * skip PermissionTiers or ConfirmationGate.
 */
export function assertNoAutoApprove(flags: AutoApproveFlags = {}): void {
  if (flags.autoApprove === true) {
    throw new AutoApproveForbiddenError("autoApprove=true");
  }
  if (flags.skipGate === true) {
    throw new AutoApproveForbiddenError("skipGate=true");
  }
  if (flags.elevateTier === true) {
    throw new AutoApproveForbiddenError("elevateTier=true");
  }
}
