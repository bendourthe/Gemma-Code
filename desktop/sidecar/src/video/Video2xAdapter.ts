import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { constants as fsConstants, promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

import {
  scrubEnv,
  isSensitiveEnvName,
  valueLooksLikeSecret,
} from "../../../../core/observability/scrubEnv.js";
import type { SettingsStore } from "../../../../core/storage/SettingsStore.js";
import {
  VIDEO_ENHANCEMENT_PRESETS,
  type VideoEnhancementArchitecture,
  type VideoEnhancementAvx2Status,
  type VideoEnhancementBackend,
  type VideoEnhancementBackendDescriptor,
  type VideoEnhancementBackendRunContext,
  type VideoEnhancementCapability,
  type VideoEnhancementCapabilityReason,
  type VideoEnhancementErrorCode,
  type VideoEnhancementFailure,
  type VideoEnhancementPlatform,
  type VideoEnhancementPresetAvailability,
  type VideoEnhancementPresetId,
  type VideoEnhancementProgress,
  type VideoEnhancementProgressSnapshot,
  type VideoEnhancementProgressStage,
  type VideoEnhancementRequest,
  type VideoEnhancementResult,
  type VideoEnhancementStageBackendProvenance,
  type VideoEnhancementStageExecution,
  type VideoEnhancementStageParameters,
  type VideoEnhancementUpscalePresetId,
  type VideoEnhancementVulkanDevice,
} from "../../../../core/video/index.js";
import type {
  Avx2ProbeResult,
  GuardedProcessResult,
  GuardedVideoProcess,
} from "./GuardedVideoProcess.js";

const VIDEO2X_VERSION_OUTPUT = "Video2X version 6.4.0";
const VIDEO2X_VERSION = "6.4.0";
const VIDEO2X_COMPATIBILITY_ID = "video2x-cli-6.4.0";
const VIDEO2X_SETTING_KEY = "video.video2xPath";
const VIDEO2X_ENV_KEY = "NEXUS_VIDEO2X_PATH";
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_READINESS_TTL_MS = 5 * 60_000;
const DEFAULT_DIAGNOSTIC_LIMIT = 8_192;
const MAX_NODE_TIMEOUT_MS = 2_147_483_647;
const MAX_PROGRESS_EVENTS = 256;
const MAX_PROGRESS_LINE = 2_048;
const MAX_PROBE_STRUCTURED_OUTPUT = 256 * 1_024;
const SAFE_DEVICE_NAME_LIMIT = 160;
const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(27)}(?:\\[[0-?]*[ -/]*[@-~]|[@-_])`,
  "g",
);
const REQUIRED_HELP_TOKENS = [
  "--list-devices",
  "--device",
  "--scaling-factor",
  "--frame-rate-mul",
  "--realesrgan-model",
  "--rife-model",
] as const;
const LOADER_OR_VULKAN_ENV = new Set([
  "APPDIR",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "VK_ICD_FILENAMES",
  "VK_LAYER_PATH",
  "VK_INSTANCE_LAYERS",
]);

export interface Video2xFileStat {
  readonly size: number;
  readonly mode: number;
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface Video2xFileSystem {
  mkdir(
    target: string,
    options?: { readonly recursive?: boolean; readonly mode?: number },
  ): Promise<unknown>;
  realpath(target: string): Promise<string>;
  stat(target: string): Promise<Video2xFileStat>;
  lstat(target: string): Promise<Video2xFileStat>;
  access(target: string, mode?: number): Promise<void>;
  readdir(target: string): Promise<readonly string[]>;
  rm(
    target: string,
    options?: { readonly recursive?: boolean; readonly force?: boolean },
  ): Promise<void>;
  rmdir(target: string): Promise<void>;
}

export interface Video2xExecutableResolutionSuccess {
  readonly ok: true;
  readonly source: "environment" | "setting";
  readonly executablePath: string;
  readonly sha256: string;
  readonly identity: {
    readonly size: number;
    readonly dev: number;
    readonly ino: number;
  };
}

export interface Video2xExecutableResolutionFailure {
  readonly ok: false;
  readonly reason: "missing_configuration" | "invalid_path" | "internal_error";
  readonly source: "environment" | "setting" | null;
  readonly diagnostic: string;
}

export type Video2xExecutableResolution =
  Video2xExecutableResolutionSuccess | Video2xExecutableResolutionFailure;

export interface ParsedVideo2xProgress {
  readonly message: string;
  readonly determinate: boolean;
  readonly processedFrames?: number;
  readonly totalFrames?: number;
  readonly percent?: number;
  readonly processingFps?: number;
  readonly elapsedMs?: number;
  readonly remainingMs?: number;
}

export interface ParsedVideo2xDevices {
  readonly devices: readonly VideoEnhancementVulkanDevice[];
  readonly selected: VideoEnhancementVulkanDevice | null;
  readonly malformed: boolean;
}

export interface Video2xStagePlanEntry {
  readonly stage: "upscale" | "interpolate";
  readonly presetId: VideoEnhancementPresetId;
  readonly parameters: VideoEnhancementStageParameters;
  readonly backend: VideoEnhancementStageBackendProvenance;
  readonly args: readonly string[];
}

export interface Video2xAdapterOptions {
  readonly settings: Pick<SettingsStore, "get">;
  readonly processRunner: GuardedVideoProcess;
  readonly stagingRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
  readonly filesystem?: Video2xFileSystem;
  readonly hashFile?: (target: string, signal?: AbortSignal) => Promise<string>;
  readonly now?: () => Date;
  readonly idFactory?: () => string;
  readonly homeDirectory?: string;
  readonly workspaceRoot?: string;
  readonly probeTimeoutMs?: number;
  readonly diagnosticLimit?: number;
  readonly monotonicNow?: () => number;
  readonly readinessTtlMs?: number;
}

interface Video2xResolvedRuntime {
  readonly executablePath: string;
  readonly executableSha256: string;
  readonly executableIdentity: Video2xExecutableResolutionSuccess["identity"];
  readonly configurationSource: "environment" | "setting";
  readonly platform: {
    readonly os: VideoEnhancementPlatform;
    readonly architecture: VideoEnhancementArchitecture;
    readonly avx2: VideoEnhancementAvx2Status;
  };
  readonly selectedDevice: VideoEnhancementVulkanDevice;
  readonly devices: readonly VideoEnhancementVulkanDevice[];
}

interface ExecutableFingerprint {
  readonly executablePath: string;
  readonly sha256: string;
  readonly identity: Video2xExecutableResolutionSuccess["identity"];
}

interface InternalProbeResult {
  readonly capability: VideoEnhancementCapability;
  readonly runtime: Video2xResolvedRuntime | null;
}

interface ProcessCapture {
  readonly result: GuardedProcessResult;
  readonly stdout: string;
  readonly stderr: string;
}

type ProbeExecutionResult =
  | { readonly ok: true; readonly stdout: string }
  | {
      readonly ok: false;
      readonly reason: "probe_timeout" | "probe_failed";
      readonly diagnostic: string | null;
    };

interface VerifiedSource {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
}

interface VerifiedOutput {
  readonly size: number;
  readonly dev: number;
  readonly ino: number;
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
}

interface OwnedPrivateRoot {
  readonly path: string;
  readonly basePath: string;
  readonly identity: FileIdentity;
  readonly baseIdentity: FileIdentity;
}

interface ReadinessObservation {
  readonly availability: VideoEnhancementPresetAvailability;
  readonly observedAt: number;
}

type DeadlineReason = "cancelled" | "timeout";

class AdapterDeadline {
  private readonly controller = new AbortController();
  private readonly startedAt: number;
  private readonly timeout: ReturnType<typeof setTimeout>;
  private reasonValue: DeadlineReason | null = null;

  constructor(
    private readonly timeoutMs: number,
    private readonly monotonicNow: () => number,
    private readonly externalSignal?: AbortSignal,
  ) {
    this.startedAt = monotonicNow();
    if (externalSignal?.aborted) {
      this.abort("cancelled");
    } else {
      externalSignal?.addEventListener("abort", this.onExternalAbort, {
        once: true,
      });
    }
    this.timeout = setTimeout(
      () => this.abort("timeout"),
      Math.min(MAX_NODE_TIMEOUT_MS, Math.max(1, Math.ceil(timeoutMs))),
    );
    this.timeout.unref?.();
  }

  get signal(): AbortSignal {
    this.refresh();
    return this.controller.signal;
  }

  currentReason(): DeadlineReason | null {
    this.refresh();
    return this.reasonValue;
  }

  remainingMs(): number {
    this.refresh();
    return Math.max(
      0,
      this.timeoutMs - Math.max(0, this.monotonicNow() - this.startedAt),
    );
  }

  async wait<T>(startOperation: () => Promise<T>): Promise<T> {
    this.throwIfInactive();
    const remainingMs = this.remainingMs();
    if (remainingMs <= 0) throw new DeadlineAbortError();
    let onAbort: (() => void) | undefined;
    let operationTimeout: ReturnType<typeof setTimeout> | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new DeadlineAbortError());
      this.controller.signal.addEventListener("abort", onAbort, { once: true });
      // This timer stays referenced so a non-cooperative operation cannot strand the await.
      operationTimeout = setTimeout(
        () => {
          this.abort("timeout");
          reject(new DeadlineAbortError());
        },
        Math.min(MAX_NODE_TIMEOUT_MS, Math.max(1, Math.ceil(remainingMs))),
      );
    });
    const operation = Promise.resolve().then(() => {
      this.throwIfInactive();
      return startOperation();
    });
    try {
      return await Promise.race([operation, interrupted]);
    } finally {
      if (onAbort) this.controller.signal.removeEventListener("abort", onAbort);
      if (operationTimeout !== undefined) clearTimeout(operationTimeout);
    }
  }

  throwIfInactive(): void {
    this.refresh();
    if (this.controller.signal.aborted) throw new DeadlineAbortError();
  }

  dispose(): void {
    clearTimeout(this.timeout);
    this.externalSignal?.removeEventListener("abort", this.onExternalAbort);
  }

  private readonly onExternalAbort = (): void => {
    this.abort("cancelled");
  };

  private refresh(): void {
    if (this.externalSignal?.aborted) this.abort("cancelled");
    if (
      this.reasonValue === null &&
      this.monotonicNow() - this.startedAt >= this.timeoutMs
    ) {
      this.abort("timeout");
    }
  }

  private abort(reason: DeadlineReason): void {
    if (this.reasonValue !== null) return;
    this.reasonValue = reason;
    this.controller.abort();
  }
}

class DeadlineAbortError extends Error {
  constructor() {
    super("Adapter operation deadline elapsed or was cancelled.");
    this.name = "DeadlineAbortError";
  }
}

class TailBuffer {
  private value = "";

  constructor(private readonly limit: number) {}

  add(chunk: string): void {
    if (chunk.length >= this.limit) {
      this.value = chunk.slice(-this.limit);
      return;
    }
    this.value = (this.value + chunk).slice(-this.limit);
  }

  text(): string {
    return this.value;
  }
}

class CompleteBoundedBuffer {
  private value = "";
  private didOverflow = false;

  constructor(private readonly limit: number) {}

  add(chunk: string): void {
    if (this.didOverflow) return;
    if (this.value.length + chunk.length > this.limit) {
      this.didOverflow = true;
      this.value = (this.value + chunk).slice(0, this.limit);
      return;
    }
    this.value += chunk;
  }

  text(): string {
    return this.value;
  }

  overflowed(): boolean {
    return this.didOverflow;
  }
}

class RedactingTailBuffer {
  private value = "";

  constructor(
    private readonly limit: number,
    private readonly redactions: () => readonly string[],
    private readonly platform: NodeJS.Platform,
  ) {}

  add(chunk: string): void {
    const maxRedactionLength = this.redactions().reduce(
      (maximum, value) => Math.max(maximum, value.length),
      0,
    );
    const retainedLimit = this.limit + maxRedactionLength * 2;
    this.value = (this.value + chunk).slice(-retainedLimit);
  }

  text(): string {
    return (
      safeDiagnostic(
        this.value,
        this.redactions(),
        this.limit,
        this.platform,
      ) ?? ""
    );
  }
}

class ProgressLineDecoder {
  private remainder = "";

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: string): void {
    this.remainder = (this.remainder + chunk).slice(-MAX_PROGRESS_LINE * 2);
    const lines = this.remainder.split(/\r\n|\r|\n/);
    this.remainder = lines.pop() ?? "";
    for (const line of lines) this.onLine(line.slice(-MAX_PROGRESS_LINE));
  }

  end(): void {
    if (this.remainder) this.onLine(this.remainder.slice(-MAX_PROGRESS_LINE));
    this.remainder = "";
  }
}

const NODE_FILESYSTEM: Video2xFileSystem = {
  mkdir: (target, options) => fs.mkdir(target, options),
  realpath: (target) => fs.realpath(target),
  stat: (target) => fs.stat(target),
  lstat: (target) => fs.lstat(target),
  access: (target, mode) => fs.access(target, mode),
  readdir: (target) => fs.readdir(target),
  rm: (target, options) => fs.rm(target, options),
  rmdir: (target) => fs.rmdir(target),
};

const VIDEO2X_STAGE_ARGS: Readonly<
  Record<VideoEnhancementPresetId, readonly string[]>
> = Object.freeze({
  "animation-upscale-2x": Object.freeze([
    "-p",
    "realesrgan",
    "-s",
    "2",
    "--realesrgan-model",
    "realesr-animevideov3",
  ]),
  "animation-upscale-4x": Object.freeze([
    "-p",
    "realesrgan",
    "-s",
    "4",
    "--realesrgan-model",
    "realesr-animevideov3",
  ]),
  "general-upscale-4x": Object.freeze([
    "-p",
    "realesrgan",
    "-s",
    "4",
    "--realesrgan-model",
    "realesrgan-plus",
  ]),
  "smooth-2x": Object.freeze([
    "-p",
    "rife",
    "-m",
    "2",
    "--rife-model",
    "rife-v4.6",
  ]),
});

export function hashVideo2xFile(
  target: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The file hash was aborted.", "AbortError"));
      return;
    }
    const hash = createHash("sha256");
    const stream = createReadStream(target, { signal });
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Derive the exact restart-addressable job-root leaf without exposing the ID. */
export function video2xJobRootLeaf(childJobId: string): string {
  const digest = createHash("sha256")
    .update(childJobId, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `video2x-job-${digest}`;
}

function cleanSingleLine(value: string): string {
  const withoutAnsi = value.replace(ANSI_PATTERN, "");
  return Array.from(withoutAnsi)
    .filter((character) => character === "\t" || character >= " ")
    .join("")
    .trim();
}

function parseClock(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = (hours * 3_600 + minutes * 60 + seconds) * 1_000;
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? milliseconds
    : undefined;
}

function parseFiniteNonNegative(value: string | undefined): number | undefined {
  if (!value || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()))
    return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Parse one stable Video2X 6.4.0 carriage-return progress update. */
export function parseVideo2xProgressLine(
  line: string,
): ParsedVideo2xProgress | null {
  const message = cleanSingleLine(line).slice(0, MAX_PROGRESS_LINE);
  if (!/(?:^|;\s*)frame\s*=/i.test(message)) return null;

  const frameField = /(?:^|;\s*)frame\s*=\s*([^;]+)/i
    .exec(message)?.[1]
    ?.trim();
  const frameMatch =
    /^(\d+)\s*\/\s*(\d+|\?)\s*(?:\(\s*([^%)]+)\s*%\s*\))?$/.exec(
      frameField ?? "",
    );
  if (!frameMatch) return { message, determinate: false };

  const processedFrames = Number(frameMatch[1]);
  const totalFrames = frameMatch[2] === "?" ? undefined : Number(frameMatch[2]);
  const percent = parseFiniteNonNegative(frameMatch[3]);
  const processingFps = parseFiniteNonNegative(
    /(?:^|;\s*)fps\s*=\s*([^;]+)/i.exec(message)?.[1],
  );
  const elapsedMs = parseClock(
    /(?:^|;\s*)elapsed\s*=\s*([^;]+)/i.exec(message)?.[1],
  );
  const remainingMs = parseClock(
    /(?:^|;\s*)remaining\s*=\s*([^;]+)/i.exec(message)?.[1],
  );
  const finiteFrames =
    Number.isSafeInteger(processedFrames) &&
    processedFrames >= 0 &&
    (totalFrames === undefined ||
      (Number.isSafeInteger(totalFrames) &&
        totalFrames > 0 &&
        processedFrames <= totalFrames));
  const validPercent = percent === undefined || percent <= 100;
  const completeTelemetry =
    finiteFrames &&
    totalFrames !== undefined &&
    percent !== undefined &&
    validPercent &&
    processingFps !== undefined &&
    elapsedMs !== undefined &&
    remainingMs !== undefined;

  if (!finiteFrames || !validPercent) return { message, determinate: false };
  return {
    message,
    determinate: completeTelemetry,
    processedFrames,
    ...(totalFrames === undefined ? {} : { totalFrames }),
    ...(percent === undefined || totalFrames === undefined ? {} : { percent }),
    ...(processingFps === undefined ? {} : { processingFps }),
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
    ...(remainingMs === undefined ? {} : { remainingMs }),
  };
}

function sanitizeDeviceName(name: string, id: number): string {
  const cleaned = cleanSingleLine(name).slice(0, SAFE_DEVICE_NAME_LIMIT);
  if (!cleaned || /[\\/]/.test(cleaned) || /[a-z]:/i.test(cleaned)) {
    return `Vulkan device ${id}`;
  }
  return cleaned;
}

/** Parse tagged numeric device blocks without inferring type from a device name. */
export function parseVideo2xDevices(output: string): ParsedVideo2xDevices {
  const lines = output.replace(ANSI_PATTERN, "").split(/\r\n|\r|\n/);
  const devices: VideoEnhancementVulkanDevice[] = [];
  const seen = new Set<number>();
  let malformed = false;
  let current: { id: number; name: string; type: string | null } | null = null;

  const finish = (): void => {
    if (!current) return;
    if (seen.has(current.id) || current.type === null) {
      malformed = true;
      current = null;
      return;
    }
    seen.add(current.id);
    if (current.type === "Discrete GPU" || current.type === "Integrated GPU") {
      devices.push({
        id: current.id,
        type:
          current.type === "Discrete GPU" ? "discrete_gpu" : "integrated_gpu",
        name: sanitizeDeviceName(current.name, current.id),
        selected: false,
      });
    } else if (
      current.type !== "CPU" &&
      current.type !== "Virtual GPU" &&
      current.type !== "Unknown"
    ) {
      malformed = true;
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = cleanSingleLine(rawLine);
    const heading = /^(\d+)\.\s+(.+)$/.exec(line);
    if (heading) {
      finish();
      const id = Number(heading[1]);
      if (!Number.isSafeInteger(id) || id < 0) {
        malformed = true;
        continue;
      }
      current = { id, name: heading[2] ?? "", type: null };
      continue;
    }
    const type = /^Type:\s*(.+)$/.exec(line)?.[1]?.trim();
    if (type && current) {
      if (current.type !== null) malformed = true;
      current.type = type;
    }
  }
  finish();

  const ordered = devices.sort((left, right) => left.id - right.id);
  const selectedCandidate =
    ordered.find((device) => device.type === "discrete_gpu") ??
    ordered.find((device) => device.type === "integrated_gpu") ??
    null;
  const selectedDevices = ordered.map((device) => ({
    ...device,
    selected: device.id === selectedCandidate?.id,
  }));
  return {
    devices: selectedDevices,
    selected: selectedDevices.find((device) => device.selected) ?? null,
    malformed,
  };
}

function stageForUpscale(
  presetId: VideoEnhancementUpscalePresetId,
): Video2xStagePlanEntry {
  const preset = VIDEO_ENHANCEMENT_PRESETS[presetId];
  const model =
    presetId === "general-upscale-4x"
      ? "realesrgan-plus"
      : "realesr-animevideov3";
  return {
    stage: "upscale",
    presetId,
    parameters: {
      stage: "upscale",
      presetId,
      contentClass: preset.contentClass,
      scaleFactor: preset.scaleFactor,
    },
    backend: {
      processor: "realesrgan",
      model,
      normalizedArguments: { scalingFactor: preset.scaleFactor },
    },
    args: VIDEO2X_STAGE_ARGS[presetId],
  };
}

function interpolationStage(): Video2xStagePlanEntry {
  return {
    stage: "interpolate",
    presetId: "smooth-2x",
    parameters: {
      stage: "interpolate",
      presetId: "smooth-2x",
      frameRateMultiplier: 2,
    },
    backend: {
      processor: "rife",
      model: "rife-v4.6",
      normalizedArguments: { frameRateMultiplier: 2 },
    },
    args: VIDEO2X_STAGE_ARGS["smooth-2x"],
  };
}

/** Build the only Video2X stage orders supported by the pinned contract. */
export function buildVideo2xStagePlan(
  request: VideoEnhancementRequest,
): readonly Video2xStagePlanEntry[] {
  if (request.mode === "upscale")
    return [stageForUpscale(request.upscalePreset)];
  if (request.mode === "interpolate") return [interpolationStage()];
  return [stageForUpscale(request.upscalePreset), interpolationStage()];
}

/** Build one shell-free invocation. Paths and flags remain discrete argv values. */
export function buildVideo2xInvocationArgs(
  inputPath: string,
  outputPath: string,
  entry: Video2xStagePlanEntry,
  deviceId: number,
): readonly string[] {
  if (!Number.isSafeInteger(deviceId) || deviceId < 0) {
    throw new Error("Video2X device ID must be a non-negative integer.");
  }
  return [
    "-i",
    inputPath,
    "-o",
    outputPath,
    ...entry.args,
    "--device",
    String(deviceId),
  ];
}

function platformPath(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

function platformEquals(
  left: string,
  right: string,
  platform: NodeJS.Platform,
): boolean {
  return platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
}

function isContained(
  root: string,
  target: string,
  platform: NodeJS.Platform,
): boolean {
  const implementation = platformPath(platform);
  const relative = implementation.relative(root, target);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${implementation.sep}`) &&
    !implementation.isAbsolute(relative)
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isExistingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Resolve env-over-setting configuration without consulting PATH. */
export async function resolveVideo2xExecutable(options: {
  readonly env: NodeJS.ProcessEnv;
  readonly settings: Pick<SettingsStore, "get">;
  readonly platform: NodeJS.Platform;
  readonly filesystem?: Video2xFileSystem;
  readonly hashFile?: (target: string, signal?: AbortSignal) => Promise<string>;
  readonly signal?: AbortSignal;
}): Promise<Video2xExecutableResolution> {
  const filesystem = options.filesystem ?? NODE_FILESYSTEM;
  const envValue = options.env[VIDEO2X_ENV_KEY]?.trim() ?? "";
  let candidate = envValue;
  let source: "environment" | "setting" = "environment";
  if (!candidate) {
    let setting: string | undefined;
    try {
      setting = await options.settings.get<string>(VIDEO2X_SETTING_KEY);
    } catch {
      return {
        ok: false,
        reason: "internal_error",
        source: "setting",
        diagnostic: "The Video2X setting could not be read.",
      };
    }
    candidate = typeof setting === "string" ? setting.trim() : "";
    source = "setting";
  }
  if (!candidate) {
    return {
      ok: false,
      reason: "missing_configuration",
      source: null,
      diagnostic: "Configure an absolute Video2X executable path.",
    };
  }
  if (
    candidate.includes("\0") ||
    candidate.includes("\r") ||
    candidate.includes("\n") ||
    !platformPath(options.platform).isAbsolute(candidate)
  ) {
    return {
      ok: false,
      reason: "invalid_path",
      source,
      diagnostic:
        "The configured Video2X path must be an absolute local file path.",
    };
  }

  try {
    const executablePath = await filesystem.realpath(candidate);
    const linkStat = await filesystem.lstat(executablePath);
    const stat = await filesystem.stat(executablePath);
    if (linkStat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("not-a-regular-file");
    }
    if (options.platform !== "win32") {
      if ((stat.mode & 0o111) === 0) throw new Error("not-executable");
      await filesystem.access(executablePath, fsConstants.X_OK);
    }
    const sha256 = await (options.hashFile ?? hashVideo2xFile)(
      executablePath,
      options.signal,
    );
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("invalid-hash");
    return {
      ok: true,
      source,
      executablePath,
      sha256,
      identity: { size: stat.size, dev: stat.dev, ino: stat.ino },
    };
  } catch {
    return {
      ok: false,
      reason: "invalid_path",
      source,
      diagnostic: "The configured Video2X executable could not be verified.",
    };
  }
}

