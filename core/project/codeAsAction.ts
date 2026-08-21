/**
 * v2.0 DF-10 -- fail-closed code-as-action kernel.
 *
 * Opt-in per run. Direct filesystem and network from the worker are rejected.
 * Mutating operations must still pass PermissionTiers + ConfirmationGate at
 * the composition root; this module only enforces the sandbox contract.
 */

export type CodeAsActionDeny = "fs" | "network" | "timeout" | "disabled";

export interface CodeAsActionRequest {
  readonly source: string;
  readonly enabled?: boolean;
  readonly timeoutMs?: number;
  readonly allowFs?: boolean;
  readonly allowNetwork?: boolean;
}

export interface CodeAsActionResult {
  readonly ok: boolean;
  readonly deny?: CodeAsActionDeny;
  readonly output?: string;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export function runCodeAsAction(req: CodeAsActionRequest): CodeAsActionResult {
  if (req.enabled !== true) {
    return { ok: false, deny: "disabled" };
  }
  if (req.allowNetwork === true) {
    return { ok: false, deny: "network" };
  }
  if (req.allowFs === true) {
    return { ok: false, deny: "fs" };
  }
  const timeout = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return { ok: false, deny: "timeout" };
  }
  // No interpreter is shipped. A later cycle can evaluate `source` inside a
  // hardened isolate; until then the kernel exists so callers fail closed
  // instead of executing arbitrary JS.
  return { ok: false, deny: "disabled", output: "code-as-action isolate is not armed" };
}
