import { describe, expect, it } from "vitest";

import {
  DiffusionInpaintRequest,
  DiffusionTxt2ImgRequest,
  IPC_METHODS,
  METHOD_SCHEMAS,
} from "../sidecar/src/protocol";

const REQUIRED_DIFFUSION_METHODS = [
  "diffusion.health",
  "diffusion.version",
  "diffusion.txt2img",
  "diffusion.img2img",
  "diffusion.inpaint",
  "diffusion.outpaint",
  "diffusion.job.drainEvents",
  "diffusion.workflow.extract",
] as const;

describe("diffusion IPC protocol", () => {
  it("registers every required diffusion method", () => {
    for (const method of REQUIRED_DIFFUSION_METHODS) {
      expect(IPC_METHODS).toContain(method);
      expect(METHOD_SCHEMAS[method].implemented).toBe(true);
    }
  });

  it("txt2img requires prompt, dims, steps, cfg, seed", () => {
    const parsed = DiffusionTxt2ImgRequest.parse({
      modelId: "sdxl-turbo",
      prompt: "a fox",
      width: 1024,
      height: 1024,
      steps: 4,
      cfgScale: 1.5,
      seed: 42,
    });
    expect(parsed.sampler).toBe("euler_a");
    expect(parsed.batchSize).toBe(1);
    expect(parsed.latentPreview).toBe(true);
  });

  it("txt2img rejects out-of-range dimensions", () => {
    expect(() =>
      DiffusionTxt2ImgRequest.parse({
        modelId: "sdxl-turbo",
        prompt: "a fox",
        width: 8,
        height: 1024,
        steps: 4,
        cfgScale: 1.5,
        seed: 42,
      }),
    ).toThrow();
  });

  it("inpaint requires sourceImage + mask", () => {
    expect(() =>
      DiffusionInpaintRequest.parse({
        modelId: "sdxl-turbo",
        prompt: "x",
        width: 512,
        height: 512,
        steps: 8,
        cfgScale: 4,
        seed: 1,
      }),
    ).toThrow();
    const ok = DiffusionInpaintRequest.parse({
      modelId: "sdxl-turbo",
      prompt: "x",
      width: 512,
      height: 512,
      steps: 8,
      cfgScale: 4,
      seed: 1,
      sourceImage: "data:image/png;base64,AAAA",
      mask: "data:image/png;base64,AAAA",
    });
    expect(ok.strength).toBeCloseTo(0.85);
  });

  it("txt2img accepts the 2026-08-22 field sampler flow-dpm-solver", () => {
    const parsed = DiffusionTxt2ImgRequest.parse({
      modelId: "sana-sprint-1024",
      prompt: "a fox in snow",
      width: 1024,
      height: 1024,
      steps: 1,
      cfgScale: 1.5,
      sampler: "flow-dpm-solver",
      seed: 42,
    });
    expect(parsed.sampler).toBe("flow-dpm-solver");
  });

  it("LoRA weights are clamped to [-2, 2]", () => {
    expect(() =>
      DiffusionTxt2ImgRequest.parse({
        modelId: "sdxl-turbo",
        prompt: "x",
        width: 512,
        height: 512,
        steps: 8,
        cfgScale: 4,
        seed: 1,
        loras: [{ id: "lora:x", weight: 10 }],
      }),
    ).toThrow();
  });
});
