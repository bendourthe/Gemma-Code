/**
 * v1.16.0 Phase 1.1 (adoption item A1) -- local serving-gateway configuration.
 *
 * Resolves the `nexus.serving.*` settings group that decides whether Nexus
 * exposes its registry-backed local models over a loopback HTTP API. The
 * gateway is opt-in and defaults OFF: with no settings written, `resolve()`
 * returns `enabled: false` and the caller opens no listener at all.
 *
 * Resolution order, highest precedence first:
 *   1. the `SettingsStore` (`~/.nexus/settings.json`, written by the desktop
 *      Settings > Local API server section over the `serving.*` IPC), then
 *   2. `NEXUS_SERVING_*` environment variables (the existing sidecar override
 *      convention -- see `NEXUS_DIFFUSION_INMEMORY`, `NEXUS_CATALOG_PATH`), then
 *   3. the built-in defaults below.
 *
 * The token is generated once and PERSISTED on first resolve when unset, so a
 * base URL + token pasted into Claude Code / Codex / Cursor keeps working across
 * app restarts. It is never logged (see `redactToken`).
 */

import { randomBytes } from "node:crypto";
import type { SettingsStore } from "../../../../core/storage/SettingsStore.js";

/** Settings keys owned by this feature. Mirrors the `package.json` contributions. */
export const SERVING_KEYS = {
  enabled: "nexus.serving.enabled",
  host: "nexus.serving.host",
  port: "nexus.serving.port",
  token: "nexus.serving.token",
} as const;

export const DEFAULT_SERVING_HOST = "127.0.0.1";
export const DEFAULT_SERVING_PORT = 11500;

/** A fully resolved, ready-to-bind gateway configuration. */
export interface ServingConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  /** Bearer token every request must present. Never empty after resolution. */
  readonly token: string;
}

export interface ResolveServingConfigOptions {
  readonly settings: SettingsStore;
  /** Injected for tests; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to a 32-byte crypto-random token. */
  readonly generateToken?: () => string;
}

/** 32 bytes of CSPRNG entropy, base64url so it pastes cleanly into a config file. */
export function generateServingToken(): string {
  return randomBytes(32).toString("base64url");
}

function envFlag(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return undefined;
}

function envPort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(n) && n > 0 && n <= 65_535 ? n : undefined;
}

function nonEmpty(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

/**
 * Resolve the effective gateway config, persisting a freshly generated token
 * when none is configured. Reads are individually fault-tolerant only insofar as
 * the store is: a malformed settings file surfaces as a thrown error to the
 * caller, which treats the gateway as disabled rather than crashing the sidecar.
 */
export async function resolveServingConfig(
  opts: ResolveServingConfigOptions,
): Promise<ServingConfig> {
  const { settings } = opts;
  const env = opts.env ?? process.env;
  const gen = opts.generateToken ?? generateServingToken;

  const storedEnabled = await settings.get<boolean>(SERVING_KEYS.enabled);
  const enabled =
    typeof storedEnabled === "boolean"
      ? storedEnabled
      : (envFlag(env.NEXUS_SERVING_ENABLED) ?? false);

  const host =
    nonEmpty(await settings.get<string>(SERVING_KEYS.host)) ??
    nonEmpty(env.NEXUS_SERVING_HOST) ??
    DEFAULT_SERVING_HOST;

  const storedPort = await settings.get<number>(SERVING_KEYS.port);
  const port =
    typeof storedPort === "number" && Number.isInteger(storedPort) && storedPort > 0
      ? storedPort
      : (envPort(env.NEXUS_SERVING_PORT) ?? DEFAULT_SERVING_PORT);

  const configuredToken =
    nonEmpty(await settings.get<string>(SERVING_KEYS.token)) ??
    nonEmpty(env.NEXUS_SERVING_TOKEN);

  let token = configuredToken;
  if (!token) {
    token = gen();
    // Persist so the token the user copied stays valid across restarts. A
    // read-only settings file must not stop the gateway from working, so a
    // failed write degrades to an in-memory (per-process) token.
    try {
      await settings.set(SERVING_KEYS.token, token);
    } catch {
      // Ephemeral token for this process only.
    }
  }

  return { enabled, host, port, token };
}

/** The base URL an external tool points at. Brackets IPv6 hosts. */
export function servingBaseUrl(config: Pick<ServingConfig, "host" | "port">): string {
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  return `http://${host}:${config.port}/v1`;
}

/**
 * Render a token for logs / telemetry. Always masked -- the gateway token is a
 * credential and must never reach stdout, stderr, or a trace record in full.
 */
export function redactToken(token: string): string {
  if (token.length <= 4) return "****";
  return `****${token.slice(-4)}`;
}
