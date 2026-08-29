import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canonicalMkDtemp } from "./helpers/canonicalTempDir";

import type { SettingsStore } from "../../core/storage/SettingsStore";
import type {
  VideoEnhancementRequest,
  VideoEnhancementUpscalePresetId,
} from "../../core/video";
import type {
  Avx2ProbeResult,
  GuardedProcessRequest,
  GuardedProcessResult,
  GuardedVideoProcess,
} from "../sidecar/src/video/GuardedVideoProcess";
import {
  Video2xAdapter,
  buildVideo2xInvocationArgs,
  buildVideo2xStagePlan,
  hashVideo2xFile,
  parseVideo2xDevices,
  parseVideo2xProgressLine,
  resolveVideo2xExecutable,
  video2xJobRootLeaf,
  type Video2xAdapterOptions,
  type Video2xFileStat,
  type Video2xFileSystem,
} from "../sidecar/src/video/Video2xAdapter";

const PINNED_HELP = [
  "--list-devices",
  "--device",
  "--scaling-factor",
  "--frame-rate-mul",
  "--realesrgan-model",
  "--rife-model",
].join("\n");
const DEVICES = [
  "0. Integrated Adapter",
  "Type: Integrated GPU",
  "1. CPU Device",
  "Type: CPU",
  "5. Discrete Adapter B",
  "Type: Discrete GPU",
  "2. Discrete Adapter A",
  "Type: Discrete GPU",
].join("\n");
const HOST_PLATFORM: NodeJS.Platform =
  process.platform === "win32" ? "win32" : "linux";

function result(
  overrides: Partial<GuardedProcessResult> = {},
): GuardedProcessResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    cancelled: false,
    terminationConfirmed: true,
    ...overrides,
  };
}

type RunHook = (
  request: GuardedProcessRequest,
  callIndex: number,
) =>
  GuardedProcessResult | undefined | Promise<GuardedProcessResult | undefined>;

class FakeVideoProcess implements GuardedVideoProcess {
  readonly calls: GuardedProcessRequest[] = [];
  readonly cwdEntriesAtLaunch: string[][] = [];
  avx2Calls = 0;

  constructor(
    private readonly hook?: RunHook,
    private readonly avx2: Avx2ProbeResult = { status: "supported" },
  ) {}

  async probeAvx2(): Promise<Avx2ProbeResult> {
    this.avx2Calls += 1;
    return this.avx2;
  }

  async run(request: GuardedProcessRequest): Promise<GuardedProcessResult> {
    this.calls.push(request);
    this.cwdEntriesAtLaunch.push(await fs.readdir(request.cwd));
    const overridden = await this.hook?.(request, this.calls.length - 1);
    if (overridden) return overridden;
    const first = request.args[0];
    if (first === "--version")
      return this.emit(request, "Video2X version 6.4.0\n");
    if (first === "--help") return this.emit(request, PINNED_HELP);
    if (first === "--list-devices") return this.emit(request, DEVICES);
    if (first !== "-i") throw new Error("unexpected fake Video2X invocation");
    const output = argumentValue(request.args, "-o");
    await fs.writeFile(output, "enhanced-video-bytes");
    const progress =
      "\u001b[32mframe=2/4 (50%); fps=12.5; elapsed=00:00:01; remaining=00:00:01\u001b[0m\r";
    request.onStdout?.(progress);
    return result({ stdout: progress });
  }

  private emit(
    request: GuardedProcessRequest,
    stdout: string,
  ): GuardedProcessResult {
    request.onStdout?.(stdout);
    return result({ stdout });
  }
}

function argumentValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = args[index + 1];
  if (index < 0 || value === undefined) throw new Error(`missing ${flag}`);
  return value;
}

function settingsWith(
  value: string | undefined,
  onGet?: () => void,
): Pick<SettingsStore, "get"> {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      expect(key).toBe("video.video2xPath");
      onGet?.();
      return value as T | undefined;
    },
  };
}

function realFilesystem(): Video2xFileSystem {
  return {
    mkdir: (target, options) => fs.mkdir(target, options),
    realpath: (target) => fs.realpath(target),
    stat: (target) => fs.stat(target),
    lstat: (target) => fs.lstat(target),
    access: (target, mode) => fs.access(target, mode),
    readdir: (target) => fs.readdir(target),
    rm: (target, options) => fs.rm(target, options),
    rmdir: (target) => fs.rmdir(target),
  };
}

function statView(stat: Video2xFileStat, symbolic: boolean): Video2xFileStat {
  return {
    size: stat.size,
    mode: stat.mode,
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    isFile: () => stat.isFile(),
    isDirectory: () => stat.isDirectory(),
    isSymbolicLink: () => symbolic,
  };
}

async function sha256(target: string): Promise<string> {
  return createHash("sha256")
    .update(await fs.readFile(target))
    .digest("hex");
}

let sandbox = "";
let executablePath = "";
let sourcePath = "";
let stagingRoot = "";

beforeEach(async () => {
  sandbox = await canonicalMkDtemp("nexus-video2x-adapter-");
  executablePath = path.join(sandbox, "video2x local executable");
  sourcePath = path.join(
    sandbox,
    "source clip 'quoted' &;$() unicode-\u00e9.mp4",
  );
  stagingRoot = path.join(sandbox, "private staging");
  await fs.writeFile(executablePath, "fake-video2x-binary");
  await fs.chmod(executablePath, 0o755);
  await fs.writeFile(sourcePath, "source-video-bytes");
  executablePath = await fs.realpath(executablePath);
  sourcePath = await fs.realpath(sourcePath);
});

afterEach(async () => {
  if (sandbox) await fs.rm(sandbox, { recursive: true, force: true });
});

async function requestFor(
  mode: "upscale" | "interpolate" | "upscale_interpolate" = "upscale",
  upscalePreset: VideoEnhancementUpscalePresetId = "animation-upscale-2x",
  source = sourcePath,
  requestId = "123e4567-e89b-42d3-a456-426614174000",
): Promise<VideoEnhancementRequest> {
  const stat = await fs.stat(source);
  const common = {
    requestId,
    parentJobId: "video-parent-1",
    source: {
      path: source,
      sha256: await sha256(source),
      sizeBytes: stat.size,
      durationSeconds: 2,
      width: 640,
      height: 360,
      frameRate: { numerator: 24, denominator: 1 },
    },
    requestedAt: "2026-08-28T12:00:00.000Z",
    timeoutMs: 60_000,
  } as const;
  if (mode === "upscale") return { ...common, mode, upscalePreset };
  if (mode === "interpolate") {
    return { ...common, mode, interpolationPreset: "smooth-2x" };
  }
  return {
    ...common,
    mode,
    upscalePreset,
    interpolationPreset: "smooth-2x",
  };
}

function createAdapter(
  processRunner: GuardedVideoProcess,
  overrides: Partial<Video2xAdapterOptions> = {},
): Video2xAdapter {
  let id = 0;
  const defaults: Video2xAdapterOptions = {
    settings: settingsWith(undefined),
    processRunner,
    stagingRoot,
    env: {
      PATH: process.env.PATH,
      NEXUS_VIDEO2X_PATH: executablePath,
      LD_PRELOAD: "/hostile/loader.so",
      DYLD_INSERT_LIBRARIES: "/hostile/dylib",
      VK_LAYER_PATH: "/hostile/vulkan",
      SECRET_TOKEN: "secret-value-that-must-not-leak",
    },
    platform: HOST_PLATFORM,
    architecture: "x64",
    idFactory: () => `fixture-${++id}`,
    homeDirectory: path.join(sandbox, "private-home"),
    workspaceRoot: path.join(sandbox, "private-workspace"),
  };
  return new Video2xAdapter({
    ...defaults,
    ...overrides,
    settings: overrides.settings ?? defaults.settings,
    processRunner: overrides.processRunner ?? processRunner,
  });
}

