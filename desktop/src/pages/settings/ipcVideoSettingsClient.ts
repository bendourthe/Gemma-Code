/**
 * v2.3.0 Phase 5 -- production Settings > Video client over sidecar IPC.
 */

import { ipcCall } from "../../lib/ipc";
import type { Video2xPathDto, VideoSettingsClient } from "./videoSettingsTypes";

export function createIpcVideoSettingsClient(): VideoSettingsClient {
  return {
    async getPath(): Promise<Video2xPathDto> {
      const reply = await ipcCall<Video2xPathDto>("video.video2xPath.get", {});
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
    async setPath(path: string): Promise<Video2xPathDto> {
      const reply = await ipcCall<Video2xPathDto>("video.video2xPath.set", { path });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
  };
}
