/**
 * v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T017) -- credential-management
 * client contract.
 *
 * The credential surface manages per-integration secrets that live ONLY in the
 * OS keychain (the Phase 1 `CredentialVault`, reached via the sidecar
 * `credentials.*` IPC methods). There is no config-file write path: every
 * mutation goes through this client to the vault.
 */

/** A client over the sidecar credential-vault IPC methods. */
export interface CredentialsClient {
  /** Whether the OS keychain is usable on this host. */
  status(): Promise<CredentialsStatusDto>;
  /** Key names stored for an integration (values are never returned). */
  listKeys(integration: string): Promise<readonly string[]>;
  /** Store (or overwrite) a secret in the keychain. */
  setSecret(integration: string, key: string, value: string): Promise<void>;
  /** Delete a secret; resolves true when one was removed. */
  deleteSecret(integration: string, key: string): Promise<boolean>;
}

export interface CredentialsStatusDto {
  /** True when the OS keychain backend is usable (no plaintext fallback). */
  readonly available: boolean;
}
