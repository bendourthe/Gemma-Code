/**
 * Backend-neutral video enhancement contract.
 *
 * This module intentionally contains no process, filesystem, desktop, or
 * vendor adapter dependencies. Platform adapters validate canonical files and
 * produce a staged result; publication remains a separate lifecycle step.
 */

export const DEFAULT_VIDEO_ENHANCEMENT_TIMEOUT_MS = 21_600_000;
export const MIN_VIDEO_ENHANCEMENT_TIMEOUT_MS = 60_000;
export const MAX_VIDEO_ENHANCEMENT_TIMEOUT_MS = 86_400_000;
export const MAX_VIDEO_ENHANCEMENT_JOB_ID_LENGTH = 256;

export const VIDEO_ENHANCEMENT_UPSCALE_PRESET_IDS = Object.freeze([
  "animation-upscale-2x",
  "animation-upscale-4x",
  "general-upscale-4x",
] as const);

export const VIDEO_ENHANCEMENT_INTERPOLATION_PRESET_IDS = Object.freeze([
  "smooth-2x",
] as const);

export type VideoEnhancementUpscalePresetId =
  (typeof VIDEO_ENHANCEMENT_UPSCALE_PRESET_IDS)[number];
export type VideoEnhancementInterpolationPresetId =
  (typeof VIDEO_ENHANCEMENT_INTERPOLATION_PRESET_IDS)[number];
export type VideoEnhancementPresetId =
  VideoEnhancementUpscalePresetId | VideoEnhancementInterpolationPresetId;

export type VideoEnhancementMode =
  "upscale" | "interpolate" | "upscale_interpolate";

export interface VideoEnhancementUpscalePreset {
  readonly id: VideoEnhancementUpscalePresetId;
  readonly kind: "upscale";
  readonly contentClass: "animation" | "general";
  readonly scaleFactor: 2 | 4;
}

export interface VideoEnhancementInterpolationPreset {
  readonly id: VideoEnhancementInterpolationPresetId;
  readonly kind: "interpolate";
  readonly frameRateMultiplier: 2;
}

export type VideoEnhancementPreset =
  VideoEnhancementUpscalePreset | VideoEnhancementInterpolationPreset;

/**
 * Semantic preset registry. Backend processor, model, and argv details do not
 * belong in this core boundary.
 */
export const VIDEO_ENHANCEMENT_PRESETS = Object.freeze({
  "animation-upscale-2x": Object.freeze({
    id: "animation-upscale-2x",
    kind: "upscale",
    contentClass: "animation",
    scaleFactor: 2,
  }),
  "animation-upscale-4x": Object.freeze({
    id: "animation-upscale-4x",
    kind: "upscale",
    contentClass: "animation",
    scaleFactor: 4,
  }),
  "general-upscale-4x": Object.freeze({
    id: "general-upscale-4x",
    kind: "upscale",
    contentClass: "general",
    scaleFactor: 4,
  }),
  "smooth-2x": Object.freeze({
    id: "smooth-2x",
    kind: "interpolate",
    frameRateMultiplier: 2,
  }),
} as const satisfies Readonly<
  Record<VideoEnhancementPresetId, VideoEnhancementPreset>
>);

export interface RationalFrameRate {
  readonly numerator: number;
  readonly denominator: number;
}

export interface VideoSourceIdentity {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: RationalFrameRate;
}

interface VideoEnhancementRequestCommon {
  readonly requestId: string;
  readonly parentJobId: string;
  readonly source: VideoSourceIdentity;
  readonly requestedAt: string;
  readonly timeoutMs: number;
}

export interface VideoEnhancementUpscaleRequest extends VideoEnhancementRequestCommon {
  readonly mode: "upscale";
  readonly upscalePreset: VideoEnhancementUpscalePresetId;
  readonly interpolationPreset?: never;
}

export interface VideoEnhancementInterpolationRequest extends VideoEnhancementRequestCommon {
  readonly mode: "interpolate";
  readonly upscalePreset?: never;
  readonly interpolationPreset: VideoEnhancementInterpolationPresetId;
}

export interface VideoEnhancementCombinedRequest extends VideoEnhancementRequestCommon {
  readonly mode: "upscale_interpolate";
  readonly upscalePreset: VideoEnhancementUpscalePresetId;
  readonly interpolationPreset: VideoEnhancementInterpolationPresetId;
}

export type VideoEnhancementRequest =
  | VideoEnhancementUpscaleRequest
  | VideoEnhancementInterpolationRequest
  | VideoEnhancementCombinedRequest;

export const VIDEO_ENHANCEMENT_CAPABILITY_REASONS = Object.freeze([
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
] as const);

export type VideoEnhancementCapabilityReason =
  (typeof VIDEO_ENHANCEMENT_CAPABILITY_REASONS)[number];
export type VideoEnhancementPresetAvailabilityState =
  "available" | "unavailable" | "unverified";

export interface VideoEnhancementPresetAvailability {
  readonly state: VideoEnhancementPresetAvailabilityState;
  readonly reason: string | null;
}

export interface VideoEnhancementBackendDescriptor {
  readonly id: string;
  readonly compatibilityId: string;
  readonly version: string;
  readonly executableSha256: string | null;
  readonly provenance: "user-supplied-unverified";
  readonly configurationSource: "environment" | "setting" | null;
}

export type VideoEnhancementPlatform = "win32" | "linux" | "darwin" | "other";
export type VideoEnhancementArchitecture = "x64" | "arm64" | "other";
export type VideoEnhancementAvx2Status =
  "available" | "unavailable" | "unknown";

export interface VideoEnhancementPlatformFacts {
  readonly os: VideoEnhancementPlatform;
  readonly architecture: VideoEnhancementArchitecture;
  readonly avx2: VideoEnhancementAvx2Status;
}

export interface VideoEnhancementVulkanDevice {
  readonly id: number;
  readonly type: "discrete_gpu" | "integrated_gpu";
  readonly name: string;
  readonly selected: boolean;
}

interface VideoEnhancementCapabilityBase {
  readonly backend: VideoEnhancementBackendDescriptor;
  readonly platform: VideoEnhancementPlatformFacts;
  readonly devices: readonly VideoEnhancementVulkanDevice[];
  readonly presets: Readonly<
    Record<VideoEnhancementPresetId, VideoEnhancementPresetAvailability>
  >;
  readonly probedAt: string;
  readonly diagnostic: string | null;
}

export interface VideoEnhancementReadyCapability extends VideoEnhancementCapabilityBase {
  readonly status: "ready";
  readonly reason: null;
}

export interface VideoEnhancementUnavailableCapability extends VideoEnhancementCapabilityBase {
  readonly status: "unavailable" | "unsupported";
  readonly reason: VideoEnhancementCapabilityReason;
}

export type VideoEnhancementCapability =
  VideoEnhancementReadyCapability | VideoEnhancementUnavailableCapability;

export const VIDEO_ENHANCEMENT_PROGRESS_STAGES = Object.freeze([
  "preflight",
  "upscale",
  "interpolate",
  "validate",
  "provenance",
  "publish",
] as const);

