import { promises as fs } from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalMkDtemp } from "./helpers/canonicalTempDir";

import { InMemorySettingsStore } from "../../core/storage/SettingsStore";
import type {
  VideoEnhancementBackend,
  VideoEnhancementCapability,
  VideoEnhancementResult,
} from "../../core/video/VideoEnhancement";
import { createStudioRuntime } from "../sidecar/src/generations/studioRuntime";
import {
  video2xJobRootLeaf,
  type Video2xInterruptedArtifactRecovery,
} from "../sidecar/src/video/Video2xAdapter";
import type { PersistedVideoEnhancementJob } from "../sidecar/src/video/VideoEnhancementPersistenceAdapter";
import type { VideoEnhancementProcessDependencies } from "../sidecar/src/video/VideoEnhancementProcessFactory";
import { createVideoEnhancementRuntimeBundle } from "../sidecar/src/video/VideoEnhancementRuntimeFactory";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

function readyCapability(): VideoEnhancementCapability {
  const available = { state: "available" as const, reason: null };
  return {
    status: "ready",
    reason: null,
    backend: {
      id: "video2x",
      compatibilityId: "video2x-cli-6.4.0",
      version: "6.4.0",
      executableSha256: "a".repeat(64),
      provenance: "user-supplied-unverified",
      configurationSource: "setting",
    },
    platform: { os: "win32", architecture: "x64", avx2: "available" },
    devices: [
      { id: 0, type: "discrete_gpu", name: "Test GPU", selected: true },
    ],
    presets: {
      "animation-upscale-2x": available,
      "animation-upscale-4x": available,
      "general-upscale-4x": available,
      "smooth-2x": available,
    },
    probedAt: "2026-08-28T12:00:00.000Z",
    diagnostic: null,
  };
}

function backend(): VideoEnhancementBackend {
  return {
    probe: vi.fn(async () => readyCapability()),
    run: vi.fn(async (): Promise<VideoEnhancementResult> => ({
      ok: false,
      requestId: null,
      parentJobId: null,
      childJobId: null,
      error: {
        code: "internal_error",
        message: "not used",
        retryable: false,
        stage: "preflight",
        diagnostics: null,
        terminationConfirmed: null,
      },
    })),
  };
}

function processDependencies(
  probeMediaTools: VideoEnhancementProcessDependencies["probeMediaTools"],
): VideoEnhancementProcessDependencies {
  return {
    processRunner: {
      run: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        terminationConfirmed: true,
      }),
    },
    ffprobe: { run: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }) },
    ffmpeg: { run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    probeMediaTools,
  };
}

