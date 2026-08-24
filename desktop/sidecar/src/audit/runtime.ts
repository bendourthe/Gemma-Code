/**
 * v2.1.0 Phase 6 -- sidecar audit-log runtime.
 *
 * Keys prefer the OS keychain. When the vault is unavailable, signing keys
 * stay in process memory (DF: no plaintext file fallback).
 */

import * as path from "node:path";
import {
  AuditLog,
  MemoryActorKeyStore,
  VaultActorKeyStore,
} from "../../../../core/audit/index.js";
import { nexusHome } from "../../../../core/storage/paths.js";
import type { CredentialVault } from "../../../../core/security/CredentialVault.js";
import type { TelemetryBus } from "../../../../core/telemetry/TelemetryBus.js";

export interface AuditRuntime {
  readonly log: AuditLog;
}

export function createAuditRuntime(opts: {
  readonly credentials?: CredentialVault;
  readonly telemetry?: TelemetryBus;
  readonly dbPath?: string;
  readonly homeDirFn?: () => string;
  readonly maxPending?: number;
} = {}): AuditRuntime {
  const keys = opts.credentials
    ? new VaultActorKeyStore(opts.credentials)
    : new MemoryActorKeyStore();
  const dbPath =
    opts.dbPath ?? path.join(nexusHome(opts.homeDirFn), "audit", "audit.db");
  const log = new AuditLog({
    dbPath,
    keys,
    maxPending: opts.maxPending,
    homeDirFn: opts.homeDirFn,
  });
  if (opts.telemetry) log.attach(opts.telemetry);
  return { log };
}
