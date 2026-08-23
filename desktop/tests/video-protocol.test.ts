import { describe, expect, it } from "vitest";

import {
  DiffusionVideoAudio2VideoRequest,
  DiffusionVideoImage2VideoRequest,
  DiffusionVideoText2VideoRequest,
  DiffusionVideoWorkflow,
  DiffusionVideoWorkflowExtractRequest,
  IPC_METHODS,
  METHOD_SCHEMAS,
} from "../sidecar/src/protocol";

const REQUIRED_VIDEO_METHODS = [
  "diffusion.video.text2video",
  "diffusion.video.image2video",
  "diffusion.video.audio2video",
  "diffusion.video.workflow.extract",
] as const;

describe("video IPC protocol", () => {
  it("registers every video method", () => {
    for (const method of REQUIRED_VIDEO_METHODS) {
      expect(IPC_METHODS).toContain(method);
      expect(METHOD_SCHEMAS[method].implemented).toBe(true);
    }
  });

  it("text2video requires prompt + duration + fps + dims", () => {
    const parsed = DiffusionVideoText2VideoRequest.parse({
      modelId: "ltx-video",
      prompt: "fox",
      width: 854,
      height: 480,
      durationSeconds: 4,
      fps: 24,
      steps: 30,
      cfgScale: 3.5,
      seed: 7,
    });
    expect(parsed.sampler).toBe("euler_a");
    expect(parsed.latentPreview).toBe(true);
    expect(parsed.durationSeconds).toBe(4);
  });

  it("text2video accepts flow-dpm-solver (Fast Preview / SANA)", () => {
    const parsed = DiffusionVideoText2VideoRequest.parse({
      modelId: "sana-video-2b-720p",
      prompt: "fox",
      width: 1280,
      height: 720,
      durationSeconds: 4,
      fps: 24,
      steps: 30,
      cfgScale: 3.5,
      sampler: "flow-dpm-solver",
      seed: 7,
    });
    expect(parsed.sampler).toBe("flow-dpm-solver");
  });

  it("text2video rejects out-of-range duration", () => {
    expect(() =>
      DiffusionVideoText2VideoRequest.parse({
        modelId: "ltx-video",
        prompt: "fox",
        width: 854,
        height: 480,
        durationSeconds: 11,
        fps: 24,
        steps: 30,
        cfgScale: 3.5,
        seed: 7,
      }),
    ).toThrow();
  });

  it("text2video rejects an invalid fps", () => {
    expect(() =>
      DiffusionVideoText2VideoRequest.parse({
        modelId: "ltx-video",
        prompt: "fox",
        width: 854,
        height: 480,
        durationSeconds: 4,
        fps: 30,
        steps: 30,
        cfgScale: 3.5,
        seed: 7,
      }),
    ).toThrow();
  });

  it("text2video rejects an invalid resolution", () => {
    expect(() =>
      DiffusionVideoText2VideoRequest.parse({
        modelId: "ltx-video",
        prompt: "fox",
        width: 1024,
        height: 1024,
        durationSeconds: 4,
        fps: 24,
        steps: 30,
        cfgScale: 3.5,
        seed: 7,
      }),
    ).toThrow();
  });

  it("image2video requires sourceImage", () => {
    expect(() =>
      DiffusionVideoImage2VideoRequest.parse({
        modelId: "svd",
        prompt: "fox",
        width: 854,
        height: 480,
        durationSeconds: 4,
        fps: 24,
        steps: 30,
        cfgScale: 3.5,
        seed: 7,
      }),
    ).toThrow();
    const ok = DiffusionVideoImage2VideoRequest.parse({
      modelId: "svd",
      prompt: "fox",
      width: 854,
      height: 480,
      durationSeconds: 4,
      fps: 24,
      steps: 30,
      cfgScale: 3.5,
      seed: 7,
      sourceImage: "data:image/png;base64,AAAA",
    });
    expect(ok.sourceImage).toMatch(/^data:image\/png/);
  });

  it("audio2video requires photo, audio, and confirmLocalAvatar", () => {
    const base = {
      modelId: "longcat-video-avatar-1.5",
      prompt: "talk",
      width: 854,
      height: 480,
      durationSeconds: 8,
      fps: 24,
      steps: 30,
      cfgScale: 3.5,
      seed: 7,
    };
    expect(() => DiffusionVideoAudio2VideoRequest.parse(base)).toThrow();
    const ok = DiffusionVideoAudio2VideoRequest.parse({
      ...base,
      sourceImage: "data:image/png;base64,AAAA",
      sourceAudio: "data:audio/wav;base64,BBBB",
      confirmLocalAvatar: true,
    });
    expect(ok.sourceAudio).toMatch(/^data:audio/);
    expect(ok.confirmLocalAvatar).toBe(true);
  });

  it("workflow.extract request requires an mp4Path", () => {
    expect(() => DiffusionVideoWorkflowExtractRequest.parse({})).toThrow();
    const ok = DiffusionVideoWorkflowExtractRequest.parse({ mp4Path: "/tmp/x.mp4" });
    expect(ok.mp4Path).toBe("/tmp/x.mp4");
  });

  it("DiffusionVideoWorkflow parses a valid workflow payload", () => {
    const wf = DiffusionVideoWorkflow.parse({
      tool: "nexus",
      version: "1.0.0",
      kind: "video",
      mode: "text2video",
      modelId: "ltx-video",
      prompt: "fox",
      width: 854,
      height: 480,
      durationSeconds: 4,
      fps: 24,
      frameCount: 96,
      steps: 30,
      cfgScale: 3.5,
      sampler: "euler_a",
      seed: 7,
      timestamp: "2026-05-17T00:00:00Z",
    });
    expect(wf.kind).toBe("video");
    expect(wf.frameCount).toBe(96);
  });

  it("DiffusionVideoWorkflow rejects non-video kind", () => {
    expect(() =>
      DiffusionVideoWorkflow.parse({
        tool: "nexus",
        version: "1.0.0",
        kind: "image",
        mode: "text2video",
        modelId: "ltx-video",
        prompt: "fox",
        width: 854,
        height: 480,
        durationSeconds: 4,
        fps: 24,
        frameCount: 96,
        steps: 30,
        cfgScale: 3.5,
        sampler: "euler_a",
        seed: 7,
        timestamp: "2026-05-17T00:00:00Z",
      }),
    ).toThrow();
  });
});
