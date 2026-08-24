/**
 * v1.16.0 Phase 1.5 (adoption item A1) -- production Local API server client
 * over the sidecar `serving.*` IPC. Both calls are plain request/response; the
 * sidecar owns the listener lifecycle, so the UI only reports and toggles.
 */

import { ipcCall } from "../../lib/ipc";
import type { AcpStatusDto, ServingClient, ServingStatusDto } from "./servingTypes";

export function createIpcServingClient(): ServingClient {
  return {
    async status(): Promise<ServingStatusDto> {
      const reply = await ipcCall<ServingStatusDto>("serving.status", {});
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },

    async setEnabled(enabled: boolean): Promise<ServingStatusDto> {
      const reply = await ipcCall<ServingStatusDto>("serving.setEnabled", { enabled });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },

    async acpStatus(): Promise<AcpStatusDto> {
      const reply = await ipcCall<AcpStatusDto>("acp.status", {});
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },

    async setAcpEnabled(enabled: boolean): Promise<AcpStatusDto> {
      const reply = await ipcCall<AcpStatusDto>("acp.setEnabled", { enabled });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
  };
}
