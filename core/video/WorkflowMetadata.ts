/**
 * v1.0.0 Phase 7.3 -- MP4 workflow metadata embed / extract.
 *
 * Analog of `core/image/WorkflowMetadata.ts` for the video pillar.
 * Where the image side writes a `tEXt` chunk inside the PNG container,
 * the video side writes a `comment` tag inside the MP4 container via
 * `ffmpeg -metadata comment=...` and reads it back via `ffprobe`.
 *
 * The schema mirrors the image-side `WorkflowMetadata` plus video-only
 * fields (`mode: "text2video" | "image2video" | "audio2video"`,
 * `durationSeconds`, `fps`, optional `sourceImageHash` /
 * `sourceAudioHash` / `provenance`). Workflow JSON is sorted-keys so
 * the embed is reproducible.
 *
 * The ffmpeg / ffprobe binaries are bundled with the desktop installer
 * (Phase 9); the path resolver is injected so tests can stub it and the
 * production caller can route to `~/.nexus/runtimes/ffmpeg/`.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

import type {
  RationalFrameRate,
  VideoEnhancementBackendDescriptor,
  VideoEnhancementExecutionEnvironment,
  VideoEnhancementMode,
  VideoEnhancementStageExecution,
  VideoEnhancementInterpolationPresetId,
  VideoEnhancementUpscalePresetId,
} from "./VideoEnhancement.js";

export const NEXUS_VIDEO_WORKFLOW_KEY = "nexus_video_workflow";

export type VideoMode = "text2video" | "image2video" | "audio2video";

export type VideoEnhancementPresetRouting = "explicit" | "derived";
export type VideoEnhancementPreservationState =
  "preserved" | "changed" | "not_observed";

export interface VideoEnhancementSourceProvenance {
  readonly generationId: string;
  readonly outputId: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: RationalFrameRate;
}

export interface VideoEnhancementOutputProvenance {
  readonly preProvenanceContainerSha256: string;
  readonly sizeBytes: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: RationalFrameRate;
  readonly frameCount: number | null;
}

export interface VideoEnhancementValidationProvenance {
  readonly containerReadable: true;
  readonly videoStreamReadable: true;
  readonly positiveSize: true;
  readonly positiveDuration: true;
  readonly dimensionsMatch: true;
  readonly frameRateMatch: true;
  readonly durationWithinTolerance: true;
  readonly durationToleranceSeconds: number;
  readonly frameCount: "observed" | "not_observed";
  readonly audioPreservation: VideoEnhancementPreservationState;
  readonly subtitlePreservation: VideoEnhancementPreservationState;
}

/**
 * Provenance embedded in an enhanced MP4. The final container hash is
 * deliberately absent because embedding that hash would be self-referential.
 */
export interface VideoEnhancementEmbeddedProvenance {
  readonly schemaVersion: 1;
  readonly nexusRelease: string;
  readonly provenanceRecordId: string;
  readonly parentJobId: string;
  readonly requestId: string;
  readonly childJobId: string;
  readonly mode: VideoEnhancementMode;
  readonly upscalePreset: VideoEnhancementUpscalePresetId | null;
  readonly interpolationPreset: VideoEnhancementInterpolationPresetId | null;
  readonly presetRouting: VideoEnhancementPresetRouting;
  readonly source: VideoEnhancementSourceProvenance;
  readonly output: VideoEnhancementOutputProvenance;
  readonly backend: VideoEnhancementBackendDescriptor;
  readonly execution: VideoEnhancementExecutionEnvironment;
  readonly stages: readonly VideoEnhancementStageExecution[];
  readonly validation: VideoEnhancementValidationProvenance;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly outcome: "completed";
}

/** Durable-index projection. This is never accepted by the MP4 serializer. */
export interface VideoEnhancementDurableProvenance extends VideoEnhancementEmbeddedProvenance {
  readonly publishedContainerSha256: string;
}