describe("video enhancement runtime factory", () => {
  it("reconciles the durable interrupted root without touching a terminal child root", async () => {
    const directory = await canonicalMkDtemp(
      "nexus-enhancement-factory-recovery-",
    );
    temporaryDirectories.push(directory);
    const stagingRoot = path.join(directory, "staging");
    const interruptedChildId = "interrupted-child";
    const terminalChildId = "terminal-child";
    const interruptedRoot = path.join(
      stagingRoot,
      video2xJobRootLeaf(interruptedChildId),
    );
    const terminalRoot = path.join(
      stagingRoot,
      video2xJobRootLeaf(terminalChildId),
    );
    await fs.mkdir(path.join(interruptedRoot, "work-1"), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(
      path.join(interruptedRoot, "stage-1.partial.mp4"),
      "partial",
    );
    await fs.mkdir(terminalRoot, { recursive: true, mode: 0o700 });
    const terminalMarker = path.join(terminalRoot, "preserve.txt");
    await fs.writeFile(terminalMarker, "terminal");

    const studio = createStudioRuntime({ dbPath: ":memory:" });
    const bundle = createVideoEnhancementRuntimeBundle({
      studio,
      settings: new InMemorySettingsStore(),
      ffmpeg: {
        ffmpegPath: "C:\\tools\\ffmpeg.exe",
        ffprobePath: "C:\\tools\\ffprobe.exe",
      },
      platform: process.platform,
      stagingRoot,
      processDependencies: processDependencies(async () => ({
        ok: true as const,
      })),
    });
    vi.spyOn(bundle.persistence, "listEnhancements").mockResolvedValue([
      {
        childJobId: interruptedChildId,
        state: "interrupted",
      } as PersistedVideoEnhancementJob,
      {
        childJobId: terminalChildId,
        state: "failed",
      } as PersistedVideoEnhancementJob,
    ]);

    await expect(bundle.initialize()).resolves.toEqual([
      {
        childJobId: interruptedChildId,
        disposition: "removed",
        reason: "removed",
      },
    ]);
    await expect(fs.access(interruptedRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.readFile(terminalMarker, "utf8")).resolves.toBe("terminal");
    await bundle.cleanupMedia();
    studio.queue.close();
    studio.index.close();
    studio.database.close();
  });

  it("recovers only interrupted child roots once before capability exposure", async () => {
    const studio = createStudioRuntime({ dbPath: ":memory:" });
    const sequence: string[] = [];
    const testBackend = backend() as VideoEnhancementBackend & {
      recoverInterruptedArtifacts(
        childJobIds: readonly string[],
      ): Promise<readonly Video2xInterruptedArtifactRecovery[]>;
    };
    testBackend.recoverInterruptedArtifacts = vi.fn(async () => {
      sequence.push("recover");
      return Object.freeze([]);
    });
    vi.spyOn(testBackend, "probe").mockImplementation(async () => {
      sequence.push("backend-probe");
      return readyCapability();
    });
    const mediaProbe = vi.fn(async () => {
      sequence.push("media-probe");
      return { ok: true as const };
    });
    const bundle = createVideoEnhancementRuntimeBundle({
      studio,
      settings: new InMemorySettingsStore(),
      ffmpeg: {
        ffmpegPath: "C:\\tools\\ffmpeg.exe",
        ffprobePath: "C:\\tools\\ffprobe.exe",
      },
      processDependencies: processDependencies(mediaProbe),
      backend: testBackend,
    });
    const listedJobs = [
      {
        childJobId: "interrupted-child",
        state: "interrupted",
      } as PersistedVideoEnhancementJob,
      {
        childJobId: "terminal-child",
        state: "failed",
      } as PersistedVideoEnhancementJob,
    ];
    const listSpy = vi
      .spyOn(bundle.persistence, "listEnhancements")
      .mockResolvedValue(listedJobs);

    await expect(bundle.probe()).resolves.toMatchObject({ status: "ready" });
    await bundle.initialize();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(testBackend.recoverInterruptedArtifacts).toHaveBeenCalledTimes(1);
    expect(testBackend.recoverInterruptedArtifacts).toHaveBeenCalledWith([
      "interrupted-child",
    ]);
    expect(sequence).toEqual(["recover", "backend-probe", "media-probe"]);
    await bundle.cleanupMedia();
    studio.queue.close();
    studio.index.close();
    studio.database.close();
  });

  it("reports ready only when the backend and both media tools probe", async () => {
    const studio = createStudioRuntime({ dbPath: ":memory:" });
    const mediaProbe = vi.fn(async () => ({ ok: true as const }));
    const bundle = createVideoEnhancementRuntimeBundle({
      studio,
      settings: new InMemorySettingsStore(),
      ffmpeg: {
        ffmpegPath: "C:\\tools\\ffmpeg.exe",
        ffprobePath: "C:\\tools\\ffprobe.exe",
      },
      processDependencies: processDependencies(mediaProbe),
      backend: backend(),
    });

    await expect(bundle.probe()).resolves.toMatchObject({
      status: "ready",
      reason: null,
    });
    expect(mediaProbe).toHaveBeenCalledTimes(1);
    await bundle.cleanupMedia();
    studio.queue.close();
    studio.index.close();
    studio.database.close();
  });

  it("downgrades backend readiness when the media pipeline is not proven", async () => {
    const studio = createStudioRuntime({ dbPath: ":memory:" });
    const bundle = createVideoEnhancementRuntimeBundle({
      studio,
      settings: new InMemorySettingsStore(),
      ffmpeg: {
        ffmpegPath: "C:\\tools\\ffmpeg.exe",
        ffprobePath: "C:\\tools\\ffprobe.exe",
      },
      processDependencies: processDependencies(async () => ({
        ok: false,
        diagnostic: "ffprobe unavailable",
      })),
      backend: backend(),
    });

    const capability = await bundle.probe();
    expect(capability).toMatchObject({
      status: "unavailable",
      reason: "probe_failed",
      diagnostic: "ffprobe unavailable",
    });
    expect(capability.presets["animation-upscale-2x"]).toEqual({
      state: "unavailable",
      reason: "Compatible ffmpeg and ffprobe executables are required.",
    });
    await bundle.cleanupMedia();
    studio.queue.close();
    studio.index.close();
    studio.database.close();
  });
});
