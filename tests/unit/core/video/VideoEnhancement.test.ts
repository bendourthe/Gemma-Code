import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_VIDEO_ENHANCEMENT_TIMEOUT_MS,
  MAX_VIDEO_ENHANCEMENT_JOB_ID_LENGTH,
  MAX_VIDEO_ENHANCEMENT_TIMEOUT_MS,
  MIN_VIDEO_ENHANCEMENT_TIMEOUT_MS,
  VIDEO_ENHANCEMENT_CAPABILITY_REASONS,
  VIDEO_ENHANCEMENT_ERROR_CODES,
  VIDEO_ENHANCEMENT_INTERPOLATION_PRESET_IDS,
  VIDEO_ENHANCEMENT_PRESETS,
  VIDEO_ENHANCEMENT_PROGRESS_STAGES,
  VIDEO_ENHANCEMENT_UPSCALE_PRESET_IDS,
  VideoEnhancementService,
  isAbsoluteLocalMp4Path,
  validateVideoEnhancementRequest,
  type VideoEnhancementBackend,
  type VideoEnhancementCapability,
  type VideoEnhancementExecutionEnvironment,
  type VideoEnhancementFailure,
  type VideoEnhancementProgress,
  type VideoEnhancementRequest,
  type VideoEnhancementResult,
  type VideoEnhancementStageParameters,
  type VideoEnhancementStageBackendProvenance,
  type VideoEnhancementStagedSuccess,
} from "../../../../core/video/index.js";

const REQUEST_ID = "123e4567-e89b-12d3-a456-426614174000";
const SECOND_REQUEST_ID = "01890f3e-8c7a-7cc2-bc71-6f4afac30b91";
const SOURCE_HASH = "a".repeat(64);

function source(pathname = "/var/nexus/video source & (one).mp4") {
  return {
    path: pathname,
    sha256: SOURCE_HASH,
    sizeBytes: 10_000,
    durationSeconds: 4.25,
    width: 1280,
    height: 720,
    frameRate: { numerator: 24_000, denominator: 1001 },
  };
}

function request(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    requestId: REQUEST_ID,
    parentJobId: "video-17:opaque/value?yes",
    source: source(),
    mode: "upscale",
    upscalePreset: "animation-upscale-2x",
    requestedAt: "2026-08-28T19:30:00.000Z",
    timeoutMs: DEFAULT_VIDEO_ENHANCEMENT_TIMEOUT_MS,
    ...overrides,
  };
}

const presetAvailability = {
  "animation-upscale-2x": { state: "unverified", reason: "not run" },
  "animation-upscale-4x": { state: "unverified", reason: "not run" },
  "general-upscale-4x": { state: "unavailable", reason: "model missing" },
  "smooth-2x": { state: "available", reason: null },
} as const;

function capability(
  status: "ready" | "unavailable" | "unsupported" = "ready",
): VideoEnhancementCapability {
  const common = {
    backend: {
      id: "video2x",
      compatibilityId: "video2x-cli-6.4.0",
      version: "6.4.0",
      executableSha256: SOURCE_HASH,
      provenance: "user-supplied-unverified",
      configurationSource: "environment",
    },
    platform: { os: "linux", architecture: "x64", avx2: "available" },
    devices: [
      { id: 2, type: "discrete_gpu", name: "Local GPU", selected: true },
    ],
    presets: presetAvailability,
    probedAt: "2026-08-28T19:30:00.000Z",
    diagnostic: null,
  } as const;
  return status === "ready"
    ? { ...common, status, reason: null }
    : {
        ...common,
        status,
        reason:
          status === "unsupported" ? "unsupported_platform" : "probe_failed",
      };
}

function success(
  value: VideoEnhancementRequest,
  childJobId: string,
): VideoEnhancementStagedSuccess {
  const parameters: VideoEnhancementStageParameters[] = [];
  if (value.mode === "upscale" || value.mode === "upscale_interpolate") {
    const preset = VIDEO_ENHANCEMENT_PRESETS[value.upscalePreset];
    parameters.push({
      stage: "upscale",
      presetId: preset.id,
      contentClass: preset.contentClass,
      scaleFactor: preset.scaleFactor,
    });
  }
  if (value.mode === "interpolate" || value.mode === "upscale_interpolate") {
    const preset = VIDEO_ENHANCEMENT_PRESETS[value.interpolationPreset];
    parameters.push({
      stage: "interpolate",
      presetId: preset.id,
      frameRateMultiplier: preset.frameRateMultiplier,
    });
  }
  const startedAtMs = Date.parse("2026-08-28T19:30:01.000Z");
  const stages = parameters.map((stageParameters, index) => {
    const backend: VideoEnhancementStageBackendProvenance =
      stageParameters.stage === "upscale"
        ? {
            processor: "realesrgan",
            model:
              stageParameters.contentClass === "animation"
                ? "realesr-animevideov3"
                : "realesrgan-plus",
            normalizedArguments: {
              scaleFactor: stageParameters.scaleFactor,
              tileSize: 0,
              tta: false,
            },
          }
        : {
            processor: "rife",
            model: "rife-v4.6",
            normalizedArguments: {
              frameRateMultiplier: stageParameters.frameRateMultiplier,
              sceneThreshold: 0.12,
              ensemble: false,
            },
          };
    return {
      stageIndex: index + 1,
      parameters: stageParameters,
      backend,
      startedAt: new Date(startedAtMs + index * 1000).toISOString(),
      completedAt: new Date(startedAtMs + (index + 1) * 1000).toISOString(),
      durationMs: 1000,
      exitCode: 0,
      outcome: "staged" as const,
    };
  });
  const execution: VideoEnhancementExecutionEnvironment = {
    platform: { os: "linux", architecture: "x64", avx2: "available" },
    selectedDevice: {
      id: 2,
      type: "discrete_gpu",
      name: "Local GPU",
    },
  };
  const durationMs = stages.length * 1000;
  return {
    ok: true,
    outcome: "staged",
    requestId: value.requestId,
    parentJobId: value.parentJobId,
    childJobId,
    source: value.source,
    stagedPath: `/var/nexus/jobs/${childJobId}/output.partial.mp4`,
    backend: capability().backend,
    stages,
    execution,
    startedAt: "2026-08-28T19:30:01.000Z",
    completedAt: new Date(startedAtMs + durationMs).toISOString(),
    durationMs,
    warnings: [],
    progress: { elapsedMs: 1000 },
  };
}

function failure(
  value: VideoEnhancementRequest,
  childJobId: string,
): VideoEnhancementFailure {
  return {
    ok: false,
    requestId: value.requestId,
    parentJobId: value.parentJobId,
    childJobId,
    error: {
      code: "backend_unavailable",
      message: "The configured enhancement backend is unavailable.",
      retryable: true,
      stage: "preflight",
      diagnostics: null,
    },
  };
}

function fakeBackend(
  run: VideoEnhancementBackend["run"] = async (value, context) =>
    success(value, context.childJobId),
): VideoEnhancementBackend & {
  probe: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
} {
  return {
    probe: vi.fn(async () => capability()),
    run: vi.fn(run),
  };
}

