import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type {
  RationalFrameRate,
  VideoEnhancementErrorCode,
  VideoEnhancementProgressStage,
  VideoEnhancementStagedSuccess,
  VideoSourceIdentity,
} from "../../../../core/video/VideoEnhancement.js";
import {
  createVideoEnhancementDurableProvenance,
  createVideoEnhancementEmbeddedProvenance,
  serializeVideoWorkflowMetadata,
  type VideoEnhancementDurableProvenance,
  type VideoEnhancementEmbeddedProvenance,
  type VideoEnhancementPresetRouting,
  type VideoEnhancementPreservationState,
  type VideoWorkflowMetadata,
} from "../../../../core/video/WorkflowMetadata.js";

const MAX_PROBE_OUTPUT_BYTES = 1_048_576;
const MIN_DURATION_TOLERANCE_SECONDS = 0.25;

export interface VideoMediaToolExecutionResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Injected ffprobe execution seam. Implementations must execute argv directly. */
export interface VideoFfprobeExecutionPort {
  run(
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<VideoMediaToolExecutionResult>;
}

/** Injected ffmpeg execution seam. Implementations must execute argv directly. */
export interface VideoFfmpegExecutionPort {
  run(
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<VideoMediaToolExecutionResult>;
}

export interface ExpectedVideoMedia {
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly frameRate: RationalFrameRate;
}

export interface ValidatedVideoMedia extends ExpectedVideoMedia {
  readonly canonicalPath: string;
  readonly sizeBytes: number;
  readonly frameCount: number | null;
  readonly videoStreamIndex: number;
  readonly audioStreamCount: number;
  readonly subtitleStreamCount: number;
}

export interface PrepareEnhancedVideoPublicationInput {
  readonly sourceGenerationId: string;
  readonly sourceOutputId: string;
  readonly provenanceRecordId: string;
  readonly nexusRelease: string;
  readonly presetRouting: VideoEnhancementPresetRouting;
  readonly sourceWorkflow: VideoWorkflowMetadata;
  readonly staged: VideoEnhancementStagedSuccess;
  /** Non-existing job-owned path for the metadata-bearing staged copy. */
  readonly metadataStagedPath: string;
  /** Non-existing final output path on the same filesystem. */
  readonly finalPath: string;
  readonly signal?: AbortSignal;
}

export interface VideoMediaFileIdentity {
  readonly device: number;
  readonly inode: number;
  readonly sizeBytes: number;
}

export interface PreparedEnhancedVideoPublication {
  readonly sourcePath: string;
  readonly metadataStagedPath: string;
  readonly finalPath: string;
  readonly sourceSha256: string;
  readonly preProvenanceContainerSha256: string;
  readonly publishedContainerSha256: string;
  readonly embeddedWorkflow: VideoWorkflowMetadata;
  readonly embeddedProvenance: VideoEnhancementEmbeddedProvenance;
  readonly durableProvenance: VideoEnhancementDurableProvenance;
  readonly media: ValidatedVideoMedia;
  readonly metadataStagedIdentity: VideoMediaFileIdentity;
}

export interface PromotedEnhancedVideoPublication {
  readonly finalPath: string;
  readonly publishedContainerSha256: string;
  /** A valid final file exists even when best-effort staging cleanup failed. */
  readonly stagedCopyRetained: boolean;
}

export type VideoEnhancementMediaLifecycleErrorCode = Extract<
  VideoEnhancementErrorCode,
  | "invalid_request"
  | "source_changed"
  | "source_invalid"
  | "output_conflict"
  | "cancelled"
  | "output_invalid"
  | "provenance_failed"
  | "publish_failed"
  | "internal_error"
>;

export class VideoEnhancementMediaLifecycleError extends Error {
  readonly name = "VideoEnhancementMediaLifecycleError";