export interface VideoWorkflowMetadata {
  readonly tool: string;
  readonly version: string;
  readonly kind: "video";
  readonly mode: VideoMode;
  readonly modelId: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly fps: number;
  readonly frameCount: number;
  readonly steps: number;
  readonly cfgScale: number;
  readonly sampler: string;
  readonly seed: number;
  readonly timestamp: string;
  readonly sourceImageHash?: string;
  readonly sourceAudioHash?: string;
  readonly enhancement?: VideoEnhancementEmbeddedProvenance;
  readonly [extension: string]: unknown;
}

export interface FfmpegContext {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  /** Test seam: spawn override. Defaults to node:child_process.spawn. */
  readonly spawnFn?: typeof spawn;
}

/**
 * Embed a video workflow object as the MP4 `comment` metadata tag.
 *
 * Runs `ffmpeg -i <in> -c copy -metadata comment=<json> <out>` to a
 * sibling temp file and then renames it over the input. The input is
 * mutated in place from the caller's perspective; on failure the temp
 * file is cleaned up and the original is untouched.
 */
export async function embedWorkflow(
  mp4Path: string,
  workflow: VideoWorkflowMetadata,
  ctx: FfmpegContext,
): Promise<void> {
  const json = serializeVideoWorkflowMetadata(workflow);
  const tempPath = `${mp4Path}.nexus-tmp.mp4`;
  const args = [
    "-y",
    "-i",
    mp4Path,
    "-c",
    "copy",
    "-metadata",
    `comment=${json}`,
    tempPath,
  ];
  await runFfmpeg(ctx, args);
  try {
    await fs.rename(tempPath, mp4Path);
  } catch (err) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw err;
  }
}

/**
 * Extract a previously-embedded video workflow from an MP4. Uses
 * `ffprobe -show_format -of json <in>` and parses the `tags.comment`
 * value (or `format_tags.comment` depending on ffprobe version) as JSON.
 *
 * Returns `null` when no workflow blob is present, the comment is not
 * JSON, or the parsed object does not match the video schema. Callers
 * that need to surface a parse failure should check `null` and fall
 * back to the raw comment string via `extractCommentRaw`.
 */
export async function extractWorkflow(
  mp4Path: string,
  ctx: FfmpegContext,
): Promise<VideoWorkflowMetadata | null> {
  const raw = await extractCommentRaw(mp4Path, ctx);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isVideoWorkflow(parsed)) return null;
    if (parsed.enhancement === undefined) return parsed;
    const enhancement = normalizeVideoEnhancementProvenance(parsed.enhancement);
    if (!enhancement) return null;
    return Object.freeze({ ...parsed, enhancement });
  } catch {
    return null;
  }
}

/** Serialize workflow metadata after enforcing the enhancement boundary. */
export function serializeVideoWorkflowMetadata(
  workflow: VideoWorkflowMetadata,
): string {
  const enhancement =
    workflow.enhancement === undefined
      ? undefined
      : normalizeVideoEnhancementProvenance(workflow.enhancement);
  if (workflow.enhancement !== undefined && !enhancement) {
    throw new TypeError("Invalid video enhancement provenance.");
  }
  if (
    workflow.enhancement !== undefined &&
    containsPublishedContainerHash(workflow)
  ) {
    throw new TypeError(
      "publishedContainerSha256 is durable-index-only and cannot be embedded.",
    );
  }
  const embeddable = enhancement
    ? Object.freeze({ ...workflow, enhancement })
    : workflow;
  return JSON.stringify(embeddable, sortKeys);
}

export function createVideoEnhancementEmbeddedProvenance(
  value: unknown,
): VideoEnhancementEmbeddedProvenance {
  const normalized = normalizeVideoEnhancementProvenance(value);
  if (!normalized) {
    throw new TypeError("Invalid video enhancement provenance.");
  }
  return normalized;
}

