/**
 * v2.1.0 Phase 5 -- Settings > Fine-tuning types (sidecar `tuning.*`).
 */

export type TuningProvisionStatus = "pending" | "ready" | "failed" | "unsupported";

export type TuningJobState =
  | "queued"
  | "running"
  | "interrupted"
  | "done"
  | "failed"
  | "quarantined"
  | "export-failed";

export interface TuningPinDto {
  name: string;
  version?: string;
  license: string;
}

export interface TuningStatusDto {
  supported: boolean;
  reason: string;
  provisionStatus: TuningProvisionStatus;
  provisionError: string | null;
  vramGB: number;
  gpuVendor: string;
  osFamily: string;
  pins: TuningPinDto[];
}

export interface TuningPreflightDto {
  ok: boolean;
  message: string;
}

export interface TuningChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TuningDatasetDto {
  id: string;
  outputPath: string;
  written: number;
  redacted: number;
  skipped: { path: string; reason: string }[];
  preview: { messages: TuningChatTurn[] }[];
}

export interface TuningJobDto {
  id: string;
  baseModelId: string;
  datasetId: string;
  datasetPath: string;
  state: TuningJobState;
  error: string | null;
  checkpointPath: string | null;
  exportPath: string | null;
  evalDelta: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TuningBaseModelDto {
  id: string;
  displayName: string;
  codingEligible: boolean;
  vision: boolean;
  requiredVramGB: number | null;
}

export interface FineTuningClient {
  status(): Promise<TuningStatusDto>;
  provision(): Promise<TuningStatusDto & { ok: boolean }>;
  preflight(): Promise<TuningPreflightDto>;
  buildDataset(sources: string[], id?: string): Promise<TuningDatasetDto>;
  listJobs(): Promise<TuningJobDto[]>;
  startJob(input: {
    baseModelId: string;
    datasetId: string;
    datasetPath: string;
  }): Promise<TuningJobDto>;
  cancelJob(id: string): Promise<TuningJobDto | null>;
  listBaseModels(hostVramGB?: number): Promise<TuningBaseModelDto[]>;
}
