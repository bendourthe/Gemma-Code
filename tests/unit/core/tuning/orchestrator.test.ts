import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TuningJobStore } from "../../../../core/tuning/jobStore.js";
import { decideEvalGate } from "../../../../core/tuning/evalGate.js";
import { runTuningJob, stubTrainer } from "../../../../core/tuning/orchestrator.js";
import { recipeForVram } from "../../../../core/tuning/recipes.js";

describe("TuningJobStore", () => {
  it("requeues leftover running jobs without duplicating ids", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nexus-jobs-"));
    const file = path.join(dir, "jobs.json");
    const first = new TuningJobStore({ filePath: file, now: () => new Date("2026-08-20T00:00:00Z") });
    first.enqueue({
      id: "j1",
      baseModelId: "gemma4:e4b",
      datasetId: "d1",
      datasetPath: "/tmp/d.jsonl",
    });
    first.patch("j1", { state: "running" });
    const second = new TuningJobStore({ filePath: file });
    expect(second.list()).toHaveLength(1);
    expect(second.list()[0]?.id).toBe("j1");
    expect(second.list()[0]?.state).toBe("queued");
  });

  it("leaves a finished job unchanged on cancel", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nexus-jobs-"));
    const store = new TuningJobStore({ filePath: path.join(dir, "jobs.json") });
    store.enqueue({ id: "j1", baseModelId: "tiny", datasetId: "d", datasetPath: "x" });
    store.patch("j1", { state: "done" });
    expect(store.cancel("j1")?.state).toBe("done");
    expect(store.cancel("missing")).toBeUndefined();
  });

  it("defaults to ~/.nexus/tuning/jobs.json", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "nexus-jobs-home-"));
    const store = new TuningJobStore({ homeDirFn: () => home });
    store.enqueue({ id: "h1", baseModelId: "tiny", datasetId: "d", datasetPath: "x" });
    expect(store.list()).toHaveLength(1);
  });
});

describe("eval gate and orchestrator", () => {
  it("quarantines a regressed adapter", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nexus-run-"));
    const store = new TuningJobStore({ filePath: path.join(dir, "jobs.json") });
    store.enqueue({
      id: "j2",
      baseModelId: "tiny",
      datasetId: "d",
      datasetPath: "x",
    });
    const job = await runTuningJob({
      store,
      trainer: stubTrainer(dir),
      evalPort: {
        async score(id) {
          return id.includes("adapter") ? 0.4 : 0.9;
        },
      },
    });
    expect(job.state).toBe("quarantined");
    expect(job.exportPath).toBeTruthy();
  });

  it("imports on pass and keeps artifacts on export failure", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nexus-run-"));
    const store = new TuningJobStore({ filePath: path.join(dir, "jobs.json") });
    store.enqueue({
      id: "j3",
      baseModelId: "tiny",
      datasetId: "d",
      datasetPath: "x",
    });
    const imported: string[] = [];
    const passed = await runTuningJob({
      store,
      trainer: stubTrainer(dir),
      evalPort: { async score() { return 0.8; } },
      ollama: {
        async importGguf(ggufPath, name) {
          imported.push(`${name}:${ggufPath}`);
        },
      },
    });
    expect(passed.state).toBe("done");
    expect(imported).toHaveLength(1);

    store.enqueue({
      id: "j4",
      baseModelId: "tiny",
      datasetId: "d",
      datasetPath: "x",
    });
    const failed = await runTuningJob({
      store,
      trainer: stubTrainer(dir),
      evalPort: { async score() { return 0.8; } },
      ollama: {
        async importGguf() {
          throw new Error("ollama create failed");
        },
      },
    });
    expect(failed.state).toBe("export-failed");
    expect(failed.exportPath).toBeTruthy();
  });

  it("cancel marks a queued job failed", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nexus-run-"));
    const store = new TuningJobStore({ filePath: path.join(dir, "jobs.json") });
    store.enqueue({ id: "j5", baseModelId: "tiny", datasetId: "d", datasetPath: "x" });
    expect(store.cancel("j5")?.state).toBe("failed");
  });

  it("claims a specific job id and honors an aborted signal", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nexus-run-"));
    const store = new TuningJobStore({ filePath: path.join(dir, "jobs.json") });
    store.enqueue({ id: "keep", baseModelId: "tiny", datasetId: "d", datasetPath: "x" });
    store.enqueue({ id: "run-me", baseModelId: "tiny", datasetId: "d", datasetPath: "x" });
    const ctl = new AbortController();
    ctl.abort();
    const job = await runTuningJob({
      store,
      jobId: "run-me",
      trainer: stubTrainer(dir),
      evalPort: { async score() { return 0.8; } },
      signal: ctl.signal,
    });
    expect(job.id).toBe("run-me");
    expect(job.state).toBe("failed");
    expect(store.get("keep")?.state).toBe("queued");
  });

  it("marks export-failed when the trainer returns no GGUF", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nexus-run-"));
    const store = new TuningJobStore({ filePath: path.join(dir, "jobs.json") });
    store.enqueue({ id: "j6", baseModelId: "tiny", datasetId: "d", datasetPath: "x" });
    const job = await runTuningJob({
      store,
      trainer: { async run() { return { checkpointPath: path.join(dir, "c.json") }; } },
      evalPort: { async score() { return 0.8; } },
    });
    expect(job.state).toBe("export-failed");
  });
});

describe("recipes", () => {
  it("picks the 16 GB preset below 24 GB", () => {
    expect(recipeForVram(16).loraRank).toBe(16);
    expect(recipeForVram(24).loraRank).toBe(32);
  });
});

describe("decideEvalGate", () => {
  it("passes a small gain", () => {
    expect(decideEvalGate({ base: 0.5, adapter: 0.6 }).decision).toBe("pass");
  });
});