export type VideoEnhancementProgressStage =
  (typeof VIDEO_ENHANCEMENT_PROGRESS_STAGES)[number];

export interface VideoEnhancementProgress {
  readonly requestId: string;
  readonly childJobId: string;
  readonly stage: VideoEnhancementProgressStage;
  readonly stageIndex: number;
  readonly stageCount: number;
  readonly processedFrames?: number;
  readonly totalFrames?: number;
  readonly percent?: number;
  readonly processingFps?: number;
  readonly elapsedMs?: number;
  readonly remainingMs?: number;
  readonly message: string;
}

export interface VideoEnhancementProgressSnapshot {
  readonly processedFrames?: number;
  readonly totalFrames?: number;
  readonly percent?: number;
  readonly processingFps?: number;
  readonly elapsedMs?: number;
  readonly remainingMs?: number;
}

export interface VideoEnhancementUpscaleStageParameters {
  readonly stage: "upscale";
  readonly presetId: VideoEnhancementUpscalePresetId;
  readonly contentClass: "animation" | "general";
  readonly scaleFactor: 2 | 4;
}

export interface VideoEnhancementInterpolationStageParameters {
  readonly stage: "interpolate";
  readonly presetId: VideoEnhancementInterpolationPresetId;
  readonly frameRateMultiplier: 2;
}

export type VideoEnhancementStageParameters =
  | VideoEnhancementUpscaleStageParameters
  | VideoEnhancementInterpolationStageParameters;

export type VideoEnhancementNormalizedArgumentValue = string | number | boolean;

export interface VideoEnhancementStageBackendProvenance {
  readonly processor: string;
  readonly model: string;
  readonly normalizedArguments: Readonly<
    Record<string, VideoEnhancementNormalizedArgumentValue>
  >;
}

export interface VideoEnhancementExecutionDevice {
  readonly id: number;
  readonly type: "discrete_gpu" | "integrated_gpu";
  readonly name: string;
}

export interface VideoEnhancementExecutionEnvironment {
  readonly platform: VideoEnhancementPlatformFacts;
  readonly selectedDevice: VideoEnhancementExecutionDevice;
}

export interface VideoEnhancementStageExecution {
  readonly stageIndex: number;
  readonly parameters: VideoEnhancementStageParameters;
  readonly backend: VideoEnhancementStageBackendProvenance;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly outcome: "staged";
}

export const VIDEO_ENHANCEMENT_ERROR_CODES = Object.freeze([
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
] as const);

export type VideoEnhancementErrorCode =
  (typeof VIDEO_ENHANCEMENT_ERROR_CODES)[number];

export interface VideoEnhancementError {
  readonly code: VideoEnhancementErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly stage: VideoEnhancementProgressStage;
  readonly diagnostics: string | null;
  readonly terminationConfirmed: boolean | null;
}

export interface VideoEnhancementStagedSuccess {
  readonly ok: true;
  readonly outcome: "staged";
  readonly requestId: string;
  readonly parentJobId: string;
  readonly childJobId: string;
  readonly source: VideoSourceIdentity;
  readonly stagedPath: string;
  readonly backend: VideoEnhancementBackendDescriptor;
  readonly stages: readonly VideoEnhancementStageExecution[];
  readonly execution: VideoEnhancementExecutionEnvironment;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly warnings: readonly string[];
  readonly progress: VideoEnhancementProgressSnapshot;
}

export interface VideoEnhancementFailure {
  readonly ok: false;
  readonly requestId: string | null;
  readonly parentJobId: string | null;
  readonly childJobId: string | null;
  readonly error: VideoEnhancementError;
}

export type VideoEnhancementResult =
  VideoEnhancementStagedSuccess | VideoEnhancementFailure;

export interface VideoEnhancementBackendRunContext {
  readonly childJobId: string;
  readonly signal: AbortSignal;
  readonly onProgress?: (event: VideoEnhancementProgress) => void;
}

export interface VideoEnhancementBackend {
  probe(signal?: AbortSignal): Promise<VideoEnhancementCapability>;
  run(
    request: VideoEnhancementRequest,
    context: VideoEnhancementBackendRunContext,
  ): Promise<VideoEnhancementResult>;
}

export type VideoEnhancementRequestValidation =
  | { readonly ok: true; readonly value: VideoEnhancementRequest }
  | { readonly ok: false; readonly error: VideoEnhancementError };

const REQUEST_FIELDS = new Set([
  "requestId",
  "parentJobId",
  "source",
  "mode",
  "upscalePreset",
  "interpolationPreset",
  "requestedAt",
  "timeoutMs",
]);
const SOURCE_FIELDS = new Set([
  "path",
  "sha256",
  "sizeBytes",
  "durationSeconds",
  "width",
  "height",
  "frameRate",
]);
const FRAME_RATE_FIELDS = new Set(["numerator", "denominator"]);
const CAPABILITY_FIELDS = new Set([
  "status",
  "reason",
  "backend",
  "platform",
  "devices",
  "presets",
  "probedAt",
  "diagnostic",
]);
const BACKEND_DESCRIPTOR_FIELDS = new Set([
  "id",
  "compatibilityId",
  "version",
  "executableSha256",
  "provenance",
  "configurationSource",
]);
const PLATFORM_FIELDS = new Set(["os", "architecture", "avx2"]);
const DEVICE_FIELDS = new Set(["id", "type", "name", "selected"]);
const EXECUTION_FIELDS = new Set(["platform", "selectedDevice"]);
const EXECUTION_DEVICE_FIELDS = new Set(["id", "type", "name"]);
const PRESET_AVAILABILITY_FIELDS = new Set(["state", "reason"]);
const PROGRESS_FIELDS = new Set([
  "requestId",
  "childJobId",
  "stage",
  "stageIndex",
  "stageCount",
  "processedFrames",
  "totalFrames",
  "percent",
  "processingFps",
  "elapsedMs",
  "remainingMs",
  "message",
]);
const PROGRESS_SNAPSHOT_FIELDS = new Set([
  "processedFrames",
  "totalFrames",
  "percent",
  "processingFps",
  "elapsedMs",
  "remainingMs",
]);
const SUCCESS_FIELDS = new Set([
  "ok",
  "outcome",
  "requestId",
  "parentJobId",
  "childJobId",
  "source",
  "stagedPath",
  "backend",
  "stages",
  "execution",
  "startedAt",
  "completedAt",
  "durationMs",
  "warnings",
  "progress",
]);
const FAILURE_FIELDS = new Set([
  "ok",
  "requestId",
  "parentJobId",
  "childJobId",
  "error",
]);
const ERROR_FIELDS = new Set([
  "code",
  "message",
  "retryable",
  "stage",
  "diagnostics",
  "terminationConfirmed",
]);
const STAGE_EXECUTION_FIELDS = new Set([
  "stageIndex",
  "parameters",
  "backend",
  "startedAt",
  "completedAt",
  "durationMs",
  "exitCode",
  "outcome",
]);
const UPSCALE_STAGE_PARAMETER_FIELDS = new Set([
  "stage",
  "presetId",
  "contentClass",
  "scaleFactor",
]);
const INTERPOLATION_STAGE_PARAMETER_FIELDS = new Set([
  "stage",
  "presetId",
  "frameRateMultiplier",
]);
const STAGE_BACKEND_FIELDS = new Set([
  "processor",
  "model",
  "normalizedArguments",
]);
const UUID_PATTERN =
  /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOWERCASE_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?Z$/;