function mapPlatform(platform: NodeJS.Platform): VideoEnhancementPlatform {
  if (platform === "win32" || platform === "linux" || platform === "darwin")
    return platform;
  return "other";
}

function mapArchitecture(architecture: string): VideoEnhancementArchitecture {
  if (architecture === "x64" || architecture === "arm64") return architecture;
  return "other";
}

function presetAvailability(
  state: VideoEnhancementPresetAvailability["state"],
  reason: string | null,
): Record<VideoEnhancementPresetId, VideoEnhancementPresetAvailability> {
  return {
    "animation-upscale-2x": { state, reason },
    "animation-upscale-4x": { state, reason },
    "general-upscale-4x": { state, reason },
    "smooth-2x": { state, reason },
  };
}

function descriptor(
  executableSha256: string | null,
  configurationSource: "environment" | "setting" | null,
): VideoEnhancementBackendDescriptor {
  return {
    id: "video2x",
    compatibilityId: VIDEO2X_COMPATIBILITY_ID,
    version: VIDEO2X_VERSION,
    executableSha256,
    provenance: "user-supplied-unverified",
    configurationSource,
  };
}

function replaceAllCaseAware(
  text: string,
  needle: string,
  replacement: string,
  caseInsensitive: boolean,
): string {
  if (!needle) return text;
  let output = "";
  let remaining = text;
  const searchNeedle = caseInsensitive
    ? needle.toLocaleLowerCase("en-US")
    : needle;
  while (remaining) {
    const searchHaystack = caseInsensitive
      ? remaining.toLocaleLowerCase("en-US")
      : remaining;
    const index = searchHaystack.indexOf(searchNeedle);
    if (index < 0) return output + remaining;
    output += remaining.slice(0, index) + replacement;
    remaining = remaining.slice(index + needle.length);
  }
  return output;
}

