import * as dns from "node:dns/promises";
import { DEFAULT_EGRESS_DENYLIST } from "./generated/safetyConfig.generated.js";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
]);

const MAX_REDIRECTS = 5;

/**
 * v1.4.0 Phase 2 (A4) -- named exfil-destination denylist layered on top of
 * the private-range SSRF guard. The private-range checks already block raw
 * link-local / loopback / RFC-1918 addresses; this list additionally blocks
 * named destinations that are dangerous regardless of the IP they resolve to:
 *
 *   - cloud instance-metadata endpoints (credential-theft pivots), and
 *   - public paste / file-drop hosts (the classic data-exfiltration sinks).
 *
 * Each entry is a lowercased host (no scheme, no port). A request host matches
 * an entry when it is exactly equal OR is a sub-domain of it (so `pastebin.com`
 * also denies `www.pastebin.com` and `raw.pastebin.com`). The literal IP
 * `169.254.169.254` is already caught by `isPrivateIpv4`; it is repeated here
 * so the sync check (which performs no DNS resolution) blocks it by name too.
 *
 * Adopted from claude-code-harness `harness.toml [safety.sandbox.network]
 * deniedDomains`. The list is extensible at runtime via
 * `configureDeniedDestinations` (wired to the `nexus.coding.egressDenyExtra`
 * setting) and per-call via the `deniedDestinations` option.
 *
 * v1.4.0 Phase 4 (A1): the baseline values are no longer hand-coded here -- they
 * are sourced from the safety-config SSOT (`nexus.security.toml [network]
 * egress_denylist`) via the generated `safetyConfig.generated.ts` artifact, so
 * this list and the other safety surfaces cannot drift apart. Edit the SSOT and
 * run `npm run security:gen` to change it.
 */
export const DEFAULT_DENIED_DESTINATIONS: readonly string[] = DEFAULT_EGRESS_DENYLIST;

const DEFAULT_DENIED_SET: ReadonlySet<string> = new Set(
  DEFAULT_DENIED_DESTINATIONS.map((d) => d.toLowerCase()),
);

/**
 * Runtime-extensible additions to the egress denylist. Seeded empty; populated
 * by `configureDeniedDestinations` from the `nexus.coding.egressDenyExtra`
 * setting at the composition root. Kept separate from the immutable defaults so
 * tests can reset it without disturbing the baseline.
 */
let _additionalDenied: ReadonlySet<string> = new Set();

/**
 * Replace the runtime-configured egress denylist additions. Called once at
 * startup and again on every settings change. Entries are lowercased and
 * trimmed; empty entries are dropped. The immutable defaults always apply and
 * are never removed by this call.
 */
export function configureDeniedDestinations(domains: readonly string[]): void {
  const normalized = domains
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
  _additionalDenied = new Set(normalized);
}

/** Test-only: clear the runtime-configured additions back to empty. */
export function resetDeniedDestinations(): void {
  _additionalDenied = new Set();
}

/**
 * Return the effective egress denylist (defaults plus runtime additions). Used
 * by tests and diagnostics; the request path uses `isDeniedDestination`.
 */
export function getDeniedDestinations(): readonly string[] {
  return [...DEFAULT_DENIED_SET, ..._additionalDenied];
}

function _hostMatchesDenied(host: string, denied: Iterable<string>): boolean {
  for (const entry of denied) {
    if (host === entry || host.endsWith(`.${entry}`)) return true;
  }
  return false;
}

/**
 * Returns true if `host` is on the egress denylist (defaults + runtime
 * additions + any per-call `extra` entries). `host` is normalized to lowercase
 * with surrounding IPv6 brackets stripped, matching the callers' host parsing.
 * Matching is exact-or-sub-domain so a denied apex domain also covers its
 * sub-domains.
 */
export function isDeniedDestination(
  host: string,
  extra?: readonly string[],
): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (_hostMatchesDenied(normalized, DEFAULT_DENIED_SET)) return true;
  if (_hostMatchesDenied(normalized, _additionalDenied)) return true;
  if (extra && extra.length > 0) {
    const extraNormalized = extra
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);
    if (_hostMatchesDenied(normalized, extraNormalized)) return true;
  }
  return false;
}

export type DnsLookupFn = (hostname: string) => Promise<readonly string[]>;

async function defaultDnsLookup(hostname: string): Promise<readonly string[]> {
  const results = await dns.lookup(hostname, { family: 0, all: true });
  return results.map((r) => r.address);
}

function isPrivateIpv4(host: string): boolean {
  if (/^127\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^0\./.test(host)) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h === "[::1]") return true;
  if (h.startsWith("fe80:") || h.startsWith("[fe80:")) return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h === "::" || h === "[::]") return true;
  return false;
}

