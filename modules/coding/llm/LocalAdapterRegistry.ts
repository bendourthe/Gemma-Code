import { z } from "zod";
import type { LLMClient } from "./types.js";
import { createOllamaClient } from "./OllamaClient.js";
import { createLmStudioClient } from "./LmStudioClient.js";

/**
 * v1.6.0 Phase 5 (comparison item A3) -- config-driven, local-only adapter
 * registry. Lowers the cost of adding a new *local* inference runtime by making
 * adapter registration manifest-driven (mirroring aisuite's convention-based
 * provider auto-discovery) instead of a hand-edited `if/else` switch in the
 * composition root (`NexusCodingRuntime._resolveBackend`).
 *
 * Hard local-only guard: every manifest endpoint must be a loopback address
 * (`127.0.0.0/8`, `::1`, or a loopback hostname). A manifest declaring any
 * non-loopback endpoint is rejected with an error that cites the AGENTS.md MCP
 * Registry Policy, because a remote endpoint would introduce the outbound
 * network surface the local-first thesis rejects by construction. This is the
 * registry's reason for existing: a new local runtime that speaks an already
 * supported wire protocol (Ollama-native or OpenAI-compatible) needs only a
 * manifest, no code change; a genuinely new wire shape still needs a new
 * `LLMClient` implementation plus a `protocol` entry here.
 *
 * Layering: this module lives under `modules/coding/llm/` (not `core/`) for two
 * reasons -- (1) the `no-llm-outside-llm-folder` boundary rule restricts direct
 * imports of the concrete clients to this folder, and (2) the loopback check
 * intentionally mirrors `modules/coding/utils/ssrf.ts` rather than living in
 * `core/`, which cannot import from `modules/`.
 */

/**
 * Wire protocol a local runtime speaks. Each value maps to one `LLMClient`
 * factory in this module. Adding a runtime that speaks an existing protocol is
 * a manifest-only change; a new protocol needs a new factory + entry here.
 */
export type LocalAdapterProtocol = "ollama" | "openai";

/** Optional capability hints carried by a manifest (advisory; not enforced). */
export interface LocalAdapterCapabilities {
  readonly chat?: boolean;
  readonly embed?: boolean;
  readonly vision?: boolean;
}

/** A validated local-runtime adapter manifest. */
export interface LocalAdapterManifest {
  /** Unique selector id (matched against the `nexus.llm.backend` setting). */
  readonly name: string;
  /** Human-friendly display name. Defaults to `name` when omitted. */
  readonly label?: string;
  /** Wire protocol -> client factory. */
  readonly protocol: LocalAdapterProtocol;
  /** Base URL. MUST be loopback; non-loopback endpoints are rejected. */
  readonly endpoint: string;
  /** Advisory capability hints. */
  readonly capabilities?: LocalAdapterCapabilities;
}

const ProtocolSchema = z.enum(["ollama", "openai"]);

const CapabilitiesSchema = z
  .object({
    chat: z.boolean().optional(),
    embed: z.boolean().optional(),
    vision: z.boolean().optional(),
  })
  .strict();

const ManifestSchema = z
  .object({
    name: z.string().min(1, "name must be a non-empty string"),
    label: z.string().min(1).optional(),
    protocol: ProtocolSchema,
    endpoint: z.string().min(1, "endpoint must be a non-empty string"),
    capabilities: CapabilitiesSchema.optional(),
  })
  .strict();

/** Built-in adapter names, exported so the composition root can reference them. */
export const OLLAMA_ADAPTER_NAME = "ollama";
export const LMSTUDIO_ADAPTER_NAME = "lmstudio";

/**
 * Loopback hostnames accepted by the local-only guard. These mirror the
 * loopback set in `ssrf.ts`; everything else (LAN / public / non-http) is
 * rejected. Intentionally stricter than `ssrf.isBlockedIp`, which also matches
 * RFC-1918 LAN ranges -- a *local runtime* must be loopback, not a LAN host.
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

/** Discriminated result of validating a raw manifest. */
export type ManifestValidationResult =
  | { readonly ok: true; readonly manifest: LocalAdapterManifest }
  | { readonly ok: false; readonly error: string };

/** Error thrown by the strict (`register` / `createClient`) registry paths. */
export class LocalAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalAdapterError";
  }
}

function nonLocalRejection(name: string, endpoint: string): string {
  return (
    `Local-adapter manifest "${name}" declares a non-local endpoint ` +
    `"${endpoint}". The Nexus MCP Registry Policy (AGENTS.md) restricts ` +
    `adapter discovery to local-only loopback endpoints (127.0.0.0/8, ::1, ` +
    `localhost); a non-loopback or remote endpoint introduces an outbound ` +
    `network surface that conflicts with the local-first, zero-outbound ` +
    `thesis and is rejected.`
  );
}

