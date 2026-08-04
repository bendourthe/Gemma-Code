/**
 * v1.15.0 Phase 4 (Issue 3) -- production Models client over the sidecar
 * `models.*` IPC. Replaces the hardcoded `createMockModelsClient` in the
 * shipped app so Settings > Models reflects and manages the real installed set.
 *
 * `list` / `remove` / `diskUsage` are request/response. `install` mirrors the
 * diffusion job pattern: start the install (accept -> job id), poll
 * `models.install.drainEvents` for buffered progress + a terminal event, and
 * `cancel` aborts it -- so a multi-minute download never blocks the IPC channel.
 */

import { ipcCall } from "../../lib/ipc";
import type { DiskUsageDto, ListedModelDto } from "./modelsTypes";
import type { InstallHandle, ModelsClient } from "./ModelsSettings";

interface InstallEventDto {
  kind: "progress" | "complete" | "error";
  id: string;
  bytes?: number;
  total?: number | null;
  message?: string;
}

/** Poll cadence for install progress; downloads are minutes-long so this is coarse. */
const POLL_MS = 400;

export function createIpcModelsClient(): ModelsClient {
  return {
    async list(): Promise<readonly ListedModelDto[]> {
      const reply = await ipcCall<{ models: ListedModelDto[] }>("models.list", {});
      if (!reply.ok) throw new Error(reply.message);
      return reply.value.models;
    },

    install(id, onProgress) {
      let cancelled = false;
      let jobId: string | null = null;
      let timer: ReturnType<typeof setInterval> | null = null;

      const stop = (): void => {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      };

      const done = new Promise<void>((resolve, reject) => {
        void (async () => {
          const started = await ipcCall<{ jobId: string }>("models.install", { id });
          if (!started.ok) {
            reject(new Error(started.message));
            return;
          }
          jobId = started.value.jobId;
          if (cancelled) {
            void ipcCall("models.install.cancel", { jobId });
          }
          timer = setInterval(() => {
            void (async () => {
              if (!jobId) return;
              const drained = await ipcCall<{ events: InstallEventDto[]; done: boolean }>(
                "models.install.drainEvents",
                { jobId },
              );
              if (!drained.ok) {
                stop();
                reject(new Error(drained.message));
                return;
              }
              for (const ev of drained.value.events) {
                if (ev.kind === "progress") {
                  onProgress({ id: ev.id, bytes: ev.bytes ?? 0, total: ev.total ?? null });
                } else if (ev.kind === "error") {
                  stop();
                  reject(new Error(ev.message ?? "install failed"));
                  return;
                } else if (ev.kind === "complete") {
                  stop();
                  resolve();
                  return;
                }
              }
              if (drained.value.done) {
                stop();
                resolve();
              }
            })();
          }, POLL_MS);
        })();
      });

      const handle: InstallHandle = {
        cancel() {
          cancelled = true;
          stop();
          if (jobId) void ipcCall("models.install.cancel", { jobId });
        },
      };
      return Object.assign(handle, { done });
    },

    async remove(id: string): Promise<void> {
      const reply = await ipcCall("models.remove", { id });
      if (!reply.ok) throw new Error(reply.message);
    },

    async diskUsage(): Promise<DiskUsageDto> {
      const reply = await ipcCall<DiskUsageDto>("models.diskUsage", {});
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
  };
}
