/**
 * Enablement for the OS process sandbox. Off by default (v1.12 rollout).
 * `NEXUS_EXEC_SANDBOX` overrides the vscode setting so the headless sidecar
 * and CI share the same switch without importing vscode.
 *
 * `# DEVIATION:` the sidecar has no vscode configuration. Headless hosts use
 * this env override against the same spawn abstraction as `run_terminal`.
 */

export function parseExecSandboxEnv(
  raw: string | undefined,
): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return undefined;
}

/**
 * Resolve whether the sandbox is requested. Env wins. The vscode callback is
 * only consulted when the env var is unset; it must not throw.
 */
export function isExecSandboxEnabled(vscodeValue?: boolean): boolean {
  const env = parseExecSandboxEnv(process.env["NEXUS_EXEC_SANDBOX"]);
  if (env !== undefined) return env;
  return vscodeValue === true;
}