/**
 * Validate a raw (untrusted) manifest. Returns a discriminated result rather
 * than throwing so discovery from config can skip-and-report invalid entries.
 * Enforces structural validity (zod) and the loopback-only endpoint guard.
 */
export function validateLocalAdapterManifest(
  raw: unknown,
): ManifestValidationResult {
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Invalid local-adapter manifest: ${detail}` };
  }
  const manifest = parsed.data;
  if (!isLoopbackEndpoint(manifest.endpoint)) {
    return { ok: false, error: nonLocalRejection(manifest.name, manifest.endpoint) };
  }
  return { ok: true, manifest };
}

/** Per-call overrides applied when building a client from a manifest. */
export interface CreateClientOptions {
  /** Override the manifest endpoint (built-ins draw this from live settings). */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

/**
 * Registry of validated local-runtime adapter manifests. Maps a manifest's
 * `protocol` to a concrete `LLMClient` factory. Construction is lazy: manifests
 * are registered eagerly (and validated at registration), but no network client
 * is built until `createClient` is called.
 */
export class LocalAdapterRegistry {
  private readonly _adapters = new Map<string, LocalAdapterManifest>();

  /**
   * Register a manifest, throwing `LocalAdapterError` if it is structurally
   * invalid or declares a non-local endpoint. Use for trusted built-ins.
   */
  register(raw: unknown): LocalAdapterManifest {
    const result = validateLocalAdapterManifest(raw);
    if (!result.ok) throw new LocalAdapterError(result.error);
    this._adapters.set(result.manifest.name, result.manifest);
    return result.manifest;
  }

  /**
   * Register a manifest without throwing, returning the validation result. Use
   * when discovering manifests from untrusted config so one bad entry does not
   * abort discovery of the rest.
   */
  tryRegister(raw: unknown): ManifestValidationResult {
    const result = validateLocalAdapterManifest(raw);
    if (result.ok) this._adapters.set(result.manifest.name, result.manifest);
    return result;
  }

  has(name: string): boolean {
    return this._adapters.has(name);
  }

  get(name: string): LocalAdapterManifest | undefined {
    return this._adapters.get(name);
  }

  /** All registered manifests, in registration order. */
  list(): readonly LocalAdapterManifest[] {
    return [...this._adapters.values()];
  }

  /**
   * Build an `LLMClient` for the named adapter. Throws `LocalAdapterError` if
   * no adapter is registered under `name`. `opts.baseUrl` overrides the
   * manifest endpoint (the composition root passes the live settings URL for
   * the built-ins); a custom adapter falls back to its manifest endpoint, which
   * was already loopback-validated at registration.
   */
  createClient(name: string, opts?: CreateClientOptions): LLMClient {
    const manifest = this._adapters.get(name);
    if (!manifest) {
      const known = [...this._adapters.keys()].join(", ") || "(none)";
      throw new LocalAdapterError(
        `No local adapter registered under name "${name}". Registered: ${known}.`,
      );
    }
    const baseUrl = opts?.baseUrl ?? manifest.endpoint;
    const timeoutMs = opts?.timeoutMs;
    switch (manifest.protocol) {
      case "ollama":
        return createOllamaClient({ baseUrl, timeoutMs });
      case "openai":
        return createLmStudioClient({ baseUrl, timeoutMs });
    }
  }
}

/**
 * The two adapters Nexus ships, expressed as manifests. Endpoints are the
 * historical defaults; the composition root overrides them with the live
 * `nexus.llm.ollamaUrl` / `nexus.llm.lmstudio.baseUrl` settings at build time.
 */
const BUILTIN_MANIFESTS: readonly LocalAdapterManifest[] = [
  {
    name: OLLAMA_ADAPTER_NAME,
    label: "Ollama",
    protocol: "ollama",
    endpoint: "http://localhost:11434",
    capabilities: { chat: true, embed: true, vision: true },
  },
  {
    name: LMSTUDIO_ADAPTER_NAME,
    label: "LM Studio",
    protocol: "openai",
    endpoint: "http://127.0.0.1:1234",
    capabilities: { chat: true, embed: true },
  },
];

/**
 * Build a registry seeded with the two built-in adapters (Ollama, LM Studio).
 * The composition root then layers any user-supplied manifests on top via
 * `tryRegister`.
 */
export function createDefaultLocalAdapterRegistry(): LocalAdapterRegistry {
  const registry = new LocalAdapterRegistry();
  for (const manifest of BUILTIN_MANIFESTS) {
    registry.register(manifest);
  }
  return registry;
}
