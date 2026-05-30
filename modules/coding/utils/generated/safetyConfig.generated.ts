// GENERATED FILE. Do not edit by hand.
// Run `npm run security:gen` to regenerate from nexus.security.toml.
//
// v1.4.0 Phase 4 (A1) -- the safety-config SSOT (nexus.security.toml) is the
// authored source for the egress denylist (A4) and the secret-path denylist;
// scripts/generate-tool-permission-table.mjs writes this module so the runtime
// guards (ssrf.ts, secretPaths.ts) read exactly what the SSOT declares. The CI
// drift gate (`npm run security:check`) fails if this file diverges from the
// SSOT.

/** Egress denylist (A4): named exfil destinations blocked by the SSRF guard. */
export const DEFAULT_EGRESS_DENYLIST: readonly string[] = [
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.azure.com",
  "pastebin.com",
  "transfer.sh",
  "0x0.st",
  "paste.ee",
  "termbin.com",
  "ix.io",
];

/** Secret-path denylist: globs for files that may hold secrets. */
export const SECRET_PATH_PATTERNS: readonly string[] = [
  "**/.env*", // gemma-check-allow: no-env-file-leakage
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/id_ecdsa*",
  "**/*.pem",
  "**/*.key",
  "**/credentials*",
  "**/.aws/**",
  "**/.ssh/**",
  "**/secrets/**",
  "**/.nexus/mcp.json",
];