export function createVideoEnhancementDurableProvenance(
  embeddedValue: unknown,
  publishedContainerSha256: string,
): VideoEnhancementDurableProvenance {
  const embedded = normalizeVideoEnhancementProvenance(embeddedValue);
  if (!embedded || !isSha256(publishedContainerSha256)) {
    throw new TypeError("Invalid durable video enhancement provenance.");
  }
  return Object.freeze({
    ...embedded,
    publishedContainerSha256: publishedContainerSha256.toLowerCase(),
  });
}

/**
 * Read the raw `comment` metadata tag from an MP4 without JSON parsing.
 * Returns `null` when ffprobe finds no comment tag.
 */
export async function extractCommentRaw(
  mp4Path: string,
  ctx: FfmpegContext,
): Promise<string | null> {
  const args = ["-v", "error", "-show_format", "-of", "json", mp4Path];
  const stdout = await runFfprobe(ctx, args);
  let parsed: { format?: { tags?: Record<string, string> } };
  try {
    parsed = JSON.parse(stdout) as {
      format?: { tags?: Record<string, string> };
    };
  } catch {
    return null;
  }
  const tags = parsed.format?.tags ?? {};
  return tags.comment ?? tags.COMMENT ?? null;
}

function isVideoWorkflow(value: unknown): value is VideoWorkflowMetadata {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "video" &&
    typeof v.modelId === "string" &&
    typeof v.prompt === "string" &&
    typeof v.durationSeconds === "number" &&
    typeof v.fps === "number" &&
    (v.mode === "text2video" ||
      v.mode === "image2video" ||
      v.mode === "audio2video") &&
    (v.enhancement === undefined ||
      normalizeVideoEnhancementProvenance(v.enhancement) !== null) &&
    !(v.enhancement !== undefined && containsPublishedContainerHash(v))
  );
}

const EMBEDDED_FIELDS = new Set([
  "schemaVersion",
  "nexusRelease",
  "provenanceRecordId",
  "parentJobId",
  "requestId",
  "childJobId",
  "mode",
  "upscalePreset",
  "interpolationPreset",
  "presetRouting",
  "source",
  "output",
  "backend",
  "execution",
  "stages",
  "validation",
  "startedAt",
  "completedAt",
  "durationMs",
  "outcome",
]);
const SOURCE_PROVENANCE_FIELDS = new Set([
  "generationId",
  "outputId",
  "sha256",
  "sizeBytes",
  "durationSeconds",
  "width",
  "height",
  "frameRate",
]);
const OUTPUT_PROVENANCE_FIELDS = new Set([
  "preProvenanceContainerSha256",
  "sizeBytes",
  "durationSeconds",
  "width",
  "height",
  "frameRate",
  "frameCount",
]);
const FRAME_RATE_FIELDS = new Set(["numerator", "denominator"]);
const BACKEND_FIELDS = new Set([
  "id",
  "compatibilityId",
  "version",
  "executableSha256",
  "provenance",
  "configurationSource",
]);
const EXECUTION_FIELDS = new Set(["platform", "selectedDevice"]);
const PLATFORM_FIELDS = new Set(["os", "architecture", "avx2"]);
const DEVICE_FIELDS = new Set(["id", "type", "name"]);
const STAGE_FIELDS = new Set([
  "stageIndex",
  "parameters",
  "backend",
  "startedAt",
  "completedAt",
  "durationMs",
  "exitCode",
  "outcome",
]);
const UPSCALE_PARAMETER_FIELDS = new Set([
  "stage",
  "presetId",
  "contentClass",
  "scaleFactor",
]);
const INTERPOLATION_PARAMETER_FIELDS = new Set([
  "stage",
  "presetId",
  "frameRateMultiplier",
]);
const STAGE_BACKEND_FIELDS = new Set([
  "processor",
  "model",
  "normalizedArguments",
]);
const VALIDATION_FIELDS = new Set([
  "containerReadable",
  "videoStreamReadable",
  "positiveSize",
  "positiveDuration",
  "dimensionsMatch",
  "frameRateMatch",
  "durationWithinTolerance",
  "durationToleranceSeconds",
  "frameCount",
  "audioPreservation",
  "subtitlePreservation",
]);
const UPSCALE_PRESETS = new Set([
  "animation-upscale-2x",
  "animation-upscale-4x",
  "general-upscale-4x",
]);
const INTERPOLATION_PRESETS = new Set(["smooth-2x"]);
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/;

