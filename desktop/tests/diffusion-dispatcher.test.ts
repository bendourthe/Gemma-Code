import { beforeEach, describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";

import {
  buildJobRequest,
  extractWorkflowFromBase64Png,
  resetJobIdFactory,
  setJobIdFactory,
} from "../sidecar/src/diffusion/dispatcher";
import { InMemoryDiffusionRuntime } from "../sidecar/src/diffusion/runtimeClient";
import {
  createMinimalPng,
  createUsablePng,
  embedWorkflow,
  type WorkflowMetadata,
} from "../../core/image/WorkflowMetadata";
import { IMAGE_RUNTIME_NOT_READY } from "../sidecar/src/diffusion/resultGuard";

describe("diffusion dispatcher", () => {
  beforeEach(() => {
    resetJobIdFactory();
  });

  it("issues a job id and forwards the request payload", async () => {
    setJobIdFactory(() => "job-fixed");
    const runtime = new InMemoryDiffusionRuntime();
    const png = createUsablePng().toString("base64");
    runtime.setResponse("txt2img", {
      ok: true,
      offloadStrategy: "keep_on_gpu",
      estimatedSeconds: 12,
      pngBase64: png,
    });
    const result = await buildJobRequest(
      "txt2img",
      { modelId: "sdxl-turbo", prompt: "fox" },
      runtime,
    );
    expect(result.jobId).toBe("job-fixed");
    expect(result.mode).toBe("txt2img");
    expect(result.offloadStrategy).toBe("keep_on_gpu");
    expect(result.estimatedSeconds).toBe(12);
    expect(result.pngBase64).toBe(png);
    expect(runtime.calls[0]?.method).toBe("txt2img");
  });

  it("routes SANA txt2img onto sana.txt2img and returns usable bytes", async () => {
    const runtime = new InMemoryDiffusionRuntime();
    const png = createUsablePng().toString("base64");
    runtime.setResponse("sana.txt2img", { ok: true, pngBase64: png });
    const result = await buildJobRequest(
      "txt2img",
      { modelId: "sana-1.6b-1024", prompt: "fox" },
      runtime,
    );
    expect(result.pngBase64).toBe(png);
    expect(runtime.calls[0]?.method).toBe("sana.txt2img");
  });

  it("treats an empty or 1x1 PNG as a typed runtime-not-ready error", async () => {
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("txt2img", { ok: true });
    await expect(
      buildJobRequest("txt2img", { modelId: "sdxl-turbo", prompt: "fox" }, runtime),
    ).rejects.toThrow(IMAGE_RUNTIME_NOT_READY);
  });

  it("rethrows runtime errors", async () => {
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setError("img2img", "diffusion-runtime-down");
    await expect(
      buildJobRequest("img2img", { sourceImage: "data:image/png;base64,AAAA" }, runtime),
    ).rejects.toThrow(/diffusion-runtime-down/);
  });

  it("rejects img2img without source bytes before calling the runtime", async () => {
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("img2img", { ok: true, pngBase64: createUsablePng().toString("base64") });
    await expect(buildJobRequest("img2img", { modelId: "sdxl-turbo" }, runtime)).rejects.toThrow(
      /source image bytes/,
    );
    expect(runtime.calls).toHaveLength(0);
  });

  it("resetJobIdFactory restores deterministic counter behaviour", async () => {
    resetJobIdFactory();
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("txt2img", { pngBase64: createUsablePng().toString("base64") });
    const first = await buildJobRequest("txt2img", { modelId: "sdxl-turbo" }, runtime);
    const second = await buildJobRequest("txt2img", { modelId: "sdxl-turbo" }, runtime);
    expect(first.jobId).toMatch(/^job-/);
    expect(second.jobId).toMatch(/^job-/);
    expect(first.jobId).not.toBe(second.jobId);
  });

  it("extractWorkflowFromBase64Png reads embedded metadata", () => {
    const wf: WorkflowMetadata = {
      tool: "nexus",
      version: "1.0.0",
      mode: "txt2img",
      prompt: "a fox",
      modelId: "sdxl-turbo",
      width: 512,
      height: 512,
      steps: 4,
      cfgScale: 1.5,
      sampler: "euler_a",
      seed: 7,
      timestamp: "2026-05-17T00:00:00Z",
    };
    const embedded = embedWorkflow(createMinimalPng(), wf);
    const base64 = Buffer.from(embedded).toString("base64");
    const extracted = extractWorkflowFromBase64Png(base64);
    expect(extracted?.prompt).toBe("a fox");
  });

  it("extractWorkflowFromBase64Png returns null for malformed input", () => {
    expect(extractWorkflowFromBase64Png("not-base64-but-decodes-to-junk")).toBeNull();
  });
});