/** Returns true if the literal address (not hostname) is private, loopback, or link-local. */
export function isBlockedIp(host: string): boolean {
  const lower = host.toLowerCase();
  if (isPrivateIpv4(lower)) return true;
  if (isPrivateIpv6(lower)) return true;
  return false;
}

/**
 * Synchronous subset of the SSRF check: validates URL shape, scheme, known
 * loopback hostnames, and literal private IPs. Does NOT perform DNS resolution.
 *
 * Use this at construction time for fail-fast validation; pair with
 * `isSsrfBlocked` in the request path to catch DNS-based bypasses.
 */
export function isSsrfBlockedSync(
  rawUrl: string,
  options?: SsrfCheckOptions,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }

  const scheme = parsed.protocol;
  if (scheme !== "http:" && scheme !== "https:") return true;

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (isDeniedDestination(host, options?.deniedDestinations)) return true;
  if (isBlockedIp(host)) return true;

  return false;
}

export interface SsrfCheckOptions {
  readonly lookup?: DnsLookupFn;
  /**
   * v1.4.0 Phase 2 (A4) -- per-call additions to the egress denylist, on top
   * of the module defaults and any runtime-configured additions. Useful for
   * callers that want to deny a destination for a single request without
   * mutating global state.
   */
  readonly deniedDestinations?: readonly string[];
}

/**
 * Returns true if the URL should be blocked to prevent SSRF.
 *
 * Blocks:
 * - Malformed URLs
 * - Non-http(s) schemes (file://, javascript:, etc.)
 * - Known loopback hostnames
 * - Any hostname that resolves to a private / loopback / link-local IP (v4 or v6)
 */
export async function isSsrfBlocked(
  rawUrl: string,
  options?: SsrfCheckOptions,
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }

  const scheme = parsed.protocol;
  if (scheme !== "http:" && scheme !== "https:") return true;

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (isDeniedDestination(host, options?.deniedDestinations)) return true;
  if (isBlockedIp(host)) return true;

  const lookup = options?.lookup ?? defaultDnsLookup;
  try {
    const addresses = await lookup(host);
    if (addresses.length === 0) return true;
    for (const ip of addresses) {
      if (isBlockedIp(ip)) return true;
    }
  } catch {
    return true;
  }

  return false;
}

export interface SsrfFetchOptions extends RequestInit {
  readonly timeoutMs?: number;
  readonly lookup?: DnsLookupFn;
  /**
   * v1.4.0 Phase 2 (A4) -- per-call additions to the egress denylist,
   * re-checked on every redirect hop along with the module defaults.
   */
  readonly deniedDestinations?: readonly string[];
  /**
   * Maximum total response body size in bytes. When the upstream advertises a
   * larger `Content-Length` or the streaming reader exceeds this threshold,
   * the request is aborted and an error is thrown. Defaults to 5 MB.
   */
  readonly maxBodyBytes?: number;
}

/** Default body-size cap for `fetchWithSsrfGuard`. */
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

function _bodyTooLargeError(len: number, max: number): Error {
  return new Error(`Response body too large: ${len} bytes (max ${max})`);
}

async function _enforceBodyCap(
  response: Response,
  maxBodyBytes: number,
): Promise<Response> {
  const contentLengthHeader =
    typeof response.headers?.get === "function"
      ? response.headers.get("content-length")
      : null;
  if (contentLengthHeader) {
    const parsed = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(parsed) && parsed > maxBodyBytes) {
      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }
      throw _bodyTooLargeError(parsed, maxBodyBytes);
    }
  }

  if (!response.body) {
    return response;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBodyBytes) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          throw _bodyTooLargeError(total, maxBodyBytes);
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  const buffered = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffered.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Response(buffered, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Fetch wrapper that re-validates each URL in a redirect chain against the
 * SSRF check. Uses `redirect: "manual"` so each 3xx hop is inspected. The
 * final response body is bounded to `maxBodyBytes` (default 5 MB) to prevent
 * memory-exhaustion DoS via crafted large responses.
 */
export async function fetchWithSsrfGuard(
  initialUrl: string,
  init: SsrfFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 10_000,
    lookup,
    deniedDestinations,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    ...fetchInit
  } = init;

  let url = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (await isSsrfBlocked(url, { lookup, deniedDestinations })) {
      throw new Error(`URL is blocked by SSRF check: "${url}"`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        ...fetchInit,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status < 300 || response.status >= 400) {
      return _enforceBodyCap(response, maxBodyBytes);
    }

    const location = response.headers.get("location");
    if (!location) return _enforceBodyCap(response, maxBodyBytes);

    try {
      url = new URL(location, url).toString();
    } catch {
      throw new Error(`Invalid redirect target: "${location}"`);
    }
  }

  throw new Error(`Too many redirects (>${MAX_REDIRECTS}) starting from "${initialUrl}"`);
}