describe("video enhancement presets", () => {
  it("contains only the four honest semantic mappings", () => {
    expect(VIDEO_ENHANCEMENT_PRESETS).toEqual({
      "animation-upscale-2x": {
        id: "animation-upscale-2x",
        kind: "upscale",
        contentClass: "animation",
        scaleFactor: 2,
      },
      "animation-upscale-4x": {
        id: "animation-upscale-4x",
        kind: "upscale",
        contentClass: "animation",
        scaleFactor: 4,
      },
      "general-upscale-4x": {
        id: "general-upscale-4x",
        kind: "upscale",
        contentClass: "general",
        scaleFactor: 4,
      },
      "smooth-2x": {
        id: "smooth-2x",
        kind: "interpolate",
        frameRateMultiplier: 2,
      },
    });
    expect(JSON.stringify(VIDEO_ENHANCEMENT_PRESETS)).not.toMatch(
      /processor|model|argv|realesrgan|rife/i,
    );
  });

  it("exports closed capability and error vocabularies", () => {
    expect(VIDEO_ENHANCEMENT_UPSCALE_PRESET_IDS).toEqual([
      "animation-upscale-2x",
      "animation-upscale-4x",
      "general-upscale-4x",
    ]);
    expect(VIDEO_ENHANCEMENT_INTERPOLATION_PRESET_IDS).toEqual(["smooth-2x"]);
    expect(VIDEO_ENHANCEMENT_CAPABILITY_REASONS).toEqual([
      "missing_configuration",
      "invalid_path",
      "unsupported_platform",
      "unsupported_architecture",
      "process_host_unavailable",
      "cpu_probe_failed",
      "missing_avx2",
      "incompatible_version",
      "incompatible_grammar",
      "probe_timeout",
      "probe_failed",
      "no_vulkan_device",
      "model_unavailable",
      "internal_error",
    ]);
    expect(VIDEO_ENHANCEMENT_PROGRESS_STAGES).toEqual([
      "preflight",
      "upscale",
      "interpolate",
      "validate",
      "provenance",
      "publish",
    ]);
    expect(VIDEO_ENHANCEMENT_ERROR_CODES).toEqual([
      "invalid_request",
      "backend_unavailable",
      "unsupported_platform",
      "incompatible_backend",
      "model_unavailable",
      "source_changed",
      "source_invalid",
      "output_conflict",
      "process_timeout",
      "process_failed",
      "cancelled",
      "output_invalid",
      "provenance_failed",
      "publish_failed",
      "internal_error",
    ]);
    expect(capability("ready")).toMatchObject({
      status: "ready",
      reason: null,
    });
    expect(capability("unsupported")).toMatchObject({
      status: "unsupported",
      reason: "unsupported_platform",
    });
  });

  it("runtime-locks every exported closed vocabulary", () => {
    const vocabularies = [
      VIDEO_ENHANCEMENT_UPSCALE_PRESET_IDS,
      VIDEO_ENHANCEMENT_INTERPOLATION_PRESET_IDS,
      VIDEO_ENHANCEMENT_CAPABILITY_REASONS,
      VIDEO_ENHANCEMENT_PROGRESS_STAGES,
      VIDEO_ENHANCEMENT_ERROR_CODES,
    ];
    for (const vocabulary of vocabularies) {
      expect(Object.isFrozen(vocabulary)).toBe(true);
      expect(() =>
        (vocabulary as unknown as string[]).push("tampered"),
      ).toThrow(TypeError);
    }
    expect(Object.isFrozen(VIDEO_ENHANCEMENT_PRESETS)).toBe(true);
    for (const preset of Object.values(VIDEO_ENHANCEMENT_PRESETS)) {
      expect(Object.isFrozen(preset)).toBe(true);
    }
    expect(() => {
      (VIDEO_ENHANCEMENT_PRESETS as unknown as Record<string, unknown>)[
        "tampered"
      ] = {};
    }).toThrow(TypeError);
  });
});

describe("validateVideoEnhancementRequest", () => {
  it.each([
    [
      "upscale on POSIX",
      request({ source: source("/tmp/input with $dollar;and&meta.mp4") }),
      "upscale",
    ],
    [
      "interpolation on a drive path",
      request({
        source: source("C:\\Videos\\source clip.MP4"),
        mode: "interpolate",
        upscalePreset: undefined,
        interpolationPreset: "smooth-2x",
      }),
      "interpolate",
    ],
    [
      "combined on UNC",
      request({
        source: source("\\\\media-server\\share\\clips\\source.mp4"),
        mode: "upscale_interpolate",
        upscalePreset: "general-upscale-4x",
        interpolationPreset: "smooth-2x",
      }),
      "upscale_interpolate",
    ],
  ])("accepts %s", (_name, input, mode) => {
    if (mode === "interpolate") delete input.upscalePreset;
    const result = validateVideoEnhancementRequest(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.mode).toBe(mode);
  });

  it("defaults the timeout and detaches a frozen request from caller input", () => {
    const input = request();
    delete input.timeoutMs;
    const originalSource = input.source;
    const result = validateVideoEnhancementRequest(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.timeoutMs).toBe(DEFAULT_VIDEO_ENHANCEMENT_TIMEOUT_MS);
    expect(result.value.source).not.toBe(originalSource);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.source)).toBe(true);
    expect(Object.isFrozen(result.value.source.frameRate)).toBe(true);
  });

  it.each([
    ["top level", () => request({ targetFps: 60 })],
    ["output path", () => request({ outputPath: "/tmp/out.mp4" })],
    ["backend flags", () => request({ processor: "anything" })],
    ["source", () => request({ source: { ...source(), device: 0 } })],
    [
      "frame rate",
      () =>
        request({
          source: source(),
        }),
    ],
  ])("rejects unknown fields at %s", (location, makeInput) => {
    const input = makeInput();
    if (location === "frame rate") {
      const sourceValue = input.source as ReturnType<typeof source>;
      input.source = {
        ...sourceValue,
        frameRate: { ...sourceValue.frameRate, decimal: 23.976 },
      };
    }
    const result = validateVideoEnhancementRequest(input);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
  });

  it("rejects symbol fields instead of silently dropping them", () => {
    const input = request();
    Object.defineProperty(input, Symbol("hidden"), {
      value: true,
      enumerable: true,
    });
    expect(validateVideoEnhancementRequest(input).ok).toBe(false);
  });

  it("fails closed when an input getter throws", () => {
    const input = request();
    Object.defineProperty(input, "requestId", {
      get() {
        throw new Error("hostile getter");
      },
    });
    expect(validateVideoEnhancementRequest(input)).toMatchObject({
      ok: false,
      error: { code: "invalid_request", diagnostics: null },
    });
  });

  it.each([
    ["upscale without a preset", request({ upscalePreset: undefined })],
    [
      "upscale with interpolation",
      request({ interpolationPreset: "smooth-2x" }),
    ],
    [
      "interpolation without its preset",
      request({ mode: "interpolate", upscalePreset: undefined }),
    ],
    [
      "interpolation with upscale",
      request({
        mode: "interpolate",
        interpolationPreset: "smooth-2x",
        upscalePreset: "animation-upscale-2x",
      }),
    ],
    [
      "combined without interpolation",
      request({ mode: "upscale_interpolate" }),
    ],
    [
      "combined without upscale",
      request({
        mode: "upscale_interpolate",
        upscalePreset: undefined,
        interpolationPreset: "smooth-2x",
      }),
    ],
    [
      "unknown upscale preset",
      request({ upscalePreset: "general-upscale-2x" }),
    ],
    [
      "arbitrary interpolation multiplier",
      request({
        mode: "interpolate",
        upscalePreset: undefined,
        interpolationPreset: "smooth-3x",
      }),
    ],
    ["unknown mode", request({ mode: "target_fps" })],
  ])("rejects the invalid mode combination %s", (_name, input) => {
    expect(validateVideoEnhancementRequest(input).ok).toBe(false);
  });

  it.each([
    ["malformed UUID", { requestId: "not-a-uuid" }],
    ["nil UUID", { requestId: "00000000-0000-0000-0000-000000000000" }],
    ["empty parent", { parentJobId: "   " }],
    ["NUL parent", { parentJobId: "video\0one" }],
    ["newline parent", { parentJobId: "video-1\nforged" }],
    ["padded parent", { parentJobId: " video-1 " }],
    [
      "overlong parent",
      { parentJobId: "x".repeat(MAX_VIDEO_ENHANCEMENT_JOB_ID_LENGTH + 1) },
    ],
    ["uppercase hash", { source: { ...source(), sha256: "A".repeat(64) } }],
    ["short hash", { source: { ...source(), sha256: "a".repeat(63) } }],
    ["zero bytes", { source: { ...source(), sizeBytes: 0 } }],
    ["fractional bytes", { source: { ...source(), sizeBytes: 1.5 } }],
    ["zero duration", { source: { ...source(), durationSeconds: 0 } }],
    [
      "nonfinite duration",
      { source: { ...source(), durationSeconds: Infinity } },
    ],
    ["zero width", { source: { ...source(), width: 0 } }],
    ["fractional height", { source: { ...source(), height: 720.5 } }],
    [
      "arithmetic-unsafe width",
      {
        source: {
          ...source(),
          width: Math.floor(Number.MAX_SAFE_INTEGER / 4) + 1,
        },
      },
    ],
    [
      "arithmetic-unsafe duration",
      {
        source: {
          ...source(),
          durationSeconds: Number.MAX_SAFE_INTEGER / 1_000 + 1,
        },
      },
    ],
    [
      "zero fps numerator",
      { source: { ...source(), frameRate: { numerator: 0, denominator: 1 } } },
    ],
    [
      "fractional fps denominator",
      {
        source: { ...source(), frameRate: { numerator: 24, denominator: 1.5 } },
      },
    ],
    [
      "arithmetic-unsafe fps numerator",
      {
        source: {
          ...source(),
          frameRate: {
            numerator: Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1,
            denominator: 1,
          },
        },
      },
    ],
    ["offset timestamp", { requestedAt: "2026-08-28T12:30:00-07:00" }],
    ["impossible timestamp", { requestedAt: "2026-02-30T12:30:00Z" }],
    ["short timeout", { timeoutMs: MIN_VIDEO_ENHANCEMENT_TIMEOUT_MS - 1 }],
    ["long timeout", { timeoutMs: MAX_VIDEO_ENHANCEMENT_TIMEOUT_MS + 1 }],
    [
      "fractional timeout",
      { timeoutMs: MIN_VIDEO_ENHANCEMENT_TIMEOUT_MS + 0.5 },
    ],
  ])("rejects %s", (_name, overrides) => {
    expect(validateVideoEnhancementRequest(request(overrides)).ok).toBe(false);
  });

  it.each([
    "/tmp/source.mp4",
    "C:\\Media Files\\source.mp4",
    "D:/Media/source.MP4",
    "\\\\server\\share\\source.mp4",
    "//server/share/source.mp4",
  ])("recognizes an absolute MP4 path: %s", (pathname) => {
    expect(isAbsoluteLocalMp4Path(pathname)).toBe(true);
  });

  it.each([
    "relative/source.mp4",
    "C:relative.mp4",
    "/tmp/source.webm",
    "/tmp/../secret.mp4",
    "C:\\tmp\\.\\source.mp4",
    "\\\\server\\share.mp4",
    "/tmp//source.mp4",
    "/tmp/source.mp4\0suffix",
  ])("rejects a noncanonical or invalid MP4 path: %s", (pathname) => {
    expect(isAbsoluteLocalMp4Path(pathname)).toBe(false);
  });

  it("accepts both timeout boundaries", () => {
    expect(
      validateVideoEnhancementRequest(
        request({ timeoutMs: MIN_VIDEO_ENHANCEMENT_TIMEOUT_MS }),
      ).ok,
    ).toBe(true);
    expect(
      validateVideoEnhancementRequest(
        request({ timeoutMs: MAX_VIDEO_ENHANCEMENT_TIMEOUT_MS }),
      ).ok,
    ).toBe(true);
  });

  it("accepts the exact arithmetic-safe source boundaries", () => {
    expect(
      validateVideoEnhancementRequest(
        request({
          source: {
            ...source(),
            width: Math.floor(Number.MAX_SAFE_INTEGER / 4),
            height: Math.floor(Number.MAX_SAFE_INTEGER / 4),
            durationSeconds: Number.MAX_SAFE_INTEGER / 1_000,
            frameRate: {
              numerator: Math.floor(Number.MAX_SAFE_INTEGER / 2),
              denominator: Number.MAX_SAFE_INTEGER,
            },
          },
        }),
      ).ok,
    ).toBe(true);
  });
});

