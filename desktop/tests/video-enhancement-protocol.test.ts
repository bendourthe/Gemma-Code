import { describe, expect, it } from "vitest";

import {
  IPC_METHODS,
  METHOD_SCHEMAS,
  VideoEnhancementCapabilityResponse,
  VideoEnhancementEnqueueRequest,
  VideoEnhancementJob,
  VideoEnhancementRequest,
} from "../sidecar/src/protocol";

const SOURCE = Object.freeze({
  path: "C:\\nexus\\outputs\\source.mp4",
  sha256: "a".repeat(64),
  sizeBytes: 1_024,
  durationSeconds: 4,
  width: 854,
  height: 480,
  frameRate: { numerator: 24, denominator: 1 },
});

const REQUEST = Object.freeze({
  requestId: "11111111-1111-4111-8111-111111111111",
  parentJobId: "video-parent",
  source: SOURCE,
  requestedAt: "2026-08-28T12:00:00.000Z",
  timeoutMs: 60_000,
  mode: "upscale" as const,
  upscalePreset: "animation-upscale-2x" as const,
});

describe("video enhancement IPC protocol", () => {
  it("registers every enhancement method as implemented", () => {
    for (const method of [
      "video.enhancement.capability",
      "video.enhancement.enqueue",
      "video.enhancement.list",
      "video.enhancement.cancel",
      "video.video2xPath.get",
      "video.video2xPath.set",
    ] as const) {
      expect(IPC_METHODS).toContain(method);
      expect(METHOD_SCHEMAS[method].implemented).toBe(true);
    }
  });

  it("accepts canonical preset IDs and rejects legacy aliases", () => {
    expect(VideoEnhancementRequest.parse(REQUEST)).toMatchObject(REQUEST);
    expect(() =>
      VideoEnhancementRequest.parse({
        ...REQUEST,
        upscalePreset: "animation-2x",
      }),
    ).toThrow();
  });

  it("validates mode-specific enqueue fields strictly", () => {
    expect(
      VideoEnhancementEnqueueRequest.parse({
        parentJobId: "video-parent",
        sourceOutputId: "video-output",
        mode: "upscale_interpolate",
        upscalePreset: "general-upscale-4x",
        interpolationPreset: "smooth-2x",
        idempotencyKey: "enhance-once",
      }),
    ).toMatchObject({ mode: "upscale_interpolate" });
    expect(() =>
      VideoEnhancementEnqueueRequest.parse({
        parentJobId: "video-parent",
        sourceOutputId: "video-output",
        mode: "interpolate",
        interpolationPreset: "smooth-2x",
        upscalePreset: "general-upscale-4x",
      }),
    ).toThrow();
    expect(() =>
      VideoEnhancementEnqueueRequest.parse({
        parentJobId: "video-parent",
        sourceOutputId: "video-output",
        mode: "upscale",
        upscalePreset: "animation-upscale-2x",
        estimatedVramGB: 0.01,
      }),
    ).toThrow();
  });

  it("requires a reason for an unavailable capability", () => {
    const base = {
      backend: {
        id: "video2x",
        compatibilityId: "video2x-cli-6.4.0",
        version: "6.4.0",
        executableSha256: null,
        provenance: "user-supplied-unverified" as const,
        configurationSource: null,
      },
      platform: {
        os: "win32" as const,
        architecture: "x64" as const,
        avx2: "unknown" as const,
      },
      devices: [],
      presets: {
        "animation-upscale-2x": {
          state: "unavailable" as const,
          reason: "Backend unavailable.",
        },
        "animation-upscale-4x": {
          state: "unavailable" as const,
          reason: "Backend unavailable.",
        },
        "general-upscale-4x": {
          state: "unavailable" as const,
          reason: "Backend unavailable.",
        },
        "smooth-2x": {
          state: "unavailable" as const,
          reason: "Backend unavailable.",
        },
      },
      probedAt: "2026-08-28T12:00:00.000Z",
      diagnostic: null,
    };
    expect(
      VideoEnhancementCapabilityResponse.parse({
        capability: {
          ...base,
          status: "unavailable",
          reason: "missing_configuration",
        },
      }).capability.status,
    ).toBe("unavailable");
    expect(() =>
      VideoEnhancementCapabilityResponse.parse({
        capability: { ...base, status: "unavailable", reason: null },
      }),
    ).toThrow();
  });

  it("accepts a separately identified persisted enhancement output", () => {
    const workflow = { schemaVersion: 1, kind: "video", enhancement: {} };
    const durableProvenance = { schemaVersion: 1, outcome: "completed" };
    expect(
      VideoEnhancementJob.parse({
        childJobId: "enhancement-child",
        parentJobId: "video-parent",
        sourceOutputId: "video-output",
        backendId: "video2x",
        state: "succeeded",
        priority: "interactive",
        estimatedVramGB: 8,
        request: REQUEST,
        idempotencyKey: null,
        attempt: 1,
        retryOfChildJobId: null,
        cancelRequested: false,
        progress: null,
        error: null,
        output: {
          outputId: "enhancement-child:output",
          path: "C:\\nexus\\outputs\\source.enhanced.mp4",
          contentHash: "b".repeat(64),
          sizeBytes: 2_048,
          durationSeconds: 4,
          width: 1_708,
          height: 960,
          frameRate: { numerator: 24, denominator: 1 },
          provenanceRecordId: "provenance:enhancement-child",
          preProvenanceContainerSha256: "c".repeat(64),
          publishedContainerSha256: "b".repeat(64),
          workflow,
          durableProvenance,
        },
        createdAt: "2026-08-28T12:00:00.000Z",
        startedAt: "2026-08-28T12:00:01.000Z",
        finishedAt: "2026-08-28T12:01:00.000Z",
      }).output,
    ).toMatchObject({ outputId: "enhancement-child:output", workflow });
  });
});
