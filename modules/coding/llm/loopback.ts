// v1.16.0 Phase 1 (adoption item A1) -- vscode-free loopback predicate.
//
// Extracted verbatim from `LocalAdapterRegistry.ts`, which re-exports it so
// there is exactly ONE definition of "is this endpoint local" in the codebase.
// The extraction exists because `LocalAdapterRegistry.ts` statically imports the
// concrete `OllamaClient` / `LmStudioClient`, and those import
// `config/settings` + `utils/logger`, both of which `import * as vscode`. A
// headless host (the desktop sidecar's serving gateway, the `nexus` CLI) cannot
// load or bundle that graph -- the same constraint that produced
// `headlessOllamaClient.ts`.
//
// The inbound serving gateway and the outbound local-adapter registry MUST agree
// on this predicate: a rule that drifts between "endpoints we will call" and
// "addresses we will bind" is how a local-first product accidentally exposes a
// model server to the network.

/**
 * Loopback hostnames accepted by the local-only guard. These mirror the loopback
 * set in `utils/ssrf.ts`; everything else (LAN / public / non-http) is rejected.
 * Intentionally stricter than `ssrf.isBlockedIp`, which also matches RFC-1918
 * LAN ranges -- a *local runtime* must be loopback, not a LAN host.
 */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
]);

/**
 * Returns true only for an `http(s)` URL whose host is a loopback address
 * (`127.0.0.0/8`, `::1`) or a loopback hostname. No DNS resolution is performed
 * (a manifest endpoint is a literal the user typed, not an attacker-controlled
 * redirect target), so this is a pure, synchronous, fail-fast check.
 */
export function isLoopbackEndpoint(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTNAMES.has(host)) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  return false;
}

/**
 * Validate a bare host (not a URL) against the loopback rule, bracketing IPv6
 * literals so `::1` parses. Used by the serving gateway's bind-address check.
 */
export function isLoopbackHost(host: string): boolean {
  const trimmed = host.trim();
  if (trimmed.length === 0) return false;
  const authority =
    trimmed.includes(":") && !trimmed.startsWith("[") ? `[${trimmed}]` : trimmed;
  return isLoopbackEndpoint(`http://${authority}`);
}
