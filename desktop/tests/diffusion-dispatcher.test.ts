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
  embedWorkflow,
  type WorkflowMetadata,
} from "../../core/image/WorkflowMetadata";

describe("diffusion dispatcher", () => {
  beforeEach(() => {
    resetJobIdFactory();
  });

  it("issues a job id and forwards the request payload", async () => {
    setJobIdFactory(() => "job-fixed");
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("txt2img", {
      ok: true,
      offloadStrategy: "keep_on_gpu",
      estimatedSeconds: 12,
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
  });

  it("rethrows runtime errors", async () => {
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setError("img2img", "diffusion-runtime-down");
    await expect(buildJobRequest("img2img", {}, runtime)).rejects.toThrow(
      /diffusion-runtime-down/,
    );
  });

  it("resetJobIdFactory restores deterministic counter behaviour", () => {
    resetJobIdFactory();
    const a = (async () => {
      const runtime = new InMemoryDiffusionRuntime();
      runtime.setResponse("txt2img", {});
      const r = await buildJobRequest("txt2img", {}, runtime);
      return r.jobId;
    })();
    expect(a).toBeInstanceOf(Promise);
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
