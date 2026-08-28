import { describe, expect, it, vi } from "vitest";

import type {
  GuardedProcessRequest,
  GuardedVideoProcess,
} from "../sidecar/src/video/GuardedVideoProcess";
import {
  createGuardedVideoProcessForPlatform,
  createVideoEnhancementProcessDependencies,
} from "../sidecar/src/video/VideoEnhancementProcessFactory";

describe("video enhancement process dependencies", () => {
  it("uses one guarded runner for direct ffprobe and ffmpeg argv", async () => {
    const calls: GuardedProcessRequest[] = [];
    const runner: GuardedVideoProcess = {
      run: vi.fn(async (request: GuardedProcessRequest) => {
        calls.push(request);
        return {
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          timedOut: false,
          cancelled: false,
          terminationConfirmed: true,
        };
      }),
    };
    const controller = new AbortController();
    const dependencies = createVideoEnhancementProcessDependencies({
      platform: "win32",
      ffmpeg: {
        ffmpegPath: "C:\\tools\\ffmpeg.exe",
        ffprobePath: "C:\\tools\\ffprobe.exe",
      },
      workspaceRoot: "C:\\workspace",
      env: { PATH: "C:\\tools" },
      processRunner: runner,
      ffprobeTimeoutMs: 1_000,
      ffmpegTimeoutMs: 2_000,
    });

    await expect(
      dependencies.ffprobe.run(
        ["-v", "error", "source.mp4"],
        controller.signal,
      ),
    ).resolves.toEqual({ exitCode: 0, stdout: "ok", stderr: "" });
    await expect(
      dependencies.ffmpeg.run(["-i", "source.mp4", "output.mp4"]),
    ).resolves.toEqual({ exitCode: 0, stdout: "ok", stderr: "" });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      executable: "C:\\tools\\ffprobe.exe",
      args: ["-v", "error", "source.mp4"],
      cwd: "C:\\workspace",
      env: { PATH: "C:\\tools" },
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    expect(calls[1]).toMatchObject({
      executable: "C:\\tools\\ffmpeg.exe",
      args: ["-i", "source.mp4", "output.mp4"],
      timeoutMs: 2_000,
    });
    await expect(dependencies.probeMediaTools()).resolves.toEqual({ ok: true });
    expect(calls.slice(2).map((call) => [call.executable, call.args])).toEqual([
      ["C:\\tools\\ffprobe.exe", ["-version"]],
      ["C:\\tools\\ffmpeg.exe", ["-version"]],
    ]);
  });

  it("maps unconfirmed, cancelled, or timed-out executions to failure", async () => {
    const runner: GuardedVideoProcess = {
      run: async () => ({
        exitCode: 0,
        stdout: "partial",
        stderr: "termination not proven",
        timedOut: false,
        cancelled: false,
        terminationConfirmed: false,
      }),
    };
    const dependencies = createVideoEnhancementProcessDependencies({
      ffmpeg: {
        ffmpegPath: "C:\\tools\\ffmpeg.exe",
        ffprobePath: "C:\\tools\\ffprobe.exe",
      },
      processRunner: runner,
    });
    await expect(
      dependencies.ffprobe.run(["source.mp4"]),
    ).resolves.toMatchObject({
      exitCode: -1,
      stderr: "termination not proven",
    });
    await expect(dependencies.probeMediaTools()).resolves.toEqual({
      ok: false,
      diagnostic:
        "The configured ffprobe executable is unavailable or incompatible.",
    });
  });

  it("does not advertise PATH-only media tools as a proven pipeline", async () => {
    const runner: GuardedVideoProcess = {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: "version",
        stderr: "",
        timedOut: false,
        cancelled: false,
        terminationConfirmed: true,
      })),
    };
    const dependencies = createVideoEnhancementProcessDependencies({
      ffmpeg: { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" },
      processRunner: runner,
    });
    await expect(dependencies.probeMediaTools()).resolves.toEqual({
      ok: false,
      diagnostic:
        "Video enhancement requires absolute configured ffmpeg and ffprobe paths.",
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("fails closed when no guarded platform host exists", async () => {
    const runner = createGuardedVideoProcessForPlatform("darwin");
    await expect(runner.probeAvx2?.()).resolves.toMatchObject({
      status: "unavailable",
      reason: "process_host_unavailable",
    });
    await expect(
      runner.run({
        executable: "video2x",
        args: [],
        cwd: "/tmp",
        env: {},
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({
      exitCode: null,
      terminationConfirmed: true,
    });
  });
});
