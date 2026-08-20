import { ipcCall } from "../../lib/ipc";
import type {
  FineTuningClient,
  TuningBaseModelDto,
  TuningDatasetDto,
  TuningJobDto,
  TuningPreflightDto,
  TuningStatusDto,
} from "./fineTuningTypes";

export function createIpcFineTuningClient(): FineTuningClient {
  return {
    async status() {
      const reply = await ipcCall<TuningStatusDto>("tuning.status", {});
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
    async provision() {
      const reply = await ipcCall<TuningStatusDto & { ok: boolean }>("tuning.provision", {});
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
    async preflight() {
      const reply = await ipcCall<TuningPreflightDto>("tuning.preflight", {});
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
    async buildDataset(sources: string[], id?: string) {
      const reply = await ipcCall<TuningDatasetDto>("tuning.dataset.build", { sources, id });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
    async listJobs() {
      const reply = await ipcCall<{ jobs: TuningJobDto[] }>("tuning.job.list", {});
      if (!reply.ok) throw new Error(reply.message);
      return reply.value.jobs;
    },
    async startJob(input) {
      const reply = await ipcCall<{ job: TuningJobDto }>("tuning.job.start", input);
      if (!reply.ok) throw new Error(reply.message);
      return reply.value.job;
    },
    async cancelJob(id: string) {
      const reply = await ipcCall<{ job: TuningJobDto | null }>("tuning.job.cancel", { id });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value.job;
    },
    async listBaseModels(hostVramGB?: number) {
      const reply = await ipcCall<{ models: TuningBaseModelDto[] }>("tuning.models.list", {
        hostVramGB,
      });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value.models;
    },
  };
}
