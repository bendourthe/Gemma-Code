import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { dispatch, createHandlerContext } from "../sidecar/src/handlers";
import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";
import { createTuningRuntime } from "../sidecar/src/tuning/runtime";
import { IPC_METHODS, METHOD_SCHEMAS } from "../sidecar/src/protocol";
import { stubTrainer } from "../../core/tuning/orchestrator.js";
import type { ModelSpec } from "../../core/registry/catalog.js";

const TINY: ModelSpec = {
  id: "tiny",
  family: "gemma",
  name: "tiny",
  tag: "latest",
  type: "llm",
  displayName: "Tiny",
  source: { protocol: "ollama" },
  codingEligible: true,
  vision: false,
  requiredVramGB: 4,
};

function makeCtx() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nexus-tune-ipc-"));
  const ctx = createHandlerContext(
    { pid: 1, platform: process.platform },
    new CodingSessionManager({
      now: () => new Date("2026-05-17T11:00:00Z"),
      idFactory: (() => {
        let i = 0;
        return () => `s-${++i}`;
      })(),
    }),
  );
  ctx.tuning = createTuningRuntime({
    host: { osFamily: "windows", gpuVendor: "nvidia", vramGB: 24 },
    homeDirFn: () => dir,
    trainer: stubTrainer(path.join(dir, "runs")),
    catalogModels: [TINY],
    evalPort: { async score() { return 0.7; } },
  });
  return { ctx, dir };
}

describe("tuning IPC", () => {
  it("registers tuning methods as implemented", () => {
    for (const method of [
      "tuning.status",
      "tuning.provision",
      "tuning.preflight",
      "tuning.dataset.build",
      "tuning.job.start",
      "tuning.job.list",
      "tuning.job.cancel",
      "tuning.models.list",
    ] as const) {
      expect(IPC_METHODS).toContain(method);
      expect(METHOD_SCHEMAS[method].implemented).toBe(true);
    }
  });

  it("hides unsupported hosts and lists coding-eligible bases", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nexus-tune-hid-"));
    const ctx = createHandlerContext({ pid: 1, platform: process.platform });
    ctx.tuning = createTuningRuntime({
      host: { osFamily: "macos", gpuVendor: "apple", vramGB: 32 },
      homeDirFn: () => dir,
      catalogModels: [TINY],
    });
    const status = (await dispatch("tuning.status", {}, ctx)) as { supported: boolean };
    expect(status.supported).toBe(false);
    const models = (await dispatch("tuning.models.list", { hostVramGB: 24 }, ctx)) as {
      models: { id: string }[];
    };
    expect(models.models.map((m) => m.id)).toEqual(["tiny"]);
  });

  it("builds a redacted dataset and completes a stub job", async () => {
    const { ctx, dir } = makeCtx();
    writeFileSync(
      path.join(dir, "chat.jsonl"),
      `${JSON.stringify({ messages: [{ role: "user", content: "key AKIAIOSFODNN7EXAMPLE" }] })}\n`,
    );
    const built = (await dispatch(
      "tuning.dataset.build",
      { sources: [path.join(dir, "chat.jsonl")], id: "ds1" },
      ctx,
    )) as { written: number; redacted: number; outputPath: string; preview: { messages: { content: string }[] }[] };
    expect(built.written).toBe(1);
    expect(built.redacted).toBe(1);
    expect(built.preview[0]?.messages[0]?.content).not.toContain("AKIAIOSFODNN7EXAMPLE");

    const started = (await dispatch(
      "tuning.job.start",
      {
        id: "job-1",
        baseModelId: "tiny",
        datasetId: "ds1",
        datasetPath: built.outputPath,
      },
      ctx,
    )) as { job: { state: string; id: string } };
    expect(started.job.id).toBe("job-1");
    expect(["done", "quarantined", "export-failed"]).toContain(started.job.state);

    const listed = (await dispatch("tuning.job.list", {}, ctx)) as { jobs: { id: string }[] };
    expect(listed.jobs.map((j) => j.id)).toEqual(["job-1"]);
  });

  it("quarantines a regressed adapter and keeps the export", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nexus-tune-q-"));
    const ctx = createHandlerContext({ pid: 1, platform: process.platform });
    ctx.tuning = createTuningRuntime({
      host: { osFamily: "linux", gpuVendor: "nvidia", vramGB: 24 },
      homeDirFn: () => dir,
      trainer: stubTrainer(path.join(dir, "runs")),
      evalPort: {
        async score(id: string) {
          return id.includes("#adapter") ? 0.1 : 0.9;
        },
      },
    });
    const started = (await dispatch(
      "tuning.job.start",
      {
        id: "bad",
        baseModelId: "tiny",
        datasetId: "d",
        datasetPath: path.join(dir, "x.jsonl"),
      },
      ctx,
    )) as { job: { state: string; exportPath: string | null } };
    expect(started.job.state).toBe("quarantined");
    expect(started.job.exportPath).toBeTruthy();
  });
});