describe("VideoEnhancementService", () => {
  it("validates before invoking the backend", async () => {
    const backend = fakeBackend();
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request({ targetFps: 60 }), {
      childJobId: "enhance-1",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(backend.run).not.toHaveBeenCalled();
  });

  it("never invokes or re-reads an invalid request accessor", async () => {
    const backend = fakeBackend();
    const service = new VideoEnhancementService(backend);
    const input = request();
    let getterReads = 0;
    Object.defineProperty(input, "requestId", {
      enumerable: true,
      get() {
        getterReads += 1;
        throw new Error("must not execute");
      },
    });
    const result = await service.run(input, {
      childJobId: "enhance-accessor",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: false,
      requestId: null,
      parentJobId: null,
      childJobId: null,
      error: { code: "invalid_request" },
    });
    expect(getterReads).toBe(0);
    expect(backend.run).not.toHaveBeenCalled();
  });

  it("snapshots a changing invalid descriptor exactly once", async () => {
    const backend = fakeBackend();
    const service = new VideoEnhancementService(backend);
    const target = request({ unknownField: true });
    let descriptorReads = 0;
    const input = new Proxy(target, {
      getOwnPropertyDescriptor(current, property) {
        if (property === "requestId") {
          descriptorReads += 1;
          if (descriptorReads > 1) throw new Error("request was re-read");
        }
        return Reflect.getOwnPropertyDescriptor(current, property);
      },
    });
    const result = await service.run(input, {
      childJobId: "enhance-changing",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: false,
      requestId: null,
      error: { code: "invalid_request" },
    });
    expect(descriptorReads).toBe(1);
    expect(backend.run).not.toHaveBeenCalled();
  });

  it("calls probe and run at most once without implicit retry", async () => {
    const backend = fakeBackend(async (value, context) =>
      failure(value, context.childJobId),
    );
    backend.probe.mockResolvedValue(capability("unavailable"));
    const service = new VideoEnhancementService(backend);
    await expect(service.probe()).resolves.toMatchObject({
      status: "unavailable",
    });
    const result = await service.run(request(), {
      childJobId: "enhance-2",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "backend_unavailable" },
    });
    expect(backend.probe).toHaveBeenCalledTimes(1);
    expect(backend.run).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid child identity before the backend", async () => {
    const backend = fakeBackend();
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: false,
      requestId: REQUEST_ID,
      parentJobId: "video-17:opaque/value?yes",
      childJobId: null,
      error: { code: "invalid_request" },
    });
    expect(backend.run).not.toHaveBeenCalled();
  });

  it("keeps pre-aborted cancellation authoritative and preserves identities", async () => {
    const backend = fakeBackend();
    const service = new VideoEnhancementService(backend);
    const controller = new AbortController();
    controller.abort();
    const result = await service.run(request(), {
      childJobId: "enhance-cancelled",
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      ok: false,
      requestId: REQUEST_ID,
      parentJobId: "video-17:opaque/value?yes",
      childJobId: "enhance-cancelled",
      error: { code: "cancelled" },
    });
    expect(backend.run).not.toHaveBeenCalled();
  });

  it("maps a shadowed throwing AbortSignal getter to a typed internal error", async () => {
    const backend = fakeBackend();
    const service = new VideoEnhancementService(backend);
    const signal = new AbortController().signal;
    const getter = vi.fn(() => {
      throw new Error("hostile aborted getter");
    });
    Object.defineProperty(signal, "aborted", {
      configurable: true,
      enumerable: true,
      get: getter,
    });
    const result = await service.run(request(), {
      childJobId: "enhance-hostile-abort-signal",
      signal,
    });
    expect(result).toMatchObject({
      ok: false,
      requestId: REQUEST_ID,
      childJobId: "enhance-hostile-abort-signal",
      error: { code: "internal_error", diagnostics: null },
    });
    expect(getter).not.toHaveBeenCalled();
    expect(backend.run).not.toHaveBeenCalled();
  });

  it("does not let an own AbortSignal value mask native cancellation", async () => {
    const backend = fakeBackend();
    const service = new VideoEnhancementService(backend);
    const controller = new AbortController();
    controller.abort();
    Object.defineProperty(controller.signal, "aborted", {
      configurable: true,
      enumerable: true,
      value: false,
    });
    const result = await service.run(request(), {
      childJobId: "enhance-shadowed-abort-state",
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    expect(backend.run).not.toHaveBeenCalled();
  });

  it("overrides a late backend success after mid-run cancellation", async () => {
    let resolveRun!: (result: VideoEnhancementResult) => void;
    const backend = fakeBackend(
      (value, context) =>
        new Promise((resolve) => {
          resolveRun = resolve;
          context.onProgress?.({
            requestId: value.requestId,
            childJobId: context.childJobId,
            stage: "interpolate",
            stageIndex: 2,
            stageCount: 2,
            message: "Interpolating frames.",
          });
        }),
    );
    const service = new VideoEnhancementService(backend);
    const controller = new AbortController();
    const runPromise = service.run(request(), {
      childJobId: "enhance-mid-cancel",
      signal: controller.signal,
    });
    const validated = validateVideoEnhancementRequest(request());
    if (!validated.ok) throw new Error("test fixture should validate");
    controller.abort();
    resolveRun(success(validated.value, "enhance-mid-cancel"));
    const result = await runPromise;
    expect(result).toMatchObject({
      ok: false,
      requestId: REQUEST_ID,
      childJobId: "enhance-mid-cancel",
      error: { code: "cancelled", stage: "interpolate" },
    });
    expect(backend.run).toHaveBeenCalledTimes(1);
  });

  it("keeps cancellation authoritative when result normalization triggers abort", async () => {
    const controller = new AbortController();
    let aborted = false;
    const backend = fakeBackend(async (value, context) => {
      const staged = success(value, context.childJobId);
      return new Proxy(staged, {
        getOwnPropertyDescriptor(target, property) {
          if (!aborted && property === "outcome") {
            aborted = true;
            controller.abort();
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-normalize-cancel",
      signal: controller.signal,
    });
    expect(aborted).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      requestId: REQUEST_ID,
      childJobId: "enhance-normalize-cancel",
      error: { code: "cancelled" },
    });
  });

  it("maps unexpected failures to a fixed redacted internal error", async () => {
    const backend = fakeBackend(async () => {
      throw new Error("secret at /home/person/private/source.mp4");
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-error",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: false,
      requestId: REQUEST_ID,
      childJobId: "enhance-error",
      error: { code: "internal_error", diagnostics: null },
    });
    expect(JSON.stringify(result)).not.toContain("/home/person");
  });

  it("isolates concurrent validated request objects and child identities", async () => {
    const observed: Array<{
      request: VideoEnhancementRequest;
      childJobId: string;
    }> = [];
    const backend = fakeBackend(async (value, context) => {
      observed.push({ request: value, childJobId: context.childJobId });
      return success(value, context.childJobId);
    });
    const service = new VideoEnhancementService(backend);
    const first = request();
    const second = request({
      requestId: SECOND_REQUEST_ID,
      parentJobId: "video-18",
    });
    const [firstResult, secondResult] = await Promise.all([
      service.run(first, {
        childJobId: "enhance-concurrent-1",
        signal: new AbortController().signal,
      }),
      service.run(second, {
        childJobId: "enhance-concurrent-2",
        signal: new AbortController().signal,
      }),
    ]);
    expect(firstResult).toMatchObject({
      ok: true,
      childJobId: "enhance-concurrent-1",
    });
    expect(secondResult).toMatchObject({
      ok: true,
      childJobId: "enhance-concurrent-2",
    });
    expect(observed).toHaveLength(2);
    expect(observed[0]?.request).not.toBe(observed[1]?.request);
    expect(observed[0]?.request.source).not.toBe(observed[1]?.request.source);
    expect(new Set(observed.map((entry) => entry.childJobId)).size).toBe(2);
  });

  it("forwards typed progress without inventing numeric telemetry", async () => {
    const progress: VideoEnhancementProgress[] = [];
    const backend = fakeBackend(async (value, context) => {
      context.onProgress?.({
        requestId: value.requestId,
        childJobId: context.childJobId,
        stage: "preflight",
        stageIndex: 1,
        stageCount: 2,
        message: "Checking local capability.",
      });
      return success(value, context.childJobId);
    });
    const service = new VideoEnhancementService(backend);
    await service.run(request(), {
      childJobId: "enhance-progress",
      signal: new AbortController().signal,
      onProgress: (event) => progress.push(event),
    });
    expect(progress).toEqual([
      {
        requestId: REQUEST_ID,
        childJobId: "enhance-progress",
        stage: "preflight",
        stageIndex: 1,
        stageCount: 2,
        message: "Checking local capability.",
      },
    ]);
  });
});

describe("VideoEnhancementService backend trust boundary", () => {
  it("copies and deeply freezes a valid staged backend result", async () => {
    let rawResult: VideoEnhancementStagedSuccess | null = null;
    const backend = fakeBackend(async (value, context) => {
      rawResult = success(value, context.childJobId);
      return rawResult;
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-frozen-result",
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(true);
    expect(result).not.toBe(rawResult);
    if (!result.ok || !rawResult) return;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.source)).toBe(true);
    expect(Object.isFrozen(result.source.frameRate)).toBe(true);
    expect(Object.isFrozen(result.backend)).toBe(true);
    expect(Object.isFrozen(result.stages)).toBe(true);
    expect(Object.isFrozen(result.stages[0])).toBe(true);
    expect(Object.isFrozen(result.stages[0]?.parameters)).toBe(true);
    expect(Object.isFrozen(result.stages[0]?.backend)).toBe(true);
    expect(Object.isFrozen(result.stages[0]?.backend.normalizedArguments)).toBe(
      true,
    );
    expect(Object.isFrozen(result.execution)).toBe(true);
    expect(Object.isFrozen(result.execution.platform)).toBe(true);
    expect(Object.isFrozen(result.execution.selectedDevice)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
    expect(Object.isFrozen(result.progress)).toBe(true);
    (rawResult.warnings as string[]).push("late mutation");
    (rawResult.backend as { id: string }).id = "tampered";
    const rawFirstStage = rawResult.stages[0];
    expect(rawFirstStage).toBeDefined();
    if (!rawFirstStage) return;
    (
      rawFirstStage.backend.normalizedArguments as Record<string, unknown>
    ).scaleFactor = 99;
    (rawResult.execution.platform as { os: string }).os = "other";
    (rawResult.execution.selectedDevice as { name: string }).name = "tampered";
    expect(result.warnings).toEqual([]);
    expect(result.backend.id).toBe("video2x");
    expect(result.stages[0]?.backend.normalizedArguments.scaleFactor).toBe(2);
    expect(result.execution.platform.os).toBe("linux");
    expect(result.execution.selectedDevice.name).toBe("Local GPU");
  });

  it("copies and deeply freezes a valid typed backend failure", async () => {
    let rawFailure: VideoEnhancementFailure | null = null;
    const backend = fakeBackend(async (value, context) => {
      rawFailure = failure(value, context.childJobId);
      return rawFailure;
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-frozen-failure",
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(false);
    expect(result).not.toBe(rawFailure);
    if (result.ok || !rawFailure) return;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.error)).toBe(true);
    (rawFailure.error as { message: string }).message = "tampered";
    expect(result.error.message).toBe(
      "The configured enhancement backend is unavailable.",
    );
  });

  it("snapshots a changing backend result descriptor exactly once", async () => {
    let descriptorReads = 0;
    const backend = fakeBackend(async (value, context) => {
      const target = success(value, context.childJobId);
      return new Proxy(target, {
        getOwnPropertyDescriptor(current, property) {
          if (property === "requestId") {
            descriptorReads += 1;
            if (descriptorReads > 1) throw new Error("result was re-read");
          }
          return Reflect.getOwnPropertyDescriptor(current, property);
        },
      });
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-result-snapshot",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ ok: true, requestId: REQUEST_ID });
    expect(descriptorReads).toBe(1);
  });

  it("never invokes a hostile backend result accessor", async () => {
    let getterReads = 0;
    const backend = fakeBackend(async () => {
      const hostile: Record<string, unknown> = {};
      Object.defineProperty(hostile, "ok", {
        enumerable: true,
        get() {
          getterReads += 1;
          throw new Error("must not execute");
        },
      });
      return hostile as unknown as VideoEnhancementResult;
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-hostile-result",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: false,
      requestId: REQUEST_ID,
      childJobId: "enhance-hostile-result",
      error: {
        code: "internal_error",
        message: "Video enhancement failed unexpectedly.",
        diagnostics: null,
      },
    });
    expect(getterReads).toBe(0);
  });

  it("never invokes a hostile normalized argument accessor", async () => {
    let getterReads = 0;
    const backend = fakeBackend(async (value, context) => {
      const base = success(value, context.childJobId);
      const normalizedArguments: Record<string, unknown> = {};
      Object.defineProperty(normalizedArguments, "scaleFactor", {
        enumerable: true,
        get() {
          getterReads += 1;
          throw new Error("must not execute");
        },
      });
      return {
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                backend: { ...stage.backend, normalizedArguments },
              }
            : stage,
        ),
      } as unknown as VideoEnhancementResult;
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-hostile-argument",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "internal_error", diagnostics: null },
    });
    expect(getterReads).toBe(0);
  });

  it("never invokes a hostile execution device accessor", async () => {
    let getterReads = 0;
    const backend = fakeBackend(async (value, context) => {
      const base = success(value, context.childJobId);
      const selectedDevice: Record<string, unknown> = {
        id: base.execution.selectedDevice.id,
        type: base.execution.selectedDevice.type,
      };
      Object.defineProperty(selectedDevice, "name", {
        enumerable: true,
        get() {
          getterReads += 1;
          throw new Error("must not execute");
        },
      });
      return {
        ...base,
        execution: { ...base.execution, selectedDevice },
      } as unknown as VideoEnhancementResult;
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-hostile-device",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "internal_error", diagnostics: null },
    });
    expect(getterReads).toBe(0);
  });

  it("snapshots normalized argument descriptors exactly once", async () => {
    let descriptorReads = 0;
    const backend = fakeBackend(async (value, context) => {
      const base = success(value, context.childJobId);
      const firstStage = base.stages[0];
      if (!firstStage) return base;
      const normalizedArguments = new Proxy(
        { ...firstStage.backend.normalizedArguments },
        {
          getOwnPropertyDescriptor(current, property) {
            if (property === "scaleFactor") {
              descriptorReads += 1;
              if (descriptorReads > 1) throw new Error("argument was re-read");
            }
            return Reflect.getOwnPropertyDescriptor(current, property);
          },
        },
      );
      return {
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                backend: { ...stage.backend, normalizedArguments },
              }
            : stage,
        ),
      };
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-argument-snapshot",
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(true);
    expect(descriptorReads).toBe(1);
  });

  it.each<[string, (base: VideoEnhancementStagedSuccess) => unknown]>([
    ["non-staged outcome", (base) => ({ ...base, outcome: "completed" })],
    [
      "request identity mismatch",
      (base) => ({ ...base, requestId: SECOND_REQUEST_ID }),
    ],
    [
      "parent identity mismatch",
      (base) => ({ ...base, parentJobId: "video-other" }),
    ],
    [
      "child identity mismatch",
      (base) => ({ ...base, childJobId: "enhance-other" }),
    ],
    [
      "source mismatch",
      (base) => ({
        ...base,
        source: { ...base.source, sha256: "b".repeat(64) },
      }),
    ],
    [
      "source alias output",
      (base) => ({ ...base, stagedPath: base.source.path }),
    ],
    ["unknown top-level field", (base) => ({ ...base, unexpected: true })],
    [
      "unknown backend field",
      (base) => ({ ...base, backend: { ...base.backend, unexpected: true } }),
    ],
    [
      "unknown configuration source",
      (base) => ({
        ...base,
        backend: { ...base.backend, configurationSource: "registry" },
      }),
    ],
    [
      "missing executable identity",
      (base) => ({
        ...base,
        backend: { ...base.backend, executableSha256: null },
      }),
    ],
    [
      "missing execution provenance",
      (base) => {
        const altered = { ...base } as Record<string, unknown>;
        delete altered.execution;
        return altered;
      },
    ],
    [
      "unknown execution field",
      (base) => ({
        ...base,
        execution: { ...base.execution, unexpected: true },
      }),
    ],
    [
      "unknown execution platform field",
      (base) => ({
        ...base,
        execution: {
          ...base.execution,
          platform: { ...base.execution.platform, unexpected: true },
        },
      }),
    ],
    [
      "unknown execution device type",
      (base) => ({
        ...base,
        execution: {
          ...base.execution,
          selectedDevice: {
            ...base.execution.selectedDevice,
            type: "cpu",
          },
        },
      }),
    ],
    ["missing semantic stage", (base) => ({ ...base, stages: [] })],
    [
      "missing stage backend provenance",
      (base) => ({
        ...base,
        stages: base.stages.map((stage, index) => {
          if (index !== 0) return stage;
          const altered = { ...stage } as Record<string, unknown>;
          delete altered.backend;
          return altered;
        }),
      }),
    ],
    [
      "unknown stage backend field",
      (base) => ({
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? { ...stage, backend: { ...stage.backend, unexpected: true } }
            : stage,
        ),
      }),
    ],
    [
      "invalid normalized argument key",
      (base) => ({
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                backend: {
                  ...stage.backend,
                  normalizedArguments: { Invalid: true },
                },
              }
            : stage,
        ),
      }),
    ],
    [
      "too many normalized arguments",
      (base) => ({
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                backend: {
                  ...stage.backend,
                  normalizedArguments: Object.fromEntries(
                    Array.from({ length: 17 }, (_, argumentIndex) => [
                      `argument${argumentIndex}`,
                      argumentIndex,
                    ]),
                  ),
                },
              }
            : stage,
        ),
      }),
    ],
    [
      "nested normalized argument",
      (base) => ({
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                backend: {
                  ...stage.backend,
                  normalizedArguments: { scaleFactor: { value: 2 } },
                },
              }
            : stage,
        ),
      }),
    ],
    [
      "normalized argument key above 64 characters",
      (base) => ({
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                backend: {
                  ...stage.backend,
                  normalizedArguments: { [`a${"B".repeat(64)}`]: true },
                },
              }
            : stage,
        ),
      }),
    ],
    [
      "non-finite normalized argument",
      (base) => ({
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                backend: {
                  ...stage.backend,
                  normalizedArguments: {
                    sceneThreshold: Number.POSITIVE_INFINITY,
                  },
                },
              }
            : stage,
        ),
      }),
    ],
    [
      "unsafe normalized argument magnitude",
      (base) => ({
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                backend: {
                  ...stage.backend,
                  normalizedArguments: {
                    scaleFactor: Number.MAX_SAFE_INTEGER + 1,
                  },
                },
              }
            : stage,
        ),
      }),
    ],
    [
      "path-bearing normalized argument",
      (base) => ({
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                backend: {
                  ...stage.backend,
                  normalizedArguments: { modelPath: "path=C:\\private\\file" },
                },
              }
            : stage,
        ),
      }),
    ],
    [
      "oversized normalized argument",
      (base) => ({
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                backend: {
                  ...stage.backend,
                  normalizedArguments: { modelName: "x".repeat(257) },
                },
              }
            : stage,
        ),
      }),
    ],
    [
      "path-bearing processor",
      (base) => ({
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                backend: { ...stage.backend, processor: "/secret.mp4" },
              }
            : stage,
        ),
      }),
    ],
    [
      "oversized model",
      (base) => ({
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                backend: { ...stage.backend, model: "x".repeat(257) },
              }
            : stage,
        ),
      }),
    ],
    [
      "path-bearing selected device name",
      (base) => ({
        ...base,
        execution: {
          ...base.execution,
          selectedDevice: {
            ...base.execution.selectedDevice,
            name: "path=/root/file",
          },
        },
      }),
    ],
    [
      "unknown selected device field",
      (base) => ({
        ...base,
        execution: {
          ...base.execution,
          selectedDevice: {
            ...base.execution.selectedDevice,
            selected: true,
          },
        },
      }),
    ],
    [
      "wrong semantic stage parameters",
      (base) => ({
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                parameters: {
                  stage: "upscale",
                  presetId: "animation-upscale-2x",
                  contentClass: "animation",
                  scaleFactor: 4,
                },
              }
            : stage,
        ),
      }),
    ],
    [
      "unsafe overall timing",
      (base) => ({ ...base, durationMs: Number.MAX_SAFE_INTEGER }),
    ],
    [
      "overall duration beyond request timeout",
      (base) => ({
        ...base,
        completedAt: new Date(
          new Date(base.startedAt).getTime() +
            DEFAULT_VIDEO_ENHANCEMENT_TIMEOUT_MS +
            1,
        ).toISOString(),
        durationMs: DEFAULT_VIDEO_ENHANCEMENT_TIMEOUT_MS + 1,
      }),
    ],
    [
      "inconsistent stage timing",
      (base) => ({
        ...base,
        stages: base.stages.map((stage) => ({
          ...stage,
          durationMs: stage.durationMs + 1,
        })),
      }),
    ],
    [
      "too many warnings",
      (base) => ({ ...base, warnings: Array(33).fill("warning") }),
    ],
    [
      "unsafe warning",
      (base) => ({ ...base, warnings: ["leaked /home/person/file.mp4"] }),
    ],
    [
      "numeric-root warning",
      (base) => ({ ...base, warnings: ["leaked /1/private.mp4"] }),
    ],
    [
      "Unicode-root warning",
      (base) => ({ ...base, warnings: ["leaked /用户/private.mp4"] }),
    ],
    [
      "file URL warning",
      (base) => ({
        ...base,
        warnings: ["leaked file:///home/person/private.mp4"],
      }),
    ],
    [
      "backtick-wrapped warning path",
      (base) => ({ ...base, warnings: ["leaked `/home/person/private.mp4`"] }),
    ],
    [
      "percent without total",
      (base) => ({ ...base, progress: { percent: 50 } }),
    ],
    [
      "arithmetic-unsafe progress",
      (base) => ({
        ...base,
        progress: { processedFrames: Number.MAX_SAFE_INTEGER },
      }),
    ],
    [
      "progress elapsed beyond request timeout",
      (base) => ({
        ...base,
        progress: { elapsedMs: DEFAULT_VIDEO_ENHANCEMENT_TIMEOUT_MS + 1 },
      }),
    ],
    [
      "unknown progress field",
      (base) => ({ ...base, progress: { elapsedMs: 1, extra: 1 } }),
    ],
  ])(
    "maps malicious staged output to fixed internal_error: %s",
    async (_name, alter) => {
      const backend = fakeBackend(
        async (value, context) =>
          alter(success(value, context.childJobId)) as VideoEnhancementResult,
      );
      const service = new VideoEnhancementService(backend);
      const result = await service.run(request(), {
        childJobId: "enhance-malicious-success",
        signal: new AbortController().signal,
      });
      expect(result).toMatchObject({
        ok: false,
        requestId: REQUEST_ID,
        parentJobId: "video-17:opaque/value?yes",
        childJobId: "enhance-malicious-success",
        error: {
          code: "internal_error",
          message: "Video enhancement failed unexpectedly.",
          diagnostics: null,
        },
      });
    },
  );

  it("accepts the exact normalized argument boundaries", async () => {
    const maximumLengthKey = `a${"B".repeat(63)}`;
    const normalizedArguments: Record<string, string | number | boolean> = {
      [maximumLengthKey]: "x".repeat(256),
      maximumSafe: Number.MAX_SAFE_INTEGER,
      minimumSafe: -Number.MAX_SAFE_INTEGER,
      finiteDecimal: 0.125,
      enabled: true,
      disabled: false,
    };
    for (
      let index = 0;
      Object.keys(normalizedArguments).length < 16;
      index += 1
    ) {
      normalizedArguments[`argument${index}`] = index;
    }
    const backend = fakeBackend(async (value, context) => {
      const base = success(value, context.childJobId);
      return {
        ...base,
        stages: base.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                backend: { ...stage.backend, normalizedArguments },
              }
            : stage,
        ),
      };
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-argument-boundaries",
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      Object.keys(result.stages[0]?.backend.normalizedArguments ?? {}),
    ).toHaveLength(16);
    expect(result.stages[0]?.backend.normalizedArguments).toMatchObject({
      [maximumLengthKey]: "x".repeat(256),
      maximumSafe: Number.MAX_SAFE_INTEGER,
      minimumSafe: -Number.MAX_SAFE_INTEGER,
      finiteDecimal: 0.125,
      enabled: true,
      disabled: false,
    });
  });

  it.each<[string, (base: VideoEnhancementFailure) => unknown]>([
    [
      "identity mismatch",
      (base) => ({ ...base, requestId: SECOND_REQUEST_ID }),
    ],
    [
      "unknown error code",
      (base) => ({ ...base, error: { ...base.error, code: "other" } }),
    ],
    [
      "unknown error field",
      (base) => ({ ...base, error: { ...base.error, secret: true } }),
    ],
    [
      "oversized message",
      (base) => ({
        ...base,
        error: { ...base.error, message: "x".repeat(2049) },
      }),
    ],
    [
      "path-bearing diagnostics",
      (base) => ({
        ...base,
        error: { ...base.error, diagnostics: "secret /home/person/source.mp4" },
      }),
    ],
    [
      "path assignment with POSIX absolute path",
      (base) => ({
        ...base,
        error: { ...base.error, diagnostics: "path=/root/file" },
      }),
    ],
    [
      "path assignment with drive absolute path",
      (base) => ({
        ...base,
        error: { ...base.error, diagnostics: "path=C:\\private\\file" },
      }),
    ],
    [
      "root-level POSIX file path",
      (base) => ({
        ...base,
        error: { ...base.error, diagnostics: "/secret.mp4" },
      }),
    ],
    [
      "numeric-root POSIX file path",
      (base) => ({
        ...base,
        error: { ...base.error, diagnostics: "/1/private.mp4" },
      }),
    ],
    [
      "Unicode-root POSIX file path",
      (base) => ({
        ...base,
        error: { ...base.error, diagnostics: "/用户/private.mp4" },
      }),
    ],
    [
      "file URL path",
      (base) => ({
        ...base,
        error: {
          ...base.error,
          diagnostics: "file:///home/person/private.mp4",
        },
      }),
    ],
    [
      "markup-wrapped path",
      (base) => ({
        ...base,
        error: { ...base.error, diagnostics: "</home/person/private.mp4>" },
      }),
    ],
    [
      "unknown stage",
      (base) => ({ ...base, error: { ...base.error, stage: "other" } }),
    ],
    ["unknown top-level field", (base) => ({ ...base, unexpected: true })],
  ])(
    "maps malicious failure output to fixed internal_error: %s",
    async (_name, alter) => {
      const backend = fakeBackend(
        async (value, context) =>
          alter(failure(value, context.childJobId)) as VideoEnhancementResult,
      );
      const service = new VideoEnhancementService(backend);
      const result = await service.run(request(), {
        childJobId: "enhance-malicious-failure",
        signal: new AbortController().signal,
      });
      expect(result).toMatchObject({
        ok: false,
        requestId: REQUEST_ID,
        childJobId: "enhance-malicious-failure",
        error: {
          code: "internal_error",
          message: "Video enhancement failed unexpectedly.",
          diagnostics: null,
        },
      });
    },
  );

  it("preserves ordinary ratios in backend diagnostics", async () => {
    const backend = fakeBackend(async (value, context) => {
      const base = failure(value, context.childJobId);
      return {
        ...base,
        error: {
          ...base.error,
          diagnostics: "Ratios 1/2, 16:9, and 1 / 2 are ordinary values.",
        },
      };
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-ratio-diagnostics",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "backend_unavailable",
        diagnostics: "Ratios 1/2, 16:9, and 1 / 2 are ordinary values.",
      },
    });
  });

  it("rejects overlapping combined-stage timings", async () => {
    const backend = fakeBackend(async (value, context) => {
      const base = success(value, context.childJobId);
      const first = base.stages[0];
      const second = base.stages[1];
      if (!first || !second) return base;
      return {
        ...base,
        stages: [
          first,
          {
            ...second,
            startedAt: "2026-08-28T19:30:01.500Z",
            completedAt: "2026-08-28T19:30:02.500Z",
          },
        ],
      } as VideoEnhancementResult;
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(
      request({
        mode: "upscale_interpolate",
        upscalePreset: "animation-upscale-2x",
        interpolationPreset: "smooth-2x",
      }),
      {
        childJobId: "enhance-overlap",
        signal: new AbortController().signal,
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "internal_error", diagnostics: null },
    });
  });
});

