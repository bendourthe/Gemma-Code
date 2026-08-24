import { ipcCall } from "../../lib/ipc";
import type { AuditLogClient } from "./SecuritySettings";

export function createIpcAuditClient(): AuditLogClient {
  return {
    async list(query = {}) {
      const reply = await ipcCall<{
        events: readonly {
          id: number;
          ts: string;
          actor: string;
          pillar: string;
          kind: string;
          trusted: boolean;
        }[];
      }>("audit.list", query);
      if (!reply.ok) throw new Error(reply.message);
      return reply.value.events;
    },
    async status() {
      const reply = await ipcCall<{ eventCount: number; droppedCount: number; vaultAvailable: boolean }>(
        "audit.status",
        {},
      );
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
  };
}