  constructor(
    readonly code: VideoEnhancementMediaLifecycleErrorCode,
    readonly stage: VideoEnhancementProgressStage,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

interface ProbeFormat {
  readonly duration?: unknown;
  readonly size?: unknown;
  readonly tags?: { readonly comment?: unknown; readonly COMMENT?: unknown };
}

interface ProbeStream {
  readonly index?: unknown;
  readonly codec_type?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly avg_frame_rate?: unknown;
  readonly r_frame_rate?: unknown;
  readonly nb_frames?: unknown;
}

interface ProbeDocument {
  readonly format?: ProbeFormat;
  readonly streams?: readonly ProbeStream[];
}

interface ProbedVideo extends ValidatedVideoMedia {
  readonly comment: string | null;
}

export class VideoEnhancementMediaLifecycle {
  constructor(
    private readonly ffprobe: VideoFfprobeExecutionPort,
    private readonly ffmpeg: VideoFfmpegExecutionPort,
  ) {}

  /** Validate the immutable source identity without changing its bytes. */
  async verifySource(
    expected: VideoSourceIdentity,
    signal?: AbortSignal,
  ): Promise<VideoSourceIdentity> {
    const canonicalPath = await canonicalExistingMp4(
      expected.path,
      "source_invalid",
      "The source video path is not a canonical regular MP4 file.",
    );
    const media = await this.probeAndValidate(
      canonicalPath,
      Object.freeze({
        width: expected.width,
        height: expected.height,
        durationSeconds: expected.durationSeconds,
        frameRate: normalizeFrameRate(expected.frameRate),
      }),
      signal,
      "source_invalid",
      "validate",
    );
    const sha256 = await hashFile(canonicalPath, signal, "validate");
    if (
      sha256 !== expected.sha256.toLowerCase() ||
      media.sizeBytes !== expected.sizeBytes
    ) {
      throw lifecycleError(
        "source_changed",
        "validate",
        "The source video identity no longer matches the expected bytes.",
        false,
      );
    }
    return Object.freeze({
      path: canonicalPath,
      sha256,
      sizeBytes: media.sizeBytes,
      durationSeconds: media.durationSeconds,
      width: media.width,
      height: media.height,
      frameRate: media.frameRate,
    });
  }

  /**
   * Validate, provenance-tag, and revalidate a job-owned staged output.
   * This method never creates the public final path.
   */
  async prepare(
    input: PrepareEnhancedVideoPublicationInput,
  ): Promise<PreparedEnhancedVideoPublication> {
    ensureActive(input.signal, "validate");
    const sourcePath = await canonicalExistingMp4(
      input.staged.source.path,
      "source_invalid",
      "The source video path is not a canonical regular MP4 file.",
    );
    const stagedPath = await canonicalExistingMp4(
      input.staged.stagedPath,
      "output_invalid",
      "The staged video path is not a canonical regular MP4 file.",
    );
    const metadataStagedPath = await canonicalNewMp4(
      input.metadataStagedPath,
      "output_conflict",
    );
    const finalPath = await canonicalNewMp4(input.finalPath, "output_conflict");
    if (
      pathsEqual(sourcePath, stagedPath) ||
      pathsEqual(sourcePath, metadataStagedPath) ||
      pathsEqual(sourcePath, finalPath) ||
      pathsEqual(stagedPath, metadataStagedPath) ||
      pathsEqual(stagedPath, finalPath) ||
      pathsEqual(metadataStagedPath, finalPath)
    ) {
      throw lifecycleError(
        "invalid_request",
        "validate",
        "Source, staged, provenance, and final paths must be distinct.",
        false,
      );
    }
    await assertSameFilesystem(metadataStagedPath, finalPath);

    const sourceExpected = expectedFromSource(input.staged);
    const sourceMedia = await this.probeAndValidate(
      sourcePath,
      sourceExpected,
      input.signal,
      "source_invalid",
      "validate",
    );
    const sourceHash = await hashFile(sourcePath, input.signal, "validate");
    if (
      sourceHash !== input.staged.source.sha256.toLowerCase() ||
      sourceMedia.sizeBytes !== input.staged.source.sizeBytes
    ) {
      throw lifecycleError(
        "source_changed",
        "validate",
        "The source video changed before enhancement publication.",
        false,
      );
    }

    const expectedOutput = deriveExpectedEnhancedMedia(input.staged);
    const stagedMedia = await this.probeAndValidate(
      stagedPath,
      expectedOutput,
      input.signal,
      "output_invalid",
      "validate",
    );
    const stagedIdentity = await fileIdentity(
      stagedPath,
      "output_invalid",
      "validate",
    );
    const preProvenanceContainerSha256 = await hashFile(
      stagedPath,
      input.signal,
      "validate",
    );
    ensureActive(input.signal, "provenance");

    const validation = Object.freeze({
      containerReadable: true as const,
      videoStreamReadable: true as const,
      positiveSize: true as const,
      positiveDuration: true as const,
      dimensionsMatch: true as const,
      frameRateMatch: true as const,
      durationWithinTolerance: true as const,
      durationToleranceSeconds: durationTolerance(sourceExpected),
      frameCount:
        stagedMedia.frameCount === null
          ? ("not_observed" as const)
          : ("observed" as const),
      audioPreservation: preservationState(
        sourceMedia.audioStreamCount,
        stagedMedia.audioStreamCount,
      ),
      subtitlePreservation: preservationState(
        sourceMedia.subtitleStreamCount,
        stagedMedia.subtitleStreamCount,
      ),
    });
    const presets = presetsFromStages(input.staged);
    let embeddedProvenance: VideoEnhancementEmbeddedProvenance;
    let embeddedWorkflow: VideoWorkflowMetadata;
    let serializedWorkflow: string;
    try {
      embeddedProvenance = createVideoEnhancementEmbeddedProvenance({
        schemaVersion: 1,
        nexusRelease: input.nexusRelease,
        provenanceRecordId: input.provenanceRecordId,
        parentJobId: input.staged.parentJobId,
        requestId: input.staged.requestId,
        childJobId: input.staged.childJobId,
        mode: modeFromStages(input.staged),
        upscalePreset: presets.upscalePreset,
        interpolationPreset: presets.interpolationPreset,
        presetRouting: input.presetRouting,
        source: {
          generationId: input.sourceGenerationId,
          outputId: input.sourceOutputId,
          sha256: sourceHash,
          sizeBytes: sourceMedia.sizeBytes,
          durationSeconds: sourceMedia.durationSeconds,
          width: sourceMedia.width,
          height: sourceMedia.height,
          frameRate: sourceMedia.frameRate,
        },
        output: {
          preProvenanceContainerSha256,
          sizeBytes: stagedMedia.sizeBytes,
          durationSeconds: stagedMedia.durationSeconds,
          width: stagedMedia.width,
          height: stagedMedia.height,
          frameRate: stagedMedia.frameRate,
          frameCount: stagedMedia.frameCount,
        },
        backend: input.staged.backend,
        execution: input.staged.execution,
        stages: input.staged.stages,
        validation,
        startedAt: input.staged.startedAt,
        completedAt: input.staged.completedAt,
        durationMs: input.staged.durationMs,
        outcome: "completed",
      });
      embeddedWorkflow = Object.freeze({
        ...input.sourceWorkflow,
        enhancement: embeddedProvenance,
      });
      serializedWorkflow = serializeVideoWorkflowMetadata(embeddedWorkflow);
    } catch {
      throw lifecycleError(
        "provenance_failed",
        "provenance",
        "Enhancement provenance could not be constructed.",
        false,
      );
    }

    const ffmpegResult = await executeTool(
      this.ffmpeg,
      Object.freeze([
        "-nostdin",
        "-v",
        "error",
        "-n",
        "-i",
        stagedPath,
        "-map",
        "0",
        "-c",
        "copy",
        "-map_metadata",
        "0",
        "-metadata",
        `comment=${serializedWorkflow}`,
        metadataStagedPath,
      ]),
      input.signal,
      "provenance_failed",
      "provenance",
      "Video metadata embedding failed.",
    );
    if (ffmpegResult.exitCode !== 0) {
      throw lifecycleError(
        "provenance_failed",
        "provenance",
        "Video metadata embedding failed.",
        true,
      );
    }
    ensureActive(input.signal, "provenance");
    if (
      !(await identitiesEqual(
        stagedPath,
        stagedIdentity,
        "provenance_failed",
        "provenance",
      )) ||
      (await hashFile(stagedPath, input.signal, "provenance")) !==
        preProvenanceContainerSha256
    ) {
      throw lifecycleError(
        "provenance_failed",
        "provenance",
        "The staged video changed during provenance embedding.",
        false,
      );
    }
    const canonicalMetadataPath = await canonicalExistingMp4(
      metadataStagedPath,
      "provenance_failed",
      "The provenance-bearing staged video was not created safely.",
      "provenance",
    );
    if (!pathsEqual(canonicalMetadataPath, metadataStagedPath)) {
      throw lifecycleError(
        "provenance_failed",
        "provenance",
        "The provenance-bearing staged video identity changed.",
        false,
      );
    }
    const publishedMedia = await this.probeAndValidate(
      metadataStagedPath,
      expectedOutput,
      input.signal,
      "provenance_failed",
      "provenance",
    );
    if (publishedMedia.comment !== serializedWorkflow) {
      throw lifecycleError(
        "provenance_failed",
        "provenance",
        "The embedded enhancement provenance could not be verified.",
        false,
      );
    }
    const publishedContainerSha256 = await hashFile(
      metadataStagedPath,
      input.signal,
      "provenance",
    );
    const durableProvenance = createVideoEnhancementDurableProvenance(
      embeddedProvenance,
      publishedContainerSha256,
    );
    await assertSourceUnchanged(
      sourcePath,
      sourceHash,
      sourceMedia.sizeBytes,
      input.signal,
      "provenance",
    );
    const metadataStagedIdentity = await fileIdentity(metadataStagedPath);
    ensureActive(input.signal, "provenance");

    return Object.freeze({
      sourcePath,
      metadataStagedPath,
      finalPath,
      sourceSha256: sourceHash,
      preProvenanceContainerSha256,
      publishedContainerSha256,
      embeddedWorkflow,
      embeddedProvenance,
      durableProvenance,
      media: Object.freeze({
        canonicalPath: metadataStagedPath,
        sizeBytes: publishedMedia.sizeBytes,
        durationSeconds: publishedMedia.durationSeconds,
        width: publishedMedia.width,
        height: publishedMedia.height,
        frameRate: publishedMedia.frameRate,
        frameCount: publishedMedia.frameCount,
        videoStreamIndex: publishedMedia.videoStreamIndex,
        audioStreamCount: publishedMedia.audioStreamCount,
        subtitleStreamCount: publishedMedia.subtitleStreamCount,
      }),
      metadataStagedIdentity,
    });
  }

  /** Atomically create the final path without replacing an existing file. */
  async promote(
    prepared: PreparedEnhancedVideoPublication,
    signal?: AbortSignal,
  ): Promise<PromotedEnhancedVideoPublication> {
    ensureActive(signal, "publish");
    const metadataStagedPath = await canonicalExistingMp4(
      prepared.metadataStagedPath,
      "publish_failed",
      "The prepared staged video is unavailable.",
      "publish",
    );
    const finalPath = await canonicalNewMp4(
      prepared.finalPath,
      "output_conflict",
    );
    if (
      !pathsEqual(metadataStagedPath, prepared.metadataStagedPath) ||
      !pathsEqual(finalPath, prepared.finalPath) ||
      !(await identitiesEqual(
        metadataStagedPath,
        prepared.metadataStagedIdentity,
      )) ||
      (await hashFile(metadataStagedPath, signal, "publish")) !==
        prepared.publishedContainerSha256
    ) {
      throw lifecycleError(
        "publish_failed",
        "publish",
        "The prepared staged video changed before publication.",
        false,
      );
    }
    await assertSourceUnchanged(
      prepared.sourcePath,
      prepared.sourceSha256,
      prepared.embeddedProvenance.source.sizeBytes,
      signal,
      "publish",
    );
    ensureActive(signal, "publish");

    let linkCreated = false;
    try {
      try {
        await fs.link(metadataStagedPath, finalPath);
        linkCreated = true;
      } catch (error) {
        if (isNodeError(error, "EEXIST")) {
          throw lifecycleError(
            "output_conflict",
            "publish",
            "The final enhanced video path already exists.",
            false,
          );
        }
        throw lifecycleError(
          "publish_failed",
          "publish",
          "The enhanced video could not be atomically promoted.",
          true,
        );
      }

      const finalIdentity = await fileIdentity(finalPath);
      if (
        !sameIdentity(finalIdentity, prepared.metadataStagedIdentity) ||
        (await hashFile(finalPath, signal, "publish")) !==
          prepared.publishedContainerSha256
      ) {
        throw lifecycleError(
          "publish_failed",
          "publish",
          "The promoted enhanced video failed identity verification.",
          false,
        );
      }
      await assertSourceUnchanged(
        prepared.sourcePath,
        prepared.sourceSha256,
        prepared.embeddedProvenance.source.sizeBytes,
        signal,
        "publish",
      );
    } catch (error) {
      if (linkCreated) {
        try {
          await unlinkExactPromotion(
            finalPath,
            prepared.metadataStagedIdentity,
          );
        } catch {
          throw lifecycleError(
            "publish_failed",
            "publish",
            "The failed enhancement promotion could not be hidden from normal output visibility.",
            true,
          );
        }
      }
      throw error;
    }
    let stagedCopyRetained = false;
    try {
      await fs.unlink(metadataStagedPath);
    } catch {
      stagedCopyRetained = true;
    }
    return Object.freeze({
      finalPath,
      publishedContainerSha256: prepared.publishedContainerSha256,
      stagedCopyRetained,
    });
  }

  private async probeAndValidate(
    canonicalPath: string,
    expected: ExpectedVideoMedia,
    signal: AbortSignal | undefined,
    failureCode: "source_invalid" | "output_invalid" | "provenance_failed",
    stage: "validate" | "provenance",
  ): Promise<ProbedVideo> {
    const result = await executeTool(
      this.ffprobe,
      Object.freeze([
        "-v",
        "error",
        "-show_entries",
        "format=duration,size:format_tags=comment:stream=index,codec_type,width,height,avg_frame_rate,r_frame_rate,nb_frames",
        "-of",
        "json",
        canonicalPath,
      ]),
      signal,
      failureCode,
      stage,
      "Video validation could not run.",
    );
    if (
      result.exitCode !== 0 ||
      Buffer.byteLength(result.stdout, "utf8") > MAX_PROBE_OUTPUT_BYTES
    ) {
      throw lifecycleError(
        failureCode,
        stage,
        "Video validation failed.",
        true,
      );
    }
    ensureActive(signal, stage);
    const stat = await fs.stat(canonicalPath);
    let document: ProbeDocument;
    try {
      document = JSON.parse(result.stdout) as ProbeDocument;
    } catch {
      throw lifecycleError(
        failureCode,
        stage,
        "Video validation returned malformed data.",
        false,
      );
    }
    const formatSize = positiveInteger(document.format?.size);
    const durationSeconds = positiveNumber(document.format?.duration);
    const streams = Array.isArray(document.streams) ? document.streams : [];
    const videoStreams = streams.filter(
      (stream) => stream?.codec_type === "video",
    );
    const matchingVideo = videoStreams.find((stream) => {
      const frameRate = parseFrameRate(
        nonzeroFrameRate(stream.avg_frame_rate)
          ? stream.avg_frame_rate
          : stream.r_frame_rate,
      );
      return (
        stream.width === expected.width &&
        stream.height === expected.height &&
        frameRate !== null &&
        frameRatesEqual(frameRate, expected.frameRate)
      );
    });
    const tolerance = durationTolerance(expected);
    if (
      !stat.isFile() ||
      stat.size <= 0 ||
      formatSize === null ||
      formatSize !== stat.size ||
      durationSeconds === null ||
      !matchingVideo ||
      Math.abs(durationSeconds - expected.durationSeconds) > tolerance
    ) {
      throw lifecycleError(
        failureCode,
        stage,
        "Video media facts did not match the expected output.",
        false,
      );
    }
    const frameRate = parseFrameRate(
      nonzeroFrameRate(matchingVideo.avg_frame_rate)
        ? matchingVideo.avg_frame_rate
        : matchingVideo.r_frame_rate,
    );
    const videoStreamIndex = nonnegativeInteger(matchingVideo.index);
    if (!frameRate || videoStreamIndex === null) {
      throw lifecycleError(
        failureCode,
        stage,
        "Video stream identity was incomplete.",
        false,
      );
    }
    const frameCount = positiveInteger(matchingVideo.nb_frames);
    const commentValue =
      document.format?.tags?.comment ?? document.format?.tags?.COMMENT;
    return Object.freeze({
      canonicalPath,
      sizeBytes: stat.size,
      durationSeconds,
      width: expected.width,
      height: expected.height,
      frameRate,
      frameCount,
      videoStreamIndex,
      audioStreamCount: streams.filter(
        (stream) => stream?.codec_type === "audio",
      ).length,
      subtitleStreamCount: streams.filter(
        (stream) => stream?.codec_type === "subtitle",
      ).length,
      comment: typeof commentValue === "string" ? commentValue : null,
    });
  }
}

export function deriveExpectedEnhancedMedia(
  staged: VideoEnhancementStagedSuccess,
): ExpectedVideoMedia {
  let width = staged.source.width;
  let height = staged.source.height;
  let frameRate = normalizeFrameRate(staged.source.frameRate);
  for (const stage of staged.stages) {
    if (stage.parameters.stage === "upscale") {
      width *= stage.parameters.scaleFactor;
      height *= stage.parameters.scaleFactor;
    } else {
      frameRate = normalizeFrameRate({
        numerator: frameRate.numerator * stage.parameters.frameRateMultiplier,
        denominator: frameRate.denominator,
      });
    }
  }
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw lifecycleError(
      "invalid_request",
      "validate",
      "Expected video dimensions are invalid.",
      false,
    );
  }
  return Object.freeze({
    width,
    height,
    durationSeconds: staged.source.durationSeconds,
    frameRate,
  });
}

function expectedFromSource(
  staged: VideoEnhancementStagedSuccess,
): ExpectedVideoMedia {
  return Object.freeze({
    width: staged.source.width,
    height: staged.source.height,
    durationSeconds: staged.source.durationSeconds,
    frameRate: normalizeFrameRate(staged.source.frameRate),
  });
}

function modeFromStages(
  staged: VideoEnhancementStagedSuccess,
): "upscale" | "interpolate" | "upscale_interpolate" {
  const hasUpscale = staged.stages.some(
    (stage) => stage.parameters.stage === "upscale",
  );
  const hasInterpolation = staged.stages.some(
    (stage) => stage.parameters.stage === "interpolate",
  );
  if (hasUpscale && hasInterpolation) return "upscale_interpolate";
  if (hasUpscale) return "upscale";
  if (hasInterpolation) return "interpolate";
  throw lifecycleError(
    "invalid_request",
    "provenance",
    "Enhancement execution contains no transform stage.",
    false,
  );
}

function presetsFromStages(staged: VideoEnhancementStagedSuccess): {
  readonly upscalePreset:
    | Extract<
        VideoEnhancementStagedSuccess["stages"][number]["parameters"],
        { readonly stage: "upscale" }
      >["presetId"]
    | null;
  readonly interpolationPreset:
    | Extract<
        VideoEnhancementStagedSuccess["stages"][number]["parameters"],
        { readonly stage: "interpolate" }
      >["presetId"]
    | null;
} {
  const upscale = staged.stages.find(
    (stage) => stage.parameters.stage === "upscale",
  );
  const interpolation = staged.stages.find(
    (stage) => stage.parameters.stage === "interpolate",
  );
  return Object.freeze({
    upscalePreset:
      upscale?.parameters.stage === "upscale"
        ? upscale.parameters.presetId
        : null,
    interpolationPreset:
      interpolation?.parameters.stage === "interpolate"
        ? interpolation.parameters.presetId
        : null,
  });
}

function preservationState(
  sourceCount: number | null,
  outputCount: number | null,
): VideoEnhancementPreservationState {
  if (sourceCount === null || outputCount === null) return "not_observed";
  return sourceCount === outputCount ? "preserved" : "changed";
}

function durationTolerance(expected: ExpectedVideoMedia): number {
  return Math.max(
    expected.frameRate.denominator / expected.frameRate.numerator,
    MIN_DURATION_TOLERANCE_SECONDS,
  );
}

function normalizeFrameRate(frameRate: RationalFrameRate): RationalFrameRate {
  if (
    !Number.isSafeInteger(frameRate.numerator) ||
    !Number.isSafeInteger(frameRate.denominator) ||
    frameRate.numerator <= 0 ||
    frameRate.denominator <= 0
  ) {
    throw lifecycleError(
      "invalid_request",
      "validate",
      "Expected rational frame rate is invalid.",
      false,
    );
  }
  const divisor = greatestCommonDivisor(
    frameRate.numerator,
    frameRate.denominator,
  );
  return Object.freeze({
    numerator: frameRate.numerator / divisor,
    denominator: frameRate.denominator / divisor,
  });
}

function parseFrameRate(value: unknown): RationalFrameRate | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    return null;
  }
  return normalizeFrameRate({ numerator, denominator });
}

function nonzeroFrameRate(value: unknown): boolean {
  return parseFrameRate(value) !== null;
}

function frameRatesEqual(
  left: RationalFrameRate,
  right: RationalFrameRate,
): boolean {
  const normalizedLeft = normalizeFrameRate(left);
  const normalizedRight = normalizeFrameRate(right);
  return (
    normalizedLeft.numerator === normalizedRight.numerator &&
    normalizedLeft.denominator === normalizedRight.denominator
  );
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function canonicalExistingMp4(
  candidate: string,
  code:
    | "source_invalid"
    | "output_invalid"
    | "provenance_failed"
    | "publish_failed",
  message: string,
  stage: VideoEnhancementProgressStage = "validate",
): Promise<string> {
  if (
    typeof candidate !== "string" ||
    candidate.includes("\0") ||
    !path.isAbsolute(candidate) ||
    path.extname(candidate).toLowerCase() !== ".mp4"
  ) {
    throw lifecycleError(code, stage, message, false);
  }
  // Leaf must be a regular file. Intermediate OS aliases (Windows 8.3, macOS
  // /var -> /private/var) are resolved; the caller receives realpath.
  try {
    const requested = path.resolve(candidate);
    const linkStat = await fs.lstat(requested);
    if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
      throw lifecycleError(code, stage, message, false);
    }
    const canonical = await fs.realpath(requested);
    const stat = await fs.stat(canonical);
    if (!stat.isFile()) {
      throw lifecycleError(code, stage, message, false);
    }
    return canonical;
  } catch (error) {
    if (error instanceof VideoEnhancementMediaLifecycleError) throw error;
    throw lifecycleError(code, stage, message, false);
  }
}

async function canonicalNewMp4(
  candidate: string,
  conflictCode: "output_conflict",
): Promise<string> {
  if (
    typeof candidate !== "string" ||
    candidate.includes("\0") ||
    !path.isAbsolute(candidate) ||
    path.extname(candidate).toLowerCase() !== ".mp4"
  ) {
    throw lifecycleError(
      "invalid_request",
      "publish",
      "The requested output path is invalid.",
      false,
    );
  }
  const requested = path.resolve(candidate);
  const requestedParent = path.dirname(requested);
  let canonicalParent: string;
  try {
    canonicalParent = await fs.realpath(requestedParent);
  } catch {
    throw lifecycleError(
      "invalid_request",
      "publish",
      "The requested output directory is unavailable.",
      false,
    );
  }
  const canonical = path.join(canonicalParent, path.basename(requested));
  try {
    await fs.lstat(canonical);
    throw lifecycleError(
      conflictCode,
      "publish",
      "The requested output path already exists.",
      false,
    );
  } catch (error) {
    if (error instanceof VideoEnhancementMediaLifecycleError) throw error;
    if (!isNodeError(error, "ENOENT")) {
      throw lifecycleError(
        "publish_failed",
        "publish",
        "The requested output path could not be checked safely.",
        true,
      );
    }
  }
  return canonical;
}

async function assertSameFilesystem(
  metadataStagedPath: string,
  finalPath: string,
): Promise<void> {
  try {
    const [metadataParent, finalParent] = await Promise.all([
      fs.stat(path.dirname(metadataStagedPath)),
      fs.stat(path.dirname(finalPath)),
    ]);
    if (metadataParent.dev !== finalParent.dev) {
      throw lifecycleError(
        "invalid_request",
        "publish",
        "Staged and final outputs must use the same filesystem.",
        false,
      );
    }
  } catch (error) {
    if (error instanceof VideoEnhancementMediaLifecycleError) throw error;
    throw lifecycleError(
      "invalid_request",
      "publish",
      "The output filesystem could not be verified.",
      false,
    );
  }
}

async function hashFile(
  target: string,
  signal: AbortSignal | undefined,
  stage: VideoEnhancementProgressStage,
): Promise<string> {
  ensureActive(signal, stage);
  const hash = createHash("sha256");
  const stream = createReadStream(target, { signal });
  try {
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
  } catch (error) {
    if (signal?.aborted) {
      throw lifecycleError(
        "cancelled",
        stage,
        "Video enhancement publication was cancelled.",
        false,
      );
    }
    throw lifecycleError(
      "internal_error",
      stage,
      "Video bytes could not be hashed.",
      true,
    );
  }
  ensureActive(signal, stage);
  return hash.digest("hex");
}

async function assertSourceUnchanged(
  sourcePath: string,
  expectedHash: string,
  expectedSize: number,
  signal?: AbortSignal,
  stage: VideoEnhancementProgressStage = "validate",
): Promise<void> {
  const currentPath = await canonicalExistingMp4(
    sourcePath,
    "source_invalid",
    "The source video is no longer a canonical regular MP4 file.",
    stage,
  );
  const stat = await fs.stat(currentPath);
  const hash = await hashFile(currentPath, signal, stage);
  if (stat.size !== expectedSize || hash !== expectedHash) {
    throw lifecycleError(
      "source_changed",
      stage,
      "The source video changed during enhancement publication.",
      false,
    );
  }
}

async function fileIdentity(
  target: string,
  code: VideoEnhancementMediaLifecycleErrorCode = "publish_failed",
  stage: VideoEnhancementProgressStage = "publish",
): Promise<VideoMediaFileIdentity> {
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size <= 0) {
    throw lifecycleError(
      code,
      stage,
      "The staged video identity is invalid.",
      false,
    );
  }
  return Object.freeze({
    device: stat.dev,
    inode: stat.ino,
    sizeBytes: stat.size,
  });
}

