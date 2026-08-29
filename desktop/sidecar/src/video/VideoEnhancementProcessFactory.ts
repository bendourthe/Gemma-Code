import * as path from "node:path";

import type { FfmpegContext } from "../../../../core/video/WorkflowMetadata.js";
import {
  createPosixGuardedVideoProcess,
  type GuardedProcessResult,
  type GuardedVideoProcess,
} from "./GuardedVideoProcess.js";
import {
  type VideoFfmpegExecutionPort,
  type VideoFfprobeExecutionPort,
  type VideoMediaToolExecutionResult,
} from "./VideoEnhancementMediaLifecycle.js";
import { createWindowsVideoProcessHost } from "./WindowsVideoProcessHost.js";

const DEFAULT_FFPROBE_TIMEOUT_MS = 30_000;
const DEFAULT_FFMPEG_TIMEOUT_MS = 30 * 60_000;

export interface VideoEnhancementProcessDependencies {
  readonly processRunner: GuardedVideoProcess;
  readonly ffprobe: VideoFfprobeExecutionPort;
  readonly ffmpeg: VideoFfmpegExecutionPort;
  readonly probeMediaTools: (
    signal?: AbortSignal,
  ) => Promise<VideoEnhancementMediaToolProbe>;
}

export type VideoEnhancementMediaToolProbe =
  { readonly ok: true } | { readonly ok: false; readonly diagnostic: string };

export interface VideoEnhancementProcessFactoryOptions {
  readonly platform?: NodeJS.Platform;
  readonly ffmpeg: FfmpegContext;
  readonly workspaceRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly processRunner?: GuardedVideoProcess;
  readonly ffprobeTimeoutMs?: number;
  readonly ffmpegTimeoutMs?: number;
}

class GuardedMediaToolPort
  implements VideoFfprobeExecutionPort, VideoFfmpegExecutionPort
{
  constructor(
    private readonly executable: string,
    private readonly processRunner: GuardedVideoProcess,
    private readonly cwd: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly timeoutMs: number,
  ) {}

  async run(
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<VideoMediaToolExecutionResult> {
    const result = await this.processRunner.run({
      executable: this.executable,
      args,
      cwd: this.cwd,
      env: this.env,
      timeoutMs: this.timeoutMs,
      signal,
    });
    return {
      exitCode: normalizedExitCode(result),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

function normalizedExitCode(result: GuardedProcessResult): number {
  if (
    result.exitCode !== null &&
    !result.timedOut &&
    !result.cancelled &&
    result.terminationConfirmed
  ) {
    return result.exitCode;
  }
  return -1;
}

function unavailableProcessRunner(): GuardedVideoProcess {
  return {
    probeAvx2: async () => ({
      status: "unavailable",
      reason: "process_host_unavailable",
      detail: "The guarded video process host is unavailable on this platform.",
    }),
    run: async () => ({
      exitCode: null,
      stdout: "",
      stderr: "The guarded video process host is unavailable on this platform.",
      timedOut: false,
      cancelled: false,
      terminationConfirmed: true,
    }),
  };
}

export function createGuardedVideoProcessForPlatform(
  platform: NodeJS.Platform = process.platform,
): GuardedVideoProcess {
  if (platform === "win32") {
    return createWindowsVideoProcessHost({ platform });
  }
  if (platform === "linux") {
    return createPosixGuardedVideoProcess({ platform });
  }
  return unavailableProcessRunner();
}

export function createVideoEnhancementProcessDependencies(
  options: VideoEnhancementProcessFactoryOptions,
): VideoEnhancementProcessDependencies {
  const platform = options.platform ?? process.platform;
  const processRunner =
    options.processRunner ?? createGuardedVideoProcessForPlatform(platform);
  const cwd = path.resolve(options.workspaceRoot ?? process.cwd());
  const env = options.env ?? process.env;
  const ffprobe = new GuardedMediaToolPort(
    options.ffmpeg.ffprobePath,
    processRunner,
    cwd,
    env,
    options.ffprobeTimeoutMs ?? DEFAULT_FFPROBE_TIMEOUT_MS,
  );
  const ffmpeg = new GuardedMediaToolPort(
    options.ffmpeg.ffmpegPath,
    processRunner,
    cwd,
    env,
    options.ffmpegTimeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS,
  );
  return {
    processRunner,
    ffprobe,
    ffmpeg,
    probeMediaTools: async (signal?: AbortSignal) => {
      if (
        !path.isAbsolute(options.ffmpeg.ffprobePath) ||
        !path.isAbsolute(options.ffmpeg.ffmpegPath)
      ) {
        return {
          ok: false,
          diagnostic:
            "Video enhancement requires absolute configured ffmpeg and ffprobe paths.",
        };
      }
      const probe = await ffprobe.run(["-version"], signal);
      if (probe.exitCode !== 0) {
        return {
          ok: false,
          diagnostic:
            "The configured ffprobe executable is unavailable or incompatible.",
        };
      }
      const muxer = await ffmpeg.run(["-version"], signal);
      if (muxer.exitCode !== 0) {
        return {
          ok: false,
          diagnostic:
            "The configured ffmpeg executable is unavailable or incompatible.",
        };
      }
      return { ok: true };
    },
  };
}
