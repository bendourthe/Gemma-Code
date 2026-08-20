/**
 * v2.1.0 Phase 5 -- QLoRA job orchestration (Nexus-owned). The Unsloth
 * library is invoked only through the injected trainer.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { decideEvalGate, type EvalPort } from "./evalGate.js";
import type { TuningJob, TuningJobStore } from "./jobStore.js";

export interface TrainerResult {
  readonly checkpointPath: string;
  readonly exportPath?: string;
}

export interface Trainer {
  run(job: TuningJob, signal: AbortSignal): Promise<TrainerResult>;
}

export interface OllamaImportPort {
  importGguf(ggufPath: string, name: string): Promise<void>;
}

export interface RunTuningOptions {
  readonly store: TuningJobStore;
  readonly evalPort: EvalPort;
  readonly trainer: Trainer;
  readonly ollama?: OllamaImportPort;
  readonly signal?: AbortSignal;
  readonly maxRegression?: number;
  /** When set, claim this queued id instead of the oldest queued row. */
  readonly jobId?: string;
}

export function stubTrainer(rootDir: string): Trainer {
  return {
    async run(job) {
      const dir = path.join(rootDir, job.id);
      mkdirSync(dir, { recursive: true });
      const checkpointPath = path.join(dir, "checkpoint.json");
      const exportPath = path.join(dir, `${job.baseModelId.replace(/[^a-z0-9._-]+/gi, "-")}-qlora.gguf`);
      writeFileSync(checkpointPath, JSON.stringify({ jobId: job.id, ok: true }));
      writeFileSync(exportPath, "GGUF-STUB\n");
      return { checkpointPath, exportPath };
    },
  };
}

function claimJob(store: TuningJobStore, jobId?: string): TuningJob | undefined {
  if (!jobId) return store.claimNext();
  const current = store.get(jobId);
  if (!current || current.state !== "queued") return undefined;
  return store.patch(jobId, { state: "running" });
}

export async function runTuningJob(opts: RunTuningOptions): Promise<TuningJob> {
  const claimed = claimJob(opts.store, opts.jobId);
  if (!claimed) {
    throw new Error("No queued tuning job.");
  }
  const signal = opts.signal ?? new AbortController().signal;
  try {
    if (signal.aborted) throw new Error("cancelled");
    const trained = await opts.trainer.run(claimed, signal);
    if (signal.aborted) throw new Error("cancelled");
    opts.store.patch(claimed.id, {
      checkpointPath: trained.checkpointPath,
      exportPath: trained.exportPath ?? null,
    });
    const base = await opts.evalPort.score(claimed.baseModelId);
    const adapter = await opts.evalPort.score(`${claimed.baseModelId}#adapter`);
    const { decision, delta } = decideEvalGate({ base, adapter }, opts.maxRegression);
    if (decision === "quarantine") {
      return opts.store.patch(claimed.id, {
        state: "quarantined",
        evalDelta: delta,
        error: `adapter regressed by ${delta.toFixed(3)} vs base`,
      })!;
    }
    if (!trained.exportPath) {
      return opts.store.patch(claimed.id, {
        state: "export-failed",
        evalDelta: delta,
        error: "trainer produced no GGUF",
      })!;
    }
    if (opts.ollama) {
      try {
        await opts.ollama.importGguf(trained.exportPath, `${claimed.baseModelId}-ft`);
      } catch (err) {
        return opts.store.patch(claimed.id, {
          state: "export-failed",
          evalDelta: delta,
          exportPath: trained.exportPath,
          error: err instanceof Error ? err.message : String(err),
        })!;
      }
    }
    return opts.store.patch(claimed.id, {
      state: "done",
      evalDelta: delta,
      exportPath: trained.exportPath,
    })!;
  } catch (err) {
    return opts.store.patch(claimed.id, {
      state: "failed",
      error: err instanceof Error ? err.message : String(err),
    })!;
  }
}
