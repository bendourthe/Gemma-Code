/**
 * v1.4.0 Phase 2 (A5) -- child-process environment scrubbing.
 *
 * Adopted from claude-code-harness `harness.toml [env]
 * CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = "1"`. The agent spawns shell commands on
 * the user's behalf; by default a child process inherits the full parent
 * environment, which routinely carries API keys, tokens, and cloud
 * credentials. A compromised or careless command can then read or exfiltrate
 * them. This module computes a reduced environment that drops variables whose
 * NAME looks secret-bearing OR whose VALUE matches a known secret shape, while
 * keeping everything a normal build / test / git command needs (PATH, HOME,
 * shell vars, etc.).
 *
 * The value-shape check reuses `detectSecretCategories` from
 * `redactSecrets.ts` so the two surfaces stay in lockstep: a value that the
 * trace/memory redactor would mask is also stripped from a child env.
 *
 * Scrubbing is conservative about false negatives (better to drop a borderline
 * variable than leak it) but is paired with an explicit allowlist so a command
 * that genuinely needs a specific secret variable can opt it back in.
 */

import { detectSecretCategories } from "./redactSecrets.js";

/**
 * Environment-variable NAME patterns that indicate a secret-bearing value.
 * Matched case-insensitively against the variable name. Chosen to catch the
 * common credential families (keys, tokens, secrets, passwords, cloud
 * credentials) while deliberately NOT matching benign names such as `PATH`,
 * `HOME`, `PWD`, `SHELL`, or `SSH_AUTH_SOCK` (the bare token `AUTH` is not a
 * trigger; only `AUTH_TOKEN` is).
 */
const SENSITIVE_ENV_NAME_RE =
  /(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY|API[_-]?KEY|ENCRYPTION_KEY|AUTH_TOKEN|SESSION_TOKEN|_KEY$|^KEY$)/;

/**
 * Returns true if the environment-variable NAME looks like it holds a secret.
 * Name-based detection alone; pair with `valueLooksLikeSecret` for defense in
 * depth against innocuously-named variables that hold credentials.
 */
export function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_ENV_NAME_RE.test(name.toUpperCase());
}

/**
 * Returns true if the VALUE matches a known secret shape (AWS access key,
 * GitHub PAT, Slack token, JWT, PEM private key). Reuses the shared redaction
 * patterns so a value that would be masked in a trace is also stripped here.
 */
export function valueLooksLikeSecret(value: string): boolean {
  if (!value) return false;
  return detectSecretCategories(value).length > 0;
}

export interface ScrubEnvOptions {
  /**
   * Exact environment-variable names that pass through even when they would
   * otherwise be scrubbed. Matched case-sensitively (environment variable
   * names are case-sensitive on POSIX). Use for a command that legitimately
   * needs a specific secret variable.
   */
  readonly allowlist?: readonly string[];
}

/**
 * Produce a scrubbed copy of `baseEnv`. A variable is dropped when its name is
 * sensitive (`isSensitiveEnvName`) or its value matches a secret shape
 * (`valueLooksLikeSecret`), unless its exact name appears in `allowlist`.
 * Variables with an `undefined` value are dropped (they carry no information
 * and Node would otherwise serialize them as the string "undefined").
 *
 * Returns a brand-new object; `baseEnv` is never mutated.
 */
export function scrubEnv(
  baseEnv: NodeJS.ProcessEnv,
  options: ScrubEnvOptions = {},
): NodeJS.ProcessEnv {
  const allow = new Set(options.allowlist ?? []);
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (allow.has(name)) {
      out[name] = value;
      continue;
    }
    if (isSensitiveEnvName(name)) continue;
    if (valueLooksLikeSecret(value)) continue;
    out[name] = value;
  }
  return out;
}