const MAX_SAFE_SOURCE_DIMENSION = Math.floor(Number.MAX_SAFE_INTEGER / 4);
const MAX_SAFE_SOURCE_FPS_NUMERATOR = Math.floor(Number.MAX_SAFE_INTEGER / 2);
const MAX_SAFE_SOURCE_DURATION_SECONDS = Number.MAX_SAFE_INTEGER / 1_000;
const MAX_BACKEND_TEXT_LENGTH = 256;
const MAX_CAPABILITY_DIAGNOSTIC_LENGTH = 8_192;
const MAX_DEVICE_COUNT = 64;
const MAX_DEVICE_NAME_LENGTH = 160;
const MAX_PRESET_REASON_LENGTH = 512;
const MAX_PROGRESS_MESSAGE_LENGTH = 2_048;
const MAX_ERROR_MESSAGE_LENGTH = 2_048;
const MAX_ERROR_DIAGNOSTIC_LENGTH = 8_192;
const MAX_WARNING_COUNT = 32;
const MAX_WARNING_LENGTH = 1_024;
const MAX_STAGED_PATH_LENGTH = 32_767;
const MAX_STAGE_COUNT = 2;
const MAX_NORMALIZED_ARGUMENT_COUNT = 16;
const MAX_NORMALIZED_ARGUMENT_TEXT_LENGTH = 256;
const MAX_SAFE_FRAME_COUNT = Math.floor(Number.MAX_SAFE_INTEGER / 2);
const NORMALIZED_ARGUMENT_KEY_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/;
const ABORT_SIGNAL_ABORTED_GETTER =
  typeof AbortSignal === "function"
    ? (Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get ??
      null)
    : null;
const UNSAFE_SINGLE_LINE_TEXT = /[\u0000-\u001f\u007f]/u;
const UNSAFE_MULTILINE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const ABSOLUTE_PATH_LIKE_TEXT =
  /(?:\bfile:\/\/\S+|(?:^|[^\p{L}\p{N}_/])(?:[a-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\s]*|\/(?!\/)(?=\S)\S*))/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotDataRecord(
  value: unknown,
  maxFields?: number,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (maxFields !== undefined && keys.length > maxFields) return null;
  const snapshot: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of keys) {
    if (typeof key !== "string") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function readAbortState(signal: AbortSignal): boolean | null {
  try {
    if (!ABORT_SIGNAL_ABORTED_GETTER) return null;
    const value = Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []);
    if (value === true) return true;
    if (
      value !== false ||
      Object.getOwnPropertyDescriptor(signal, "aborted") !== undefined
    ) {
      return null;
    }
    return false;
  } catch {
    return null;
  }
}

function snapshotDataArray(
  value: unknown,
  maxLength: number,
): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maxLength
  ) {
    return null;
  }
  const length = lengthDescriptor.value as number;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) return null;
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) return null;
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function hasOnlyFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && allowed.has(key),
  );
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonnegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isSafeSingleLineText(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !UNSAFE_SINGLE_LINE_TEXT.test(value) &&
    !ABSOLUTE_PATH_LIKE_TEXT.test(value)
  );
}

function isSafeMultilineText(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !UNSAFE_MULTILINE_TEXT.test(value) &&
    !ABSOLUTE_PATH_LIKE_TEXT.test(value)
  );
}

function isCapabilityReason(
  value: unknown,
): value is VideoEnhancementCapabilityReason {
  return VIDEO_ENHANCEMENT_CAPABILITY_REASONS.some(
    (reason) => reason === value,
  );
}

function isProgressStage(
  value: unknown,
): value is VideoEnhancementProgressStage {
  return VIDEO_ENHANCEMENT_PROGRESS_STAGES.some((stage) => stage === value);
}

function isErrorCode(value: unknown): value is VideoEnhancementErrorCode {
  return VIDEO_ENHANCEMENT_ERROR_CODES.some((code) => code === value);
}

function timestampMilliseconds(value: unknown): number | null {
  if (!isUtcTimestamp(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const date = new Date(parsed);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]) &&
    date.getUTCHours() === Number(match[4]) &&
    date.getUTCMinutes() === Number(match[5]) &&
    date.getUTCSeconds() === Number(match[6])
  );
}

function isOpaqueJobId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.trim().length > 0 &&
    value.length <= MAX_VIDEO_ENHANCEMENT_JOB_ID_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function hasCanonicalSegments(value: string): boolean {
  let remainder = value.replace(/\\/g, "/");
  if (/^[a-z]:\//i.test(remainder)) {
    remainder = remainder.slice(3);
  } else if (remainder.startsWith("//")) {
    remainder = remainder.slice(2);
  } else {
    remainder = remainder.slice(1);
  }
  const segments = remainder.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

/** Lexical only; the platform adapter owns realpath and file checks. */
export function isAbsoluteLocalMp4Path(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\r") ||
    value.includes("\n") ||
    !/\.mp4$/i.test(value)
  ) {
    return false;
  }

  const posixAbsolute = value.startsWith("/") && !value.startsWith("//");
  const driveAbsolute = /^[a-z]:[\\/]/i.test(value);
  const uncAbsolute = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+[\\/]/.test(value);
  return (
    (posixAbsolute || driveAbsolute || uncAbsolute) &&
    hasCanonicalSegments(value)
  );
}

function invalidRequest(message: string): VideoEnhancementRequestValidation {
  const error = Object.freeze({
    code: "invalid_request" as const,
    message,
    retryable: false,
    stage: "preflight" as const,
    diagnostics: null,
    terminationConfirmed: null,
  });
  return Object.freeze({
    ok: false,
    error,
  });
}

function validateSource(value: unknown): VideoSourceIdentity | null {
  const source = snapshotDataRecord(value);
  if (!source || !hasOnlyFields(source, SOURCE_FIELDS)) return null;
  if (!isAbsoluteLocalMp4Path(source.path)) return null;
  if (
    typeof source.sha256 !== "string" ||
    !LOWERCASE_SHA256_PATTERN.test(source.sha256)
  ) {
    return null;
  }
  if (!isPositiveSafeInteger(source.sizeBytes)) return null;
  if (
    !isPositiveFiniteNumber(source.durationSeconds) ||
    source.durationSeconds > MAX_SAFE_SOURCE_DURATION_SECONDS
  )
    return null;
  if (
    !isPositiveSafeInteger(source.width) ||
    !isPositiveSafeInteger(source.height) ||
    source.width > MAX_SAFE_SOURCE_DIMENSION ||
    source.height > MAX_SAFE_SOURCE_DIMENSION
  )
    return null;
  const frameRateValue = snapshotDataRecord(source.frameRate);
  if (!frameRateValue || !hasOnlyFields(frameRateValue, FRAME_RATE_FIELDS)) {
    return null;
  }
  if (
    !isPositiveSafeInteger(frameRateValue.numerator) ||
    !isPositiveSafeInteger(frameRateValue.denominator) ||
    frameRateValue.numerator > MAX_SAFE_SOURCE_FPS_NUMERATOR
  ) {
    return null;
  }

  const frameRate = Object.freeze({
    numerator: frameRateValue.numerator,
    denominator: frameRateValue.denominator,
  });
  return Object.freeze({
    path: source.path,
    sha256: source.sha256,
    sizeBytes: source.sizeBytes,
    durationSeconds: source.durationSeconds,
    width: source.width,
    height: source.height,
    frameRate,
  });
}