async function identitiesEqual(
  target: string,
  expected: VideoMediaFileIdentity,
  code: VideoEnhancementMediaLifecycleErrorCode = "publish_failed",
  stage: VideoEnhancementProgressStage = "publish",
): Promise<boolean> {
  return sameIdentity(await fileIdentity(target, code, stage), expected);
}

function sameIdentity(
  left: VideoMediaFileIdentity,
  right: VideoMediaFileIdentity,
): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.sizeBytes === right.sizeBytes
  );
}

async function unlinkExactPromotion(
  target: string,
  expected: VideoMediaFileIdentity,
): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.dev !== expected.device ||
    stat.ino !== expected.inode
  ) {
    return;
  }
  try {
    await fs.unlink(target);
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
}

async function executeTool(
  port: VideoFfprobeExecutionPort | VideoFfmpegExecutionPort,
  args: readonly string[],
  signal: AbortSignal | undefined,
  code: "source_invalid" | "output_invalid" | "provenance_failed",
  stage: "validate" | "provenance",
  message: string,
): Promise<VideoMediaToolExecutionResult> {
  ensureActive(signal, stage);
  try {
    const result = await port.run(args, signal);
    ensureActive(signal, stage);
    if (
      !result ||
      !Number.isInteger(result.exitCode) ||
      typeof result.stdout !== "string" ||
      typeof result.stderr !== "string"
    ) {
      throw lifecycleError(code, stage, message, false);
    }
    return result;
  } catch (error) {
    if (error instanceof VideoEnhancementMediaLifecycleError) throw error;
    if (signal?.aborted) {
      throw lifecycleError(
        "cancelled",
        stage,
        "Video enhancement publication was cancelled.",
        false,
      );
    }
    throw lifecycleError(code, stage, message, true);
  }
}

function ensureActive(
  signal: AbortSignal | undefined,
  stage: VideoEnhancementProgressStage,
): void {
  if (signal?.aborted) {
    throw lifecycleError(
      "cancelled",
      stage,
      "Video enhancement publication was cancelled.",
      false,
    );
  }
}

function lifecycleError(
  code: VideoEnhancementMediaLifecycleErrorCode,
  stage: VideoEnhancementProgressStage,
  message: string,
  retryable: boolean,
): VideoEnhancementMediaLifecycleError {
  return new VideoEnhancementMediaLifecycleError(
    code,
    stage,
    message,
    retryable,
  );
}

function pathsEqual(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isNodeError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
