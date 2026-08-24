/**
 * v1.20.0 Phase 1 (A1) -- shared enablement for the `parse_document` agent tool.
 *
 * VS Code reads `nexus.coding.parseDocument.enabled` through settings.ts.
 * Headless / sidecar hosts have no vscode configuration, so they honour
 * `NEXUS_PARSE_DOCUMENT` (same env-override shape as `NEXUS_EXEC_SANDBOX`)
 * and, when that is unset, the boolean stored at
 * `nexus.coding.parseDocument.enabled` in `~/.nexus/settings.json`.
 *
 * Default is false: the tool is absent until the operator opts in.
 */

export const PARSE_DOCUMENT_SETTING_KEY = "nexus.coding.parseDocument.enabled";
export const PARSE_DOCUMENT_ENV = "NEXUS_PARSE_DOCUMENT";

export function parseParseDocumentEnv(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return undefined;
}

/**
 * Resolve whether `parse_document` should be registered. Env wins. A stored
 * settings boolean is consulted only when the env var is unset. Missing both
 * is off.
 */
export function isParseDocumentEnabled(opts?: {
  readonly env?: NodeJS.ProcessEnv;
  readonly settingsValue?: boolean;
}): boolean {
  const envBag = opts?.env ?? process.env;
  const fromEnv = parseParseDocumentEnv(envBag[PARSE_DOCUMENT_ENV]);
  if (fromEnv !== undefined) return fromEnv;
  return opts?.settingsValue === true;
}