function isUpscalePreset(
  value: unknown,
): value is VideoEnhancementUpscalePresetId {
  return (
    value === "animation-upscale-2x" ||
    value === "animation-upscale-4x" ||
    value === "general-upscale-4x"
  );
}

function isInterpolationPreset(
  value: unknown,
): value is VideoEnhancementInterpolationPresetId {
  return value === "smooth-2x";
}

/**
 * Strictly validates and copies an unknown request. Unknown fields are
 * rejected at every nested contract boundary, and the returned request is
 * detached from mutable caller-owned input.
 */
function validateVideoEnhancementRequestUnchecked(
  input: unknown,
): VideoEnhancementRequestValidation {
  const requestValue = snapshotDataRecord(input);
  if (!requestValue)
    return invalidRequest("Video enhancement request must be an object.");
  if (!hasOnlyFields(requestValue, REQUEST_FIELDS)) {
    return invalidRequest(
      "Video enhancement request contains an unknown field.",
    );
  }
  if (
    typeof requestValue.requestId !== "string" ||
    !UUID_PATTERN.test(requestValue.requestId)
  ) {
    return invalidRequest("Video enhancement request ID must be a UUID.");
  }
  if (!isOpaqueJobId(requestValue.parentJobId)) {
    return invalidRequest(
      "Parent job ID must be a non-empty bounded identifier.",
    );
  }
  const source = validateSource(requestValue.source);
  if (!source) return invalidRequest("Video source identity is invalid.");
  if (!isUtcTimestamp(requestValue.requestedAt)) {
    return invalidRequest(
      "Requested timestamp must be an ISO-8601 UTC timestamp.",
    );
  }

  const timeoutMs = hasOwn(requestValue, "timeoutMs")
    ? requestValue.timeoutMs
    : DEFAULT_VIDEO_ENHANCEMENT_TIMEOUT_MS;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_VIDEO_ENHANCEMENT_TIMEOUT_MS ||
    timeoutMs > MAX_VIDEO_ENHANCEMENT_TIMEOUT_MS
  ) {
    return invalidRequest(
      "Video enhancement timeout is outside the allowed range.",
    );
  }

  const common = {
    requestId: requestValue.requestId,
    parentJobId: requestValue.parentJobId,
    source,
    requestedAt: requestValue.requestedAt,
    timeoutMs,
  } as const;

  if (requestValue.mode === "upscale") {
    if (
      !isUpscalePreset(requestValue.upscalePreset) ||
      hasOwn(requestValue, "interpolationPreset")
    ) {
      return invalidRequest(
        "Upscale mode requires only a supported upscale preset.",
      );
    }
    return {
      ok: true,
      value: Object.freeze({
        ...common,
        mode: "upscale",
        upscalePreset: requestValue.upscalePreset,
      }),
    };
  }

  if (requestValue.mode === "interpolate") {
    if (
      !isInterpolationPreset(requestValue.interpolationPreset) ||
      hasOwn(requestValue, "upscalePreset")
    ) {
      return invalidRequest(
        "Interpolation mode requires only the supported interpolation preset.",
      );
    }
    return {
      ok: true,
      value: Object.freeze({
        ...common,
        mode: "interpolate",
        interpolationPreset: requestValue.interpolationPreset,
      }),
    };
  }

  if (requestValue.mode === "upscale_interpolate") {
    if (
      !isUpscalePreset(requestValue.upscalePreset) ||
      !isInterpolationPreset(requestValue.interpolationPreset)
    ) {
      return invalidRequest(
        "Combined mode requires one supported preset for each stage.",
      );
    }
    return {
      ok: true,
      value: Object.freeze({
        ...common,
        mode: "upscale_interpolate",
        upscalePreset: requestValue.upscalePreset,
        interpolationPreset: requestValue.interpolationPreset,
      }),
    };
  }

  return invalidRequest("Video enhancement mode is invalid.");
}

export function validateVideoEnhancementRequest(
  input: unknown,
): VideoEnhancementRequestValidation {
  try {
    return validateVideoEnhancementRequestUnchecked(input);
  } catch {
    return invalidRequest(
      "Video enhancement request could not be read safely.",
    );
  }
}

function normalizeBackendDescriptor(
  value: unknown,
): VideoEnhancementBackendDescriptor | null {
  const descriptor = snapshotDataRecord(value);
  if (!descriptor || !hasOnlyFields(descriptor, BACKEND_DESCRIPTOR_FIELDS)) {
    return null;
  }
  if (
    !isSafeSingleLineText(descriptor.id, MAX_BACKEND_TEXT_LENGTH) ||
    !isSafeSingleLineText(
      descriptor.compatibilityId,
      MAX_BACKEND_TEXT_LENGTH,
    ) ||
    !isSafeSingleLineText(descriptor.version, MAX_BACKEND_TEXT_LENGTH) ||
    descriptor.provenance !== "user-supplied-unverified" ||
    !(
      descriptor.configurationSource === "environment" ||
      descriptor.configurationSource === "setting" ||
      descriptor.configurationSource === null
    ) ||
    !(
      descriptor.executableSha256 === null ||
      (typeof descriptor.executableSha256 === "string" &&
        LOWERCASE_SHA256_PATTERN.test(descriptor.executableSha256))
    )
  ) {
    return null;
  }
  return Object.freeze({
    id: descriptor.id,
    compatibilityId: descriptor.compatibilityId,
    version: descriptor.version,
    executableSha256: descriptor.executableSha256,
    provenance: descriptor.provenance,
    configurationSource: descriptor.configurationSource,
  });
}

function normalizePresetAvailability(
  value: unknown,
): VideoEnhancementPresetAvailability | null {
  const availability = snapshotDataRecord(value);
  if (
    !availability ||
    !hasOnlyFields(availability, PRESET_AVAILABILITY_FIELDS) ||
    !(
      availability.state === "available" ||
      availability.state === "unavailable" ||
      availability.state === "unverified"
    )
  ) {
    return null;
  }
  if (availability.state === "available") {
    if (availability.reason !== null) return null;
  } else if (
    !isSafeSingleLineText(availability.reason, MAX_PRESET_REASON_LENGTH)
  ) {
    return null;
  }
  return Object.freeze({
    state: availability.state,
    reason: availability.reason,
  });
}

function normalizePresetAvailabilityMap(
  value: unknown,
): Readonly<
  Record<VideoEnhancementPresetId, VideoEnhancementPresetAvailability>