function normalizeVideoEnhancementProvenance(
  value: unknown,
): VideoEnhancementEmbeddedProvenance | null {
  const record = snapshotRecord(value);
  if (
    !record ||
    !hasExactFields(record, EMBEDDED_FIELDS) ||
    record.schemaVersion !== 1 ||
    !isSafeText(record.nexusRelease, 64) ||
    !isIdentifier(record.provenanceRecordId) ||
    !isIdentifier(record.parentJobId) ||
    !isIdentifier(record.requestId) ||
    !isIdentifier(record.childJobId) ||
    !(
      record.mode === "upscale" ||
      record.mode === "interpolate" ||
      record.mode === "upscale_interpolate"
    ) ||
    !(
      record.presetRouting === "explicit" || record.presetRouting === "derived"
    ) ||
    record.outcome !== "completed" ||
    !isTimestamp(record.startedAt) ||
    !isTimestamp(record.completedAt) ||
    !isNonnegativeSafeInteger(record.durationMs)
  ) {
    return null;
  }

  const startedAt = Date.parse(record.startedAt);
  const completedAt = Date.parse(record.completedAt);
  if (
    completedAt < startedAt ||
    record.durationMs !== completedAt - startedAt
  ) {
    return null;
  }

  const upscalePreset = normalizeUpscalePreset(record.upscalePreset);
  const interpolationPreset = normalizeInterpolationPreset(
    record.interpolationPreset,
  );
  if (
    (record.mode === "upscale" &&
      (upscalePreset === null || record.interpolationPreset !== null)) ||
    (record.mode === "interpolate" &&
      (record.upscalePreset !== null || interpolationPreset === null)) ||
    (record.mode === "upscale_interpolate" &&
      (upscalePreset === null || interpolationPreset === null))
  ) {
    return null;
  }

  const source = normalizeSourceProvenance(record.source);
  const output = normalizeOutputProvenance(record.output);
  const backend = normalizeBackend(record.backend);
  const execution = normalizeExecution(record.execution);
  const stages = normalizeStages(record.stages, record.mode);
  const validation = normalizeValidation(record.validation);
  if (!source || !output || !backend || !execution || !stages || !validation) {
    return null;
  }
  if (
    Date.parse(stages[0]!.startedAt) < startedAt ||
    Date.parse(stages.at(-1)!.completedAt) > completedAt ||
    (upscalePreset !== null &&
      stages.find((stage) => stage.parameters.stage === "upscale")?.parameters
        .presetId !== upscalePreset) ||
    (interpolationPreset !== null &&
      stages.find((stage) => stage.parameters.stage === "interpolate")
        ?.parameters.presetId !== interpolationPreset)
  ) {
    return null;
  }
  const expectedOutput = expectedOutputFacts(source, stages);
  if (
    !expectedOutput ||
    output.width !== expectedOutput.width ||
    output.height !== expectedOutput.height ||
    !frameRatesEqual(output.frameRate, expectedOutput.frameRate) ||
    Math.abs(output.durationSeconds - source.durationSeconds) >
      expectedOutput.durationToleranceSeconds ||
    validation.durationToleranceSeconds !==
      expectedOutput.durationToleranceSeconds
  ) {
    return null;
  }

  return Object.freeze({
    schemaVersion: 1,
    nexusRelease: record.nexusRelease,
    provenanceRecordId: record.provenanceRecordId,
    parentJobId: record.parentJobId,
    requestId: record.requestId,
    childJobId: record.childJobId,
    mode: record.mode,
    upscalePreset,
    interpolationPreset,
    presetRouting: record.presetRouting,
    source,
    output,
    backend,
    execution,
    stages,
    validation,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    durationMs: record.durationMs,
    outcome: "completed",
  });
}

