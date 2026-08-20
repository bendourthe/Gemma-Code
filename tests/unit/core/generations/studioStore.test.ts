import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { expandBatch, MAX_BATCH_EXPANSION } from "../../../../core/generations/batchExpand.js";
import { contentHash } from "../../../../core/generations/contentHash.js";
import { GenerationIndex } from "../../../../core/generations/GenerationIndex.js";
import { GenerationQueue } from "../../../../core/generations/GenerationQueue.js";
import { resolveStudioDbPath } from "../../../../core/generations/paths.js";
import { pumpOnce } from "../../../../core/generations/queuePump.js";
import { redactWorkflow } from "../../../../core/generations/redactWorkflow.js";
import { GpuScheduler } from "../../../../core/scheduler/GpuScheduler.js";
import { InProcessTelemetryBus } from "../../../../core/telemetry/TelemetryBus.js";
import { createMinimalPng, embedWorkflow, extractWorkflow } from "../../../../core/image/WorkflowMetadata.js";
import type { WorkflowMetadata } from "../../../../core/image/WorkflowMetadata.js";

const indexes: GenerationIndex[] = [];
const queues: GenerationQueue[] = [];

afterEach(() => {
  for (const i of indexes) i.close();
  indexes.length = 0;
  for (const q of queues) q.close();
  queues.length = 0;
});

function sampleWf(over: Partial<WorkflowMetadata> = {}): WorkflowMetadata {
  return {
    tool: "nexus",
    version: "1.0.0",
    mode: "txt2img",
    prompt: "a fox",
    modelId: "sana-1.6b-1024",
    width: 1024,
    height: 1024,
    steps: 4,
    cfgScale: 1.5,
    sampler: "euler_a",
    seed: 1,
    timestamp: "2026-08-20T00:00:00Z",
    ...over,
  };
}

describe("expandBatch", () => {
  it("expands an inclusive seed range", () => {
    const jobs = expandBatch({ prompt: "fox", seed: 0 }, { kind: "seed-range", start: 1, end: 3 });
    expect(jobs.map((j) => j.seed)).toEqual([1, 2, 3]);
  });

  it("expands a prompt matrix", () => {
    const jobs = expandBatch(
      { seed: 9 },
      { kind: "prompt-matrix", prompts: ["a", "b"], negatives: ["x"] },
    );
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ prompt: "a", negativePrompt: "x", seed: 9 });
  });

  it("rejects expansions above the cap", () => {
    expect(() =>
      expandBatch({}, { kind: "seed-range", start: 1, end: MAX_BATCH_EXPANSION + 1 }),
    ).toThrow(/64/);
  });

  it("expands a combined seed-and-prompt matrix", () => {
    const jobs = expandBatch(
      {},
      { kind: "combined", seedStart: 1, seedEnd: 2, prompts: ["a"], negatives: ["x"] },
    );
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ prompt: "a", negativePrompt: "x", seed: 1 });
    expect(jobs[1]).toMatchObject({ seed: 2 });
  });

  it("returns the base job when a combined spec has no axes", () => {
    expect(expandBatch({ prompt: "solo" }, { kind: "combined" })).toEqual([{ prompt: "solo" }]);
  });
});

describe("resolveStudioDbPath", () => {
  it("nests studio.db under ~/.nexus/generations", () => {
    const db = resolveStudioDbPath(() => path.join("/tmp", "nexus-home"));
    expect(db.replaceAll("\\", "/")).toMatch(/generations\/studio\.db$/);
  });
});

describe("GenerationIndex", () => {
  it("round-trips redacted workflow keyed by content hash", () => {
    const index = new GenerationIndex({ dbPath: ":memory:" });
    indexes.push(index);
    const png = embedWorkflow(createMinimalPng(), sampleWf({ prompt: "fox AKIAABCDEFGHIJKLMNOP" }));
    const stored = index.put(png, "image", sampleWf({ prompt: "fox AKIAABCDEFGHIJKLMNOP" }));
    expect(stored.workflow.prompt).toContain("<redacted>");
    expect(stored.workflow.prompt).not.toContain("AKIA");
    const got = index.getByBytes(png);
    expect(got?.workflow.prompt).toBe(stored.workflow.prompt);
    expect(got?.contentHash).toBe(contentHash(png));
  });

  it("is the fallback when PNG embed is missing", () => {
    const index = new GenerationIndex({ dbPath: ":memory:" });
    indexes.push(index);
    const bare = createMinimalPng();
    expect(extractWorkflow(bare)).toBeNull();
    index.put(bare, "image", sampleWf({ prompt: "indexed only" }));
    expect(index.getByBytes(bare)?.workflow.prompt).toBe("indexed only");
  });

  it("creates the parent directory for an on-disk database", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nexus-gen-"));
    const dbPath = path.join(dir, "nested", "studio.db");
    const index = new GenerationIndex({ dbPath });
    indexes.push(index);
    index.put("bytes", "image", sampleWf());
    expect(index.get(contentHash("bytes"))?.pillar).toBe("image");
    index.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for an unknown hash", () => {
    const index = new GenerationIndex({ dbPath: ":memory:" });
    indexes.push(index);
    expect(index.get("deadbeef")).toBeNull();
  });
});

describe("redactWorkflow", () => {
  it("scrubs prompt and negativePrompt only", () => {
    const out = redactWorkflow({
      prompt: "see ghp_abcdefghijklmnopqrstuvwxyzabcdefghij",
      negativePrompt: "x",
      seed: 3,
    });
    expect(String(out.prompt)).toContain("<redacted>");
    expect(out.seed).toBe(3);
  });
});

