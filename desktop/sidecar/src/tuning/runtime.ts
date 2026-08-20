/**
 * v2.1.0 Phase 5 -- sidecar fine-tuning runtime.
 *
 * Orchestration is Nexus-owned. Unsloth is invoked only through the trainer
 * (stub by default; live subprocess when NEXUS_TUNING_LIVE=1).
 */

import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { TuningJobStore, type TuningJob } from "../../../../core/tuning/jobStore.js";
import { TuningProvisioner, type ProvisionState } from "../../../../core/tuning/provisioner.js";
import { buildDataset } from "../../../../core/tuning/datasetBuilder.js";
import { runTuningJob, stubTrainer, type OllamaImportPort, type Trainer } from "../../../../core/tuning/orchestrator.js";
import type { EvalPort } from "../../../../core/tuning/evalGate.js";
import { recipeForVram } from "../../../../core/tuning/recipes.js";
import { filterTuningBaseModels, type TuningBaseModel } from "../../../../core/tuning/baseModels.js";
import { evaluateTrainingHardware, type TrainingHost } from "../../../../core/tuning/hardwareGate.js";
import { UNSLOTH_PINS } from "../../../../core/tuning/licensePins.js";
import { GpuScheduler } from "../../../../core/scheduler/GpuScheduler.js";
import { InProcessTelemetryBus } from "../../../../core/telemetry/TelemetryBus.js";
import type { ModelSpec } from "../../../../core/registry/catalog.js";
import { loadCatalog } from "../../../../core/registry/catalog.js";
import { nexusHome } from "../../../../core/storage/paths.js";

export function hostFromEnv(
  platform: NodeJS.Platform = process.platform,
): TrainingHost {
  const osFamily =
    platform === "win32" ? "windows" : platform === "darwin" ? "macos" : platform === "linux" ? "linux" : "unknown";
  const gpuVendor = (process.env.NEXUS_GPU_VENDOR ?? "none").toLowerCase();
  const parsed = Number(process.env.NEXUS_VRAM_GB ?? "0");
  const vramGB = Number.isFinite(parsed) ? parsed : 0;
  return { osFamily, gpuVendor, vramGB };
}

export interface TuningRuntime {
  status(): Promise<{
    supported: boolean;
    reason: string;
    provisionStatus: ProvisionState["status"];
    provisionError: string | null;
    vramGB: number;
    gpuVendor: string;
    osFamily: string;
    pins: { name: string; version?: string; license: string }[];
  }>;
  provision(): Promise<{ ok: boolean } & Awaited<ReturnType<TuningRuntime["status"]>>>;
  preflight(): Promise<{ ok: boolean; message: string }>;
  buildDataset(params: { sources: readonly string[]; id?: string }): ReturnType<typeof buildDataset>;
  listJobs(states?: readonly TuningJob["state"][]): readonly TuningJob[];
  startJob(params: {
    id?: string;
    baseModelId: string;
    datasetId: string;
    datasetPath: string;
  }): Promise<TuningJob>;
  cancelJob(id: string): TuningJob | undefined;
  listBaseModels(hostVramGB?: number): Promise<TuningBaseModel[]>;
}

export interface TuningRuntimeOptions {
  readonly host?: TrainingHost;
  readonly homeDirFn?: () => string;
  readonly store?: TuningJobStore;
  readonly provisioner?: TuningProvisioner;
  readonly scheduler?: GpuScheduler;
  readonly trainer?: Trainer;
  readonly evalPort?: EvalPort;
  readonly ollama?: OllamaImportPort;
  readonly catalogModels?: readonly ModelSpec[];
  readonly now?: () => Date;
}

function defaultEvalPort(): EvalPort {
  const base = Number(process.env.NEXUS_TUNING_EVAL_BASE ?? "0.5");
  const adapter = Number(process.env.NEXUS_TUNING_EVAL_ADAPTER ?? "0.5");
  return {
    async score(id: string) {
      return id.includes("#adapter") ? adapter : base;
    },
  };
}