function normalizeSourceProvenance(
  value: unknown,
): VideoEnhancementSourceProvenance | null {
  const source = snapshotRecord(value);
  const frameRate = source ? normalizeFrameRate(source.frameRate) : null;
  if (
    !source ||
    !hasExactFields(source, SOURCE_PROVENANCE_FIELDS) ||
    !isIdentifier(source.generationId) ||
    !isIdentifier(source.outputId) ||
    !isSha256(source.sha256) ||
    !isPositiveSafeInteger(source.sizeBytes) ||
    !isPositiveFinite(source.durationSeconds) ||
    !isPositiveSafeInteger(source.width) ||
    !isPositiveSafeInteger(source.height) ||
    !frameRate
  ) {
    return null;
  }
  return Object.freeze({
    generationId: source.generationId,
    outputId: source.outputId,
    sha256: source.sha256.toLowerCase(),
    sizeBytes: source.sizeBytes,
    durationSeconds: source.durationSeconds,
    width: source.width,
    height: source.height,
    frameRate,
  });
}

function normalizeOutputProvenance(
  value: unknown,
): VideoEnhancementOutputProvenance | null {
  const output = snapshotRecord(value);
  const frameRate = output ? normalizeFrameRate(output.frameRate) : null;
  if (
    !output ||
    !hasExactFields(output, OUTPUT_PROVENANCE_FIELDS) ||
    !isSha256(output.preProvenanceContainerSha256) ||
    !isPositiveSafeInteger(output.sizeBytes) ||
    !isPositiveFinite(output.durationSeconds) ||
    !isPositiveSafeInteger(output.width) ||
    !isPositiveSafeInteger(output.height) ||
    !frameRate ||
    !(output.frameCount === null || isPositiveSafeInteger(output.frameCount))
  ) {
    return null;
  }
  return Object.freeze({
    preProvenanceContainerSha256:
      output.preProvenanceContainerSha256.toLowerCase(),
    sizeBytes: output.sizeBytes,
    durationSeconds: output.durationSeconds,
    width: output.width,
    height: output.height,
    frameRate,
    frameCount: output.frameCount,
  });
}

function normalizeFrameRate(value: unknown): RationalFrameRate | null {
  const frameRate = snapshotRecord(value);
  if (
    !frameRate ||
    !hasExactFields(frameRate, FRAME_RATE_FIELDS) ||
    !isPositiveSafeInteger(frameRate.numerator) ||
    !isPositiveSafeInteger(frameRate.denominator)
  ) {
    return null;
  }
  return Object.freeze({
    numerator: frameRate.numerator,
    denominator: frameRate.denominator,
  });
}

function normalizeBackend(
  value: unknown,
): VideoEnhancementBackendDescriptor | null {
  const backend = snapshotRecord(value);
  if (
    !backend ||
    !hasExactFields(backend, BACKEND_FIELDS) ||
    !isSafeText(backend.id, 128) ||
    !isSafeText(backend.compatibilityId, 128) ||
    !isSafeText(backend.version, 128) ||
    !isSha256(backend.executableSha256) ||
    backend.provenance !== "user-supplied-unverified" ||
    !(
      backend.configurationSource === "environment" ||
      backend.configurationSource === "setting"
    )
  ) {
    return null;
  }
  return Object.freeze({
    id: backend.id,
    compatibilityId: backend.compatibilityId,
    version: backend.version,
    executableSha256: backend.executableSha256.toLowerCase(),
    provenance: "user-supplied-unverified",
    configurationSource: backend.configurationSource,
  });
}

