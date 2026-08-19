// ---------------------------------------------------------------------------
// v1.16.0 Phase 4 (adoption item A6) -- security guards for the headless tool
// surface.
//
// The headless surface (`headlessTools.ts`, used by the desktop sidecar and the
// `nexus` CLI) grew up without two controls the VS Code surface has had since
// v0.8.0: PERMISSION TIERS and the SECRET-PATH DENYLIST. That gap was tolerable
// while every headless tool was a plain workspace read/write; adding
// `parse_document` -- which reads an arbitrary workspace file and feeds it to a
// model subprocess -- made it load-bearing, so the guards are added here for
// EVERY headless tool rather than bolted onto the one new one.
//
// The confirmation model differs from VS Code by necessity: a headless host has
// no user to prompt. So a tool at CONFIRM or above is REFUSED unless the host
// supplies a `confirm` callback. Fail-closed is the only safe default -- silently
// auto-approving a tier the VS Code surface gates would make the headless host
// the weaker path, which is exactly how a guard gets bypassed.
// ---------------------------------------------------------------------------

// NOTE: imports `permissionTierMap.js`, NOT `PermissionTiers.js`. The latter
// reaches `vscode` transitively (utils/logger, src/tools/handlers/terminal), and
// pulling that into the headless surface would break the esbuild sidecar bundle.
import { PermissionTier, TOOL_PERMISSION_MAP } from "../guardrails/permissionTierMap.js";
import {
  confirmationRequiredForPosture,
  parseSecurityPosture,
} from "../guardrails/SecurityPosture.js";
/** Re-exported so a headless caller needs only this module. */
export { PermissionTier };
import { matchesSecretPath } from "../utils/secretPaths.js";
import type { BuiltinToolName } from "../../../src/tools/types.js";

/** Asks the host to approve a CONFIRM/DANGEROUS tool call. */
export type HeadlessConfirmFn = (
  toolName: string,
  summary: string,
  detail: string,
  args?: Readonly<Record<string, unknown>>,
) => Promise<boolean>;

export interface HeadlessGuardOptions {
  /**
   * Host approval callback. When ABSENT, tools at CONFIRM or above are refused
   * rather than auto-approved -- a headless host must opt in explicitly.
   */
  readonly confirm?: HeadlessConfirmFn;
  /** Extra secret-path globs, mirroring `nexus.coding.secretPathDenyExtra`. */
  readonly secretPathDenyExtra?: readonly string[];
  /** Per-tool tier overrides, clamped by `getPermissionTier` exactly as in VS Code. */
  readonly permissionOverrides?: Record<string, number>;
  /** v1.19.1 Phase 2.5 -- posture dial; Unattended skips CONFIRM, never DANGEROUS. */
  readonly securityPosture?: string;
}

export interface GuardDecision {
  readonly allowed: boolean;
  /** Populated when `allowed` is false; safe to return to the model verbatim. */
  readonly reason?: string;
}

/**
 * Parameter names that carry a filesystem path, per tool. Mirrors the VS Code
 * surface's per-tool `allow_secrets` checks; a tool absent from this map has no
 * path parameter to screen.
 */
const PATH_PARAMS: Readonly<Record<string, readonly string[]>> = {
  read_file: ["path"],
  write_file: ["path"],
  create_file: ["path"],
  edit_file: ["path"],
  delete_file: ["path"],
  list_directory: ["path"],
  parse_document: ["path"],
  hash_file: ["path"],
  watch_path: ["path"],
};

/**
 * Resolve a tool's effective tier, honouring overrides but never letting one
 * drop a CONFIRM-or-above baseline to AUTO_APPROVE.
 */
export function resolveTier(
  toolName: string,
  overrides?: Record<string, number>,
): PermissionTier {
  const baseline =
    TOOL_PERMISSION_MAP[toolName as BuiltinToolName] ?? PermissionTier.DANGEROUS;
  const override = overrides?.[toolName];
  if (override === undefined) return baseline;
  if (!Number.isInteger(override) || override < 0 || override > PermissionTier.DANGEROUS) {
    return baseline;
  }
  if (baseline >= PermissionTier.CONFIRM && override < PermissionTier.CONFIRM) {
    return baseline;
  }
  return override as PermissionTier;
}

/**
 * Screen one headless tool call. Returns a refusal reason instead of throwing,
 * so the caller can hand the model an actionable message.
 */
export async function screenHeadlessCall(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
  opts: HeadlessGuardOptions = {},
): Promise<GuardDecision> {
  // 1. Secret-path denylist, with the same `allow_secrets` escape hatch the VS
  //    Code handlers use -- but here the escape hatch still needs `confirm`,
  //    because there is no user watching by default.
  const pathParams = PATH_PARAMS[toolName] ?? [];
  for (const param of pathParams) {
    const value = args[param];
    if (typeof value !== "string" || value.length === 0) continue;
    if (!matchesSecretPath(value, opts.secretPathDenyExtra ?? [])) continue;

    if (args["allow_secrets"] !== true) {
      return {
        allowed: false,
        reason:
          `Path "${value}" matches the secret-path denylist. ` +
          `Usage: pass allow_secrets=true to request explicit approval, or use a non-secret path.`,
      };
    }
    // No prompt available: refuse. Unlike the tier check below, refusing here
    // costs nothing legitimate -- an agent flow that reads `.env` or a private
    // key was already refused outright on the VS Code surface.
    if (!opts.confirm) {
      return {
        allowed: false,
        reason:
          `Path "${value}" matches the secret-path denylist and this host cannot prompt for approval. ` +
          `Refusing rather than auto-approving.`,
      };
    }
    const approved = await opts.confirm(
      toolName,
      `Allow ${toolName} on secret-path file "${value}"?`,
      "The path matches the secret-path denylist (env/keys/credentials).",
      args,
    );
    if (!approved) {
      return { allowed: false, reason: `${toolName} on "${value}" was rejected.` };
    }
  }

  // 2. Permission tier -- enforced ONLY when the host supplies `confirm`.
  //
  //    This asymmetry with the secret-path check above is deliberate and is the
  //    difference between hardening and breakage. Every write/terminal tool on
  //    this surface is CONFIRM or DANGEROUS, so refusing them without a prompt
  //    would refuse essentially every agent action -- turning "add the missing
  //    guard" into "disable the headless agent". The headless surface has never
  //    had tier enforcement, so there is no prior gate being relaxed here: a
  //    host that wants tiers enforced opts in by supplying `confirm`, and a host
  //    that does not keeps exactly its pre-v1.16.0 behavior.
  //
  //    An unknown tool still resolves to DANGEROUS, and an override may RAISE a
  //    tier but never lower a CONFIRM-or-above baseline (the pen-test F-003
  //    clamp) -- so once a host opts in, the rules match the VS Code registry.
  if (!opts.confirm) return { allowed: true };

  const baseline =
    TOOL_PERMISSION_MAP[toolName as BuiltinToolName] ?? PermissionTier.DANGEROUS;
  const tier = resolveTier(toolName, opts.permissionOverrides);
  const posture = parseSecurityPosture(opts.securityPosture);
  if (
    baseline === PermissionTier.DANGEROUS ||
    confirmationRequiredForPosture(tier, posture)
  ) {
    const approved = await opts.confirm(
      toolName,
      `Run ${toolName}?`,
      `This tool is tier ${PermissionTier[tier]}.`,
      args,
    );
    if (!approved) {
      return { allowed: false, reason: `Tool "${toolName}" was rejected.` };
    }
  }

  return { allowed: true };
}
