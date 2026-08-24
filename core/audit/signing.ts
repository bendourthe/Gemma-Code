/**
 * v2.1.0 Phase 6 -- per-actor Ed25519 keys for the local audit log.
 * Keys never leave the host. Tests inject a map; production prefers the vault.
 */

import { generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from "node:crypto";

export type AuditActor = "app" | "planner" | "critic" | "worker";

export const AUDIT_ACTORS: readonly AuditActor[] = ["app", "planner", "critic", "worker"];

export interface ActorKeyPair {
  readonly actor: AuditActor;
  readonly publicPem: string;
  readonly privatePem: string;
}

export interface ActorKeyStore {
  get(actor: AuditActor): Promise<ActorKeyPair | undefined>;
  set(pair: ActorKeyPair): Promise<void>;
}

export class MemoryActorKeyStore implements ActorKeyStore {
  private readonly map = new Map<AuditActor, ActorKeyPair>();
  async get(actor: AuditActor): Promise<ActorKeyPair | undefined> {
    return this.map.get(actor);
  }
  async set(pair: ActorKeyPair): Promise<void> {
    this.map.set(pair.actor, pair);
  }
}

export function generateActorKey(actor: AuditActor): ActorKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    actor,
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function signPayload(privatePem: string, payload: string): string {
  const sig = nodeSign(null, Buffer.from(payload, "utf8"), privatePem);
  return sig.toString("base64");
}

export function verifyPayload(publicPem: string, payload: string, signatureB64: string): boolean {
  try {
    return nodeVerify(null, Buffer.from(payload, "utf8"), publicPem, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/** Persist Ed25519 pairs in the OS keychain. Never writes plaintext files. */
export class VaultActorKeyStore implements ActorKeyStore {
  private readonly memory = new MemoryActorKeyStore();

  constructor(private readonly vault: import("../security/CredentialVault.js").CredentialVault) {}

  async get(actor: AuditActor): Promise<ActorKeyPair | undefined> {
    const cached = await this.memory.get(actor);
    if (cached) return cached;
    try {
      const raw = await this.vault.get("audit", actor);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as ActorKeyPair;
      if (parsed?.actor === actor && parsed.publicPem && parsed.privatePem) {
        await this.memory.set(parsed);
        return parsed;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  async set(pair: ActorKeyPair): Promise<void> {
    await this.memory.set(pair);
    try {
      await this.vault.set("audit", pair.actor, JSON.stringify(pair));
    } catch {
      // Keychain unavailable: keep the pair in process memory only.
    }
  }
}

export async function createActorKeyStore(
  vault?: import("../security/CredentialVault.js").CredentialVault,
): Promise<ActorKeyStore> {
  if (vault && (await vault.isAvailable())) {
    return new VaultActorKeyStore(vault);
  }
  return new MemoryActorKeyStore();
}

export async function ensureActorKeys(store: ActorKeyStore): Promise<ReadonlyMap<AuditActor, ActorKeyPair>> {
  const out = new Map<AuditActor, ActorKeyPair>();
  for (const actor of AUDIT_ACTORS) {
    const existing = await store.get(actor);
    if (existing) {
      out.set(actor, existing);
      continue;
    }
    const generated = generateActorKey(actor);
    await store.set(generated);
    out.set(actor, generated);
  }
  return out;
}