function normalizeExecution(
  value: unknown,
): VideoEnhancementExecutionEnvironment | null {
  const execution = snapshotRecord(value);
  const platform = execution ? snapshotRecord(execution.platform) : null;
  const device = execution ? snapshotRecord(execution.selectedDevice) : null;
  if (
    !execution ||
    !hasExactFields(execution, EXECUTION_FIELDS) ||
    !platform ||
    !hasExactFields(platform, PLATFORM_FIELDS) ||
    !(
      platform.os === "win32" ||
      platform.os === "linux" ||
      platform.os === "darwin" ||
      platform.os === "other"
    ) ||
    !(
      platform.architecture === "x64" ||
      platform.architecture === "arm64" ||
      platform.architecture === "other"
    ) ||
    !(
      platform.avx2 === "available" ||
      platform.avx2 === "unavailable" ||
      platform.avx2 === "unknown"
    ) ||
    !device ||
    !hasExactFields(device, DEVICE_FIELDS) ||
    !isNonnegativeSafeInteger(device.id) ||
    !(device.type === "discrete_gpu" || device.type === "integrated_gpu") ||
    !isSafeText(device.name, 256)
  ) {
    return null;
  }
  return Object.freeze({
    platform: Object.freeze({
      os: platform.os,
      architecture: platform.architecture,
      avx2: platform.avx2,
    }),
    selectedDevice: Object.freeze({
      id: device.id,
      type: device.type,
      name: device.name,
    }),
  });
}

function normalizeStages(
  value: unknown,
  mode: VideoEnhancementMode,
): readonly VideoEnhancementStageExecution[] | null {
  const items = snapshotArray(value, 2);
  const expectedKinds =
    mode === "upscale"
      ? (["upscale"] as const)
      : mode === "interpolate"
        ? (["interpolate"] as const)
        : (["upscale", "interpolate"] as const);
  if (!items || items.length !== expectedKinds.length) return null;

  const stages: VideoEnhancementStageExecution[] = [];
  let previousCompletedAt = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < items.length; index += 1) {
    const stage = snapshotRecord(items[index]);
    const expectedKind = expectedKinds[index];
    if (
      !stage ||
      !expectedKind ||
      !hasExactFields(stage, STAGE_FIELDS) ||
      stage.stageIndex !== index + 1 ||
      !isTimestamp(stage.startedAt) ||
      !isTimestamp(stage.completedAt) ||
      !isNonnegativeSafeInteger(stage.durationMs) ||
      stage.exitCode !== 0 ||
      stage.outcome !== "staged"
    ) {
      return null;
    }
    const startedAt = Date.parse(stage.startedAt);
    const completedAt = Date.parse(stage.completedAt);
    if (
      completedAt < startedAt ||
      startedAt < previousCompletedAt ||
      stage.durationMs !== completedAt - startedAt
    ) {
      return null;
    }
    const parameters = normalizeStageParameters(stage.parameters, expectedKind);
    const backend = normalizeStageBackend(stage.backend);
    if (!parameters || !backend) return null;
    stages.push(
      Object.freeze({
        stageIndex: index + 1,
        parameters,
        backend,
        startedAt: stage.startedAt,
        completedAt: stage.completedAt,
        durationMs: stage.durationMs,
        exitCode: 0,
        outcome: "staged",
      }),
    );
    previousCompletedAt = completedAt;
  }
  return Object.freeze(stages);
}

function normalizeStageParameters(
  value: unknown,
  expectedKind: "upscale" | "interpolate",
): VideoEnhancementStageExecution["parameters"] | null {
  const parameters = snapshotRecord(value);
  if (!parameters || parameters.stage !== expectedKind) return null;
  if (expectedKind === "upscale") {
    const preset = normalizeUpscalePreset(parameters.presetId);
    if (
      !hasExactFields(parameters, UPSCALE_PARAMETER_FIELDS) ||
      !preset ||
      !(
        parameters.contentClass === "animation" ||
        parameters.contentClass === "general"
      ) ||
      !(parameters.scaleFactor === 2 || parameters.scaleFactor === 4) ||
      !upscalePresetMatches(
        preset,
        parameters.contentClass,
        parameters.scaleFactor,
      )
    ) {
      return null;
    }
    return Object.freeze({
      stage: "upscale",
      presetId: preset,
      contentClass: parameters.contentClass,
      scaleFactor: parameters.scaleFactor,
    });
  }
  const preset = normalizeInterpolationPreset(parameters.presetId);
  if (
    !hasExactFields(parameters, INTERPOLATION_PARAMETER_FIELDS) ||
    !preset ||
    parameters.frameRateMultiplier !== 2
  ) {
    return null;
  }
  return Object.freeze({
    stage: "interpolate",
    presetId: preset,
    frameRateMultiplier: 2,
  });
}