describe("VideoEnhancementService capability boundary", () => {
  it("copies and deeply freezes a valid capability", async () => {
    const raw = capability();
    const backend = fakeBackend();
    backend.probe.mockResolvedValue(raw);
    const service = new VideoEnhancementService(backend);
    const result = await service.probe();
    expect(result).not.toBe(raw);
    expect(result).toMatchObject({ status: "ready", reason: null });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.backend)).toBe(true);
    expect(Object.isFrozen(result.platform)).toBe(true);
    expect(Object.isFrozen(result.devices)).toBe(true);
    expect(Object.isFrozen(result.devices[0])).toBe(true);
    expect(Object.isFrozen(result.presets)).toBe(true);
    for (const availability of Object.values(result.presets)) {
      expect(Object.isFrozen(availability)).toBe(true);
    }
    (raw.backend as { id: string }).id = "tampered";
    (raw.backend as { configurationSource: string }).configurationSource =
      "setting";
    (raw.devices[0] as { name: string }).name = "tampered";
    expect(result.backend.id).toBe("video2x");
    expect(result.backend.configurationSource).toBe("environment");
    expect(result.devices[0]?.name).toBe("Local GPU");
  });

  it("normalizes a rejected probe once without leaking its error", async () => {
    const backend = fakeBackend();
    backend.probe.mockRejectedValue(
      new Error("secret at C:\\Users\\person\\video2x.exe"),
    );
    const service = new VideoEnhancementService(backend);
    const result = await service.probe();
    expect(result).toMatchObject({
      status: "unavailable",
      reason: "internal_error",
      diagnostic: null,
      backend: { executableSha256: null },
    });
    expect(JSON.stringify(result)).not.toContain("person");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.presets)).toBe(true);
    expect(backend.probe).toHaveBeenCalledTimes(1);
  });

  it.each<[string, (base: VideoEnhancementCapability) => unknown]>([
    ["unknown top-level field", (base) => ({ ...base, unexpected: true })],
    ["ready reason", (base) => ({ ...base, reason: "probe_failed" })],
    [
      "unknown platform vocabulary",
      (base) => ({ ...base, platform: { ...base.platform, os: "freebsd" } }),
    ],
    [
      "duplicate selected devices",
      (base) => ({
        ...base,
        devices: [
          ...base.devices,
          { id: 3, type: "integrated_gpu", name: "Other GPU", selected: true },
        ],
      }),
    ],
    [
      "missing executable identity",
      (base) => ({
        ...base,
        backend: { ...base.backend, executableSha256: null },
      }),
    ],
    [
      "missing configuration source",
      (base) => {
        const backend = { ...base.backend } as Record<string, unknown>;
        delete backend.configurationSource;
        return { ...base, backend };
      },
    ],
    [
      "unknown configuration source",
      (base) => ({
        ...base,
        backend: { ...base.backend, configurationSource: "registry" },
      }),
    ],
    [
      "unknown preset field",
      (base) => ({
        ...base,
        presets: {
          ...base.presets,
          unknown: { state: "available", reason: null },
        },
      }),
    ],
    [
      "path-bearing diagnostic",
      (base) => ({ ...base, diagnostic: "failed at /home/person/video2x" }),
    ],
    [
      "path assignment diagnostic",
      (base) => ({ ...base, diagnostic: "path=/root/file" }),
    ],
    [
      "numeric-root diagnostic",
      (base) => ({ ...base, diagnostic: "failed at /1/private.mp4" }),
    ],
    [
      "Unicode-root diagnostic",
      (base) => ({ ...base, diagnostic: "failed at /用户/private.mp4" }),
    ],
    [
      "file URL diagnostic",
      (base) => ({
        ...base,
        diagnostic: "failed at file:///home/person/private.mp4",
      }),
    ],
    [
      "pipe-delimited diagnostic",
      (base) => ({ ...base, diagnostic: "failed|/home/person/private.mp4" }),
    ],
  ])("fails closed on malformed capability: %s", async (_name, alter) => {
    const backend = fakeBackend();
    backend.probe.mockResolvedValue(
      alter(capability()) as VideoEnhancementCapability,
    );
    const service = new VideoEnhancementService(backend);
    const result = await service.probe();
    expect(result).toMatchObject({
      status: "unavailable",
      reason: "internal_error",
      diagnostic: null,
    });
    expect(backend.probe).toHaveBeenCalledTimes(1);
  });
});