function safeDiagnostic(
  text: string,
  redactions: readonly string[],
  limit: number,
  platform: NodeJS.Platform,
): string | null {
  let safe = text.replace(ANSI_PATTERN, "");
  const ordered = [
    ...new Set(redactions.filter((value) => value.length >= 4)),
  ].sort((left, right) => right.length - left.length);
  for (const value of ordered) {
    safe = replaceAllCaseAware(safe, value, "[redacted]", platform === "win32");
  }
  safe = safe.slice(-limit).trim();
  return safe || null;
}

function scrubVideo2xEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned = scrubEnv(base);
  for (const key of Object.keys(cleaned)) {
    const upper = key.toUpperCase();
    if (
      LOADER_OR_VULKAN_ENV.has(upper) ||
      upper.startsWith("DYLD_") ||
      upper.startsWith("VK_") ||
      upper === VIDEO2X_ENV_KEY
    ) {
      delete cleaned[key];
    }
  }
  return cleaned;
}

function modelUnavailable(output: string): boolean {
  return /(?:model[^\r\n]*(?:not found|missing|failed to (?:open|load))|(?:not found|missing)[^\r\n]*model)/i.test(
    output,
  );
}

function hasExactHelpToken(output: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s,])${escaped}(?=$|[\\s=,\\[])`, "m").test(output);
}

export class Video2xAdapter implements VideoEnhancementBackend {
  private readonly filesystem: Video2xFileSystem;
  private readonly hashFile: (
    target: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly architecture: string;
  private readonly stagingRoot: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly homeDirectory: string;
  private readonly workspaceRoot: string;
  private readonly probeTimeoutMs: number;
  private readonly diagnosticLimit: number;
  private readonly monotonicNow: () => number;
  private readonly readinessTtlMs: number;
  private readonly readiness = new Map<
    VideoEnhancementPresetId,
    ReadinessObservation
  >();
  private readinessHash: string | null = null;

  constructor(private readonly options: Video2xAdapterOptions) {
    this.filesystem = options.filesystem ?? NODE_FILESYSTEM;
    this.hashFile = options.hashFile ?? hashVideo2xFile;
    this.env = { ...(options.env ?? process.env) };
    this.platform = options.platform ?? process.platform;
    this.architecture = options.architecture ?? process.arch;
    this.stagingRoot =
      options.stagingRoot ?? path.join(tmpdir(), "nexus", "video-enhancement");
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.diagnosticLimit = options.diagnosticLimit ?? DEFAULT_DIAGNOSTIC_LIMIT;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.readinessTtlMs = options.readinessTtlMs ?? DEFAULT_READINESS_TTL_MS;
    if (
      !Number.isFinite(this.readinessTtlMs) ||
      this.readinessTtlMs <= 0 ||
      this.readinessTtlMs > MAX_NODE_TIMEOUT_MS
    ) {
      throw new Error(
        `readinessTtlMs must be between 1 and ${MAX_NODE_TIMEOUT_MS}`,
      );
    }
    this.resetReadiness(null);
  }

  invalidateReadiness(presetId?: VideoEnhancementPresetId): void {
    if (presetId === undefined) {
      this.resetReadiness(this.readinessHash);
      return;
    }
    this.readiness.set(presetId, {
      availability: this.unverifiedReadiness(),
      observedAt: this.monotonicNow(),
    });
  }

  async probe(signal?: AbortSignal): Promise<VideoEnhancementCapability> {
    const deadline = new AdapterDeadline(
      Math.min(MAX_NODE_TIMEOUT_MS, this.probeTimeoutMs * 4),
      this.monotonicNow,
      signal,
    );
    try {
      return (await this.probeInternal(deadline)).capability;
    } finally {
      deadline.dispose();
    }
  }

  async run(
    request: VideoEnhancementRequest,
    context: VideoEnhancementBackendRunContext,
  ): Promise<VideoEnhancementResult> {
    const deadline = new AdapterDeadline(
      request.timeoutMs,
      this.monotonicNow,
      context.signal,
    );
    try {
      return await this.runWithinDeadline(request, context, deadline);
    } finally {
      deadline.dispose();
    }
  }

  private async runWithinDeadline(
    request: VideoEnhancementRequest,
    context: VideoEnhancementBackendRunContext,
    deadline: AdapterDeadline,
  ): Promise<VideoEnhancementResult> {
    const startedAt = this.now();
    const baseRedactions = this.redactionValues(request.source.path);
    if (deadline.currentReason() === "cancelled") {
      return this.failure(
        request,
        context.childJobId,
        "cancelled",
        "preflight",
        false,
        null,
      );
    }

    const internalProbe = await this.probeInternal(deadline);
    const postProbeReason: DeadlineReason | null = deadline.currentReason();
    if (postProbeReason === "cancelled") {
      return this.failure(
        request,
        context.childJobId,
        "cancelled",
        "preflight",
        false,
        null,
      );
    }
    if (postProbeReason === "timeout") {
      return this.failure(
        request,
        context.childJobId,
        "process_timeout",
        "preflight",
        true,
        "The overall enhancement deadline elapsed during preflight.",
      );
    }
    if (!internalProbe.runtime || internalProbe.capability.status !== "ready") {
      const reason =
        internalProbe.capability.status === "ready"
          ? "internal_error"
          : internalProbe.capability.reason;
      const code = this.errorCodeForCapability(reason);
      return this.failure(
        request,
        context.childJobId,
        code,
        "preflight",
        code === "backend_unavailable",
        internalProbe.capability.diagnostic,
      );
    }

    const runtime = internalProbe.runtime;
    const plan = buildVideo2xStagePlan(request);
    const requestedPresets = plan.map((entry) => entry.presetId);
    if (
      requestedPresets.some(
        (presetId) =>
          internalProbe.capability.presets[presetId].state === "unavailable",
      )
    ) {
      return this.failure(
        request,
        context.childJobId,
        "model_unavailable",
        "preflight",
        false,
        "The selected pinned Video2X model is unavailable.",
      );
    }
    const redactions = [
      ...baseRedactions,
      runtime.executablePath,
      this.stagingRoot,
    ];
    let jobRoot: OwnedPrivateRoot | null = null;
    const executions: VideoEnhancementStageExecution[] = [];
    const outputIdentities: VerifiedOutput[] = [];
    const progressEvents: VideoEnhancementProgress[] = [];
    const diagnostics = new TailBuffer(this.diagnosticLimit);
    let finalOutputIdentity: VerifiedOutput | null = null;
    let terminationWasUnconfirmed = false;
    const ensureActive = (stage: VideoEnhancementProgressStage): void => {
      try {
        deadline.throwIfInactive();
      } catch {
        const reason = deadline.currentReason();
        throw new AdapterFailure(
          reason === "cancelled" ? "cancelled" : "process_timeout",
          stage,
          reason !== "cancelled",
          reason === "cancelled"
            ? "Cancellation was requested."
            : "The overall job deadline elapsed.",
        );
      }
    };
    try {
      const verifiedSource = await this.verifySource(
        request,
        undefined,
        deadline,
      );
      ensureActive("preflight");
      const sourcePath = verifiedSource.path;
      jobRoot = await this.createPrivateRoot(
        "job",
        deadline,
        context.childJobId,
      );
      ensureActive("preflight");
      redactions.push(jobRoot.path);
      const outputPaths = plan.map((_, index) =>
        path.join(
          jobRoot?.path ?? "",
          index === plan.length - 1
            ? `stage-${index + 1}.partial.mp4`
            : `stage-${index + 1}.intermediate.partial.mp4`,
        ),
      );
      for (const outputPath of outputPaths) {
        this.assertContained(jobRoot.path, outputPath);
        await this.requireMissing(outputPath, deadline);
        if (platformEquals(sourcePath, outputPath, this.platform)) {
          throw new AdapterFailure(
            "output_conflict",
            "preflight",
            false,
            "Output aliases the source.",
          );
        }
      }

      let inputPath = sourcePath;
      for (let index = 0; index < plan.length; index += 1) {
        const entry = plan[index];
        const outputPath = outputPaths[index];
        if (!entry || !outputPath) {
          throw new AdapterFailure(
            "internal_error",
            "preflight",
            false,
            "Stage planning failed.",
          );
        }
        ensureActive(entry.stage);
        const remainingTimeout = deadline.remainingMs();
        if (remainingTimeout <= 0) {
          throw new AdapterFailure(
            "process_timeout",
            entry.stage,
            true,
            "The job timeout elapsed.",
          );
        }

        const stageStartedAt = this.now();
        const stageCwd = await this.createStageWorkRoot(
          jobRoot,
          index + 1,
          deadline,
        );
        ensureActive(entry.stage);
        if (
          !(await this.executableMatches(
            {
              executablePath: runtime.executablePath,
              sha256: runtime.executableSha256,
              identity: runtime.executableIdentity,
            },
            deadline,
          ))
        ) {
          throw new AdapterFailure(
            "incompatible_backend",
            entry.stage,
            false,
            "The configured Video2X executable changed before launch.",
          );
        }
        ensureActive(entry.stage);
        let capture: ProcessCapture;
        try {
          capture = await this.runEnhancementProcess({
            executablePath: runtime.executablePath,
            args: buildVideo2xInvocationArgs(
              inputPath,
              outputPath,
              entry,
              runtime.selectedDevice.id,
            ),
            cwd: stageCwd.path,
            timeoutMs: remainingTimeout,
            signal: deadline.signal,
            entry,
            request,
            context,
            stageIndex: index + 1,
            stageCount: plan.length,
            progressEvents,
            redactions,
          });
        } catch (error) {
          throw new AdapterFailure(
            deadline.currentReason() === "cancelled"
              ? "cancelled"
              : deadline.currentReason() === "timeout"
                ? "process_timeout"
                : "process_failed",
            entry.stage,
            deadline.currentReason() !== "cancelled",
            error instanceof Error
              ? error.message
              : "Video2X could not be started.",
          );
        }
        diagnostics.add(capture.stdout);
        diagnostics.add("\n");
        diagnostics.add(capture.stderr);

        if (!capture.result.terminationConfirmed) {
          terminationWasUnconfirmed = true;
          if (
            deadline.currentReason() === "cancelled" ||
            capture.result.cancelled
          ) {
            throw new AdapterFailure(
              "cancelled",
              entry.stage,
              false,
              "Cancellation was requested; private staging was quarantined because process termination could not be confirmed.",
            );
          }
          if (
            deadline.currentReason() === "timeout" ||
            capture.result.timedOut
          ) {
            throw new AdapterFailure(
              "process_timeout",
              entry.stage,
              true,
              "Video2X timed out; private staging was quarantined because process termination could not be confirmed.",
            );
          }
          throw new AdapterFailure(
            "process_failed",
            entry.stage,
            true,
            "Private staging was quarantined because process termination could not be confirmed.",
          );
        }
        if (
          deadline.currentReason() === "cancelled" ||
          capture.result.cancelled
        ) {
          throw new AdapterFailure(
            "cancelled",
            entry.stage,
            false,
            "Cancellation was requested.",
          );
        }
        if (deadline.currentReason() === "timeout" || capture.result.timedOut) {
          throw new AdapterFailure(
            "process_timeout",
            entry.stage,
            true,
            "Video2X timed out.",
          );
        }
        if (capture.result.exitCode !== 0) {
          const combinedOutput = `${capture.stdout}\n${capture.stderr}`;
          if (modelUnavailable(combinedOutput)) {
            this.setReadiness(entry.presetId, {
              state: "unavailable",
              reason: "The pinned model could not be loaded.",
            });
            throw new AdapterFailure(
              "model_unavailable",
              entry.stage,
              false,
              "The pinned Video2X model could not be loaded.",
            );
          }
          throw new AdapterFailure(
            "process_failed",
            entry.stage,
            true,
            "Video2X exited unsuccessfully.",
          );
        }

        const verifiedOutput = await this.verifyStagedFile(
          jobRoot.path,
          outputPath,
          verifiedSource,
          undefined,
          deadline,
        );
        ensureActive(entry.stage);
        if ((await this.cleanupOwnedRoot(stageCwd)) !== "removed") {
          throw new AdapterFailure(
            "internal_error",
            entry.stage,
            true,
            "The private stage working directory could not be cleaned.",
          );
        }
        ensureActive(entry.stage);
        const stageCompletedAt = this.now();
        executions.push({
          stageIndex: index + 1,
          parameters: entry.parameters,
          backend: entry.backend,
          startedAt: stageStartedAt.toISOString(),
          completedAt: stageCompletedAt.toISOString(),
          durationMs: Math.max(
            0,
            stageCompletedAt.getTime() - stageStartedAt.getTime(),
          ),
          exitCode: 0,
          outcome: "staged",
        });
        this.setReadiness(entry.presetId, {
          state: "available",
          reason: null,
        });
        outputIdentities[index] = verifiedOutput;
        inputPath = outputPath;
        if (index === plan.length - 1) finalOutputIdentity = verifiedOutput;
      }

      await this.verifySource(request, verifiedSource, deadline);
      const terminalStage = plan.at(-1)?.stage ?? "preflight";
      ensureActive(terminalStage);
      const stagedPath = outputPaths.at(-1);
      if (!stagedPath) {
        throw new AdapterFailure(
          "internal_error",
          "preflight",
          false,
          "No staged output was planned.",
        );
      }
      for (const [index, intermediate] of outputPaths.slice(0, -1).entries()) {
        const expectedIdentity = outputIdentities[index];
        if (
          !expectedIdentity ||
          !(await this.removeOwnedFile(jobRoot, intermediate, expectedIdentity))
        ) {
          throw new AdapterFailure(
            "internal_error",
            terminalStage,
            true,
            "The private intermediate could not be cleaned.",
          );
        }
      }
      ensureActive(terminalStage);
      if (
        !(await this.executableMatches(
          {
            executablePath: runtime.executablePath,
            sha256: runtime.executableSha256,
            identity: runtime.executableIdentity,
          },
          deadline,
        ))
      ) {
        throw new AdapterFailure(
          "incompatible_backend",
          terminalStage,
          false,
          "The configured Video2X executable changed during execution.",
        );
      }
      ensureActive(terminalStage);
      if (!finalOutputIdentity) {
        throw new AdapterFailure(
          "output_invalid",
          "validate",
          true,
          "Final output identity is missing.",
        );
      }
      await this.verifyStagedFile(
        jobRoot.path,
        stagedPath,
        verifiedSource,
        finalOutputIdentity,
        deadline,
      );
      ensureActive(terminalStage);
      const completedAt = this.now();
      const lastProgress = progressEvents.at(-1);
      return {
        ok: true,
        outcome: "staged",
        requestId: request.requestId,
        parentJobId: request.parentJobId,
        childJobId: context.childJobId,
        source: request.source,
        stagedPath,
        backend: descriptor(
          runtime.executableSha256,
          runtime.configurationSource,
        ),
        stages: executions,
        execution: {
          platform: runtime.platform,
          selectedDevice: {
            id: runtime.selectedDevice.id,
            type: runtime.selectedDevice.type,
            name: runtime.selectedDevice.name,
          },
        },
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        warnings: [],
        progress: this.progressSnapshot(lastProgress),
      };
    } catch (error) {
      const cleanupDisposition = !jobRoot
        ? "removed"
        : terminationWasUnconfirmed
          ? "quarantined"
          : await this.cleanupOwnedRoot(jobRoot);
      const failure =
        error instanceof AdapterFailure
          ? error
          : new AdapterFailure(
              deadline.currentReason() === "cancelled"
                ? "cancelled"
                : deadline.currentReason() === "timeout"
                  ? "process_timeout"
                  : "internal_error",
              "preflight",
              false,
              error instanceof Error
                ? error.message
                : "Unexpected adapter failure.",
            );
      const diagnostic = safeDiagnostic(
        `${failure.detail}\n${diagnostics.text()}${
          cleanupDisposition === "removed"
            ? ""
            : "\nPrivate staging was quarantined because ownership-safe cleanup could not be completed."
        }`,
        redactions,
        this.diagnosticLimit,
        this.platform,
      );
      return this.failure(
        request,
        context.childJobId,
        deadline.currentReason() === "cancelled"
          ? "cancelled"
          : deadline.currentReason() === "timeout"
            ? "process_timeout"
            : failure.code,
        failure.stage,
        failure.retryable,
        diagnostic,
      );
    }
  }

  private async probeInternal(
    deadline: AdapterDeadline,
  ): Promise<InternalProbeResult> {
    const probedAt = this.now().toISOString();
    const os = mapPlatform(this.platform);
    const architecture = mapArchitecture(this.architecture);
    let avx2: VideoEnhancementAvx2Status = "unknown";
    if (this.platform !== "win32" && this.platform !== "linux") {
      return this.unavailableProbe(
        "unsupported",
        "unsupported_platform",
        probedAt,
        os,
        architecture,
        avx2,
      );
    }
    if (this.architecture !== "x64") {
      return this.unavailableProbe(
        "unsupported",
        "unsupported_architecture",
        probedAt,
        os,
        architecture,
        avx2,
      );
    }
    if (deadline.currentReason() !== null) {
      return this.unavailableProbe(
        "unavailable",
        deadline.currentReason() === "timeout"
          ? "probe_timeout"
          : "probe_failed",
        probedAt,
        os,
        architecture,
        avx2,
        "Probe was cancelled.",
      );
    }

    let resolution: Video2xExecutableResolution;
    try {
      resolution = await deadline.wait(() =>
        resolveVideo2xExecutable({
          env: this.env,
          settings: this.options.settings,
          platform: this.platform,
          filesystem: this.filesystem,
          hashFile: this.hashFile,
          signal: deadline.signal,
        }),
      );
    } catch {
      return this.unavailableProbe(
        "unavailable",
        deadline.currentReason() === "timeout"
          ? "probe_timeout"
          : "probe_failed",
        probedAt,
        os,
        architecture,
        avx2,
        deadline.currentReason() === "cancelled"
          ? "Probe was cancelled."
          : "The configured Video2X executable could not be verified before the probe deadline.",
      );
    }
    if (!resolution.ok) {
      return this.unavailableProbe(
        "unavailable",
        resolution.reason,
        probedAt,
        os,
        architecture,
        avx2,
        resolution.diagnostic,
        null,
        resolution.source,
      );
    }
    if (this.readinessHash !== resolution.sha256) {
      this.resetReadiness(resolution.sha256);
    }

    const redactions = this.redactionValues(
      resolution.executablePath,
      this.stagingRoot,
    );
    const version = await this.executeProbe(
      resolution,
      ["--version"],
      deadline,
      redactions,
    );
    if (!version.ok) {
      return this.unavailableProbe(
        "unavailable",
        version.reason,
        probedAt,
        os,
        architecture,
        avx2,
        version.diagnostic,
        resolution.sha256,
        resolution.source,
      );
    }
    if (version.stdout.trim() !== VIDEO2X_VERSION_OUTPUT) {
      return this.unavailableProbe(
        "unavailable",
        "incompatible_version",
        probedAt,
        os,
        architecture,
        avx2,
        safeDiagnostic(
          version.stdout,
          redactions,
          this.diagnosticLimit,
          this.platform,
        ),
        resolution.sha256,
        resolution.source,
      );
    }

    const help = await this.executeProbe(
      resolution,
      ["--help"],
      deadline,
      redactions,
    );
    if (!help.ok) {
      return this.unavailableProbe(
        "unavailable",
        help.reason,
        probedAt,
        os,
        architecture,
        avx2,
        help.diagnostic,
        resolution.sha256,
        resolution.source,
      );
    }
    if (
      REQUIRED_HELP_TOKENS.some(
        (token) => !hasExactHelpToken(help.stdout, token),
      )
    ) {
      return this.unavailableProbe(
        "unavailable",
        "incompatible_grammar",
        probedAt,
        os,
        architecture,
        avx2,
        "The Video2X command grammar does not match the pinned contract.",
        resolution.sha256,
        resolution.source,
      );
    }

    if (!this.options.processRunner || !this.options.processRunner.probeAvx2) {
      return this.unavailableProbe(
        "unavailable",
        "process_host_unavailable",
        probedAt,
        os,
        architecture,
        avx2,
        null,
        resolution.sha256,
        resolution.source,
      );
    }
    let avx2Result: Avx2ProbeResult;
    try {
      avx2Result = await deadline.wait(() =>
        this.options.processRunner.probeAvx2!(),
      );
    } catch {
      return this.unavailableProbe(
        "unavailable",
        deadline.currentReason() === "timeout"
          ? "probe_timeout"
          : "cpu_probe_failed",
        probedAt,
        os,
        architecture,
        avx2,
        deadline.currentReason() === "cancelled"
          ? "Probe was cancelled."
          : null,
        resolution.sha256,
        resolution.source,
      );
    }
    if (avx2Result.status === "unsupported") {
      avx2 = "unavailable";
      return this.unavailableProbe(
        "unsupported",
        "missing_avx2",
        probedAt,
        os,
        architecture,
        avx2,
        null,
        resolution.sha256,
        resolution.source,
      );
    }
    if (avx2Result.status !== "supported") {
      return this.unavailableProbe(
        "unavailable",
        avx2Result.reason ?? "cpu_probe_failed",
        probedAt,
        os,
        architecture,
        avx2,
        avx2Result.detail ?? null,
        resolution.sha256,
        resolution.source,
      );
    }
    avx2 = "available";

    const listed = await this.executeProbe(
      resolution,
      ["--list-devices"],
      deadline,
      redactions,
    );
    if (!listed.ok) {
      return this.unavailableProbe(
        "unavailable",
        listed.reason,
        probedAt,
        os,
        architecture,
        avx2,
        listed.diagnostic,
        resolution.sha256,
        resolution.source,
      );
    }
    const parsedDevices = parseVideo2xDevices(listed.stdout);
    if (parsedDevices.malformed || !parsedDevices.selected) {
      return this.unavailableProbe(
        "unavailable",
        "no_vulkan_device",
        probedAt,
        os,
        architecture,
        avx2,
        parsedDevices.malformed
          ? "Video2X returned malformed Vulkan device data."
          : "Video2X did not report a supported Vulkan GPU.",
        resolution.sha256,
        resolution.source,
      );
    }
    if (!(await this.executableMatches(resolution, deadline))) {
      return this.unavailableProbe(
        "unavailable",
        deadline.currentReason() === "timeout"
          ? "probe_timeout"
          : "probe_failed",
        probedAt,
        os,
        architecture,
        avx2,
        "The configured Video2X executable changed during probing.",
        resolution.sha256,
        resolution.source,
      );
    }

    const presets = this.currentReadiness();
    const allUnavailable = Object.values(presets).every(
      (entry) => entry.state === "unavailable",
    );
    const capability: VideoEnhancementCapability = allUnavailable
      ? {
          status: "unavailable",
          reason: "model_unavailable",
          backend: descriptor(resolution.sha256, resolution.source),
          platform: { os, architecture, avx2 },
          devices: parsedDevices.devices,
          presets,
          probedAt,
          diagnostic: "No pinned Video2X model is currently available.",
        }
      : {
          status: "ready",
          reason: null,
          backend: descriptor(resolution.sha256, resolution.source),
          platform: { os, architecture, avx2 },
          devices: parsedDevices.devices,
          presets,
          probedAt,
          diagnostic: null,
        };
    return {
      capability,
      runtime: allUnavailable
        ? null
        : {
            executablePath: resolution.executablePath,
            executableSha256: resolution.sha256,
            executableIdentity: resolution.identity,
            configurationSource: resolution.source,
            platform: { os, architecture, avx2 },
            selectedDevice: parsedDevices.selected,
            devices: parsedDevices.devices,
          },
    };
  }

  private unavailableProbe(
    status: "unavailable" | "unsupported",
    reason: VideoEnhancementCapabilityReason,
    probedAt: string,
    os: VideoEnhancementPlatform,
    architecture: VideoEnhancementArchitecture,
    avx2: VideoEnhancementAvx2Status,
    diagnostic: string | null = null,
    executableSha256: string | null = null,
    configurationSource: "environment" | "setting" | null = null,
  ): InternalProbeResult {
    return {
      capability: {
        status,
        reason,
        backend: descriptor(executableSha256, configurationSource),
        platform: { os, architecture, avx2 },
        devices: [],
        presets: presetAvailability("unavailable", reason),
        probedAt,
        diagnostic: safeDiagnostic(
          diagnostic ?? "",
          this.redactionValues(this.stagingRoot),
          this.diagnosticLimit,
          this.platform,
        ),
      },
      runtime: null,
    };
  }

  private currentReadiness(): Record<
    VideoEnhancementPresetId,
    VideoEnhancementPresetAvailability
  > {
    const result = presetAvailability("unverified", null);
    const now = this.monotonicNow();
    for (const presetId of Object.keys(result) as VideoEnhancementPresetId[]) {
      const observation = this.readiness.get(presetId);
      if (!observation || now - observation.observedAt >= this.readinessTtlMs) {
        const availability = this.unverifiedReadiness();
        this.readiness.set(presetId, { availability, observedAt: now });
        result[presetId] = availability;
      } else {
        result[presetId] = observation.availability;
      }
    }
    return result;
  }

  private resetReadiness(executableSha256: string | null): void {
    this.readiness.clear();
    this.readinessHash = executableSha256;
    for (const presetId of Object.keys(
      VIDEO_ENHANCEMENT_PRESETS,
    ) as VideoEnhancementPresetId[]) {
      this.readiness.set(presetId, {
        availability: this.unverifiedReadiness(),
        observedAt: this.monotonicNow(),
      });
    }
  }

  private setReadiness(
    presetId: VideoEnhancementPresetId,
    availability: VideoEnhancementPresetAvailability,
  ): void {
    this.readiness.set(presetId, {
      availability,
      observedAt: this.monotonicNow(),
    });
  }

  private unverifiedReadiness(): VideoEnhancementPresetAvailability {
    return {
      state: "unverified",
      reason: "The pinned model has not completed a staged run yet.",
    };
  }

  private async executeProbe(
    executable: Video2xExecutableResolutionSuccess,
    args: readonly string[],
    deadline: AdapterDeadline,
    redactions: readonly string[],
  ): Promise<ProbeExecutionResult> {
    let cwd: OwnedPrivateRoot | null = null;
    let terminationConfirmed = true;
    let processStarted = false;
    let processResultObserved = false;
    let outcome: ProbeExecutionResult;
    try {
      cwd = await this.createPrivateRoot("probe", deadline);
      const probeRoot = cwd;
      if (
        (await deadline.wait(() => this.filesystem.readdir(probeRoot.path)))
          .length !== 0
      ) {
        throw new Error("Probe working directory was not empty.");
      }
      if (!(await this.executableMatches(executable, deadline))) {
        outcome = {
          ok: false,
          reason:
            deadline.currentReason() === "timeout"
              ? "probe_timeout"
              : "probe_failed",
          diagnostic:
            "The configured Video2X executable changed before probing.",
        };
      } else {
        const stdout = new CompleteBoundedBuffer(MAX_PROBE_STRUCTURED_OUTPUT);
        const stderr = new RedactingTailBuffer(
          this.diagnosticLimit,
          () => [...redactions, ...(cwd ? [cwd.path] : [])],
          this.platform,
        );
        let sawStdoutCallback = false;
        let sawStderrCallback = false;
        const result = await deadline.wait(() => {
          processStarted = true;
          return this.options.processRunner.run({
            executable: executable.executablePath,
            args,
            cwd: probeRoot.path,
            env: scrubVideo2xEnvironment(this.env),
            timeoutMs: Math.max(
              1,
              Math.floor(Math.min(this.probeTimeoutMs, deadline.remainingMs())),
            ),
            signal: deadline.signal,
            onStdout: (chunk) => {
              sawStdoutCallback = true;
              stdout.add(chunk);
            },
            onStderr: (chunk) => {
              sawStderrCallback = true;
              stderr.add(chunk);
            },
            graceInput: "q",
          });
        });
        processResultObserved = true;
        terminationConfirmed = result.terminationConfirmed;
        if (!sawStdoutCallback) stdout.add(result.stdout);
        if (!sawStderrCallback) stderr.add(result.stderr);
        if (!terminationConfirmed) {
          outcome = {
            ok: false,
            reason:
              result.timedOut || deadline.currentReason() === "timeout"
                ? "probe_timeout"
                : "probe_failed",
            diagnostic:
              "Private probe data was quarantined because process termination could not be confirmed.",
          };
        } else if (stdout.overflowed()) {
          outcome = {
            ok: false,
            reason: "probe_failed",
            diagnostic:
              "Video2X probe output exceeded the compatibility limit.",
          };
        } else if (result.timedOut || deadline.currentReason() === "timeout") {
          outcome = {
            ok: false,
            reason: "probe_timeout",
            diagnostic: stderr.text() || null,
          };
        } else if (
          result.cancelled ||
          deadline.currentReason() === "cancelled" ||
          result.exitCode !== 0
        ) {
          outcome = {
            ok: false,
            reason: "probe_failed",
            diagnostic: stderr.text() || null,
          };
        } else {
          outcome = { ok: true, stdout: stdout.text() };
        }
      }
    } catch (error) {
      if (processStarted && !processResultObserved)
        terminationConfirmed = false;
      outcome = {
        ok: false,
        reason:
          deadline.currentReason() === "timeout"
            ? "probe_timeout"
            : "probe_failed",
        diagnostic: terminationConfirmed
          ? safeDiagnostic(
              error instanceof Error ? error.message : "Video2X probe failed.",
              cwd ? [...redactions, cwd.path] : redactions,
              this.diagnosticLimit,
              this.platform,
            )
          : "Private probe data was quarantined because process termination could not be confirmed.",
      };
    }
    if (
      cwd &&
      terminationConfirmed &&
      (await this.cleanupOwnedRoot(cwd)) !== "removed"
    ) {
      return {
        ok: false,
        reason: "probe_failed",
        diagnostic:
          "Private probe data was quarantined because ownership-safe cleanup could not be completed.",
      };
    }
    return outcome;
  }

  private async runEnhancementProcess(options: {
    readonly executablePath: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
    readonly entry: Video2xStagePlanEntry;
    readonly request: VideoEnhancementRequest;
    readonly context: VideoEnhancementBackendRunContext;
    readonly stageIndex: number;
    readonly stageCount: number;
    readonly progressEvents: VideoEnhancementProgress[];
    readonly redactions: readonly string[];
  }): Promise<ProcessCapture> {
    const stdout = new RedactingTailBuffer(
      this.diagnosticLimit,
      () => options.redactions,
      this.platform,
    );
    const stderr = new RedactingTailBuffer(
      this.diagnosticLimit,
      () => options.redactions,
      this.platform,
    );
    let sawStdoutCallback = false;
    let sawStderrCallback = false;
    const decoder = new ProgressLineDecoder((line) => {
      const parsed = parseVideo2xProgressLine(line);
      if (!parsed) return;
      const event: VideoEnhancementProgress = {
        requestId: options.request.requestId,
        childJobId: options.context.childJobId,
        stage: options.entry.stage,
        stageIndex: options.stageIndex,
        stageCount: options.stageCount,
        ...(parsed.processedFrames === undefined
          ? {}
          : { processedFrames: parsed.processedFrames }),
        ...(parsed.totalFrames === undefined
          ? {}
          : { totalFrames: parsed.totalFrames }),
        ...(parsed.percent === undefined ? {} : { percent: parsed.percent }),
        ...(parsed.processingFps === undefined
          ? {}
          : { processingFps: parsed.processingFps }),
        ...(parsed.elapsedMs === undefined
          ? {}
          : { elapsedMs: parsed.elapsedMs }),
        ...(parsed.remainingMs === undefined
          ? {}
          : { remainingMs: parsed.remainingMs }),
        message: "Video2X is processing the staged video.",
      };
      options.progressEvents.push(event);
      if (options.progressEvents.length > MAX_PROGRESS_EVENTS)
        options.progressEvents.shift();
      try {
        options.context.onProgress?.(event);
      } catch {
        // A consumer callback cannot control the subprocess lifecycle.
      }
    });
    const result = await this.options.processRunner.run({
      executable: options.executablePath,
      args: options.args,
      cwd: options.cwd,
      env: scrubVideo2xEnvironment(this.env),
      timeoutMs: Math.max(1, Math.floor(options.timeoutMs)),
      signal: options.signal,
      onStdout: (chunk) => {
        sawStdoutCallback = true;
        stdout.add(chunk);
        decoder.push(chunk);
      },
      onStderr: (chunk) => {
        sawStderrCallback = true;
        stderr.add(chunk);
      },
      graceInput: "q",
    });
    if (!sawStdoutCallback) {
      stdout.add(result.stdout);
      decoder.push(result.stdout);
    }
    if (!sawStderrCallback) stderr.add(result.stderr);
    decoder.end();
    return { result, stdout: stdout.text(), stderr: stderr.text() };
  }

  private async executableMatches(
    executable: ExecutableFingerprint,
    deadline?: AdapterDeadline,
  ): Promise<boolean> {
    try {
      const linkStat = await this.waitFor(
        () => this.filesystem.lstat(executable.executablePath),
        deadline,
      );
      const canonical = await this.waitFor(
        () => this.filesystem.realpath(executable.executablePath),
        deadline,
      );
      const stat = await this.waitFor(
        () => this.filesystem.stat(canonical),
        deadline,
      );
      if (
        linkStat.isSymbolicLink() ||
        !stat.isFile() ||
        !platformEquals(canonical, executable.executablePath, this.platform) ||
        stat.size !== executable.identity.size ||
        stat.dev !== executable.identity.dev ||
        stat.ino !== executable.identity.ino
      ) {
        return false;
      }
      return (
        (await this.waitFor(
          () => this.hashFile(canonical, deadline?.signal),
          deadline,
        )) === executable.sha256
      );
    } catch {
      return false;
    }
  }

  private async verifySource(
    request: VideoEnhancementRequest,
    expected?: VerifiedSource,
    deadline?: AdapterDeadline,
  ): Promise<VerifiedSource> {
    let canonical: string;
    let stat: Video2xFileStat;
    let linkStat: Video2xFileStat;
    try {
      linkStat = await this.waitFor(
        () => this.filesystem.lstat(request.source.path),
        deadline,
      );
      canonical = await this.waitFor(
        () => this.filesystem.realpath(request.source.path),
        deadline,
      );
      stat = await this.waitFor(
        () => this.filesystem.stat(canonical),
        deadline,
      );
    } catch {
      throw new AdapterFailure(
        "source_invalid",
        "preflight",
        false,
        "Source is missing or unreadable.",
      );
    }
    if (
      linkStat.isSymbolicLink() ||
      !stat.isFile() ||
      !platformEquals(canonical, request.source.path, this.platform)
    ) {
      throw new AdapterFailure(
        "source_invalid",
        "preflight",
        false,
        "Source is not a canonical regular file.",
      );
    }
    if (stat.size !== request.source.sizeBytes) {
      throw new AdapterFailure(
        "source_changed",
        "preflight",
        false,
        "Source size changed.",
      );
    }
    if (expected && (stat.dev !== expected.dev || stat.ino !== expected.ino)) {
      throw new AdapterFailure(
        "source_changed",
        "preflight",
        false,
        "Source file identity changed.",
      );
    }
    let hash: string;
    try {
      hash = await this.waitFor(
        () => this.hashFile(canonical, deadline?.signal),
        deadline,
      );
    } catch {
      throw new AdapterFailure(
        "source_invalid",
        "preflight",
        false,
        "Source could not be hashed.",
      );
    }
    if (hash !== request.source.sha256) {
      throw new AdapterFailure(
        "source_changed",
        "preflight",
        false,
        "Source hash changed.",
      );
    }
    return { path: canonical, dev: stat.dev, ino: stat.ino };
  }

  private async createPrivateRoot(
    kind: "probe" | "job",
    deadline: AdapterDeadline,
    childJobId?: string,
  ): Promise<OwnedPrivateRoot> {
    const implementation = platformPath(this.platform);
    if (!implementation.isAbsolute(this.stagingRoot)) {
      throw new AdapterFailure(
        "output_conflict",
        "preflight",
        false,
        "Staging root is not absolute.",
      );
    }
    await deadline.wait(() =>
      this.filesystem.mkdir(this.stagingRoot, {
        recursive: true,
        mode: 0o700,
      }),
    );
    const configuredRootStat = await deadline.wait(() =>
      this.filesystem.lstat(this.stagingRoot),
    );
    const canonicalBase = await deadline.wait(() =>
      this.filesystem.realpath(this.stagingRoot),
    );
    const baseStat = await deadline.wait(() =>
      this.filesystem.stat(canonicalBase),
    );
    const normalizedConfiguredRoot = implementation.resolve(this.stagingRoot);
    if (
      configuredRootStat.isSymbolicLink() ||
      !configuredRootStat.isDirectory() ||
      !baseStat.isDirectory() ||
      configuredRootStat.dev !== baseStat.dev ||
      configuredRootStat.ino !== baseStat.ino ||
      !this.isPrivateDirectory(baseStat) ||
      !platformEquals(normalizedConfiguredRoot, canonicalBase, this.platform)
    ) {
      throw new AdapterFailure(
        "output_conflict",
        "preflight",
        false,
        "Staging root is not a canonical private directory.",
      );
    }
    const baseIdentity = { dev: baseStat.dev, ino: baseStat.ino };
    let leaf: string;
    if (kind === "job") {
      if (childJobId === undefined) {
        throw new AdapterFailure(
          "internal_error",
          "preflight",
          false,
          "Child job identity is missing.",
        );
      }
      leaf = video2xJobRootLeaf(childJobId);
    } else {
      const token = this.idFactory();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(token)) {
        throw new AdapterFailure(
          "internal_error",
          "preflight",
          false,
          "Probe root token is invalid.",
        );
      }
      leaf = `video2x-probe-${token}`;
    }
    const candidate = implementation.join(canonicalBase, leaf);
    this.assertContained(canonicalBase, candidate);
    let createdIdentity: FileIdentity | null = null;
    try {
      await deadline.wait(() =>
        this.filesystem.mkdir(candidate, {
          recursive: false,
          mode: 0o700,
        }),
      );
      const linkStat = await deadline.wait(() =>
        this.filesystem.lstat(candidate),
      );
      createdIdentity = { dev: linkStat.dev, ino: linkStat.ino };
      const canonical = await deadline.wait(() =>
        this.filesystem.realpath(candidate),
      );
      const stat = await deadline.wait(() => this.filesystem.stat(canonical));
      if (
        linkStat.isSymbolicLink() ||
        !linkStat.isDirectory() ||
        !stat.isDirectory() ||
        !this.isPrivateDirectory(linkStat) ||
        !sameIdentity(createdIdentity, { dev: stat.dev, ino: stat.ino }) ||
        !platformEquals(candidate, canonical, this.platform) ||
        !isContained(canonicalBase, canonical, this.platform)
      ) {
        throw new AdapterFailure(
          "output_conflict",
          "preflight",
          false,
          "Job root containment could not be proven.",
        );
      }
      return {
        path: canonical,
        basePath: canonicalBase,
        identity: createdIdentity,
        baseIdentity,
      };
    } catch (error) {
      if (createdIdentity) {
        await this.removeFreshEmptyRoot(
          candidate,
          canonicalBase,
          createdIdentity,
          baseIdentity,
        );
      }
      if (error instanceof AdapterFailure) throw error;
      if (isExistingFileError(error)) {
        throw new AdapterFailure(
          "output_conflict",
          "preflight",
          false,
          "The deterministic private job root already exists.",
        );
      }
      throw new AdapterFailure(
        "output_conflict",
        "preflight",
        false,
        "Job root containment could not be proven.",
      );
    }
  }

  private async createStageWorkRoot(
    jobRoot: OwnedPrivateRoot,
    stageIndex: number,
    deadline: AdapterDeadline,
  ): Promise<OwnedPrivateRoot> {
    if (!(await this.ownedRootIsCurrent(jobRoot))) {
      throw new AdapterFailure(
        "output_conflict",
        "preflight",
        false,
        "Job root ownership could not be revalidated.",
      );
    }
    const implementation = platformPath(this.platform);
    const candidate = implementation.join(jobRoot.path, `work-${stageIndex}`);
    this.assertContained(jobRoot.path, candidate);
    let createdIdentity: FileIdentity | null = null;
    try {
      await deadline.wait(() =>
        this.filesystem.mkdir(candidate, {
          recursive: false,
          mode: 0o700,
        }),
      );
      const linkStat = await deadline.wait(() =>
        this.filesystem.lstat(candidate),
      );
      createdIdentity = { dev: linkStat.dev, ino: linkStat.ino };
      const canonical = await deadline.wait(() =>
        this.filesystem.realpath(candidate),
      );
      const stat = await deadline.wait(() => this.filesystem.stat(canonical));
      const entries = await deadline.wait(() =>
        this.filesystem.readdir(canonical),
      );
      if (
        linkStat.isSymbolicLink() ||
        !linkStat.isDirectory() ||
        !stat.isDirectory() ||
        !this.isPrivateDirectory(linkStat) ||
        !sameIdentity(createdIdentity, { dev: stat.dev, ino: stat.ino }) ||
        !platformEquals(candidate, canonical, this.platform) ||
        !isContained(jobRoot.path, canonical, this.platform) ||
        entries.length !== 0
      ) {
        throw new AdapterFailure(
          "output_conflict",
          "preflight",
          false,
          "Stage working-directory isolation could not be proven.",
        );
      }
      return {
        path: canonical,
        basePath: jobRoot.path,
        identity: createdIdentity,
        baseIdentity: jobRoot.identity,
      };
    } catch (error) {
      if (createdIdentity) {
        await this.removeFreshEmptyRoot(
          candidate,
          jobRoot.path,
          createdIdentity,
          jobRoot.identity,
        );
      }
      if (error instanceof AdapterFailure) throw error;
      throw new AdapterFailure(
        "output_conflict",
        "preflight",
        false,
        "Stage working-directory isolation could not be proven.",
      );
    }
  }

  private isPrivateDirectory(stat: Video2xFileStat): boolean {
    if (this.platform === "win32") return true;
    const getuid = process.getuid;
    return (
      typeof getuid === "function" &&
      stat.uid === getuid() &&
      (stat.mode & 0o077) === 0
    );
  }

  private assertContained(root: string, target: string): void {
    if (!isContained(root, target, this.platform)) {
      throw new AdapterFailure(
        "output_conflict",
        "preflight",
        false,
        "Output escaped the job root.",
      );
    }
  }

  private async requireMissing(
    target: string,
    deadline?: AdapterDeadline,
  ): Promise<void> {
    try {
      await this.waitFor(() => this.filesystem.lstat(target), deadline);
      throw new AdapterFailure(
        "output_conflict",
        "preflight",
        false,
        "Output already exists.",
      );
    } catch (error) {
      if (error instanceof AdapterFailure) throw error;
      if (!isMissingFileError(error)) {
        throw new AdapterFailure(
          "output_conflict",
          "preflight",
          false,
          "Output state could not be verified.",
        );
      }
    }
  }

  private async verifyStagedFile(
    root: string,
    target: string,
    source: VerifiedSource,
    expected?: VerifiedOutput,
    deadline?: AdapterDeadline,
  ): Promise<VerifiedOutput> {
    let stat: Video2xFileStat;
    let canonical: string;
    try {
      stat = await this.waitFor(() => this.filesystem.lstat(target), deadline);
      canonical = await this.waitFor(
        () => this.filesystem.realpath(target),
        deadline,
      );
    } catch {
      throw new AdapterFailure(
        "output_invalid",
        "validate",
        true,
        "Staged output is missing.",
      );
    }
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size <= 0 ||
      (stat.dev === source.dev && stat.ino === source.ino) ||
      (expected !== undefined &&
        (stat.size !== expected.size ||
          stat.dev !== expected.dev ||
          stat.ino !== expected.ino)) ||
      !platformEquals(canonical, target, this.platform) ||
      !isContained(root, canonical, this.platform)
    ) {
      throw new AdapterFailure(
        "output_invalid",
        "validate",
        true,
        "Staged output is not a contained regular file.",
      );
    }
    return { size: stat.size, dev: stat.dev, ino: stat.ino };
  }

  private async removeExact(
    target: string,
    recursive: boolean,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.filesystem.rm(target, { recursive, force: true });
        return true;
      } catch {
        // One immediate retry handles transient Windows sharing races.
      }
    }
    return false;
  }

  private async waitFor<T>(
    startOperation: () => Promise<T>,
    deadline?: AdapterDeadline,
  ): Promise<T> {
    return deadline ? deadline.wait(startOperation) : startOperation();
  }

  private async removeFreshEmptyRoot(
    target: string,
    basePath: string,
    identity: FileIdentity,
    baseIdentity: FileIdentity,
  ): Promise<boolean> {
    try {
      const baseLink = await this.filesystem.lstat(basePath);
      const canonicalBase = await this.filesystem.realpath(basePath);
      const baseStat = await this.filesystem.stat(canonicalBase);
      const targetLink = await this.filesystem.lstat(target);
      if (
        baseLink.isSymbolicLink() ||
        !baseLink.isDirectory() ||
        !baseStat.isDirectory() ||
        !platformEquals(basePath, canonicalBase, this.platform) ||
        !sameIdentity(baseIdentity, {
          dev: baseLink.dev,
          ino: baseLink.ino,
        }) ||
        !sameIdentity(baseIdentity, {
          dev: baseStat.dev,
          ino: baseStat.ino,
        }) ||
        targetLink.isSymbolicLink() ||
        !targetLink.isDirectory() ||
        !sameIdentity(identity, {
          dev: targetLink.dev,
          ino: targetLink.ino,
        }) ||
        !isContained(basePath, target, this.platform) ||
        (await this.filesystem.readdir(target)).length !== 0
      ) {
        return false;
      }
      await this.filesystem.rmdir(target);
      return true;
    } catch {
      return false;
    }
  }

  private async ownedRootIsCurrent(root: OwnedPrivateRoot): Promise<boolean> {
    try {
      const baseLink = await this.filesystem.lstat(root.basePath);
      const canonicalBase = await this.filesystem.realpath(root.basePath);
      const baseStat = await this.filesystem.stat(canonicalBase);
      const linkStat = await this.filesystem.lstat(root.path);
      const canonical = await this.filesystem.realpath(root.path);
      const stat = await this.filesystem.stat(canonical);
      return (
        !baseLink.isSymbolicLink() &&
        baseLink.isDirectory() &&
        baseStat.isDirectory() &&
        platformEquals(root.basePath, canonicalBase, this.platform) &&
        sameIdentity(root.baseIdentity, {
          dev: baseLink.dev,
          ino: baseLink.ino,
        }) &&
        sameIdentity(root.baseIdentity, {
          dev: baseStat.dev,
          ino: baseStat.ino,
        }) &&
        !linkStat.isSymbolicLink() &&
        linkStat.isDirectory() &&
        stat.isDirectory() &&
        this.isPrivateDirectory(linkStat) &&
        platformEquals(root.path, canonical, this.platform) &&
        isContained(canonicalBase, canonical, this.platform) &&
        sameIdentity(root.identity, {
          dev: linkStat.dev,
          ino: linkStat.ino,
        }) &&
        sameIdentity(root.identity, { dev: stat.dev, ino: stat.ino })
      );
    } catch {
      return false;
    }
  }

  private async removeOwnedFile(
    root: OwnedPrivateRoot,
    target: string,
    expected: VerifiedOutput,
  ): Promise<boolean> {
    try {
      if (!(await this.ownedRootIsCurrent(root))) return false;
      const linkStat = await this.filesystem.lstat(target);
      const canonical = await this.filesystem.realpath(target);
      if (
        linkStat.isSymbolicLink() ||
        !linkStat.isFile() ||
        linkStat.size !== expected.size ||
        linkStat.dev !== expected.dev ||
        linkStat.ino !== expected.ino ||
        !platformEquals(target, canonical, this.platform) ||
        !isContained(root.path, canonical, this.platform)
      ) {
        return false;
      }
      return this.removeExact(target, false);
    } catch {
      return false;
    }
  }

  private async cleanupOwnedRoot(
    root: OwnedPrivateRoot,
  ): Promise<"removed" | "quarantined"> {
    if (!(await this.ownedRootIsCurrent(root))) return "quarantined";
    return (await this.removeExact(root.path, true))
      ? "removed"
      : "quarantined";
  }

  private redactionValues(...paths: string[]): string[] {
    const values = [
      this.homeDirectory,
      this.workspaceRoot,
      this.stagingRoot,
      ...paths,
    ];
    for (const [name, value] of Object.entries(this.env)) {
      if (value && (isSensitiveEnvName(name) || valueLooksLikeSecret(value))) {
        values.push(value);
      }
    }
    return values;
  }

  private progressSnapshot(
    progress: VideoEnhancementProgress | undefined,
  ): VideoEnhancementProgressSnapshot {
    if (!progress) return {};
    return {
      ...(progress.processedFrames === undefined
        ? {}
        : { processedFrames: progress.processedFrames }),
      ...(progress.totalFrames === undefined
        ? {}
        : { totalFrames: progress.totalFrames }),
      ...(progress.percent === undefined ? {} : { percent: progress.percent }),
      ...(progress.processingFps === undefined
        ? {}
        : { processingFps: progress.processingFps }),
      ...(progress.elapsedMs === undefined
        ? {}
        : { elapsedMs: progress.elapsedMs }),
      ...(progress.remainingMs === undefined
        ? {}
        : { remainingMs: progress.remainingMs }),
    };
  }

  private errorCodeForCapability(
    reason: VideoEnhancementCapabilityReason,
  ): VideoEnhancementErrorCode {
    if (
      reason === "unsupported_platform" ||
      reason === "unsupported_architecture"
    ) {
      return "unsupported_platform";
    }
    if (reason === "model_unavailable") return "model_unavailable";
    if (
      reason === "missing_avx2" ||
      reason === "incompatible_version" ||
      reason === "incompatible_grammar" ||
      reason === "no_vulkan_device"
    ) {
      return "incompatible_backend";
    }
    return "backend_unavailable";
  }

  private failure(
    request: VideoEnhancementRequest,
    childJobId: string,
    code: VideoEnhancementErrorCode,
    stage: VideoEnhancementProgressStage,
    retryable: boolean,
    diagnostics: string | null,
  ): VideoEnhancementFailure {
    const messages: Record<VideoEnhancementErrorCode, string> = {
      invalid_request: "The video enhancement request is invalid.",
      backend_unavailable: "Video2X is not available on this device.",
      unsupported_platform: "Video2X is not supported on this platform.",
      incompatible_backend:
        "The configured Video2X installation is incompatible.",
      model_unavailable: "The selected Video2X model is unavailable.",
      source_changed: "The source video changed after the request was queued.",
      source_invalid: "The source video is missing or invalid.",
      output_conflict: "A private staging output could not be created safely.",
      process_timeout: "Video enhancement exceeded its time limit.",
      process_failed: "Video2X failed while processing the staged video.",
      cancelled: "Video enhancement was cancelled.",
      output_invalid: "Video2X did not produce a valid staged MP4.",
      provenance_failed: "Video enhancement provenance could not be recorded.",
      publish_failed: "The enhanced video could not be published.",
      internal_error: "Video enhancement failed unexpectedly.",
    };
    return {
      ok: false,
      requestId: request.requestId,
      parentJobId: request.parentJobId,
      childJobId,
      error: { code, message: messages[code], retryable, stage, diagnostics },
    };
  }
}

class AdapterFailure extends Error {
  constructor(
    readonly code: VideoEnhancementErrorCode,
    readonly stage: VideoEnhancementProgressStage,
    readonly retryable: boolean,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "AdapterFailure";
  }
}
