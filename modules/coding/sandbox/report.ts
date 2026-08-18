/**
 * Loud sandbox status strings. "unconfined" must appear whenever confinement
 * is off or the backend is missing. Partial confinement is stated, not implied.
 */

import { UNCONFINED_TOKEN, type SandboxCapability, type SandboxMode, type SandboxReport } from "./types.js";

export function inferSandboxMode(
  enabled: boolean,
  capability: SandboxCapability,
): SandboxMode {
  if (!enabled || !capability.available) return "unconfined";
  const fs = capability.enforced.includes("filesystem");
  const net = capability.enforced.includes("network");
  if (fs && net) return "confined";
  if (capability.enforced.length > 0) return "partial";
  return "unconfined";
}

export function formatSandboxSummary(input: {
  readonly enabled: boolean;
  readonly mode: SandboxMode;
  readonly backendId: string;
  readonly detail: string;
  readonly unenforced: readonly string[];
}): string {
  if (!input.enabled) {
    return `OS process sandbox: ${UNCONFINED_TOKEN} (nexus.coding.execSandbox is off)`;
  }
  if (input.mode === "unconfined") {
    return `OS process sandbox: ${UNCONFINED_TOKEN} (${input.detail})`;
  }
  if (input.mode === "partial") {
    const missing =
      input.unenforced.length > 0
        ? `; unenforced: ${input.unenforced.join(", ")}`
        : "";
    return `OS process sandbox: partial (${input.backendId}${missing}; ${input.detail})`;
  }
  return `OS process sandbox: confined (${input.backendId}; ${input.detail})`;
}

export function reportFromCapability(
  enabled: boolean,
  capability: SandboxCapability,
  modeOverride?: SandboxMode,
): SandboxReport {
  const mode = modeOverride ?? inferSandboxMode(enabled, capability);
  return {
    mode,
    backendId: capability.backendId,
    enabled,
    summary: formatSandboxSummary({
      enabled,
      mode,
      backendId: capability.backendId,
      detail: capability.detail,
      unenforced: capability.unenforced,
    }),
    enforced: capability.enforced,
    unenforced: capability.unenforced,
    capability,
  };
}

export const NONE_CAPABILITY: SandboxCapability = {
  platform: process.platform,
  backendId: "none",
  available: false,
  detail: "no OS backend selected",
  enforced: [],
  unenforced: ["filesystem", "network", "process-limits", "restricted-token"],
};
