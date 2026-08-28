import * as path from "node:path";

import type { SettingsStore } from "../../../../core/storage/SettingsStore.js";
import { nexusHome } from "../../../../core/storage/paths.js";
import {
  VideoEnhancementService,
  type VideoEnhancementBackend,
  type VideoEnhancementCapability,
  type VideoEnhancementPresetAvailability,
  type VideoEnhancementPresetId,
} from "../../../../core/video/VideoEnhancement.js";
import type { FfmpegContext } from "../../../../core/video/WorkflowMetadata.js";
import type { StudioRuntime } from "../generations/studioRuntime.js";
import {
  Video2xAdapter,
  type Video2xInterruptedArtifactRecovery,
} from "./Video2xAdapter.js";
import { VideoEnhancementMediaAdapter } from "./VideoEnhancementMediaAdapter.js";
import { VideoEnhancementMediaLifecycle } from "./VideoEnhancementMediaLifecycle.js";
import { VideoEnhancementPersistenceAdapter } from "./VideoEnhancementPersistenceAdapter.js";
import {
  createVideoEnhancementProcessDependencies,
  type VideoEnhancementProcessDependencies,
} from "./VideoEnhancementProcessFactory.js";
import { VideoEnhancementRuntime } from "./VideoEnhancementRuntime.js";

const PRESET_IDS: readonly VideoEnhancementPresetId[] = Object.freeze([
  "animation-upscale-2x",
  "animation-upscale-4x",
  "general-upscale-4x",
  "smooth-2x",
]);

export interface VideoEnhancementRuntimeBundle {
  readonly runtime: VideoEnhancementRuntime;
  readonly persistence: VideoEnhancementPersistenceAdapter;
  readonly media: VideoEnhancementMediaAdapter;
  /** Must settle before direct runtime or persistence-list exposure. */
  initialize(): Promise<readonly Video2xInterruptedArtifactRecovery[]>;
  probe(signal?: AbortSignal): Promise<VideoEnhancementCapability>;
  stopActive(): Promise<void>;
  cleanupMedia(): ReturnType<VideoEnhancementMediaAdapter["shutdown"]>;
}

export interface VideoEnhancementRuntimeFactoryOptions {
  readonly studio: Pick<StudioRuntime, "queue" | "index" | "scheduler">;
  readonly settings: Pick<SettingsStore, "get">;
  readonly ffmpeg: FfmpegContext;
  readonly platform?: NodeJS.Platform;
  readonly workspaceRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly stagingRoot?: string;
  readonly processDependencies?: VideoEnhancementProcessDependencies;
  readonly backend?: VideoEnhancementBackend;
}

interface RecoverableVideoEnhancementBackend extends VideoEnhancementBackend {
  recoverInterruptedArtifacts(
    childJobIds: readonly string[],
  ): Promise<readonly Video2xInterruptedArtifactRecovery[]>;
}

export function createVideoEnhancementRuntimeBundle(
  options: VideoEnhancementRuntimeFactoryOptions,
): VideoEnhancementRuntimeBundle {
  const platform = options.platform ?? process.platform;
  const processDependencies =
    options.processDependencies ??
    createVideoEnhancementProcessDependencies({
      platform,
      ffmpeg: options.ffmpeg,
      workspaceRoot: options.workspaceRoot,
      env: options.env,
    });
  const backend =
    options.backend ??
    new Video2xAdapter({
      settings: options.settings,
      processRunner: processDependencies.processRunner,
      stagingRoot:
        options.stagingRoot ??
        path.join(nexusHome(), "video-enhancement", "staging"),
      env: options.env,
      platform,
      workspaceRoot: options.workspaceRoot,
    });
  const service = new VideoEnhancementService(backend);
  const persistence = new VideoEnhancementPersistenceAdapter(
    options.studio.queue,
    options.studio.index,
  );
  const media = new VideoEnhancementMediaAdapter(
    new VideoEnhancementMediaLifecycle(
      processDependencies.ffprobe,
      processDependencies.ffmpeg,
    ),
  );
  const runtime = new VideoEnhancementRuntime({
    queue: persistence,
    storage: persistence,
    scheduler: options.studio.scheduler,
    service,
    media,
    publication: media,
  });
  const recoverableBackend = supportsInterruptedArtifactRecovery(backend)
    ? backend
    : null;
  let initialization: Promise<
    readonly Video2xInterruptedArtifactRecovery[]
  > | null = null;
  const initialize = (): Promise<
    readonly Video2xInterruptedArtifactRecovery[]
  > => {
    initialization ??= (async () => {
      if (!recoverableBackend) return Object.freeze([]);
      const interruptedChildIds = (await persistence.listEnhancements())
        .filter((job) => job.state === "interrupted")
        .map((job) => job.childJobId);
      return recoverableBackend.recoverInterruptedArtifacts(
        interruptedChildIds,
      );
    })();
    return initialization;
  };

  return Object.freeze({
    runtime,
    persistence,
    media,
    initialize,
    async probe(signal?: AbortSignal): Promise<VideoEnhancementCapability> {
      await initialize();
      const capability = await service.probe(signal);
      if (capability.status !== "ready") return capability;
      try {
        const mediaProbe = await processDependencies.probeMediaTools(signal);
        if (mediaProbe.ok) return capability;
        return mediaUnavailableCapability(capability, mediaProbe.diagnostic);
      } catch {
        return mediaUnavailableCapability(
          capability,
          "The configured ffmpeg or ffprobe executable could not be verified.",
        );
      }
    },
    stopActive: () => runtime.shutdown(),
    cleanupMedia: () => media.shutdown(),
  });
}

function supportsInterruptedArtifactRecovery(
  backend: VideoEnhancementBackend,
): backend is RecoverableVideoEnhancementBackend {
  return (
    "recoverInterruptedArtifacts" in backend &&
    typeof backend.recoverInterruptedArtifacts === "function"
  );
}

function mediaUnavailableCapability(
  capability: Extract<VideoEnhancementCapability, { status: "ready" }>,
  diagnostic: string,
): VideoEnhancementCapability {
  const unavailable = Object.freeze({
    state: "unavailable",
    reason: "Compatible ffmpeg and ffprobe executables are required.",
  }) satisfies VideoEnhancementPresetAvailability;
  const presets = Object.fromEntries(
    PRESET_IDS.map((presetId) => [presetId, unavailable]),
  ) as Record<VideoEnhancementPresetId, VideoEnhancementPresetAvailability>;
  return Object.freeze({
    ...capability,
    status: "unavailable",
    reason: "probe_failed",
    presets: Object.freeze(presets),
    diagnostic,
  });
}