describe("VideoEnhancementService progress boundary", () => {
  it("copies and freezes valid progress before forwarding it", async () => {
    let rawProgress: VideoEnhancementProgress | null = null;
    const received: VideoEnhancementProgress[] = [];
    const backend = fakeBackend(async (value, context) => {
      rawProgress = {
        requestId: value.requestId,
        childJobId: context.childJobId,
        stage: "upscale",
        stageIndex: 1,
        stageCount: 1,
        processedFrames: 5,
        totalFrames: 10,
        percent: 50,
        processingFps: 3.5,
        elapsedMs: 1000,
        remainingMs: 1000,
        message: "Enhancing frames.",
      };
      context.onProgress?.(rawProgress);
      return success(value, context.childJobId);
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-progress-copy",
      signal: new AbortController().signal,
      onProgress: (event) => received.push(event),
    });
    expect(result.ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).not.toBe(rawProgress);
    expect(Object.isFrozen(received[0])).toBe(true);
    if (rawProgress) {
      (rawProgress as { message: string }).message = "tampered";
    }
    expect(received[0]?.message).toBe("Enhancing frames.");
  });

  it.each<
    [string, (value: VideoEnhancementRequest, childJobId: string) => unknown]
  >([
    [
      "identity mismatch",
      (_value, childJobId) => ({
        requestId: SECOND_REQUEST_ID,
        childJobId,
        stage: "upscale",
        stageIndex: 1,
        stageCount: 1,
        message: "Enhancing frames.",
      }),
    ],
    [
      "unknown field",
      (value, childJobId) => ({
        requestId: value.requestId,
        childJobId,
        stage: "upscale",
        stageIndex: 1,
        stageCount: 1,
        message: "Enhancing frames.",
        unexpected: true,
      }),
    ],
    [
      "unsafe message",
      (value, childJobId) => ({
        requestId: value.requestId,
        childJobId,
        stage: "upscale",
        stageIndex: 1,
        stageCount: 1,
        message: "leaked /home/person/source.mp4",
      }),
    ],
    [
      "arithmetic-unsafe frames",
      (value, childJobId) => ({
        requestId: value.requestId,
        childJobId,
        stage: "upscale",
        stageIndex: 1,
        stageCount: 1,
        processedFrames: Number.MAX_SAFE_INTEGER,
        message: "Enhancing frames.",
      }),
    ],
    [
      "non-finite percent",
      (value, childJobId) => ({
        requestId: value.requestId,
        childJobId,
        stage: "upscale",
        stageIndex: 1,
        stageCount: 1,
        totalFrames: 10,
        percent: Number.NaN,
        message: "Enhancing frames.",
      }),
    ],
    [
      "elapsed beyond request timeout",
      (value, childJobId) => ({
        requestId: value.requestId,
        childJobId,
        stage: "upscale",
        stageIndex: 1,
        stageCount: 1,
        elapsedMs: value.timeoutMs + 1,
        message: "Enhancing frames.",
      }),
    ],
  ])(
    "ignores hostile progress without failing the run: %s",
    async (_name, makeProgress) => {
      const received: VideoEnhancementProgress[] = [];
      const backend = fakeBackend(async (value, context) => {
        context.onProgress?.(
          makeProgress(value, context.childJobId) as VideoEnhancementProgress,
        );
        return success(value, context.childJobId);
      });
      const service = new VideoEnhancementService(backend);
      const result = await service.run(request(), {
        childJobId: "enhance-hostile-progress",
        signal: new AbortController().signal,
        onProgress: (event) => received.push(event),
      });
      expect(result.ok).toBe(true);
      expect(received).toEqual([]);
    },
  );

  it("ignores regressing progress and continues with later truthful updates", async () => {
    const received: VideoEnhancementProgress[] = [];
    const backend = fakeBackend(async (value, context) => {
      for (const percent of [50, 25, 75]) {
        context.onProgress?.({
          requestId: value.requestId,
          childJobId: context.childJobId,
          stage: "upscale",
          stageIndex: 1,
          stageCount: 1,
          processedFrames: percent,
          totalFrames: 100,
          percent,
          elapsedMs: percent * 10,
          message: "Enhancing frames.",
        });
      }
      return success(value, context.childJobId);
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-progress-regression",
      signal: new AbortController().signal,
      onProgress: (event) => received.push(event),
    });
    expect(result.ok).toBe(true);
    expect(received.map((event) => event.percent)).toEqual([50, 75]);
  });

  it("ignores accessor-backed progress without invoking the accessor", async () => {
    const accessor = vi.fn(() => "unsafe");
    const backend = fakeBackend(async (value, context) => {
      const progress = {
        requestId: value.requestId,
        childJobId: context.childJobId,
        stage: "upscale",
        stageIndex: 1,
        stageCount: 1,
        message: "Enhancing frames.",
      };
      Object.defineProperty(progress, "message", {
        get: accessor,
        enumerable: true,
      });
      context.onProgress?.(progress as unknown as VideoEnhancementProgress);
      return success(value, context.childJobId);
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-accessor-progress",
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(true);
    expect(accessor).not.toHaveBeenCalled();
  });

  it("does not let a progress consumer control backend success", async () => {
    const backend = fakeBackend(async (value, context) => {
      context.onProgress?.({
        requestId: value.requestId,
        childJobId: context.childJobId,
        stage: "upscale",
        stageIndex: 1,
        stageCount: 1,
        message: "Enhancing frames.",
      });
      return success(value, context.childJobId);
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-progress-consumer",
      signal: new AbortController().signal,
      onProgress: () => {
        throw new Error("consumer failure");
      },
    });
    expect(result.ok).toBe(true);
  });

  it("ignores backend progress emitted after successful settlement", async () => {
    let emitLate!: (event: VideoEnhancementProgress) => void;
    const received: VideoEnhancementProgress[] = [];
    const backend = fakeBackend(async (value, context) => {
      emitLate = context.onProgress!;
      return success(value, context.childJobId);
    });
    const service = new VideoEnhancementService(backend);
    const result = await service.run(request(), {
      childJobId: "enhance-late-progress-success",
      signal: new AbortController().signal,
      onProgress: (event) => received.push(event),
    });
    expect(result.ok).toBe(true);
    emitLate({
      requestId: REQUEST_ID,
      childJobId: "enhance-late-progress-success",
      stage: "upscale",
      stageIndex: 1,
      stageCount: 1,
      message: "Enhancing frames.",
    });
    expect(received).toEqual([]);
  });

  it("ignores backend progress emitted after cancellation", async () => {
    let emitLate!: (event: VideoEnhancementProgress) => void;
    let resolveRun!: (result: VideoEnhancementResult) => void;
    const received: VideoEnhancementProgress[] = [];
    const controller = new AbortController();
    const backend = fakeBackend(
      (_value, context) =>
        new Promise((resolve) => {
          emitLate = context.onProgress!;
          resolveRun = resolve;
        }),
    );
    const service = new VideoEnhancementService(backend);
    const runPromise = service.run(request(), {
      childJobId: "enhance-late-progress-cancel",
      signal: controller.signal,
      onProgress: (event) => received.push(event),
    });
    const validated = validateVideoEnhancementRequest(request());
    if (!validated.ok) throw new Error("test fixture should validate");
    controller.abort();
    emitLate({
      requestId: REQUEST_ID,
      childJobId: "enhance-late-progress-cancel",
      stage: "upscale",
      stageIndex: 1,
      stageCount: 1,
      message: "Enhancing frames.",
    });
    resolveRun(success(validated.value, "enhance-late-progress-cancel"));
    await expect(runPromise).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    expect(received).toEqual([]);
  });
});

describe("core video import boundary", () => {
  it("keeps the contract free of process, desktop, module, and adapter imports", () => {
    const modulePath = path.resolve(
      __dirname,
      "../../../../core/video/VideoEnhancement.ts",
    );
    const sourceText = readFileSync(modulePath, "utf8");
    const importLines = sourceText.match(/^import\s.+$/gm) ?? [];
    expect(importLines).toEqual([]);
    expect(sourceText).not.toMatch(/(?:node:)?child_process/);
    expect(sourceText).not.toMatch(
      /from\s+["'][^"']*(?:desktop|modules)[^"']*["']/i,
    );
  });

  it("keeps the narrow barrel from re-exporting process-bound metadata", () => {
    const indexPath = path.resolve(
      __dirname,
      "../../../../core/video/index.ts",
    );
    const indexText = readFileSync(indexPath, "utf8");
    expect(indexText).toContain('from "./VideoEnhancement.js"');
    expect(indexText).not.toContain("WorkflowMetadata");
    expect(indexText).not.toContain("child_process");
  });
});
