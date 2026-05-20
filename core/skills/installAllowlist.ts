/**
 * v1.1.0 Phase 8.3 -- install-source allowlist.
 *
 * `nexus skills install <ns>/<name> --from <url>` accepts only sources
 * whose URL host is in this allowlist. The list is intentionally short
 * and reviewed alongside the security audit; any addition must be
 * matched by a written justification in the changelog.
 *
 * The `file://` scheme is allowed only under `NEXUS_SKILLS_TEST_MODE=1`
 * so end-to-end tests can install from a local fixture without granting
 * the production CLI a path-injection surface.
 *
 * Closes v1.0.0 carryforward `10.P2.III` (`nexus skills install/remove`).
 */

/**
 * Production allowlist. Lowercase hosts only -- the CLI normalizes the
 * incoming URL's host before comparing.
 */
export const INSTALL_ALLOWLIST: readonly string[] = Object.freeze([
  "github.com",
  "gitlab.com",
  "raw.githubusercontent.com",
  "bendourthe.com",
]);

export interface AllowlistOptions {
  /** Allow `file://` URLs (tests). Defaults to `process.env.NEXUS_SKILLS_TEST_MODE === "1"`. */
  allowFileUrls?: boolean;
  /** Custom allowlist (tests). Defaults to `INSTALL_ALLOWLIST`. */
  allowlist?: readonly string[];
}

export interface AllowlistDecision {
  readonly ok: boolean;
  /** Lowercased host that was checked. Empty when `ok === false` and the URL was unparseable. */
  readonly host: string;
  /** Human-readable rejection reason when `ok === false`. */
  readonly reason?: string;
}

/**
 * Decide whether `url` is an acceptable install source. Pure function:
 * no network, no filesystem, no side effects.
 */
export function checkInstallUrl(
  url: string,
  opts: AllowlistOptions = {},
): AllowlistDecision {
  const allowFileUrls =
    opts.allowFileUrls ?? process.env["NEXUS_SKILLS_TEST_MODE"] === "1";
  const allowlist = opts.allowlist ?? INSTALL_ALLOWLIST;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, host: "", reason: `invalid URL: ${url}` };
  }

  if (parsed.protocol === "file:") {
    if (allowFileUrls) return { ok: true, host: parsed.hostname.toLowerCase() };
    return {
      ok: false,
      host: parsed.hostname.toLowerCase(),
      reason: "file:// URLs are not allowed outside test mode",
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      host: parsed.hostname.toLowerCase(),
      reason: `unsupported protocol: ${parsed.protocol}`,
    };
  }

  const host = parsed.hostname.toLowerCase();
  const allowed = new Set(allowlist.map((h) => h.toLowerCase()));
  if (!allowed.has(host)) {
    return {
      ok: false,
      host,
      reason: `host '${host}' is not in the install allowlist (${allowlist.join(", ")})`,
    };
  }

  return { ok: true, host };
}