> | null {
  const presets = snapshotDataRecord(value);
  if (
    !presets ||
    !hasOnlyFields(
      presets,
      new Set([
        "animation-upscale-2x",
        "animation-upscale-4x",
        "general-upscale-4x",
        "smooth-2x",
      ]),
    )
  ) {
    return null;
  }
  const animation2x = normalizePresetAvailability(
    presets["animation-upscale-2x"],
  );
  const animation4x = normalizePresetAvailability(
    presets["animation-upscale-4x"],
  );
  const general4x = normalizePresetAvailability(presets["general-upscale-4x"]);
  const smooth2x = normalizePresetAvailability(presets["smooth-2x"]);
  if (!animation2x || !animation4x || !general4x || !smooth2x) return null;
  return Object.freeze({
    "animation-upscale-2x": animation2x,
    "animation-upscale-4x": animation4x,
    "general-upscale-4x": general4x,
    "smooth-2x": smooth2x,
  });
}

function normalizePlatformFacts(
  value: unknown,
): VideoEnhancementPlatformFacts | null {
  const platform = snapshotDataRecord(value);
  if (!platform || !hasOnlyFields(platform, PLATFORM_FIELDS)) return null;
  if (
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
    )
  ) {
    return null;
  }
  return Object.freeze({
    os: platform.os,
    architecture: platform.architecture,
    avx2: platform.avx2,
  });
}

function normalizeDevices(
  value: unknown,
): readonly VideoEnhancementVulkanDevice[] | null {
  const devices = snapshotDataArray(value, MAX_DEVICE_COUNT);
  if (!devices) return null;
  const normalized: VideoEnhancementVulkanDevice[] = [];
  const ids = new Set<number>();
  let selectedCount = 0;
  for (const value of devices) {
    const device = snapshotDataRecord(value);
    if (
      !device ||
      !hasOnlyFields(device, DEVICE_FIELDS) ||
      !isNonnegativeSafeInteger(device.id) ||
      ids.has(device.id) ||
      !(device.type === "discrete_gpu" || device.type === "integrated_gpu") ||
      !isSafeSingleLineText(device.name, MAX_DEVICE_NAME_LENGTH) ||
      typeof device.selected !== "boolean"
    ) {
      return null;
    }
    ids.add(device.id);
    if (device.selected) selectedCount += 1;
    normalized.push(
      Object.freeze({
        id: device.id,
        type: device.type,
        name: device.name,
        selected: device.selected,
      }),
    );
  }
  return selectedCount <= 1 ? Object.freeze(normalized) : null;
}

function normalizeCapability(
  value: unknown,
): VideoEnhancementCapability | null {
  const capabilityValue = snapshotDataRecord(value);
  if (
    !capabilityValue ||
    !hasOnlyFields(capabilityValue, CAPABILITY_FIELDS) ||
    !(
      capabilityValue.status === "ready" ||
      capabilityValue.status === "unavailable" ||
      capabilityValue.status === "unsupported"
    )
  ) {
    return null;
  }
  if (capabilityValue.status === "ready") {
    if (capabilityValue.reason !== null) return null;
  }
  const backend = normalizeBackendDescriptor(capabilityValue.backend);
  const platform = normalizePlatformFacts(capabilityValue.platform);
  const devices = normalizeDevices(capabilityValue.devices);
  const presets = normalizePresetAvailabilityMap(capabilityValue.presets);
  if (
    !backend ||
    !platform ||
    !devices ||
    !presets ||
    !isUtcTimestamp(capabilityValue.probedAt) ||
    !(
      capabilityValue.diagnostic === null ||
      isSafeMultilineText(
        capabilityValue.diagnostic,
        MAX_CAPABILITY_DIAGNOSTIC_LENGTH,
      )
    ) ||
    (capabilityValue.status === "ready" &&
      (backend.executableSha256 === null ||
        devices.filter((device) => device.selected).length !== 1))
  ) {
    return null;
  }
  const common = {
    backend,
    platform,
    devices,
    presets,
    probedAt: capabilityValue.probedAt,
    diagnostic: capabilityValue.diagnostic,
  } as const;
  if (capabilityValue.status === "ready") {
    return Object.freeze({ ...common, status: "ready", reason: null });
  }
  const reason = capabilityValue.reason;
  if (!isCapabilityReason(reason)) return null;
  return Object.freeze({
    ...common,
    status: capabilityValue.status,
    reason,
  });
}

function internalErrorCapability(): VideoEnhancementCapability {
  const unavailable = Object.freeze({
    state: "unavailable" as const,
    reason: "The enhancement capability probe failed safely.",
  });
  return Object.freeze({
    status: "unavailable" as const,
    reason: "internal_error" as const,
    backend: Object.freeze({
      id: "unknown",
      compatibilityId: "unknown",
      version: "unknown",
      executableSha256: null,
      provenance: "user-supplied-unverified" as const,
      configurationSource: null,
    }),
    platform: Object.freeze({
      os: "other" as const,
      architecture: "other" as const,
      avx2: "unknown" as const,
    }),
    devices: Object.freeze([]),
    presets: Object.freeze({
      "animation-upscale-2x": unavailable,
      "animation-upscale-4x": unavailable,
      "general-upscale-4x": unavailable,
      "smooth-2x": unavailable,
    }),
    probedAt: new Date().toISOString(),
    diagnostic: null,
  });
}

function normalizeProgressMetrics(
  value: Record<string, unknown>,
): VideoEnhancementProgressSnapshot | null {
  const normalized: {
    processedFrames?: number;
    totalFrames?: number;
    percent?: number;
    processingFps?: number;
    elapsedMs?: number;
    remainingMs?: number;
  } = {};
  if (hasOwn(value, "processedFrames")) {
    if (
      !isNonnegativeSafeInteger(value.processedFrames) ||
      value.processedFrames > MAX_SAFE_FRAME_COUNT
    )
      return null;
    normalized.processedFrames = value.processedFrames;
  }
  if (hasOwn(value, "totalFrames")) {
    if (
      !isNonnegativeSafeInteger(value.totalFrames) ||
      value.totalFrames > MAX_SAFE_FRAME_COUNT
    )
      return null;
    normalized.totalFrames = value.totalFrames;
  }
  if (
    normalized.processedFrames !== undefined &&
    normalized.totalFrames !== undefined &&
    normalized.processedFrames > normalized.totalFrames
  ) {
    return null;
  }
  if (hasOwn(value, "percent")) {
    if (
      !isNonnegativeFiniteNumber(value.percent) ||
      value.percent > 100 ||
      normalized.totalFrames === undefined ||
      normalized.totalFrames === 0
    )
      return null;
    normalized.percent = value.percent;
  }
  if (hasOwn(value, "processingFps")) {
    if (
      !isNonnegativeFiniteNumber(value.processingFps) ||
      value.processingFps > MAX_SAFE_SOURCE_FPS_NUMERATOR
    )
      return null;
    normalized.processingFps = value.processingFps;
  }
  if (hasOwn(value, "elapsedMs")) {
    if (
      !isNonnegativeSafeInteger(value.elapsedMs) ||
      value.elapsedMs > MAX_VIDEO_ENHANCEMENT_TIMEOUT_MS
    )
      return null;
    normalized.elapsedMs = value.elapsedMs;
  }
  if (hasOwn(value, "remainingMs")) {
    if (
      !isNonnegativeSafeInteger(value.remainingMs) ||
      value.remainingMs > MAX_VIDEO_ENHANCEMENT_TIMEOUT_MS
    )
      return null;
    normalized.remainingMs = value.remainingMs;
  }
  return Object.freeze(normalized);
}