describe("Video2X pure contract helpers", () => {
  it.each([
    [
      "animation-upscale-2x",
      [
        "-p",
        "realesrgan",
        "-s",
        "2",
        "--realesrgan-model",
        "realesr-animevideov3",
      ],
    ],
    [
      "animation-upscale-4x",
      [
        "-p",
        "realesrgan",
        "-s",
        "4",
        "--realesrgan-model",
        "realesr-animevideov3",
      ],
    ],
    [
      "general-upscale-4x",
      ["-p", "realesrgan", "-s", "4", "--realesrgan-model", "realesrgan-plus"],
    ],
  ] as const)("maps %s to its exact pinned argv", async (preset, expected) => {
    const plan = buildVideo2xStagePlan(await requestFor("upscale", preset));
    expect(plan).toHaveLength(1);
    expect(plan[0]?.args).toEqual(expected);
    expect(plan[0]?.backend).toEqual({
      processor: "realesrgan",
      model:
        preset === "general-upscale-4x"
          ? "realesrgan-plus"
          : "realesr-animevideov3",
      normalizedArguments: {
        scalingFactor: preset === "animation-upscale-2x" ? 2 : 4,
      },
    });
  });

  it("maps smooth-2x and orders combined upscale before interpolation", async () => {
    const interpolation = buildVideo2xStagePlan(
      await requestFor("interpolate"),
    );
    expect(interpolation[0]?.args).toEqual([
      "-p",
      "rife",
      "-m",
      "2",
      "--rife-model",
      "rife-v4.6",
    ]);
    expect(interpolation[0]?.backend).toEqual({
      processor: "rife",
      model: "rife-v4.6",
      normalizedArguments: { frameRateMultiplier: 2 },
    });
    const combined = buildVideo2xStagePlan(
      await requestFor("upscale_interpolate", "general-upscale-4x"),
    );
    expect(combined.map((entry) => entry.stage)).toEqual([
      "upscale",
      "interpolate",
    ]);
  });

  it("keeps hostile paths as single argv values", async () => {
    const entry = buildVideo2xStagePlan(await requestFor())[0];
    if (!entry) throw new Error("missing test stage");
    const input =
      'C:\\Media Folder\\quote" & pipe| percent% caret^ unicode-\u96ea\\tail\\';
    const output = "C:\\Private Output\\result & done.partial.mp4";
    const args = buildVideo2xInvocationArgs(input, output, entry, 7);
    expect(args).toEqual([
      "-i",
      input,
      "-o",
      output,
      ...entry.args,
      "--device",
      "7",
    ]);
  });

  it("parses ANSI progress and leaves malformed telemetry indeterminate", () => {
    expect(
      parseVideo2xProgressLine(
        "\u001b[32mframe=12/24 (50%); fps=6.5; elapsed=00:00:02; remaining=00:00:02\u001b[0m",
      ),
    ).toMatchObject({
      determinate: true,
      processedFrames: 12,
      totalFrames: 24,
      percent: 50,
      processingFps: 6.5,
      elapsedMs: 2_000,
      remainingMs: 2_000,
    });
    expect(
      parseVideo2xProgressLine(
        "frame=4/?; fps=nan; elapsed=bad; remaining=bad",
      ),
    ).toEqual({
      message: "frame=4/?; fps=nan; elapsed=bad; remaining=bad",
      determinate: false,
      processedFrames: 4,
    });
    expect(parseVideo2xProgressLine("ordinary log line")).toBeNull();
    expect(
      parseVideo2xProgressLine(
        "frame=5/4 (100%); fps=1; elapsed=00:00:01; remaining=00:00:00",
      ),
    ).toEqual({
      message: "frame=5/4 (100%); fps=1; elapsed=00:00:01; remaining=00:00:00",
      determinate: false,
    });
  });

  it("selects the lowest discrete device, then the lowest integrated device", () => {
    const parsed = parseVideo2xDevices(DEVICES);
    expect(parsed.malformed).toBe(false);
    expect(parsed.selected).toMatchObject({
      id: 2,
      type: "discrete_gpu",
      selected: true,
    });
    const integrated = parseVideo2xDevices(
      "9. CPU\nType: CPU\n4. Integrated B\nType: Integrated GPU\n1. Integrated A\nType: Integrated GPU",
    );
    expect(integrated.selected).toMatchObject({
      id: 1,
      type: "integrated_gpu",
    });
  });

  it("fails closed for malformed, virtual, CPU-only, and unknown devices", () => {
    expect(parseVideo2xDevices("0. Broken").malformed).toBe(true);
    expect(
      parseVideo2xDevices("0. Virtual\nType: Virtual GPU").selected,
    ).toBeNull();
    expect(parseVideo2xDevices("0. CPU\nType: CPU").selected).toBeNull();
    expect(
      parseVideo2xDevices("0. Mystery\nType: Something Else").malformed,
    ).toBe(true);
  });

  it("derives restart-addressable job leaves from fixed UTF-8 SHA-256 vectors", () => {
    expect(video2xJobRootLeaf("enhance-child-1")).toBe(
      "video2x-job-4988fbf2e5f31e5cdb8d7b07a8402ea5",
    );
    expect(video2xJobRootLeaf("child-unicode-\u96ea")).toBe(
      "video2x-job-6ee1db6c53904c770f3d116c8dcc9cc2",
    );
    expect(video2xJobRootLeaf("enhance-child-1")).not.toContain(
      "enhance-child-1",
    );
  });

  it("makes the default streaming hash abort-aware", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      hashVideo2xFile(sourcePath, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("Video2X executable resolution and capability", () => {
  it("uses a nonempty environment path before the typed setting and hashes it", async () => {
    let settingReads = 0;
    const resolved = await resolveVideo2xExecutable({
      env: {
        NEXUS_VIDEO2X_PATH: executablePath,
        PATH: path.dirname(executablePath),
      },
      settings: settingsWith(path.join(sandbox, "other"), () => {
        settingReads += 1;
      }),
      platform: HOST_PLATFORM,
    });
    expect(resolved).toMatchObject({
      ok: true,
      source: "environment",
      executablePath,
      sha256: await sha256(executablePath),
      identity: { size: 19 },
    });
    if (!resolved.ok) throw new Error(resolved.diagnostic);
    expect(resolved.source).toBe("environment");
    expect(settingReads).toBe(0);
  });

  it("reports the typed setting as the winning configuration source", async () => {
    const resolved = await resolveVideo2xExecutable({
      env: {},
      settings: settingsWith(executablePath),
      platform: HOST_PLATFORM,
    });
    expect(resolved).toMatchObject({ ok: true, source: "setting" });
  });

  it("fails an invalid winning environment value without falling back", async () => {
    let settingReads = 0;
    const resolved = await resolveVideo2xExecutable({
      env: { NEXUS_VIDEO2X_PATH: "relative-video2x" },
      settings: settingsWith(executablePath, () => {
        settingReads += 1;
      }),
      platform: HOST_PLATFORM,
    });
    expect(resolved).toMatchObject({ ok: false, reason: "invalid_path" });
    expect(settingReads).toBe(0);
  });

  it("does not use PATH as executable discovery", async () => {
    const resolved = await resolveVideo2xExecutable({
      env: { PATH: executablePath },
      settings: settingsWith(undefined),
      platform: HOST_PLATFORM,
    });
    expect(resolved).toMatchObject({
      ok: false,
      reason: "missing_configuration",
    });
  });

  it("runs exact version, help, and list-device probes in separate private roots", async () => {
    const runner = new FakeVideoProcess();
    const capability = await createAdapter(runner).probe();
    expect(capability).toMatchObject({
      status: "ready",
      reason: null,
      backend: {
        id: "video2x",
        compatibilityId: "video2x-cli-6.4.0",
        version: "6.4.0",
        executableSha256: await sha256(executablePath),
        provenance: "user-supplied-unverified",
        configurationSource: "environment",
      },
      platform: { architecture: "x64", avx2: "available" },
    });
    expect(capability.devices.find((device) => device.selected)?.id).toBe(2);
    expect(
      Object.values(capability.presets).every(
        (preset) => preset.state === "unverified",
      ),
    ).toBe(true);
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["--version"],
      ["--help"],
      ["--list-devices"],
    ]);
    expect(new Set(runner.calls.map((call) => call.cwd)).size).toBe(3);
    expect(
      runner.calls.every((call) => call.executable === executablePath),
    ).toBe(true);
    expect(runner.calls.every((call) => call.graceInput === "q")).toBe(true);
  });

  it("probes in contract order after resolving explicit configuration", async () => {
    const order: string[] = [];
    const runner = new FakeVideoProcess((request) => {
      order.push(String(request.args[0]));
      return undefined;
    });
    runner.probeAvx2 = async () => {
      order.push("avx2");
      return { status: "supported" };
    };
    const capability = await createAdapter(runner, {
      env: {},
      settings: settingsWith(executablePath, () => order.push("setting")),
      hashFile: async (target, signal) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        order.push("hash");
        return sha256(target);
      },
    }).probe();
    expect(capability).toMatchObject({
      status: "ready",
      backend: { configurationSource: "setting" },
    });
    expect(order).toEqual([
      "setting",
      "hash",
      "hash",
      "--version",
      "hash",
      "--help",
      "avx2",
      "hash",
      "--list-devices",
      "hash",
    ]);
  });

  it("does not run the AVX2 probe when explicit configuration is invalid", async () => {
    const runner = new FakeVideoProcess();
    const capability = await createAdapter(runner, {
      env: { NEXUS_VIDEO2X_PATH: "relative-video2x" },
    }).probe();
    expect(capability).toMatchObject({
      status: "unavailable",
      reason: "invalid_path",
      backend: { configurationSource: "environment" },
    });
    expect(runner.avx2Calls).toBe(0);
    expect(runner.calls).toHaveLength(0);
  });

  it("preserves a process-host AVX2 failure classification", async () => {
    const capability = await createAdapter(
      new FakeVideoProcess(undefined, {
        status: "unavailable",
        reason: "process_host_unavailable",
      }),
    ).probe();
    expect(capability).toMatchObject({
      status: "unavailable",
      reason: "process_host_unavailable",
      backend: { configurationSource: "environment" },
    });
  });

  it.each([
    ["darwin", "x64", "unsupported_platform"],
    [HOST_PLATFORM, "arm64", "unsupported_architecture"],
  ] as const)(
    "rejects unsupported %s/%s before launching",
    async (platform, architecture, reason) => {
      const runner = new FakeVideoProcess();
      const capability = await createAdapter(runner, {
        platform,
        architecture,
      }).probe();
      expect(capability).toMatchObject({ status: "unsupported", reason });
      expect(runner.avx2Calls).toBe(0);
      expect(runner.calls).toHaveLength(0);
    },
  );

  it.each([
    [{ status: "unsupported" }, "missing_avx2", "unsupported"],
    [{ status: "unavailable" }, "cpu_probe_failed", "unavailable"],
  ] as const)(
    "fails closed for AVX2 result %o",
    async (avx2, reason, status) => {
      const runner = new FakeVideoProcess(undefined, avx2);
      const capability = await createAdapter(runner).probe();
      expect(capability).toMatchObject({ status, reason });
      expect(runner.calls.map((call) => call.args)).toEqual([
        ["--version"],
        ["--help"],
      ]);
    },
  );

  it.each([
    [
      "version mismatch",
      (request: GuardedProcessRequest) =>
        request.args[0] === "--version"
          ? result({ stdout: "Video2X version 6.4.1\n" })
          : undefined,
      "incompatible_version",
    ],
    [
      "grammar mismatch",
      (request: GuardedProcessRequest) =>
        request.args[0] === "--help"
          ? result({
              stdout: PINNED_HELP.replace("\n--device\n", "\n--device-mode\n"),
            })
          : undefined,
      "incompatible_grammar",
    ],
    [
      "CPU-only devices",
      (request: GuardedProcessRequest) =>
        request.args[0] === "--list-devices"
          ? result({ stdout: "0. CPU\nType: CPU" })
          : undefined,
      "no_vulkan_device",
    ],
    [
      "probe timeout",
      (request: GuardedProcessRequest) =>
        request.args[0] === "--version"
          ? result({ exitCode: null, timedOut: true })
          : undefined,
      "probe_timeout",
    ],
  ] as const)("classifies %s", async (_name, hook, reason) => {
    const capability = await createAdapter(new FakeVideoProcess(hook)).probe();
    expect(capability).toMatchObject({ status: "unavailable", reason });
  });

  it("fails rather than parsing lossy structured probe output", async () => {
    const runner = new FakeVideoProcess((request) =>
      request.args[0] === "--help"
        ? result({ stdout: `${"x".repeat(300_000)}\n${PINNED_HELP}` })
        : undefined,
    );
    const capability = await createAdapter(runner).probe();
    expect(capability).toMatchObject({
      status: "unavailable",
      reason: "probe_failed",
    });
    expect(capability.diagnostic).toMatch(/exceeded the compatibility limit/i);
  });

  it("fails when the executable changes after it was hashed", async () => {
    const runner = new FakeVideoProcess(async (request) => {
      if (request.args[0] !== "--list-devices") return undefined;
      await fs.writeFile(executablePath, "swapped-video2x-binary");
      return result({ stdout: DEVICES });
    });
    const capability = await createAdapter(runner).probe();
    expect(capability).toMatchObject({
      status: "unavailable",
      reason: "probe_failed",
    });
  });

  it("reports probe cleanup failure instead of claiming readiness", async () => {
    const baseFilesystem = realFilesystem();
    const filesystem: Video2xFileSystem = {
      ...baseFilesystem,
      async rm(target, options) {
        if (target.includes("video2x-probe-"))
          throw new Error("sharing violation");
        return baseFilesystem.rm(target, options);
      },
    };
    const capability = await createAdapter(new FakeVideoProcess(), {
      filesystem,
    }).probe();
    expect(capability).toMatchObject({
      status: "unavailable",
      reason: "probe_failed",
    });
    expect(capability.diagnostic).toMatch(/quarantined/i);
  });

  it.skipIf(HOST_PLATFORM === "win32")(
    "rejects a permissive pre-existing staging root",
    async () => {
      await fs.mkdir(stagingRoot, { recursive: true, mode: 0o755 });
      await fs.chmod(stagingRoot, 0o755);
      const runner = new FakeVideoProcess();
      const capability = await createAdapter(runner).probe();
      expect(capability).toMatchObject({
        status: "unavailable",
        reason: "probe_failed",
      });
      expect(runner.calls).toHaveLength(0);
    },
  );
});

describe("Video2X interrupted-artifact recovery", () => {
  it("removes only the authorized stale root and permits the same child ID after restart", async () => {
    const childJobId = "interrupted-child-restart";
    const jobRoot = path.join(stagingRoot, video2xJobRootLeaf(childJobId));
    const unrelatedRoot = path.join(stagingRoot, "unrelated-job-root");
    await fs.mkdir(path.join(jobRoot, "work-1"), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(path.join(jobRoot, "stage-1.partial.mp4"), "partial");
    await fs.mkdir(unrelatedRoot, { recursive: true, mode: 0o700 });
    const unrelatedMarker = path.join(unrelatedRoot, "preserve.txt");
    await fs.writeFile(unrelatedMarker, "unrelated");

    const restarted = createAdapter(new FakeVideoProcess());
    await expect(
      restarted.recoverInterruptedArtifacts([
        childJobId,
        childJobId,
        "interrupted-child-without-artifacts",
      ]),
    ).resolves.toEqual([
      {
        childJobId,
        disposition: "removed",
        reason: "removed",
      },
      {
        childJobId: "interrupted-child-without-artifacts",
        disposition: "absent",
        reason: "not_found",
      },
    ]);
    await expect(fs.access(jobRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(unrelatedMarker, "utf8")).resolves.toBe(
      "unrelated",
    );

    const runResult = await restarted.run(await requestFor(), {
      childJobId,
      signal: new AbortController().signal,
    });
    expect(runResult.ok).toBe(true);
  });

  it("preserves a symlinked deterministic root and its external target", async () => {
    const childJobId = "interrupted-child-symlink";
    const jobRoot = path.join(stagingRoot, video2xJobRootLeaf(childJobId));
    const externalRoot = path.join(sandbox, "external-owned-root");
    await fs.mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    await fs.mkdir(externalRoot, { recursive: true, mode: 0o700 });
    const externalMarker = path.join(externalRoot, "preserve.txt");
    await fs.writeFile(externalMarker, "external");
    await fs.symlink(
      externalRoot,
      jobRoot,
      HOST_PLATFORM === "win32" ? "junction" : "dir",
    );

    await expect(
      createAdapter(new FakeVideoProcess()).recoverInterruptedArtifacts([
        childJobId,
      ]),
    ).resolves.toEqual([
      {
        childJobId,
        disposition: "preserved",
        reason: "untrusted_job_root",
      },
    ]);
    expect((await fs.lstat(jobRoot)).isSymbolicLink()).toBe(true);
    await expect(fs.readFile(externalMarker, "utf8")).resolves.toBe("external");
  });

  it("preserves a deterministic root whose identity changes before removal", async () => {
    const childJobId = "interrupted-child-replaced";
    const jobRoot = path.join(stagingRoot, video2xJobRootLeaf(childJobId));
    await fs.mkdir(jobRoot, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(jobRoot, "partial.mp4"), "partial");
    const baseFilesystem = realFilesystem();
    const removed: string[] = [];
    let childObservations = 0;
    const filesystem: Video2xFileSystem = {
      ...baseFilesystem,
      async lstat(target) {
        const stat = await baseFilesystem.lstat(target);
        if (path.resolve(target) !== path.resolve(jobRoot)) return stat;
        childObservations += 1;
        if (childObservations === 1) return stat;
        return {
          ...statView(stat, false),
          dev: stat.dev === 1 ? 2 : 1,
          ino: stat.ino === 1 ? 2 : 1,
        };
      },
      async rm(target, options) {
        removed.push(target);
        return baseFilesystem.rm(target, options);
      },
    };

    await expect(
      createAdapter(new FakeVideoProcess(), {
        filesystem,
      }).recoverInterruptedArtifacts([childJobId]),
    ).resolves.toEqual([
      {
        childJobId,
        disposition: "preserved",
        reason: "cleanup_failed",
      },
    ]);
    expect(removed).not.toContain(jobRoot);
    await expect(
      fs.readFile(path.join(jobRoot, "partial.mp4"), "utf8"),
    ).resolves.toBe("partial");
  });
});

describe("Video2X staged execution", () => {
  it("uses exact shell-free argv, a private cwd, scrubbed env, and preserves the source", async () => {
    const runner = new FakeVideoProcess();
    const adapter = createAdapter(runner);
    const request = await requestFor("upscale", "animation-upscale-2x");
    const original = await fs.readFile(sourcePath, "utf8");
    const events: unknown[] = [];
    const controller = new AbortController();
    const runResult = await adapter.run(request, {
      childJobId: "enhance-child-1",
      signal: controller.signal,
      onProgress: (event) => events.push(event),
    });
    expect(runResult.ok).toBe(true);
    if (!runResult.ok) throw new Error(runResult.error.message);
    expect(runResult.outcome).toBe("staged");
    expect(runResult.stagedPath).toContain(stagingRoot);
    expect(path.dirname(runResult.stagedPath)).toBe(
      path.join(stagingRoot, video2xJobRootLeaf("enhance-child-1")),
    );
    expect(await fs.readFile(runResult.stagedPath, "utf8")).toBe(
      "enhanced-video-bytes",
    );
    expect(await fs.readFile(sourcePath, "utf8")).toBe(original);
    expect(runResult.backend.executableSha256).toBe(
      await sha256(executablePath),
    );
    expect(runResult.stages[0]?.parameters).toEqual({
      stage: "upscale",
      presetId: "animation-upscale-2x",
      contentClass: "animation",
      scaleFactor: 2,
    });
    expect(runResult.stages[0]?.backend).toEqual({
      processor: "realesrgan",
      model: "realesr-animevideov3",
      normalizedArguments: { scalingFactor: 2 },
    });
    expect(runResult.execution).toEqual({
      platform: {
        os: HOST_PLATFORM,
        architecture: "x64",
        avx2: "available",
      },
      selectedDevice: {
        id: 2,
        type: "discrete_gpu",
        name: "Discrete Adapter A",
      },
    });
    expect(runResult.backend.configurationSource).toBe("environment");

    const enhancement = runner.calls.find((call) => call.args[0] === "-i");
    expect(enhancement).toBeDefined();
    if (!enhancement) throw new Error("missing enhancement call");
    expect(enhancement.args).toEqual([
      "-i",
      sourcePath,
      "-o",
      runResult.stagedPath,
      "-p",
      "realesrgan",
      "-s",
      "2",
      "--realesrgan-model",
      "realesr-animevideov3",
      "--device",
      "2",
    ]);
    expect(enhancement.cwd).not.toBe(path.dirname(sourcePath));
    expect(enhancement.cwd).not.toBe(path.dirname(runResult.stagedPath));
    expect(enhancement.cwd.startsWith(stagingRoot)).toBe(true);
    expect(enhancement).not.toHaveProperty("shell");
    expect(enhancement.env.LD_PRELOAD).toBeUndefined();
    expect(enhancement.env.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(enhancement.env.VK_LAYER_PATH).toBeUndefined();
    expect(enhancement.env.NEXUS_VIDEO2X_PATH).toBeUndefined();
    expect(enhancement.env.SECRET_TOKEN).toBeUndefined();
    expect(new Set(runner.calls.map((call) => call.signal)).size).toBe(1);
    expect(runner.calls[0]?.signal).not.toBe(controller.signal);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stage: "upscale",
      stageIndex: 1,
      stageCount: 1,
      percent: 50,
    });
    expect(
      runner.cwdEntriesAtLaunch.every((entries) => entries.length === 0),
    ).toBe(true);
    expect(await fs.readdir(path.dirname(runResult.stagedPath))).toEqual([
      path.basename(runResult.stagedPath),
    ]);
  });

  it("runs combined mode as two stages and removes only the intermediate", async () => {
    const runner = new FakeVideoProcess();
    const runResult = await createAdapter(runner).run(
      await requestFor("upscale_interpolate", "general-upscale-4x"),
      { childJobId: "combined-child", signal: new AbortController().signal },
    );
    expect(runResult.ok).toBe(true);
    if (!runResult.ok) throw new Error(runResult.error.message);
    const calls = runner.calls.filter((call) => call.args[0] === "-i");
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((call) => call.cwd)).size).toBe(2);
    expect(
      calls.every((call) => call.cwd !== path.dirname(runResult.stagedPath)),
    ).toBe(true);
    expect(calls[0]?.args.slice(4)).toEqual([
      "-p",
      "realesrgan",
      "-s",
      "4",
      "--realesrgan-model",
      "realesrgan-plus",
      "--device",
      "2",
    ]);
    expect(calls[1]?.args.slice(4)).toEqual([
      "-p",
      "rife",
      "-m",
      "2",
      "--rife-model",
      "rife-v4.6",
      "--device",
      "2",
    ]);
    const intermediate = argumentValue(calls[0]?.args ?? [], "-o");
    expect(argumentValue(calls[1]?.args ?? [], "-i")).toBe(intermediate);
    await expect(fs.access(intermediate)).rejects.toThrow();
    await expect(fs.access(runResult.stagedPath)).resolves.toBeUndefined();
    expect(runResult.stages.map((stage) => stage.parameters.stage)).toEqual([
      "upscale",
      "interpolate",
    ]);
  });

  it("splits CR/LF progress, strips ANSI, and bounds retained progress", async () => {
    const runner = new FakeVideoProcess(async (request) => {
      if (request.args[0] !== "-i") return undefined;
      const output = argumentValue(request.args, "-o");
      await fs.writeFile(output, "output");
      const stdout = [
        "\u001b[33mframe=1/4 (25%); fps=4; elapsed=00:00:01; remaining=00:00:03\u001b[0m\r",
        "frame=2/4 (50%); fps=5; elapsed=00:00:02; remaining=00:00:02\n",
        "frame=nan/4 (75%); fps=nan; elapsed=bad; remaining=bad\r",
      ].join("");
      request.onStdout?.(stdout);
      return result({ stdout });
    });
    const events: Array<{ message: string; percent?: number }> = [];
    const runResult = await createAdapter(runner).run(await requestFor(), {
      childJobId: "progress-child",
      signal: new AbortController().signal,
      onProgress: (event) => events.push(event),
    });
    expect(runResult.ok).toBe(true);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ percent: 25 });
    expect(events[1]).toMatchObject({ percent: 50 });
    expect(events[2]).not.toHaveProperty("percent");
    expect(events.every((event) => !event.message.includes("\u001b"))).toBe(
      true,
    );
  });

  it("makes pre-abort authoritative without probing or creating output", async () => {
    const runner = new FakeVideoProcess();
    const controller = new AbortController();
    controller.abort();
    const runResult = await createAdapter(runner).run(await requestFor(), {
      childJobId: "cancelled-before-start",
      signal: controller.signal,
    });
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    expect(runner.calls).toHaveLength(0);
  });

  it("treats cancellation as authoritative even after child exit zero and cleans partials", async () => {
    const controller = new AbortController();
    const runner = new FakeVideoProcess(async (request) => {
      if (request.args[0] !== "-i") return undefined;
      await fs.writeFile(argumentValue(request.args, "-o"), "partial");
      controller.abort();
      return result({ exitCode: 0, cancelled: false });
    });
    const runResult = await createAdapter(runner).run(await requestFor(), {
      childJobId: "cancel-race",
      signal: controller.signal,
    });
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    const enhancement = runner.calls.find((call) => call.args[0] === "-i");
    expect(enhancement?.graceInput).toBe("q");
    expect(await fs.readdir(stagingRoot)).toEqual([]);
  });

  it("classifies timeout and removes the exact partial job root", async () => {
    const runner = new FakeVideoProcess(async (request) => {
      if (request.args[0] !== "-i") return undefined;
      await fs.writeFile(argumentValue(request.args, "-o"), "partial");
      return result({ exitCode: null, timedOut: true });
    });
    const runResult = await createAdapter(runner).run(await requestFor(), {
      childJobId: "timeout-child",
      signal: new AbortController().signal,
    });
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "process_timeout", terminationConfirmed: true },
    });
    expect(await fs.readdir(stagingRoot)).toEqual([]);
    await expect(fs.readFile(sourcePath, "utf8")).resolves.toBe(
      "source-video-bytes",
    );
  });

  it.each([
    [
      "cancelled",
      result({
        exitCode: null,
        cancelled: true,
        terminationConfirmed: false,
      }),
    ],
    [
      "process_timeout",
      result({
        exitCode: null,
        timedOut: true,
        terminationConfirmed: false,
      }),
    ],
  ] as const)(
    "quarantines rather than cleans when %s termination is unconfirmed",
    async (code, processResult) => {
      const childJobId = `unconfirmed-${code}`;
      const jobRoot = path.join(stagingRoot, video2xJobRootLeaf(childJobId));
      const runner = new FakeVideoProcess(async (request) => {
        if (request.args[0] !== "-i") return undefined;
        await fs.writeFile(argumentValue(request.args, "-o"), "partial");
        return processResult;
      });
      const runResult = await createAdapter(runner).run(await requestFor(), {
        childJobId,
        signal: new AbortController().signal,
      });
      expect(runResult).toMatchObject({
        ok: false,
        error: { code, terminationConfirmed: false },
      });
      if (runResult.ok) throw new Error("expected failure");
      expect(runResult.error.diagnostics).toMatch(/quarantined/i);
      expect(runResult.error.diagnostics).not.toContain(jobRoot);
      expect(runResult.error.diagnostics).not.toContain(stagingRoot);
      await expect(fs.access(jobRoot)).resolves.toBeUndefined();
    },
  );

  it("quarantines a probe root when probe termination is unconfirmed", async () => {
    const runner = new FakeVideoProcess((request) =>
      request.args[0] === "--version"
        ? result({ exitCode: 0, terminationConfirmed: false })
        : undefined,
    );
    const capability = await createAdapter(runner).probe();
    expect(capability).toMatchObject({
      status: "unavailable",
      reason: "probe_failed",
    });
    expect(capability.diagnostic).toMatch(/quarantined/i);
    expect(capability.diagnostic).not.toContain(stagingRoot);
    await expect(
      fs.access(path.join(stagingRoot, "video2x-probe-fixture-1")),
    ).resolves.toBeUndefined();
  });

  it.each([
    [
      "nonzero exit",
      result({ exitCode: 9, stderr: "encoder failed" }),
      "process_failed",
    ],
    [
      "missing model",
      result({ exitCode: 2, stderr: "RealESRGAN model file not found" }),
      "model_unavailable",
    ],
    ["empty output", result({ exitCode: 0 }), "output_invalid"],
  ] as const)(
    "classifies %s without exposing a staged result",
    async (_name, processResult, code) => {
      const runner = new FakeVideoProcess((request) =>
        request.args[0] === "-i" ? processResult : undefined,
      );
      const runResult = await createAdapter(runner).run(await requestFor(), {
        childJobId: `failure-${code}`,
        signal: new AbortController().signal,
      });
      expect(runResult).toMatchObject({
        ok: false,
        error: { code, terminationConfirmed: true },
      });
      expect(await fs.readdir(stagingRoot)).toEqual([]);
    },
  );

  it("maps enhancement spawn errors to process_failed", async () => {
    const runner = new FakeVideoProcess((request) => {
      if (request.args[0] === "-i") throw new Error("spawn failed");
      return undefined;
    });
    const runResult = await createAdapter(runner).run(await requestFor(), {
      childJobId: "spawn-error",
      signal: new AbortController().signal,
    });
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "process_failed", terminationConfirmed: false },
    });
  });

  it("rejects a symlink-shaped staged output through the injected filesystem seam", async () => {
    const baseFilesystem = realFilesystem();
    const filesystem: Video2xFileSystem = {
      ...baseFilesystem,
      async lstat(target) {
        const stat = await baseFilesystem.lstat(target);
        return target.endsWith(".partial.mp4") ? statView(stat, true) : stat;
      },
    };
    const runResult = await createAdapter(new FakeVideoProcess(), {
      filesystem,
    }).run(await requestFor(), {
      childJobId: "symlink-output",
      signal: new AbortController().signal,
    });
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "output_invalid" },
    });
    expect(await fs.readdir(stagingRoot)).toEqual([]);
  });

  it("rejects a hard-link output alias to the immutable source", async () => {
    const runner = new FakeVideoProcess(async (request) => {
      if (request.args[0] !== "-i") return undefined;
      await fs.link(sourcePath, argumentValue(request.args, "-o"));
      return result();
    });
    const runResult = await createAdapter(runner).run(await requestFor(), {
      childJobId: "hardlink-output",
      signal: new AbortController().signal,
    });
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "output_invalid" },
    });
    expect(await fs.readFile(sourcePath, "utf8")).toBe("source-video-bytes");
    expect(await fs.readdir(stagingRoot)).toEqual([]);
  });

  it("rejects a symlinked configured staging root before process launch", async () => {
    const baseFilesystem = realFilesystem();
    const filesystem: Video2xFileSystem = {
      ...baseFilesystem,
      async lstat(target) {
        const stat = await baseFilesystem.lstat(target);
        return target === stagingRoot ? statView(stat, true) : stat;
      },
    };
    const runner = new FakeVideoProcess();
    const capability = await createAdapter(runner, { filesystem }).probe();
    expect(capability).toMatchObject({
      status: "unavailable",
      reason: "probe_failed",
    });
    expect(runner.calls).toHaveLength(0);
    expect(await fs.readdir(stagingRoot)).toEqual([]);
  });

  it("cleans a newly created root when post-create containment validation fails", async () => {
    const baseFilesystem = realFilesystem();
    const filesystem: Video2xFileSystem = {
      ...baseFilesystem,
      async realpath(target) {
        if (target.includes("video2x-probe-")) {
          return path.join(sandbox, "escaped-probe-root");
        }
        return baseFilesystem.realpath(target);
      },
    };
    const runner = new FakeVideoProcess();
    const capability = await createAdapter(runner, { filesystem }).probe();
    expect(capability).toMatchObject({
      status: "unavailable",
      reason: "probe_failed",
    });
    expect(runner.calls).toHaveLength(0);
    expect(await fs.readdir(stagingRoot)).toEqual([]);
  });

  it("fails closed on a deterministic job-root collision without deleting it", async () => {
    const childJobId = "persisted-child-collision";
    const jobRoot = path.join(stagingRoot, video2xJobRootLeaf(childJobId));
    await fs.mkdir(jobRoot, { recursive: true, mode: 0o700 });
    const marker = path.join(jobRoot, "owned-by-another-run.txt");
    await fs.writeFile(marker, "preserve-me");
    const runner = new FakeVideoProcess();
    const runResult = await createAdapter(runner).run(await requestFor(), {
      childJobId,
      signal: new AbortController().signal,
    });
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "output_conflict" },
    });
    await expect(fs.readFile(marker, "utf8")).resolves.toBe("preserve-me");
    expect(runner.calls.filter((call) => call.args[0] === "-i")).toHaveLength(
      0,
    );
  });

  it("quarantines a failed job when the owned root identity changes", async () => {
    const childJobId = "identity-swapped-root";
    const jobRoot = path.join(stagingRoot, video2xJobRootLeaf(childJobId));
    const baseFilesystem = realFilesystem();
    const removed: string[] = [];
    let identityChanged = false;
    const filesystem: Video2xFileSystem = {
      ...baseFilesystem,
      async lstat(target) {
        const stat = await baseFilesystem.lstat(target);
        if (
          identityChanged &&
          target.includes(video2xJobRootLeaf(childJobId))
        ) {
          return {
            ...statView(stat, false),
            dev: stat.dev === 1 ? 2 : 1,
            ino: stat.ino === 1 ? 2 : 1,
          };
        }
        return stat;
      },
      async stat(target) {
        const stat = await baseFilesystem.stat(target);
        if (
          identityChanged &&
          target.includes(video2xJobRootLeaf(childJobId))
        ) {
          return {
            ...statView(stat, false),
            dev: stat.dev === 1 ? 2 : 1,
            ino: stat.ino === 1 ? 2 : 1,
          };
        }
        return stat;
      },
      async rm(target, options) {
        removed.push(target);
        return baseFilesystem.rm(target, options);
      },
    };
    const runner = new FakeVideoProcess((request) => {
      if (request.args[0] !== "-i") return undefined;
      identityChanged = true;
      return result({ exitCode: 9, stderr: "failed" });
    });
    const runResult = await createAdapter(runner, { filesystem }).run(
      await requestFor(),
      { childJobId, signal: new AbortController().signal },
    );
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "process_failed" },
    });
    if (runResult.ok) throw new Error("expected failure");
    expect(runResult.error.diagnostics).toMatch(/quarantined/i);
    expect(runResult.error.diagnostics).not.toContain(jobRoot);
    expect(removed).not.toContain(jobRoot);
    await expect(fs.access(jobRoot)).resolves.toBeUndefined();
  });

  it("never deletes child paths after the staging parent identity changes", async () => {
    const childJobId = "identity-swapped-parent";
    const jobRoot = path.join(stagingRoot, video2xJobRootLeaf(childJobId));
    const baseFilesystem = realFilesystem();
    const removed: string[] = [];
    let parentChanged = false;
    const filesystem: Video2xFileSystem = {
      ...baseFilesystem,
      async lstat(target) {
        const stat = await baseFilesystem.lstat(target);
        if (
          parentChanged &&
          target.includes("private staging") &&
          !target.includes(video2xJobRootLeaf(childJobId))
        ) {
          return {
            ...statView(stat, false),
            dev: stat.dev === 1 ? 2 : 1,
            ino: stat.ino === 1 ? 2 : 1,
          };
        }
        return stat;
      },
      async rm(target, options) {
        removed.push(target);
        return baseFilesystem.rm(target, options);
      },
    };
    const runner = new FakeVideoProcess((request) => {
      if (request.args[0] !== "-i") return undefined;
      parentChanged = true;
      return result({ exitCode: 9, stderr: "failed" });
    });
    const runResult = await createAdapter(runner, { filesystem }).run(
      await requestFor(),
      { childJobId, signal: new AbortController().signal },
    );
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "process_failed" },
    });
    if (runResult.ok) throw new Error("expected failure");
    expect(runResult.error.diagnostics).toMatch(/quarantined/i);
    expect(removed.some((target) => target.startsWith(jobRoot))).toBe(false);
    await expect(fs.access(jobRoot)).resolves.toBeUndefined();
  });

  it("rejects an existing destination before enhancement launch", async () => {
    const baseFilesystem = realFilesystem();
    const fakeOutputStat: Video2xFileStat = {
      size: 1,
      mode: 0o600,
      dev: 1,
      ino: 1,
      uid: typeof process.getuid === "function" ? process.getuid() : 0,
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    };
    const filesystem: Video2xFileSystem = {
      ...baseFilesystem,
      async lstat(target) {
        if (target.endsWith(".partial.mp4")) return fakeOutputStat;
        return baseFilesystem.lstat(target);
      },
    };
    const runner = new FakeVideoProcess();
    const runResult = await createAdapter(runner, { filesystem }).run(
      await requestFor(),
      {
        childJobId: "existing-output",
        signal: new AbortController().signal,
      },
    );
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "output_conflict" },
    });
    expect(runner.calls.filter((call) => call.args[0] === "-i")).toHaveLength(
      0,
    );
  });

  it("rehashes the source and rejects a mutation before returning success", async () => {
    const runner = new FakeVideoProcess(async (request) => {
      if (request.args[0] !== "-i") return undefined;
      await fs.writeFile(argumentValue(request.args, "-o"), "output");
      await fs.writeFile(sourcePath, "mutated-source-video");
      return result();
    });
    const runResult = await createAdapter(runner).run(await requestFor(), {
      childJobId: "source-change",
      signal: new AbortController().signal,
    });
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "source_changed" },
    });
    expect(await fs.readdir(stagingRoot)).toEqual([]);
  });

  it("bounds and redacts process diagnostics, paths, and secret environment values", async () => {
    const secret = "secret-value-that-must-not-leak";
    const home = path.join(sandbox, "private-home");
    const workspace = path.join(sandbox, "private-workspace");
    const runner = new FakeVideoProcess((request) => {
      if (request.args[0] !== "-i") return undefined;
      const raw = `${"x".repeat(5_000)}|${sourcePath}|${executablePath}|${stagingRoot}|${home}|${workspace}|${secret}`;
      return result({ exitCode: 3, stderr: raw });
    });
    const runResult = await createAdapter(runner, {
      diagnosticLimit: 512,
      homeDirectory: home,
      workspaceRoot: workspace,
    }).run(await requestFor(), {
      childJobId: "diagnostic-redaction",
      signal: new AbortController().signal,
    });
    expect(runResult.ok).toBe(false);
    if (runResult.ok) throw new Error("expected failure");
    const diagnostic = runResult.error.diagnostics ?? "";
    expect(diagnostic.length).toBeLessThanOrEqual(512);
    for (const value of [
      sourcePath,
      executablePath,
      stagingRoot,
      home,
      workspace,
      secret,
    ]) {
      expect(diagnostic).not.toContain(value);
    }
    expect(diagnostic).toContain("[redacted]");
  });

  it("redacts a secret split across chunks before bounded retention", async () => {
    const secret = `secret-${"z".repeat(1_000)}-tail`;
    const runner = new FakeVideoProcess((request) => {
      if (request.args[0] !== "-i") return undefined;
      request.onStderr?.(`prefix-${secret.slice(0, 600)}`);
      request.onStderr?.(`${secret.slice(600)}-suffix`);
      return result({ exitCode: 4 });
    });
    const runResult = await createAdapter(runner, {
      diagnosticLimit: 128,
      env: {
        NEXUS_VIDEO2X_PATH: executablePath,
        SECRET_TOKEN: secret,
      },
    }).run(await requestFor(), {
      childJobId: "split-secret",
      signal: new AbortController().signal,
    });
    expect(runResult.ok).toBe(false);
    if (runResult.ok) throw new Error("expected failure");
    const diagnostic = runResult.error.diagnostics ?? "";
    expect(diagnostic.length).toBeLessThanOrEqual(128);
    expect(diagnostic).toContain("[redacted]");
    expect(diagnostic).not.toContain(secret.slice(-80));
  });

  it("fails closed for a preset already proven unavailable while other presets remain usable", async () => {
    const runner = new FakeVideoProcess((request) => {
      if (
        request.args[0] === "-i" &&
        request.args.includes("realesr-animevideov3")
      ) {
        return result({ exitCode: 2, stderr: "model file not found" });
      }
      return undefined;
    });
    const adapter = createAdapter(runner);
    const first = await adapter.run(await requestFor(), {
      childJobId: "model-first-failure",
      signal: new AbortController().signal,
    });
    expect(first).toMatchObject({
      ok: false,
      error: { code: "model_unavailable" },
    });
    const capability = await adapter.probe();
    expect(capability.status).toBe("ready");
    expect(capability.presets["animation-upscale-2x"].state).toBe(
      "unavailable",
    );
    expect(capability.presets["general-upscale-4x"].state).toBe("unverified");
    const enhancementCount = runner.calls.filter(
      (call) => call.args[0] === "-i",
    ).length;
    const blocked = await adapter.run(await requestFor(), {
      childJobId: "model-blocked",
      signal: new AbortController().signal,
    });
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: "model_unavailable" },
    });
    expect(runner.calls.filter((call) => call.args[0] === "-i")).toHaveLength(
      enhancementCount,
    );
    const alternate = await adapter.run(
      await requestFor("upscale", "general-upscale-4x"),
      { childJobId: "model-alternate", signal: new AbortController().signal },
    );
    expect(alternate.ok).toBe(true);
  });

  it("recovers an unavailable preset only after explicit invalidation", async () => {
    let modelMissing = true;
    const runner = new FakeVideoProcess((request) => {
      if (
        modelMissing &&
        request.args[0] === "-i" &&
        request.args.includes("realesr-animevideov3")
      ) {
        return result({ exitCode: 2, stderr: "model file not found" });
      }
      return undefined;
    });
    const adapter = createAdapter(runner);
    const first = await adapter.run(await requestFor(), {
      childJobId: "invalidate-first",
      signal: new AbortController().signal,
    });
    expect(first).toMatchObject({
      ok: false,
      error: { code: "model_unavailable" },
    });
    modelMissing = false;
    const enhancementCount = runner.calls.filter(
      (call) => call.args[0] === "-i",
    ).length;
    const blocked = await adapter.run(await requestFor(), {
      childJobId: "invalidate-blocked",
      signal: new AbortController().signal,
    });
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: "model_unavailable" },
    });
    expect(runner.calls.filter((call) => call.args[0] === "-i")).toHaveLength(
      enhancementCount,
    );
    adapter.invalidateReadiness("animation-upscale-2x");
    const recovered = await adapter.run(await requestFor(), {
      childJobId: "invalidate-recovered",
      signal: new AbortController().signal,
    });
    expect(recovered.ok).toBe(true);
  });

  it("expires stale model unavailability after the bounded readiness TTL", async () => {
    let clock = 0;
    let modelMissing = true;
    const runner = new FakeVideoProcess((request) => {
      if (
        modelMissing &&
        request.args[0] === "-i" &&
        request.args.includes("realesr-animevideov3")
      ) {
        return result({ exitCode: 2, stderr: "model file not found" });
      }
      return undefined;
    });
    const adapter = createAdapter(runner, {
      monotonicNow: () => clock,
      readinessTtlMs: 100,
    });
    const first = await adapter.run(await requestFor(), {
      childJobId: "ttl-first",
      signal: new AbortController().signal,
    });
    expect(first).toMatchObject({
      ok: false,
      error: { code: "model_unavailable" },
    });
    modelMissing = false;
    const blocked = await adapter.run(await requestFor(), {
      childJobId: "ttl-blocked",
      signal: new AbortController().signal,
    });
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: "model_unavailable" },
    });
    clock = 101;
    const recovered = await adapter.run(await requestFor(), {
      childJobId: "ttl-recovered",
      signal: new AbortController().signal,
    });
    expect(recovered.ok).toBe(true);
  });

  it("lets cancellation win during terminal intermediate cleanup", async () => {
    const controller = new AbortController();
    const baseFilesystem = realFilesystem();
    const filesystem: Video2xFileSystem = {
      ...baseFilesystem,
      async rm(target, options) {
        const removed = await baseFilesystem.rm(target, options);
        if (target.includes("intermediate.partial.mp4")) controller.abort();
        return removed;
      },
    };
    const runResult = await createAdapter(new FakeVideoProcess(), {
      filesystem,
    }).run(await requestFor("upscale_interpolate"), {
      childJobId: "terminal-cancel",
      signal: controller.signal,
    });
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    expect(await fs.readdir(stagingRoot)).toEqual([]);
  });

  it("enforces the overall deadline during terminal source rehash", async () => {
    let clock = 0;
    let sourceHashCalls = 0;
    const hashFile = async (target: string): Promise<string> => {
      if (target === sourcePath) {
        sourceHashCalls += 1;
        if (sourceHashCalls === 2) clock = 60_001;
      }
      return sha256(target);
    };
    const runResult = await createAdapter(new FakeVideoProcess(), {
      hashFile,
      monotonicNow: () => clock,
    }).run(await requestFor(), {
      childJobId: "terminal-deadline",
      signal: new AbortController().signal,
    });
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "process_timeout" },
    });
    expect(await fs.readdir(stagingRoot)).toEqual([]);
  });

  it("uses one internal signal and preserves user cancellation during source hashing", async () => {
    const controller = new AbortController();
    let notifySourceHashStarted: (() => void) | undefined;
    const sourceHashStarted = new Promise<void>((resolve) => {
      notifySourceHashStarted = resolve;
    });
    let hashSignal: AbortSignal | undefined;
    const hashFile = async (
      target: string,
      signal?: AbortSignal,
    ): Promise<string> => {
      if (target !== sourcePath) return sha256(target);
      hashSignal = signal;
      notifySourceHashStarted?.();
      return await new Promise<string>(() => undefined);
    };
    const runner = new FakeVideoProcess();
    const runPromise = createAdapter(runner, { hashFile }).run(
      await requestFor(),
      {
        childJobId: "hash-user-cancel",
        signal: controller.signal,
      },
    );
    await sourceHashStarted;
    controller.abort();
    const runResult = await runPromise;
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    expect(hashSignal).toBeDefined();
    expect(runner.calls.every((call) => call.signal === hashSignal)).toBe(true);
    expect(hashSignal).not.toBe(controller.signal);
  });

  it("bounds a hanging source hash with the run-local deadline", async () => {
    vi.useFakeTimers();
    try {
      let notifySourceHashStarted: (() => void) | undefined;
      const sourceHashStarted = new Promise<void>((resolve) => {
        notifySourceHashStarted = resolve;
      });
      const hashFile = async (target: string): Promise<string> => {
        if (target !== sourcePath) return sha256(target);
        notifySourceHashStarted?.();
        return await new Promise<string>(() => undefined);
      };
      const request = { ...(await requestFor()), timeoutMs: 100 };
      const runPromise = createAdapter(new FakeVideoProcess(), {
        hashFile,
      }).run(request, {
        childJobId: "hash-deadline",
        signal: new AbortController().signal,
      });
      await sourceHashStarted;
      await vi.advanceTimersByTimeAsync(100);
      const runResult = await runPromise;
      expect(runResult).toMatchObject({
        ok: false,
        error: { code: "process_timeout" },
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a hanging probe runner that ignores cancellation", async () => {
    vi.useFakeTimers();
    try {
      let notifyProbeStarted: (() => void) | undefined;
      const probeStarted = new Promise<void>((resolve) => {
        notifyProbeStarted = resolve;
      });
      const runner = new FakeVideoProcess((request) => {
        if (request.args[0] !== "--version") return undefined;
        notifyProbeStarted?.();
        return new Promise<GuardedProcessResult>(() => undefined);
      });
      const probePromise = createAdapter(runner, {
        probeTimeoutMs: 25,
      }).probe();
      await probeStarted;
      await vi.advanceTimersByTimeAsync(100);
      const capability = await probePromise;
      expect(capability).toMatchObject({
        status: "unavailable",
        reason: "probe_timeout",
      });
      expect(capability.diagnostic).toMatch(/quarantined/i);
      expect(capability.diagnostic).not.toContain(stagingRoot);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a hanging filesystem operation with the run-local deadline", async () => {
    let notifySourceReadStarted: (() => void) | undefined;
    const sourceReadStarted = new Promise<void>((resolve) => {
      notifySourceReadStarted = resolve;
    });
    const baseFilesystem = realFilesystem();
    const filesystem: Video2xFileSystem = {
      ...baseFilesystem,
      async lstat(target) {
        if (target === sourcePath) {
          notifySourceReadStarted?.();
          return await new Promise<Video2xFileStat>(() => undefined);
        }
        return baseFilesystem.lstat(target);
      },
    };
    const request = { ...(await requestFor()), timeoutMs: 100 };
    const runPromise = createAdapter(new FakeVideoProcess(), {
      filesystem,
    }).run(request, {
      childJobId: "filesystem-deadline",
      signal: new AbortController().signal,
    });
    await sourceReadStarted;
    const runResult = await runPromise;
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "process_timeout" },
    });
  });

  it("revalidates the final staged identity after terminal awaits", async () => {
    let finalPath = "";
    const runner = new FakeVideoProcess((request) => {
      if (request.args[0] === "-i")
        finalPath = argumentValue(request.args, "-o");
      return undefined;
    });
    const baseFilesystem = realFilesystem();
    const filesystem: Video2xFileSystem = {
      ...baseFilesystem,
      async rm(target, options) {
        const removed = await baseFilesystem.rm(target, options);
        if (target.includes("intermediate.partial.mp4")) {
          await fs.rm(finalPath, { force: true });
          await fs.link(sourcePath, finalPath);
        }
        return removed;
      },
    };
    const runResult = await createAdapter(runner, { filesystem }).run(
      await requestFor("upscale_interpolate"),
      {
        childJobId: "terminal-output-swap",
        signal: new AbortController().signal,
      },
    );
    expect(runResult).toMatchObject({
      ok: false,
      error: { code: "output_invalid" },
    });
    expect(await fs.readFile(sourcePath, "utf8")).toBe("source-video-bytes");
  });

  it("surfaces unresolved private cleanup without leaking a path", async () => {
    const baseFilesystem = realFilesystem();
    const filesystem: Video2xFileSystem = {
      ...baseFilesystem,
      async rm(target, options) {
        if (target.includes("video2x-job-"))
          throw new Error("sharing violation");
        return baseFilesystem.rm(target, options);
      },
    };
    const runner = new FakeVideoProcess((request) =>
      request.args[0] === "-i" ? result({ exitCode: 8 }) : undefined,
    );
    const runResult = await createAdapter(runner, { filesystem }).run(
      await requestFor(),
      {
        childJobId: "cleanup-failure",
        signal: new AbortController().signal,
      },
    );
    expect(runResult.ok).toBe(false);
    if (runResult.ok) throw new Error("expected failure");
    expect(runResult.error.diagnostics).toMatch(/quarantined/i);
    expect(runResult.error.diagnostics).not.toContain(stagingRoot);
  });

  it("isolates concurrent job roots and cancellation state", async () => {
    const secondSource = path.join(sandbox, "second-source.mp4");
    await fs.writeFile(secondSource, "second-source-bytes");
    const canonicalSecond = await fs.realpath(secondSource);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const runner = new FakeVideoProcess(async (request) => {
      if (request.args[0] !== "-i") return undefined;
      if (argumentValue(request.args, "-i") === sourcePath) {
        await fs.writeFile(
          argumentValue(request.args, "-o"),
          "cancelled-partial",
        );
        firstController.abort();
        return result({ exitCode: 0 });
      }
      return undefined;
    });
    const adapter = createAdapter(runner);
    const [first, second] = await Promise.all([
      adapter.run(await requestFor(), {
        childJobId: "concurrent-cancelled",
        signal: firstController.signal,
      }),
      adapter.run(
        await requestFor(
          "upscale",
          "animation-upscale-2x",
          canonicalSecond,
          "223e4567-e89b-42d3-a456-426614174000",
        ),
        { childJobId: "concurrent-success", signal: secondController.signal },
      ),
    ]);
    expect(first).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(second.ok).toBe(true);
    const enhancementCalls = runner.calls.filter(
      (call) => call.args[0] === "-i",
    );
    expect(new Set(enhancementCalls.map((call) => call.cwd)).size).toBe(2);
    expect(secondController.signal.aborted).toBe(false);
  });
});