function expectedOutputFacts(
  source: VideoEnhancementSourceProvenance,
  stages: readonly VideoEnhancementStageExecution[],
):
  (ExpectedOutputFacts & { readonly durationToleranceSeconds: number }) | null {
  let width = source.width;
  let height = source.height;
  let frameRate = source.frameRate;
  for (const stage of stages) {
    if (stage.parameters.stage === "upscale") {
      width *= stage.parameters.scaleFactor;
      height *= stage.parameters.scaleFactor;
    } else {
      const numerator =
        frameRate.numerator * stage.parameters.frameRateMultiplier;
      if (!Number.isSafeInteger(numerator)) return null;
      frameRate = Object.freeze({
        numerator,
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
    return null;
  }
  return Object.freeze({
    width,
    height,
    frameRate,
    durationToleranceSeconds: Math.max(
      source.frameRate.denominator / source.frameRate.numerator,
      0.25,
    ),
  });
}

interface ExpectedOutputFacts {
  readonly width: number;
  readonly height: number;
  readonly frameRate: RationalFrameRate;
}

function frameRatesEqual(
  left: RationalFrameRate,
  right: RationalFrameRate,
): boolean {
  return (
    BigInt(left.numerator) * BigInt(right.denominator) ===
    BigInt(right.numerator) * BigInt(left.denominator)
  );
}

function upscalePresetMatches(
  preset: VideoEnhancementUpscalePresetId,
  contentClass: "animation" | "general",
  scaleFactor: 2 | 4,
): boolean {
  return (
    (preset === "animation-upscale-2x" &&
      contentClass === "animation" &&
      scaleFactor === 2) ||
    (preset === "animation-upscale-4x" &&
      contentClass === "animation" &&
      scaleFactor === 4) ||
    (preset === "general-upscale-4x" &&
      contentClass === "general" &&
      scaleFactor === 4)
  );
}

function normalizeStageBackend(
  value: unknown,
): VideoEnhancementStageExecution["backend"] | null {
  const backend = snapshotRecord(value);
  const argumentsValue = backend
    ? snapshotRecord(backend.normalizedArguments, 32)
    : null;
  if (
    !backend ||
    !hasExactFields(backend, STAGE_BACKEND_FIELDS) ||
    !isSafeText(backend.processor, 128) ||
    !isSafeText(backend.model, 128) ||
    !argumentsValue
  ) {
    return null;
  }
  const normalizedArguments: Record<string, string | number | boolean> =
    Object.create(null) as Record<string, string | number | boolean>;
  for (const [key, argument] of Object.entries(argumentsValue)) {
    if (
      !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(key) ||
      !(
        (typeof argument === "string" && isSafeText(argument, 256)) ||
        (typeof argument === "number" &&
          Number.isFinite(argument) &&
          Math.abs(argument) <= Number.MAX_SAFE_INTEGER) ||
        typeof argument === "boolean"
      )
    ) {
      return null;
    }
    normalizedArguments[key] = argument;
  }
  return Object.freeze({
    processor: backend.processor,
    model: backend.model,
    normalizedArguments: Object.freeze(normalizedArguments),
  });
}

function normalizeValidation(
  value: unknown,
): VideoEnhancementValidationProvenance | null {
  const validation = snapshotRecord(value);
  if (
    !validation ||
    !hasExactFields(validation, VALIDATION_FIELDS) ||
    validation.containerReadable !== true ||
    validation.videoStreamReadable !== true ||
    validation.positiveSize !== true ||
    validation.positiveDuration !== true ||
    validation.dimensionsMatch !== true ||
    validation.frameRateMatch !== true ||
    validation.durationWithinTolerance !== true ||
    !isPositiveFinite(validation.durationToleranceSeconds) ||
    !(
      validation.frameCount === "observed" ||
      validation.frameCount === "not_observed"
    ) ||
    !isPreservationState(validation.audioPreservation) ||
    !isPreservationState(validation.subtitlePreservation)
  ) {
    return null;
  }
  return Object.freeze({
    containerReadable: true,
    videoStreamReadable: true,
    positiveSize: true,
    positiveDuration: true,
    dimensionsMatch: true,
    frameRateMatch: true,
    durationWithinTolerance: true,
    durationToleranceSeconds: validation.durationToleranceSeconds,
    frameCount: validation.frameCount,
    audioPreservation: validation.audioPreservation,
    subtitlePreservation: validation.subtitlePreservation,
  });
}

function normalizeUpscalePreset(
  value: unknown,
): VideoEnhancementUpscalePresetId | null {
  return typeof value === "string" && UPSCALE_PRESETS.has(value)
    ? (value as VideoEnhancementUpscalePresetId)
    : null;
}

function normalizeInterpolationPreset(
  value: unknown,
): VideoEnhancementInterpolationPresetId | null {
  return typeof value === "string" && INTERPOLATION_PRESETS.has(value)
    ? (value as VideoEnhancementInterpolationPresetId)
    : null;
}

function isPreservationState(
  value: unknown,
): value is VideoEnhancementPreservationState {
  return (
    value === "preserved" || value === "changed" || value === "not_observed"
  );
}

function snapshotRecord(
  value: unknown,
  maxFields = 64,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.getOwnPropertySymbols(value).length > 0 ||
    Object.keys(descriptors).length > maxFields
  ) {
    return null;
  }
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !("value" in descriptor)) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotArray(
  value: unknown,
  maxLength: number,
): readonly unknown[] | null {
  if (!Array.isArray(value) || value.length > maxLength) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).filter((key) => key !== "length");
  if (keys.length !== value.length) return null;
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return null;
    }
    result.push(descriptor.value);
  }
  return result;
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= 256 && ID_PATTERN.test(value)
  );
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function containsPublishedContainerHash(value: unknown): boolean {
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown): boolean => {
    if (!candidate || typeof candidate !== "object") return false;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "publishedContainerSha256") return true;
      if ("value" in descriptor && visit(descriptor.value)) return true;
    }
    return false;
  };
  return visit(value);
}

function sortKeys(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (value as Record<string, unknown>)[key];
        return acc;
      }, {});
  }
  return value;
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

async function runFfmpeg(
  ctx: FfmpegContext,
  args: readonly string[],
): Promise<RunResult> {
  const result = await runCommand(ctx.ffmpegPath, args, ctx.spawnFn ?? spawn);
  if (result.code !== 0) {
    throw new Error(`ffmpeg failed (${result.code}): ${result.stderr}`);
  }
  return result;
}

async function runFfprobe(
  ctx: FfmpegContext,
  args: readonly string[],
): Promise<string> {
  const result = await runCommand(ctx.ffprobePath, args, ctx.spawnFn ?? spawn);
  if (result.code !== 0) {
    throw new Error(`ffprobe failed (${result.code}): ${result.stderr}`);
  }
  return result.stdout;
}

function runCommand(
  command: string,
  args: readonly string[],
  spawnFn: typeof spawn,
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawnFn(command, args as string[], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) =>
      stdoutChunks.push(Buffer.from(chunk)),
    );
    child.stderr?.on("data", (chunk: Buffer) =>
      stderrChunks.push(Buffer.from(chunk)),
    );
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        code: code ?? -1,
      });
    });
  });
}