function normalizeProgressEvent(
  value: unknown,
  request: VideoEnhancementRequest,
  childJobId: string,
): VideoEnhancementProgress | null {
  const progress = snapshotDataRecord(value);
  if (
    !progress ||
    !hasOnlyFields(progress, PROGRESS_FIELDS) ||
    progress.requestId !== request.requestId ||
    progress.childJobId !== childJobId ||
    !isProgressStage(progress.stage) ||
    !isPositiveSafeInteger(progress.stageIndex) ||
    !isPositiveSafeInteger(progress.stageCount) ||
    progress.stageCount > VIDEO_ENHANCEMENT_PROGRESS_STAGES.length ||
    progress.stageIndex > progress.stageCount ||
    !isSafeSingleLineText(progress.message, MAX_PROGRESS_MESSAGE_LENGTH)
  ) {
    return null;
  }
  const metrics = normalizeProgressMetrics(progress);
  if (
    !metrics ||
    (metrics.elapsedMs !== undefined && metrics.elapsedMs > request.timeoutMs)
  )
    return null;
  return Object.freeze({
    requestId: progress.requestId,
    childJobId: progress.childJobId,
    stage: progress.stage,
    stageIndex: progress.stageIndex,
    stageCount: progress.stageCount,
    ...metrics,
    message: progress.message,
  });
}

function isProgressRegression(
  previous: VideoEnhancementProgress,
  next: VideoEnhancementProgress,
): boolean {
  if (
    next.stageCount !== previous.stageCount ||
    next.stageIndex < previous.stageIndex ||
    (next.stageIndex === previous.stageIndex &&
      next.stage !== previous.stage) ||
    (previous.elapsedMs !== undefined &&
      next.elapsedMs !== undefined &&
      next.elapsedMs < previous.elapsedMs)
  ) {
    return true;
  }
  if (next.stageIndex !== previous.stageIndex) return false;
  return (
    (previous.processedFrames !== undefined &&
      next.processedFrames !== undefined &&
      next.processedFrames < previous.processedFrames) ||
    (previous.totalFrames !== undefined &&
      next.totalFrames !== undefined &&
      next.totalFrames !== previous.totalFrames) ||
    (previous.percent !== undefined &&
      next.percent !== undefined &&
      next.percent < previous.percent)
  );
}

function sourcesMatch(
  left: VideoSourceIdentity,
  right: VideoSourceIdentity,
): boolean {
  return (
    left.path === right.path &&
    left.sha256 === right.sha256 &&
    left.sizeBytes === right.sizeBytes &&
    left.durationSeconds === right.durationSeconds &&
    left.width === right.width &&
    left.height === right.height &&
    left.frameRate.numerator === right.frameRate.numerator &&
    left.frameRate.denominator === right.frameRate.denominator
  );
}

