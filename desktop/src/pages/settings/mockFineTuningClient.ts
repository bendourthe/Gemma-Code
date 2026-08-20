import type {
  FineTuningClient,
  TuningBaseModelDto,
  TuningDatasetDto,
  TuningJobDto,
  TuningPreflightDto,
  TuningStatusDto,
} from "./fineTuningTypes";

const UNSUPPORTED: TuningStatusDto = {
  supported: false,
  reason: "GPU vendor 'none' is not in the training allowlist (NVIDIA, or AMD on Linux).",
  provisionStatus: "pending",
  provisionError: null,
  vramGB: 8,
  gpuVendor: "none",
  osFamily: "windows",
  pins: [
    { name: "unsloth", version: "2026.8.18", license: "Apache-2.0" },
    { name: "unsloth-zoo", version: "2026.8.13", license: "LGPL-3.0-or-later" },
  ],
};

const SUPPORTED: TuningStatusDto = {
  supported: true,
  reason: "NVIDIA GPU with enough VRAM.",
  provisionStatus: "pending",
  provisionError: null,
  vramGB: 24,
  gpuVendor: "nvidia",
  osFamily: "windows",
  pins: UNSUPPORTED.pins,
};

export function createMockFineTuningClient(
  initial: Partial<TuningStatusDto> = {},
): FineTuningClient {
  let status: TuningStatusDto = { ...SUPPORTED, ...initial };
  let jobs: TuningJobDto[] = [];
  let dataset: TuningDatasetDto | null = null;

  return {
    async status() {
      return status;
    },
    async provision() {
      status = { ...status, provisionStatus: status.supported ? "ready" : "unsupported" };
      return { ...status, ok: true };
    },
    async preflight(): Promise<TuningPreflightDto> {
      if (status.provisionStatus !== "ready") {
        return { ok: false, message: "tuning venv python is missing; re-provision from Settings." };
      }
      return { ok: true, message: "ok" };
    },
    async buildDataset(sources: string[], id?: string) {
      dataset = {
        id: id ?? "ds-mock",
        outputPath: "/tmp/train.jsonl",
        written: sources.length,
        redacted: 1,
        skipped: [],
        preview: [{ messages: [{ role: "user", content: "hello <redacted>" }] }],
      };
      return dataset;
    },
    async listJobs() {
      return jobs;
    },
    async startJob(input) {
      const job: TuningJobDto = {
        id: "j-mock",
        baseModelId: input.baseModelId,
        datasetId: input.datasetId,
        datasetPath: input.datasetPath,
        state: "done",
        error: null,
        checkpointPath: "/tmp/ckpt.json",
        exportPath: "/tmp/adapter.gguf",
        evalDelta: 0,
        createdAt: "2026-08-20T00:00:00Z",
        updatedAt: "2026-08-20T00:00:00Z",
      };
      jobs = [job];
      return job;
    },
    async cancelJob(id) {
      const job = jobs.find((j) => j.id === id);
      if (!job) return null;
      const next = { ...job, state: "failed" as const, error: "cancelled" };
      jobs = jobs.map((j) => (j.id === id ? next : j));
      return next;
    },
    async listBaseModels(): Promise<TuningBaseModelDto[]> {
      return [{ id: "gemma4:e4b", displayName: "Gemma 4 E4B", codingEligible: true, vision: false, requiredVramGB: 6 }];
    },
  };
}

export { UNSUPPORTED as MOCK_UNSUPPORTED_TUNING, SUPPORTED as MOCK_SUPPORTED_TUNING };
