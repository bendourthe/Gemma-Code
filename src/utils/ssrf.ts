import * as dns from "node:dns/promises";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
]);

const MAX_REDIRECTS = 5;

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
export function isSsrfBlockedSync(rawUrl: string): boolean {
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
  if (isBlockedIp(host)) return true;

  return false;
}

export interface SsrfCheckOptions {
  readonly lookup?: DnsLookupFn;
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
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    ...fetchInit
  } = init;

  let url = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (await isSsrfBlocked(url, { lookup })) {
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