function pathsLexicallyEqual(left: string, right: string): boolean {
  const normalizedLeft = left.replace(/\\/g, "/");
  const normalizedRight = right.replace(/\\/g, "/");
  const windowsStyle =
    /^[a-z]:\//i.test(normalizedLeft) || normalizedLeft.startsWith("//");
  return windowsStyle
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function expectedStageParameters(
  request: VideoEnhancementRequest,
): readonly VideoEnhancementStageParameters[] {
  const parameters: VideoEnhancementStageParameters[] = [];
  if (request.mode === "upscale" || request.mode === "upscale_interpolate") {
    const preset = VIDEO_ENHANCEMENT_PRESETS[request.upscalePreset];
    parameters.push({
      stage: "upscale",
      presetId: preset.id,
      contentClass: preset.contentClass,
      scaleFactor: preset.scaleFactor,
    });
  }
  if (
    request.mode === "interpolate" ||
    request.mode === "upscale_interpolate"
  ) {
    const preset = VIDEO_ENHANCEMENT_PRESETS[request.interpolationPreset];
    parameters.push({
      stage: "interpolate",
      presetId: preset.id,
      frameRateMultiplier: preset.frameRateMultiplier,
    });
  }
  return parameters;
}

function normalizeStageParameters(
  value: unknown,
  expected: VideoEnhancementStageParameters,
): VideoEnhancementStageParameters | null {
  const parameters = snapshotDataRecord(value);
  if (!parameters) return null;
  if (expected.stage === "upscale") {
    if (
      !hasOnlyFields(parameters, UPSCALE_STAGE_PARAMETER_FIELDS) ||
      parameters.stage !== expected.stage ||
      parameters.presetId !== expected.presetId ||
      parameters.contentClass !== expected.contentClass ||
      parameters.scaleFactor !== expected.scaleFactor
    ) {
      return null;
    }
    return Object.freeze({
      stage: expected.stage,
      presetId: expected.presetId,
      contentClass: expected.contentClass,
      scaleFactor: expected.scaleFactor,
    });
  }
  if (
    !hasOnlyFields(parameters, INTERPOLATION_STAGE_PARAMETER_FIELDS) ||
    parameters.stage !== expected.stage ||
    parameters.presetId !== expected.presetId ||
    parameters.frameRateMultiplier !== expected.frameRateMultiplier
  ) {
    return null;
  }
  return Object.freeze({
    stage: expected.stage,
    presetId: expected.presetId,
    frameRateMultiplier: expected.frameRateMultiplier,
  });
}

function normalizeNormalizedArguments(
  value: unknown,
): Readonly<Record<string, VideoEnhancementNormalizedArgumentValue>> | null {
  const argumentsValue = snapshotDataRecord(
    value,
    MAX_NORMALIZED_ARGUMENT_COUNT,
  );
  if (!argumentsValue) return null;
  const normalized = Object.create(null) as Record<
    string,
    VideoEnhancementNormalizedArgumentValue
  >;
  for (const key of Object.keys(argumentsValue)) {
    if (!NORMALIZED_ARGUMENT_KEY_PATTERN.test(key)) return null;
    const argumentValue = argumentsValue[key];
    if (typeof argumentValue === "string") {
      if (
        !isSafeSingleLineText(
          argumentValue,
          MAX_NORMALIZED_ARGUMENT_TEXT_LENGTH,
        )
      ) {
        return null;
      }
    } else if (typeof argumentValue === "number") {
      if (
        !Number.isFinite(argumentValue) ||
        Math.abs(argumentValue) > Number.MAX_SAFE_INTEGER
      ) {
        return null;
      }
    } else if (typeof argumentValue !== "boolean") {
      return null;
    }
    normalized[key] = argumentValue;
  }
  return Object.freeze(normalized);
}

function normalizeStageBackendProvenance(
  value: unknown,
): VideoEnhancementStageBackendProvenance | null {
  const backend = snapshotDataRecord(value);
  if (!backend || !hasOnlyFields(backend, STAGE_BACKEND_FIELDS)) return null;
  const normalizedArguments = normalizeNormalizedArguments(
    backend.normalizedArguments,
  );
  if (
    !isSafeSingleLineText(backend.processor, MAX_BACKEND_TEXT_LENGTH) ||
    !isSafeSingleLineText(backend.model, MAX_BACKEND_TEXT_LENGTH) ||
    !normalizedArguments
  ) {
    return null;
  }
  return Object.freeze({
    processor: backend.processor,
    model: backend.model,
    normalizedArguments,
  });
}

function normalizeExecutionDevice(
  value: unknown,
): VideoEnhancementExecutionDevice | null {
  const device = snapshotDataRecord(value);
  if (
    !device ||
    !hasOnlyFields(device, EXECUTION_DEVICE_FIELDS) ||
    !isNonnegativeSafeInteger(device.id) ||
    !(device.type === "discrete_gpu" || device.type === "integrated_gpu") ||
    !isSafeSingleLineText(device.name, MAX_DEVICE_NAME_LENGTH)
  ) {
    return null;
  }
  return Object.freeze({
    id: device.id,
    type: device.type,
    name: device.name,
  });
}

function normalizeExecutionEnvironment(
  value: unknown,
): VideoEnhancementExecutionEnvironment | null {
  const execution = snapshotDataRecord(value);
  if (!execution || !hasOnlyFields(execution, EXECUTION_FIELDS)) return null;
  const platform = normalizePlatformFacts(execution.platform);
  const selectedDevice = normalizeExecutionDevice(execution.selectedDevice);
  if (!platform || !selectedDevice) return null;
  return Object.freeze({ platform, selectedDevice });
}

function normalizeStageExecutions(
  value: unknown,
  request: VideoEnhancementRequest,
  overallStartedAt: number,
  overallCompletedAt: number,
): readonly VideoEnhancementStageExecution[] | null {
  const stages = snapshotDataArray(value, MAX_STAGE_COUNT);
  const expected = expectedStageParameters(request);
  if (!stages || stages.length !== expected.length) return null;
  const normalized: VideoEnhancementStageExecution[] = [];
  let previousCompletedAt = overallStartedAt;
  for (let index = 0; index < stages.length; index += 1) {
    const stage = snapshotDataRecord(stages[index]);
    const expectedParameters = expected[index];
    if (
      !stage ||
      !expectedParameters ||
      !hasOnlyFields(stage, STAGE_EXECUTION_FIELDS) ||
      stage.stageIndex !== index + 1 ||
      stage.exitCode !== 0 ||
      stage.outcome !== "staged" ||
      !isNonnegativeSafeInteger(stage.durationMs) ||
      stage.durationMs > request.timeoutMs
    ) {
      return null;
    }
    const parameters = normalizeStageParameters(
      stage.parameters,
      expectedParameters,
    );
    const backend = normalizeStageBackendProvenance(stage.backend);
    if (
      typeof stage.startedAt !== "string" ||
      typeof stage.completedAt !== "string"
    ) {
      return null;
    }
    const startedAt = timestampMilliseconds(stage.startedAt);
    const completedAt = timestampMilliseconds(stage.completedAt);
    if (
      !parameters ||
      !backend ||
      startedAt === null ||
      completedAt === null ||
      completedAt < startedAt ||
      startedAt < overallStartedAt ||
      startedAt < previousCompletedAt ||
      completedAt > overallCompletedAt ||
      stage.durationMs !== completedAt - startedAt
    ) {
      return null;
    }
    normalized.push(
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
  return Object.freeze(normalized);
}

function normalizeWarnings(value: unknown): readonly string[] | null {
  const warnings = snapshotDataArray(value, MAX_WARNING_COUNT);
  if (!warnings) return null;
  const normalized: string[] = [];
  for (const warning of warnings) {
    if (!isSafeSingleLineText(warning, MAX_WARNING_LENGTH)) return null;
    normalized.push(warning);
  }
  return Object.freeze(normalized);
}

function normalizeProgressSnapshot(
  value: unknown,
  timeoutMs: number,
): VideoEnhancementProgressSnapshot | null {
  const progress = snapshotDataRecord(value);
  if (!progress || !hasOnlyFields(progress, PROGRESS_SNAPSHOT_FIELDS)) {
    return null;
  }
  const normalized = normalizeProgressMetrics(progress);
  if (
    !normalized ||
    (normalized.elapsedMs !== undefined && normalized.elapsedMs > timeoutMs)
  ) {
    return null;
  }
  return normalized;
}

function normalizeBackendSuccess(
  successValue: Record<string, unknown>,
  request: VideoEnhancementRequest,
  childJobId: string,
): VideoEnhancementStagedSuccess | null {
  if (
    !hasOnlyFields(successValue, SUCCESS_FIELDS) ||
    successValue.ok !== true ||
    successValue.outcome !== "staged" ||
    successValue.requestId !== request.requestId ||
    successValue.parentJobId !== request.parentJobId ||
    successValue.childJobId !== childJobId ||
    !isAbsoluteLocalMp4Path(successValue.stagedPath) ||
    successValue.stagedPath.length > MAX_STAGED_PATH_LENGTH ||
    pathsLexicallyEqual(successValue.stagedPath, request.source.path) ||
    !isNonnegativeSafeInteger(successValue.durationMs) ||
    successValue.durationMs > request.timeoutMs
  ) {
    return null;
  }
  const source = validateSource(successValue.source);
  const backend = normalizeBackendDescriptor(successValue.backend);
  if (
    typeof successValue.startedAt !== "string" ||
    typeof successValue.completedAt !== "string"
  ) {
    return null;
  }
  const startedAt = timestampMilliseconds(successValue.startedAt);
  const completedAt = timestampMilliseconds(successValue.completedAt);
  if (
    !source ||
    !sourcesMatch(source, request.source) ||
    !backend ||
    backend.executableSha256 === null ||
    startedAt === null ||
    completedAt === null ||
    completedAt < startedAt ||
    successValue.durationMs !== completedAt - startedAt
  ) {
    return null;
  }
  const stages = normalizeStageExecutions(
    successValue.stages,
    request,
    startedAt,
    completedAt,
  );
  const warnings = normalizeWarnings(successValue.warnings);
  const progress = normalizeProgressSnapshot(
    successValue.progress,
    request.timeoutMs,
  );
  const execution = normalizeExecutionEnvironment(successValue.execution);
  if (!stages || !warnings || !progress || !execution) return null;
  return Object.freeze({
    ok: true,
    outcome: "staged",
    requestId: request.requestId,
    parentJobId: request.parentJobId,
    childJobId,
    source,
    stagedPath: successValue.stagedPath,
    backend,
    stages,
    execution,
    startedAt: successValue.startedAt,
    completedAt: successValue.completedAt,
    durationMs: successValue.durationMs,
    warnings,
    progress,
  });
}

function normalizeBackendFailure(
  failureValue: Record<string, unknown>,
  request: VideoEnhancementRequest,
  childJobId: string,
): VideoEnhancementFailure | null {
  if (
    !hasOnlyFields(failureValue, FAILURE_FIELDS) ||
    failureValue.ok !== false ||
    failureValue.requestId !== request.requestId ||
    failureValue.parentJobId !== request.parentJobId ||
    failureValue.childJobId !== childJobId
  ) {
    return null;
  }
  const errorValue = snapshotDataRecord(failureValue.error);
  if (
    !errorValue ||
    !hasOnlyFields(errorValue, ERROR_FIELDS) ||
    !isErrorCode(errorValue.code) ||
    !isSafeSingleLineText(errorValue.message, MAX_ERROR_MESSAGE_LENGTH) ||
    typeof errorValue.retryable !== "boolean" ||
    !isProgressStage(errorValue.stage) ||
    !(
      errorValue.terminationConfirmed === null ||
      typeof errorValue.terminationConfirmed === "boolean"
    ) ||
    !(
      errorValue.diagnostics === null ||
      isSafeMultilineText(errorValue.diagnostics, MAX_ERROR_DIAGNOSTIC_LENGTH)
    )
  ) {
    return null;
  }
  const error = Object.freeze({
    code: errorValue.code,
    message: errorValue.message,
    retryable: errorValue.retryable,
    stage: errorValue.stage,
    diagnostics: errorValue.diagnostics,
    terminationConfirmed: errorValue.terminationConfirmed,
  });
  return Object.freeze({
    ok: false,
    requestId: request.requestId,
    parentJobId: request.parentJobId,
    childJobId,
    error,
  });
}

function normalizeBackendResult(
  value: unknown,
  request: VideoEnhancementRequest,
  childJobId: string,
): VideoEnhancementResult | null {
  const result = snapshotDataRecord(value);
  if (!result) return null;
  if (result.ok === true) {
    return normalizeBackendSuccess(result, request, childJobId);
  }
  if (result.ok === false) {
    return normalizeBackendFailure(result, request, childJobId);
  }
  return null;
}

function failure(
  code: "invalid_request" | "cancelled" | "internal_error",
  message: string,
  requestId: string | null,
  parentJobId: string | null,
  childJobId: string | null,
  stage: VideoEnhancementProgressStage = "preflight",
): VideoEnhancementFailure {
  const error = Object.freeze({
    code,
    message,
    retryable: code === "cancelled",
    stage,
    diagnostics: null,
    terminationConfirmed: null,
  });
  return Object.freeze({
    ok: false,
    requestId,
    parentJobId,
    childJobId,
    error,
  });
}

/**
 * Pure orchestration wrapper. It validates before one backend call, never
 * retries implicitly, and keeps Nexus cancellation authoritative over a late
 * backend success.
 */
export class VideoEnhancementService {
  constructor(private readonly backend: VideoEnhancementBackend) {}

  async probe(signal?: AbortSignal): Promise<VideoEnhancementCapability> {
    try {
      const capability = normalizeCapability(await this.backend.probe(signal));
      return capability ?? internalErrorCapability();
    } catch {
      return internalErrorCapability();
    }
  }

  async run(
    input: unknown,
    context: VideoEnhancementBackendRunContext,
  ): Promise<VideoEnhancementResult> {
    const validation = validateVideoEnhancementRequest(input);
    if (!validation.ok) {
      return failure(
        "invalid_request",
        validation.error.message,
        null,
        null,
        null,
      );
    }

    const request = validation.value;
    let childJobId: unknown;
    let signal: AbortSignal;
    let onProgress: ((event: VideoEnhancementProgress) => void) | undefined;
    try {
      childJobId = context.childJobId;
      signal = context.signal;
      onProgress = context.onProgress;
    } catch {
      return failure(
        "internal_error",
        "Video enhancement failed unexpectedly.",
        request.requestId,
        request.parentJobId,
        null,
      );
    }
    if (!isOpaqueJobId(childJobId)) {
      return failure(
        "invalid_request",
        "Child job ID must be a non-empty bounded identifier.",
        request.requestId,
        request.parentJobId,
        null,
      );
    }
    const initialAbortState = readAbortState(signal);
    if (initialAbortState === null) {
      return failure(
        "internal_error",
        "Video enhancement failed unexpectedly.",
        request.requestId,
        request.parentJobId,
        childJobId,
      );
    }
    if (initialAbortState) {
      return failure(
        "cancelled",
        "Video enhancement was cancelled.",
        request.requestId,
        request.parentJobId,
        childJobId,
      );
    }

    let currentStage: VideoEnhancementProgressStage = "preflight";
    let lastProgress: VideoEnhancementProgress | null = null;
    let acceptingProgress = true;
    const backendContext: VideoEnhancementBackendRunContext = Object.freeze({
      childJobId,
      signal,
      onProgress: (event: VideoEnhancementProgress) => {
        if (!acceptingProgress || readAbortState(signal) !== false) return;
        try {
          const normalized = normalizeProgressEvent(event, request, childJobId);
          if (
            !normalized ||
            (lastProgress && isProgressRegression(lastProgress, normalized))
          )
            return;
          currentStage = normalized.stage;
          lastProgress = normalized;
          try {
            onProgress?.(normalized);
          } catch {
            // A progress consumer cannot control the backend lifecycle.
          }
        } catch {
          // Malformed progress is non-authoritative. The caller retains a
          // truthful indeterminate running state instead of false precision.
        }
      },
    });

    try {
      const result = await this.backend.run(request, backendContext);
      acceptingProgress = false;
      const postRunAbortState = readAbortState(signal);
      if (postRunAbortState === null) {
        return failure(
          "internal_error",
          "Video enhancement failed unexpectedly.",
          request.requestId,
          request.parentJobId,
          childJobId,
          currentStage,
        );
      }
      if (postRunAbortState) {
        return failure(
          "cancelled",
          "Video enhancement was cancelled.",
          request.requestId,
          request.parentJobId,
          childJobId,
          currentStage,
        );
      }
      const normalized = normalizeBackendResult(result, request, childJobId);
      const postNormalizeAbortState = readAbortState(signal);
      if (postNormalizeAbortState === null) {
        return failure(
          "internal_error",
          "Video enhancement failed unexpectedly.",
          request.requestId,
          request.parentJobId,
          childJobId,
          currentStage,
        );
      }
      if (postNormalizeAbortState) {
        return failure(
          "cancelled",
          "Video enhancement was cancelled.",
          request.requestId,
          request.parentJobId,
          childJobId,
          currentStage,
        );
      }
      return (
        normalized ??
        failure(
          "internal_error",
          "Video enhancement failed unexpectedly.",
          request.requestId,
          request.parentJobId,
          childJobId,
          currentStage,
        )
      );
    } catch {
      acceptingProgress = false;
      if (readAbortState(signal) === true) {
        return failure(
          "cancelled",
          "Video enhancement was cancelled.",
          request.requestId,
          request.parentJobId,
          childJobId,
          currentStage,
        );
      }
      return failure(
        "internal_error",
        "Video enhancement failed unexpectedly.",
        request.requestId,
        request.parentJobId,
        childJobId,
        currentStage,
      );
    }
  }
}
