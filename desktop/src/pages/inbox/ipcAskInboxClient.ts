/**
 * v1.18.0 Phase 4 (OW-A1) -- production ask-inbox client over sidecar IPC.
 */

import { ipcCall } from "../../lib/ipc";
import type { AskInboxClient, ParkedAskDto, ScheduledRunDto } from "./askInboxTypes";

export function createIpcAskInboxClient(): AskInboxClient {
  return {
    async list(state) {
      const reply = await ipcCall<{ asks: ParkedAskDto[] }>(
        "ask.inbox.list",
        state ? { state } : {},
      );
      if (!reply.ok) throw new Error(reply.message);
      return reply.value.asks;
    },
    async approve(id) {
      const reply = await ipcCall<{ ok: boolean; reason: string }>("ask.inbox.approve", { id });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
    async deny(id) {
      const reply = await ipcCall<{ ok: boolean; reason: string }>("ask.inbox.deny", { id });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
    async pendingCount() {
      const reply = await ipcCall<{ pending: number }>("ask.inbox.pendingCount", {});
      if (!reply.ok) return 0;
      return reply.value.pending;
    },
    async listSchedules() {
      const reply = await ipcCall<{ schedules: ScheduledRunDto[] }>("ask.scheduler.list", {});
      if (!reply.ok) throw new Error(reply.message);
      return reply.value.schedules;
    },
    async setScheduleEnabled(id, enabled) {
      const reply = await ipcCall<{ ok: boolean }>("ask.scheduler.setEnabled", { id, enabled });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
  };
}