describe("GenerationQueue", () => {
  it("re-queues interrupted jobs on recover without duplicating ids", () => {
    const q = new GenerationQueue({ dbPath: ":memory:" });
    queues.push(q);
    q.enqueue({
      id: "job-a",
      pillar: "image",
      jobType: "txt2img",
      parameters: { prompt: "fox" },
    });
    q.markRunning("job-a");
    q.recover();
    expect(q.get("job-a")?.state).toBe("queued");
    q.recover();
    expect(q.list(["queued"])).toHaveLength(1);
  });

  it("expands a seed batch into child jobs", () => {
    const q = new GenerationQueue({ dbPath: ":memory:" });
    queues.push(q);
    const kids = q.enqueueBatch({
      id: "batch-1",
      pillar: "image",
      jobType: "txt2img",
      parameters: { prompt: "fox" },
      batchSpec: { kind: "seed-range", start: 1, end: 2 },
    });
    expect(kids).toHaveLength(2);
    expect(kids[0]?.id).toBe("batch-1");
    expect(kids[1]?.id).toBe("batch-1:1");
    expect(kids.map((k) => k.parameters.seed)).toEqual([1, 2]);
  });

  it("cancel marks the job failed", () => {
    const q = new GenerationQueue({ dbPath: ":memory:" });
    queues.push(q);
    q.enqueue({ id: "c", pillar: "image", jobType: "txt2img", parameters: {} });
    expect(q.cancel("c")?.error).toBe("cancelled");
    expect(q.pendingCount()).toBe(0);
  });

  it("reorder updates sort_order", () => {
    const q = new GenerationQueue({ dbPath: ":memory:" });
    queues.push(q);
    q.enqueue({ id: "a", pillar: "image", jobType: "txt2img", parameters: {}, priority: "batch" });
    q.enqueue({ id: "b", pillar: "image", jobType: "txt2img", parameters: {}, priority: "batch" });
    q.reorder(["b", "a"]);
    expect(q.list(["queued"]).map((j) => j.id)).toEqual(["b", "a"]);
  });

  it("serves interactive jobs before batch", () => {
    const q = new GenerationQueue({ dbPath: ":memory:" });
    queues.push(q);
    q.enqueue({
      id: "batch",
      pillar: "image",
      jobType: "txt2img",
      parameters: {},
      priority: "batch",
    });
    q.enqueue({
      id: "live",
      pillar: "image",
      jobType: "txt2img",
      parameters: {},
      priority: "interactive",
    });
    expect(q.nextQueued()?.id).toBe("live");
  });
});

describe("pumpOnce + GpuScheduler", () => {
  it("runs interactive before batch and waits behind a coding occupant", async () => {
    const q = new GenerationQueue({ dbPath: ":memory:" });
    queues.push(q);
    const order: string[] = [];
    const bus = new InProcessTelemetryBus();
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 24 });
    sched.setForegroundModule("coding");
    const coding = await sched.enqueue({
      moduleId: "coding",
      jobType: "tokens",
      estimatedVramGB: 4,
      priority: "foreground",
      run: async () => {
        order.push("coding-start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("coding");
        return "ok";
      },
    });
    q.enqueue({
      id: "batch",
      pillar: "image",
      jobType: "txt2img",
      parameters: { prompt: "b" },
      priority: "batch",
    });
    q.enqueue({
      id: "live",
      pillar: "image",
      jobType: "txt2img",
      parameters: { prompt: "a" },
      priority: "interactive",
    });
    const first = pumpOnce(q, {
      scheduler: sched,
      run: async (job) => {
        order.push(job.id);
        return { workflow: { prompt: job.parameters.prompt } };
      },
    });
    const second = pumpOnce(q, {
      scheduler: sched,
      run: async (job) => {
        order.push(job.id);
        return { workflow: { prompt: job.parameters.prompt } };
      },
    });
    await coding.completion;
    await first;
    await second;
    expect(order[0]).toBe("coding-start");
    expect(order).toContain("coding");
    expect(order.indexOf("coding")).toBeLessThan(order.indexOf("live"));
    expect(order.indexOf("live")).toBeLessThan(order.indexOf("batch"));
    expect(q.get("live")?.state).toBe("done");
    expect(q.get("batch")?.state).toBe("done");
  });

  it("returns null when the queue is empty", async () => {
    const q = new GenerationQueue({ dbPath: ":memory:" });
    queues.push(q);
    expect(await pumpOnce(q, { run: async () => ({}) })).toBeNull();
  });

  it("indexes pngBase64 when the runner omits workflow", async () => {
    const q = new GenerationQueue({ dbPath: ":memory:" });
    queues.push(q);
    const index = new GenerationIndex({ dbPath: ":memory:" });
    indexes.push(index);
    const png = createMinimalPng();
    q.enqueue({ id: "png-only", pillar: "image", jobType: "txt2img", parameters: { prompt: "p" } });
    await pumpOnce(q, {
      index,
      run: async () => ({ pngBase64: png.toString("base64") }),
    });
    expect(q.get("png-only")?.state).toBe("done");
    expect(index.getByBytes(png)?.workflow.prompt).toBe("p");
  });

  it("marks the job failed when the runner throws", async () => {
    const q = new GenerationQueue({ dbPath: ":memory:" });
    queues.push(q);
    q.enqueue({ id: "boom", pillar: "video", jobType: "txt2vid", parameters: {} });
    const done = await pumpOnce(q, {
      estimatedVramGB: () => 9,
      run: async () => {
        throw new Error("pipeline down");
      },
    });
    expect(done?.state).toBe("failed");
    expect(done?.error).toBe("pipeline down");
  });
});
