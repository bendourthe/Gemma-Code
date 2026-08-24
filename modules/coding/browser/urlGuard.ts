import { isBlockedIp, isDeniedDestination } from "../utils/ssrf.js";

export type NavigableUrlResult =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly error: string };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "file:", "about:"]);

/**
 * Allow `file://` (adversarial fixtures), `about:blank`, and public http(s).
 * Deny javascript/data, metadata IPs, RFC-1918, and the egress denylist.
 */
export function assertNavigableUrl(raw: string): NavigableUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Missing required parameter: url." };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: `Invalid URL: ${trimmed}` };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      error: `URL scheme "${parsed.protocol}" is not allowed. Use http(s), file://, or about:blank.`,
    };
  }
  if (parsed.protocol === "about:") {
    if (parsed.pathname !== "blank" && parsed.href !== "about:blank") {
      return { ok: false, error: "Only about:blank is allowed from the about: scheme." };
    }
    return { ok: true, url: parsed };
  }
  if (parsed.protocol === "file:") {
    return { ok: true, url: parsed };
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host === "ip6-localhost" ||
    host === "ip6-loopback" ||
    isDeniedDestination(host) ||
    isBlockedIp(host)
  ) {
    return {
      ok: false,
      error: `URL host "${host}" is blocked by the SSRF / egress denylist.`,
    };
  }
  return { ok: true, url: parsed };
}
