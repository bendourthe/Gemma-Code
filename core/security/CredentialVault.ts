/**
 * v1.5.0 Phase 1 (adoption-ecosystem-2026-06 T002) -- local credential vault.
 *
 * Adopts report item 2 (`local-only`): a positive, OS-keychain-backed store
 * for user-supplied MCP / integration secrets, so secrets never land in a
 * plaintext config file (the threat Viktor, S1, describes). The vault is the
 * credential source the MCP registry resolves `${vault}` env references
 * against (see modules/coding/mcp/McpManager.ts).
 *
 * Secrets are scoped per integration: `get/set/delete` take an `integration`
 * (e.g. an MCP server name) and a `key` (e.g. the env var name), mapped to the
 * keychain's (service, account) pair. Values are held only by the OS keychain;
 * this module keeps none in memory beyond a single call.
 *
 * No-leak discipline: the vault never logs a secret value. On a backend error
 * (whose message could echo a value), the message is passed through
 * `redactSecrets` before it reaches the injected logger. There is no plaintext
 * fallback -- when the keychain is unavailable the vault throws
 * {@link KeychainUnavailableError}.
 */

import { redactSecrets } from "../observability/redactSecrets.js";
import {
  detectKeychainBackend,
  type KeychainBackend,
  type DetectKeychainBackendOptions,
} from "./KeychainBackend.js";

/** Thrown when no OS keychain primitive is available (never a plaintext fallback). */
export class KeychainUnavailableError extends Error {
  constructor(backendName: string) {
    super(
      `Credential vault unavailable: the OS keychain backend "${backendName}" ` +
        `is not usable on this host. Secrets are not written to plaintext; ` +
        `install the platform keychain tool or set the secret in the host environment.`,
    );
    this.name = "KeychainUnavailableError";
  }
}

/** Severity for the optional vault logger. */
export type VaultLogLevel = "debug" | "warn" | "error";

/** Minimal logger sink injected into the vault. Defaults to a no-op. */
export type VaultLogger = (level: VaultLogLevel, message: string) => void;

const NOOP_LOGGER: VaultLogger = () => {};

/** A per-integration secret store backed by the OS keychain. */
export interface CredentialVault {
  /** Read a secret, or undefined when none is stored. */
  get(integration: string, key: string): Promise<string | undefined>;
  /** Store (or overwrite) a secret. */
  set(integration: string, key: string, value: string): Promise<void>;
  /** Delete a secret; resolves true when one was removed. */
  delete(integration: string, key: string): Promise<boolean>;
  /** Best-effort list of key names stored for an integration. */
  list(integration: string): Promise<readonly string[]>;
  /** Whether the underlying keychain is usable on this host. */
  isAvailable(): Promise<boolean>;
}

export interface KeychainCredentialVaultOptions {
  /** Service-name prefix in the keychain. Defaults to "Nexus". */
  readonly servicePrefix?: string;
  /** Logger sink (defaults to no-op). Receives redacted messages only. */
  readonly logger?: VaultLogger;
}

/**
 * {@link CredentialVault} backed by a {@link KeychainBackend}. Each integration
 * maps to a distinct keychain service (`<prefix>:<integration>`) so a list /
 * delete is naturally scoped per integration.
 */
export class KeychainCredentialVault implements CredentialVault {
  private readonly _backend: KeychainBackend;
  private readonly _servicePrefix: string;
  private readonly _log: VaultLogger;

  constructor(backend: KeychainBackend, opts: KeychainCredentialVaultOptions = {}) {
    this._backend = backend;
    this._servicePrefix = opts.servicePrefix ?? "Nexus";
    this._log = opts.logger ?? NOOP_LOGGER;
  }

  private _service(integration: string): string {
    return `${this._servicePrefix}:${integration}`;
  }

  private async _ensureAvailable(): Promise<void> {
    if (!(await this._backend.isAvailable())) {
      throw new KeychainUnavailableError(this._backend.name);
    }
  }

  /** Run a backend op, redacting any thrown message before logging + rethrow. */
  private async _guard<T>(op: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof KeychainUnavailableError) throw err;
      const raw = err instanceof Error ? err.message : String(err);
      const safe = redactSecrets(raw);
      this._log("error", `[CredentialVault] ${op} failed: ${safe}`);
      throw new Error(`CredentialVault ${op} failed: ${safe}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    return this._backend.isAvailable();
  }

  async get(integration: string, key: string): Promise<string | undefined> {
    await this._ensureAvailable();
    this._log("debug", `[CredentialVault] get ${integration}/${key}`);
    const value = await this._guard("get", () => this._backend.get(this._service(integration), key));
    return value ?? undefined;
  }

  async set(integration: string, key: string, value: string): Promise<void> {
    await this._ensureAvailable();
    this._log("debug", `[CredentialVault] set ${integration}/${key}`);
    await this._guard("set", () => this._backend.set(this._service(integration), key, value));
  }

  async delete(integration: string, key: string): Promise<boolean> {
    await this._ensureAvailable();
    this._log("debug", `[CredentialVault] delete ${integration}/${key}`);
    return this._guard("delete", () => this._backend.delete(this._service(integration), key));
  }

  async list(integration: string): Promise<readonly string[]> {
    await this._ensureAvailable();
    return this._guard("list", () => this._backend.list(this._service(integration)));
  }
}

export interface CreateCredentialVaultOptions
  extends KeychainCredentialVaultOptions,
    DetectKeychainBackendOptions {}

/**
 * Construct the default credential vault for the host platform. The backend is
 * chosen by platform; availability is probed lazily on first use, so this is
 * cheap to call at bootstrap even where no keychain tool is installed.
 */
export function createCredentialVault(
  opts: CreateCredentialVaultOptions = {},
): CredentialVault {
  const backend = detectKeychainBackend({ platform: opts.platform, exec: opts.exec });
  return new KeychainCredentialVault(backend, {
    servicePrefix: opts.servicePrefix,
    logger: opts.logger,
  });
}