export function createTuningRuntime(opts: TuningRuntimeOptions = {}): TuningRuntime {
  const host = opts.host ?? hostFromEnv();
  const homeDirFn = opts.homeDirFn;
  const root = path.join(nexusHome(homeDirFn), "tuning");
  const store =
    opts.store ??
    new TuningJobStore({
      filePath: path.join(root, "jobs.json"),
      homeDirFn,
      now: opts.now,
    });
  const provisioner =
    opts.provisioner ??
    new TuningProvisioner({
      host,
      root,
      homeDirFn,
    });
  const scheduler =
    opts.scheduler ??
    new GpuScheduler({
      telemetry: new InProcessTelemetryBus(),
      vramProvider: () => host.vramGB || 24,
    });
  const trainer = opts.trainer ?? stubTrainer(path.join(root, "runs"));
  const evalPort = opts.evalPort ?? defaultEvalPort();
  const aborts = new Map<string, AbortController>();

  async function snapshot() {
    const gate = evaluateTrainingHardware(host);
    const state = provisioner.state();
    return {
      supported: gate.supported,
      reason: gate.reason,
      provisionStatus: state.status,
      provisionError: state.error ?? null,
      vramGB: host.vramGB,
      gpuVendor: host.gpuVendor,
      osFamily: host.osFamily,
      pins: UNSLOTH_PINS.provisioned.map((p) => ({
        name: p.name,
        version: p.version,
        license: p.license,
      })),
    };
  }

  return {
    status: snapshot,
    async provision() {
      const state = await provisioner.provision();
      const next = await snapshot();
      return { ...next, ok: state.status === "ready" || state.status === "unsupported" };
    },
    preflight: () => provisioner.preflight(),
    buildDataset(params) {
      return buildDataset({
        sources: params.sources,
        id: params.id,
        homeDirFn,
        now: opts.now,
      });
    },
    listJobs(states) {
      const jobs = store.list();
      if (!states || states.length === 0) return jobs;
      const allow = new Set(states);
      return jobs.filter((j) => allow.has(j.state));
    },
    async startJob(params) {
      const id = params.id ?? `tune-${randomUUID()}`;
      const job = store.enqueue({
        id,
        baseModelId: params.baseModelId,
        datasetId: params.datasetId,
        datasetPath: params.datasetPath,
      });
      const ctl = new AbortController();
      aborts.set(id, ctl);
      const recipe = recipeForVram(host.vramGB || 16);
      try {
        const handle = await scheduler.enqueue({
          moduleId: "tuning",
          jobType: "qlora",
          estimatedVramGB: recipe.vramGB,
          priority: "background",
          id,
          modelId: params.baseModelId,
          run: async (signal) => {
            const linked = new AbortController();
            const onAbort = () => linked.abort();
            ctl.signal.addEventListener("abort", onAbort);
            signal.addEventListener("abort", onAbort);
            try {
              return await runTuningJob({
                store,
                jobId: id,
                trainer,
                evalPort,
                ollama: opts.ollama,
                signal: linked.signal,
              });
            } finally {
              ctl.signal.removeEventListener("abort", onAbort);
              signal.removeEventListener("abort", onAbort);
              aborts.delete(id);
            }
          },
        });
        await handle.completion;
      } catch (err) {
        aborts.delete(id);
        return (
          store.patch(id, {
            state: "failed",
            error: err instanceof Error ? err.message : String(err),
          }) ?? job
        );
      }
      return store.get(id) ?? job;
    },
    cancelJob(id) {
      aborts.get(id)?.abort();
      aborts.delete(id);
      return store.cancel(id);
    },
    async listBaseModels(hostVramGB) {
      const models =
        opts.catalogModels ??
        (await loadCatalog()).models;
      return filterTuningBaseModels(models, { hostVramGB: hostVramGB ?? host.vramGB });
    },
  };
}
