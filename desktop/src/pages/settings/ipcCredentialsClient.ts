/**
 * v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T017) -- production credential
 * client over the sidecar `credentials.*` IPC methods.
 *
 * Every mutation routes through the sidecar to the OS-keychain `CredentialVault`
 * (core/security). The desktop never persists a credential to a config file.
 */

import { ipcCall } from "../../lib/ipc";
import type { CredentialsClient, CredentialsStatusDto } from "./credentialsTypes";

export function createIpcCredentialsClient(): CredentialsClient {
  return {
    async status(): Promise<CredentialsStatusDto> {
      const reply = await ipcCall<CredentialsStatusDto>("credentials.status", {});
      // Treat an unreachable sidecar as "keychain unavailable" rather than
      // throwing, so the surface degrades to a clear disabled state.
      return reply.ok ? reply.value : { available: false };
    },
    async listKeys(integration: string): Promise<readonly string[]> {
      const reply = await ipcCall<{ keys: string[] }>("credentials.list", {
        integration,
      });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value.keys;
    },
    async setSecret(integration: string, key: string, value: string): Promise<void> {
      const reply = await ipcCall<{ ok: true }>("credentials.set", {
        integration,
        key,
        value,
      });
      if (!reply.ok) throw new Error(reply.message);
    },
    async deleteSecret(integration: string, key: string): Promise<boolean> {
      const reply = await ipcCall<{ removed: boolean }>("credentials.delete", {
        integration,
        key,
      });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value.removed;
    },
  };
}
