import {
  spawn as nodeSpawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
} from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, readdirSync, renameSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";

import {
  createPosixGuardedVideoProcess,
  parseLinuxAvx2,
  scrubVideoProcessEnv,
} from "../sidecar/src/video/GuardedVideoProcess.js";
import {
  buildWindowsCommandLine,
  createWindowsVideoProcessHost,
  parseWindowsBuild,
  quoteWindowsArgument,
  WINDOWS_VIDEO_PROCESS_HOST_CSHARP,
  WINDOWS_VIDEO_PROCESS_HOST_ENCODED_COMMAND,
  WINDOWS_VIDEO_PROCESS_HOST_PS1,
} from "../sidecar/src/video/WindowsVideoProcessHost.js";

import { canonicalMkDtemp } from "./helpers/canonicalTempDir";

const WINDOWS_ONLY = process.platform === "win32" ? it : it.skip;

async function rmTree(target: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function runCaptured(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ readonly exitCode: number | null; readonly stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = nodeSpawn(executable, [...args], {
      windowsHide: true,
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stderr }));
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function authenticatedHelperEnv(
  manifestPath: string,
  manifestJson: string,
  sourcePath: string,
  source: string,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NEXUS_VIDEO_HOST_MANIFEST_PATH: manifestPath,
    NEXUS_VIDEO_HOST_MANIFEST_SHA256: sha256(manifestJson),
    NEXUS_VIDEO_HOST_SOURCE_PATH: sourcePath,
    NEXUS_VIDEO_HOST_SOURCE_SHA256: sha256(source),
    ...overrides,
  };
}

function encodedPowerShellArgs(): readonly string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    WINDOWS_VIDEO_PROCESS_HOST_ENCODED_COMMAND,
  ];
}

function createNeverClosingChild(): {
  readonly child: ChildProcessWithoutNullStreams;
  readonly events: EventEmitter;
  readonly kill: ReturnType<typeof vi.fn>;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
} {
  const events = new EventEmitter();
  const kill = vi.fn(() => true);
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(events, {
    stdin: new PassThrough(),
    stdout,
    stderr,
    kill,
  }) as unknown as ChildProcessWithoutNullStreams;
  return { child, events, kill, stdout, stderr };
}

describe("WindowsVideoProcessHost", () => {
  it("implements CRT argument quoting without a command shell", () => {
    expect(quoteWindowsArgument("")).toBe('""');
    expect(quoteWindowsArgument("plain")).toBe("plain");
    expect(quoteWindowsArgument("two words")).toBe('"two words"');
    expect(quoteWindowsArgument('a"b')).toBe('"a\\"b"');
    expect(quoteWindowsArgument("C:\\two words\\")).toBe('"C:\\two words\\\\"');
    expect(buildWindowsCommandLine("C:\\Program Files\\video2x.exe", [])).toBe(
      '"C:\\Program Files\\video2x.exe"',
    );
    expect(
      buildWindowsCommandLine("C:\\Program Files\\video2x.exe", [
        "a&b",
        "tail\\",
      ]),
    ).toBe('"C:\\Program Files\\video2x.exe" a&b tail\\');
  });

  it("keeps the native host on the suspended argv-safe job-object path", () => {
    expect(WINDOWS_VIDEO_PROCESS_HOST_CSHARP).toContain("CreateProcessW");
    expect(WINDOWS_VIDEO_PROCESS_HOST_CSHARP).toContain("CREATE_SUSPENDED");
    expect(WINDOWS_VIDEO_PROCESS_HOST_CSHARP).toContain(
      "AssignProcessToJobObject",
    );
    expect(WINDOWS_VIDEO_PROCESS_HOST_CSHARP).toContain(
      "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE",
    );
    expect(WINDOWS_VIDEO_PROCESS_HOST_CSHARP).toContain(
      "PROC_THREAD_ATTRIBUTE_HANDLE_LIST",
    );
    expect(WINDOWS_VIDEO_PROCESS_HOST_CSHARP).toContain(
      "IsProcessorFeaturePresent",
    );
    expect(WINDOWS_VIDEO_PROCESS_HOST_CSHARP).toContain(
      "BuildEnvironmentBlock",
    );
    expect(WINDOWS_VIDEO_PROCESS_HOST_CSHARP).toContain("TerminateJobObject");
    expect(WINDOWS_VIDEO_PROCESS_HOST_CSHARP).toContain(
      "HOST_WATCHDOG_EXIT_CODE",
    );
    expect(WINDOWS_VIDEO_PROCESS_HOST_CSHARP).not.toMatch(
      /cmd\.exe|taskkill|tree-kill/i,
    );
    expect(WINDOWS_VIDEO_PROCESS_HOST_PS1).toContain("ConvertFrom-Json");
    expect(WINDOWS_VIDEO_PROCESS_HOST_PS1).toContain(
      "Get-AuthenticatedUtf8File",
    );
    expect(WINDOWS_VIDEO_PROCESS_HOST_PS1).toContain(
      'throw "$Label authentication failed"',
    );
    expect(WINDOWS_VIDEO_PROCESS_HOST_PS1).toContain(
      "Remove-Item -LiteralPath $ManifestPath",
    );
    expect(WINDOWS_VIDEO_PROCESS_HOST_PS1).toContain(
      "Add-Type -TypeDefinition $source -Language CSharp",
    );
    expect(WINDOWS_VIDEO_PROCESS_HOST_PS1).not.toMatch(
      /OutputAssembly|AssemblyPath|Add-Type -Path/,
    );
    expect(
      Buffer.from(
        WINDOWS_VIDEO_PROCESS_HOST_ENCODED_COMMAND,
        "base64",
      ).toString("utf16le"),
    ).toBe(WINDOWS_VIDEO_PROCESS_HOST_PS1);
    expect(WINDOWS_VIDEO_PROCESS_HOST_PS1).toContain("Assert-ExactProperties");
    expect(WINDOWS_VIDEO_PROCESS_HOST_PS1).toContain("must not contain NUL");
    expect(WINDOWS_VIDEO_PROCESS_HOST_PS1).toContain("'environment'");
    expect(WINDOWS_VIDEO_PROCESS_HOST_PS1).toContain("'hostWatchdogMs'");
  });

  it("fails old or malformed Windows build evidence closed", () => {
    expect(parseWindowsBuild("10.0.22631")).toBe(22631);
    expect(parseWindowsBuild("10.0.19041")).toBe(19041);
    expect(parseWindowsBuild("10.0.18363")).toBe(18363);
    expect(parseWindowsBuild("unknown")).toBeNull();
  });

  it("scrubs credentials and loader/Vulkan overrides", () => {
    const clean = scrubVideoProcessEnv({
      PATH: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      API_KEY: "secret",
      SESSION_TOKEN: "secret",
      APPDIR: "shadow",
      LD_PRELOAD: "shadow.so",
      VK_ICD_FILENAMES: "shadow.json",
      BENIGN_ALIAS: "ghp_" + "a".repeat(36),
      NEXUS_VIDEO_HOST_MANIFEST_PATH: "attacker-controlled",
    });
    expect(clean).toEqual({
      PATH: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
    });
  });

  it("requires AVX2 on every Linux processor flag line", async () => {
    expect(parseLinuxAvx2("flags : sse4_2 avx avx2\nflags : avx2 fma")).toEqual(
      {
        status: "supported",
      },
    );
    expect(parseLinuxAvx2("flags : sse4_2 avx\nflags : avx2 fma").status).toBe(
      "unsupported",
    );
    expect(parseLinuxAvx2("processor : 0").status).toBe("unavailable");

    const process = createPosixGuardedVideoProcess({
      platform: "linux",
      readCpuInfo: async () => "flags : avx2",
    });
    await expect(process.probeAvx2?.()).resolves.toEqual({
      status: "supported",
    });
  });

  it("keeps cancellation authoritative when abort and stdin failure race spawn", async () => {
    const controller = new AbortController();
    let spawned: ReturnType<typeof nodeSpawn> | undefined;
    let observedEnv: NodeJS.ProcessEnv | undefined;
    const spawnFn = ((
      command: string,
      args: readonly string[],
      options: SpawnOptions,
    ) => {
      observedEnv = options.env;
      spawned = nodeSpawn(command, [...args], options);
      controller.abort();
      setTimeout(() => {
        spawned?.stdin?.emit(
          "error",
          Object.assign(new Error("closed"), { code: "EPIPE" }),
        );
      }, 0);
      return spawned;
    }) as typeof nodeSpawn;
    const runner = createPosixGuardedVideoProcess({
      platform: "linux",
      spawnFn,
      killProcessGroup: (_pid, signal) => {
        spawned?.kill(signal);
      },
    });

    const result = await runner.run({
      executable: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10000)"],
      cwd: os.tmpdir(),
      env: {
        ...process.env,
        API_KEY: "do-not-forward",
        VK_LAYER_PATH: "shadow",
      },
      timeoutMs: 20_000,
      signal: controller.signal,
      gracefulShutdownMs: 5,
      forceKillMs: 20,
    });

    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(observedEnv?.API_KEY).toBeUndefined();
    expect(observedEnv?.VK_LAYER_PATH).toBeUndefined();
  });

  it("rejects invalid Windows host timeouts before launching a helper", async () => {
    const host = createWindowsVideoProcessHost({
      platform: "win32",
      spawnFn: vi.fn() as unknown as typeof nodeSpawn,
    });
    await expect(
      host.run({
        executable: "C:\\video2x.exe",
        args: [],
        cwd: os.tmpdir(),
        env: {},
        timeoutMs: 0,
      }),
    ).rejects.toThrow("timeoutMs must be between 1 and 86400000");
  });

  it("writes scrubbed bounded manifests in concurrent private control directories", async () => {
    const root = await canonicalMkDtemp("nexus-manifest-test-");
    const firstWork = path.join(root, "first-work");
    const secondWork = path.join(root, "second-work");
    await Promise.all([mkdir(firstWork), mkdir(secondWork)]);
    const hostileLoaderEnvironment = {
      COR_ENABLE_PROFILING: "1",
      COR_PROFILER: "{00000000-0000-0000-0000-000000000001}",
      CORECLR_ENABLE_PROFILING: "1",
      CORECLR_PROFILER_PATH: "C:\\attacker\\profiler.dll",
      COMPlus_ReadyToRun: "0",
      DOTNET_STARTUP_HOOKS: "C:\\attacker\\startup-hook.dll",
      DOTNET_ADDITIONAL_DEPS: "C:\\attacker\\additional.deps.json",
      DOTNET_SHARED_STORE: "C:\\attacker\\shared-store",
      DOTNET_ROOT: "C:\\attacker\\dotnet",
      DOTNET_ROOT_X64: "C:\\attacker\\dotnet-x64",
    } as const;
    const priorLoaderEnvironment = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(hostileLoaderEnvironment)) {
      priorLoaderEnvironment.set(name, process.env[name]);
      process.env[name] = value;
    }
    const manifests: Array<Record<string, unknown>> = [];
    const controlDirectories: string[] = [];
    const controlFiles: string[][] = [];
    const spawnFn = ((
      _command: string,
      args: readonly string[],
      options: SpawnOptions,
    ) => {
      const helperEnv = options.env ?? {};
      const manifestPath = helperEnv.NEXUS_VIDEO_HOST_MANIFEST_PATH;
      const sourcePath = helperEnv.NEXUS_VIDEO_HOST_SOURCE_PATH;
      if (manifestPath === undefined || sourcePath === undefined) {
        throw new Error("missing manifest path");
      }
      const helperEnvironmentNames = new Set(
        Object.keys(helperEnv).map((name) => name.toUpperCase()),
      );
      const permittedHelperEnvironmentNames = new Set([
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "NEXUS_VIDEO_HOST_MANIFEST_PATH",
        "NEXUS_VIDEO_HOST_MANIFEST_SHA256",
        "NEXUS_VIDEO_HOST_SOURCE_PATH",
        "NEXUS_VIDEO_HOST_SOURCE_SHA256",
      ]);
      expect(
        [...helperEnvironmentNames].filter(
          (name) => !permittedHelperEnvironmentNames.has(name),
        ),
      ).toEqual([]);
      for (const hostileName of Object.keys(hostileLoaderEnvironment)) {
        expect(helperEnvironmentNames.has(hostileName.toUpperCase())).toBe(
          false,
        );
      }
      expect(helperEnvironmentNames.has("NEXUS_VIDEO_TEST_VALUE")).toBe(false);
      expect(args).toEqual([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        WINDOWS_VIDEO_PROCESS_HOST_ENCODED_COMMAND,
      ]);
      expect(args.join(" ")).not.toContain("video2x.exe");
      const manifestJson = readFileSync(manifestPath, "utf8");
      const source = readFileSync(sourcePath, "utf8");
      expect(helperEnv.NEXUS_VIDEO_HOST_MANIFEST_SHA256).toBe(
        sha256(manifestJson),
      );
      expect(helperEnv.NEXUS_VIDEO_HOST_SOURCE_SHA256).toBe(sha256(source));
      manifests.push(JSON.parse(manifestJson) as Record<string, unknown>);
      controlDirectories.push(String(options.cwd));
      controlFiles.push(readdirSync(String(options.cwd)).sort());
      return nodeSpawn(process.execPath, ["-e", "process.exit(0)"], options);
    }) as typeof nodeSpawn;

    try {
      const host = createWindowsVideoProcessHost({
        platform: "win32",
        powershellPath: process.execPath,
        scratchRoot: root,
        spawnFn,
      });
      const results = await Promise.all(
        [firstWork, secondWork].map((cwd) =>
          host.run({
            executable: "C:\\Program Files\\Video2X\\video2x.exe",
            args: [],
            cwd,
            env: {
              ...process.env,
              NEXUS_VIDEO_TEST_VALUE: "unicode-\u03c0",
              API_KEY: "do-not-forward",
              VK_ICD_FILENAMES: "shadow.json",
            },
            timeoutMs: 1_000,
          }),
        ),
      );

      expect(results).toEqual([
        expect.objectContaining({ exitCode: 0, terminationConfirmed: true }),
        expect.objectContaining({ exitCode: 0, terminationConfirmed: true }),
      ]);
      expect(manifests).toHaveLength(2);
      for (const manifest of manifests) {
        expect(manifest).toMatchObject({
          schemaVersion: 1,
          mode: "run",
          arguments: [],
          environment: {
            NEXUS_VIDEO_TEST_VALUE: "unicode-\u03c0",
          },
          hostWatchdogMs: 7_250,
        });
        expect(
          (manifest.environment as Record<string, string>).API_KEY,
        ).toBeUndefined();
        expect(
          (manifest.environment as Record<string, string>).VK_ICD_FILENAMES,
        ).toBeUndefined();
        expect(manifest.sourceSha256).toBeUndefined();
      }
      expect(controlFiles).toEqual([
        ["NexusVideoProcessHost.cs", "request.json"],
        ["NexusVideoProcessHost.cs", "request.json"],
      ]);
      expect(new Set(controlDirectories).size).toBe(2);
      expect(
        controlDirectories.every(
          (directory) =>
            directory.startsWith(root) &&
            directory !== firstWork &&
            directory !== secondWork,
        ),
      ).toBe(true);
      expect((await readdir(root)).sort()).toEqual([
        "first-work",
        "second-work",
      ]);
    } finally {
      for (const [name, value] of priorLoaderEnvironment) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps timeout authoritative and removes its private control directory", async () => {
    const root = await canonicalMkDtemp("nexus-timeout-test-");
    const work = path.join(root, "work");
    await mkdir(work);
    const spawnFn = ((
      _command: string,
      _args: readonly string[],
      options: SpawnOptions,
    ) =>
      nodeSpawn(
        process.execPath,
        ["-e", "setTimeout(() => {}, 10000)"],
        options,
      )) as typeof nodeSpawn;

    try {
      const host = createWindowsVideoProcessHost({
        platform: "win32",
        powershellPath: process.execPath,
        scratchRoot: root,
        spawnFn,
      });
      const result = await host.run({
        executable: "C:\\video2x.exe",
        args: [],
        cwd: work,
        env: process.env,
        timeoutMs: 20,
        gracefulShutdownMs: 0,
        forceKillMs: 0,
      });
      expect(result).toMatchObject({
        timedOut: true,
        cancelled: false,
        terminationConfirmed: true,
      });
      expect(await readdir(root)).toEqual(["work"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("settles a timed-out host that ignores kill and never closes", async () => {
    const root = await canonicalMkDtemp("nexus-no-close-test-");
    const work = path.join(root, "work");
    await mkdir(work);
    const fake = createNeverClosingChild();
    const onStdout = vi.fn();
    const onStderr = vi.fn();
    let cleanupCalls = 0;
    try {
      const host = createWindowsVideoProcessHost({
        platform: "win32",
        powershellPath: process.execPath,
        scratchRoot: root,
        spawnFn: (() => {
          queueMicrotask(() => {
            fake.stdout.write("before-out");
            fake.stderr.write("before-err");
          });
          return fake.child;
        }) as unknown as typeof nodeSpawn,
        cleanupHostFn: async (_helperRoot, directory) => {
          cleanupCalls += 1;
          await rm(directory, { recursive: true, force: true });
        },
      });
      const result = await host.run({
        executable: "C:\\video2x.exe",
        args: [],
        cwd: work,
        env: process.env,
        timeoutMs: 1,
        gracefulShutdownMs: 0,
        forceKillMs: 0,
        onStdout,
        onStderr,
      });

      expect(result).toMatchObject({
        exitCode: null,
        stdout: "before-out",
        timedOut: true,
        cancelled: false,
        terminationConfirmed: false,
      });
      expect(result.stderr).toContain("before-err");
      expect(result.stderr).toContain("termination was not acknowledged");
      fake.stdout.write("late-out");
      fake.stderr.write("late-err");
      await Promise.resolve();
      expect(result.stdout).not.toContain("late-out");
      expect(result.stderr).not.toContain("late-err");
      expect(onStdout).toHaveBeenCalledTimes(1);
      expect(onStderr).toHaveBeenCalledTimes(1);
      expect(fake.stdout.isPaused()).toBe(true);
      expect(fake.stderr.isPaused()).toBe(true);
      expect(fake.kill).toHaveBeenCalledTimes(2);
      expect(cleanupCalls).toBe(1);
      expect(await readdir(root)).toEqual(["work"]);

      expect(fake.events.emit("close", 0)).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(cleanupCalls).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retains valid byte-bounded UTF-8 tails across incremental appends", async () => {
    const root = await canonicalMkDtemp("nexus-utf8-tail-test-");
    const work = path.join(root, "work");
    await mkdir(work);
    const fake = createNeverClosingChild();
    const threeByteInput = "€".repeat(21_846);
    const fourByteInput = `${"😀".repeat(16_384)}x`;
    try {
      const host = createWindowsVideoProcessHost({
        platform: "win32",
        powershellPath: process.execPath,
        scratchRoot: root,
        spawnFn: (() => {
          queueMicrotask(() => {
            fake.stdout.write(threeByteInput);
            fake.stdout.write("xy");
            fake.stderr.write(fourByteInput);
            fake.stderr.write("wxyz");
            fake.events.emit("close", 0);
          });
          return fake.child;
        }) as unknown as typeof nodeSpawn,
      });

      const result = await host.run({
        executable: "C:\\video2x.exe",
        args: [],
        cwd: work,
        env: process.env,
        timeoutMs: 1_000,
      });

      expect(result).toMatchObject({
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        terminationConfirmed: true,
      });
      expect(result.stdout).toBe(`${"€".repeat(21_844)}xy`);
      expect(result.stderr).toBe(`${"😀".repeat(16_382)}xwxyz`);
      expect(`${threeByteInput}xy`.endsWith(result.stdout)).toBe(true);
      expect(`${fourByteInput}wxyz`.endsWith(result.stderr)).toBe(true);
      expect(result.stdout).not.toContain("�");
      expect(result.stderr).not.toContain("�");
      expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(
        65_536,
      );
      expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(
        65_536,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lets cancellation win while a no-close timeout is escalating", async () => {
    const root = await canonicalMkDtemp("nexus-race-test-");
    const work = path.join(root, "work");
    await mkdir(work);
    const fake = createNeverClosingChild();
    const controller = new AbortController();
    try {
      const host = createWindowsVideoProcessHost({
        platform: "win32",
        powershellPath: process.execPath,
        scratchRoot: root,
        spawnFn: (() => fake.child) as unknown as typeof nodeSpawn,
      });
      const running = host.run({
        executable: "C:\\video2x.exe",
        args: [],
        cwd: work,
        env: process.env,
        timeoutMs: 1,
        signal: controller.signal,
        gracefulShutdownMs: 0,
        forceKillMs: 0,
      });
      setTimeout(() => controller.abort(), 20);

      const result = await running;
      expect(result).toMatchObject({
        exitCode: null,
        timedOut: false,
        cancelled: true,
        terminationConfirmed: false,
      });
      expect(result.stderr).toContain("termination was not acknowledged");
      expect(fake.kill).toHaveBeenCalledTimes(2);
      expect(await readdir(root)).toEqual(["work"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not let cleanup failure erase authoritative cancellation", async () => {
    const root = await canonicalMkDtemp("nexus-cleanup-test-");
    const work = path.join(root, "work");
    await mkdir(work);
    const controller = new AbortController();
    const spawnFn = ((
      _command: string,
      _args: readonly string[],
      options: SpawnOptions,
    ) => {
      const child = nodeSpawn(
        process.execPath,
        ["-e", "setTimeout(() => {}, 10000)"],
        options,
      );
      controller.abort();
      return child;
    }) as typeof nodeSpawn;

    try {
      const host = createWindowsVideoProcessHost({
        platform: "win32",
        powershellPath: process.execPath,
        scratchRoot: root,
        spawnFn,
        cleanupHostFn: async () => {
          throw new Error("simulated cleanup failure");
        },
      });
      const result = await host.run({
        executable: "C:\\video2x.exe",
        args: [],
        cwd: work,
        env: process.env,
        timeoutMs: 10_000,
        signal: controller.signal,
        gracefulShutdownMs: 0,
        forceKillMs: 0,
      });
      expect(result.cancelled).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(result.terminationConfirmed).toBe(true);
      expect(result.stderr).toContain(
        "cleanup failed after authoritative stop",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes prepared control files when helper spawn fails", async () => {
    const root = await canonicalMkDtemp("nexus-spawn-test-");
    const work = path.join(root, "work");
    await mkdir(work);
    try {
      const host = createWindowsVideoProcessHost({
        platform: "win32",
        powershellPath: process.execPath,
        scratchRoot: root,
        spawnFn: (() => {
          throw new Error("simulated spawn failure");
        }) as typeof nodeSpawn,
      });
      await expect(
        host.run({
          executable: "C:\\video2x.exe",
          args: [],
          cwd: work,
          env: process.env,
          timeoutMs: 1_000,
        }),
      ).rejects.toThrow("simulated spawn failure");
      expect(await readdir(root)).toEqual(["work"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses cleanup after the private control directory identity changes", async () => {
    const root = await canonicalMkDtemp("nexus-identity-test-");
    const work = path.join(root, "work");
    await mkdir(work);
    const spawnFn = ((
      _command: string,
      _args: readonly string[],
      options: SpawnOptions,
    ) => {
      const directory = String(options.cwd);
      renameSync(directory, directory + "-original");
      mkdirSync(directory);
      return nodeSpawn(process.execPath, ["-e", "process.exit(0)"], options);
    }) as typeof nodeSpawn;
    try {
      const host = createWindowsVideoProcessHost({
        platform: "win32",
        powershellPath: process.execPath,
        scratchRoot: root,
        spawnFn,
      });
      await expect(
        host.run({
          executable: "C:\\video2x.exe",
          args: [],
          cwd: work,
          env: process.env,
          timeoutMs: 1_000,
        }),
      ).rejects.toThrow("control directory identity changed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("maps a false Windows AVX2 probe to unavailable evidence", async () => {
    const root = await canonicalMkDtemp("nexus-avx2-test-");
    const spawnFn = ((
      _command: string,
      _args: readonly string[],
      options: SpawnOptions,
    ) =>
      nodeSpawn(
        process.execPath,
        ["-e", "process.stdout.write('{\"avx2\":false}'); process.exit(3)"],
        options,
      )) as typeof nodeSpawn;
    try {
      const host = createWindowsVideoProcessHost({
        platform: "win32",
        windowsRelease: "10.0.22631",
        powershellPath: process.execPath,
        scratchRoot: root,
        spawnFn,
      });
      await expect(host.probeAvx2?.()).resolves.toEqual({
        status: "unavailable",
        reason: "cpu_probe_failed",
        detail: "Windows AVX2 evidence was unavailable",
      });
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("types a missing Windows helper as process_host_unavailable", async () => {
    const root = await canonicalMkDtemp("nexus-host-missing-");
    try {
      const host = createWindowsVideoProcessHost({
        platform: "win32",
        windowsRelease: "10.0.22631",
        powershellPath: path.join(root, "missing-powershell.exe"),
        scratchRoot: root,
      });
      await expect(host.probeAvx2?.()).resolves.toMatchObject({
        status: "unavailable",
        reason: "process_host_unavailable",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  WINDOWS_ONLY(
    "rejects malformed manifests by mode and deletes each one",
    async () => {
      const powershellPath = path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const validProbe = {
        schemaVersion: 1,
        mode: "probe-avx2",
        environment: {},
        hostWatchdogMs: 10_000,
      };
      const missingEnvironment = { ...validProbe } as Record<string, unknown>;
      delete missingEnvironment.environment;
      const cases: ReadonlyArray<{
        readonly name: string;
        readonly manifest: Record<string, unknown>;
        readonly expected: RegExp;
      }> = [
        {
          name: "unknown",
          manifest: { ...validProbe, unexpected: true },
          expected: /unknown field 'unexpected'/i,
        },
        {
          name: "missing",
          manifest: missingEnvironment,
          expected: /missing field 'environment'/i,
        },
        {
          name: "wrong-type",
          manifest: { ...validProbe, hostWatchdogMs: "10000" },
          expected: /hostWatchdogMs must be an integer/i,
        },
        {
          name: "nul",
          manifest: {
            ...validProbe,
            mode: "run",
            executable: "C:\\video2x.exe",
            arguments: ["bad\u0000argument"],
            cwd: "C:\\work",
          },
          expected: /argument must not contain NUL/i,
        },
      ];

      for (const testCase of cases) {
        const root = await canonicalMkDtemp(
          "nexus-schema-" + testCase.name + "-",
        );
        const manifestPath = path.join(root, "request.json");
        const sourcePath = path.join(root, "host.cs");
        const manifestJson = JSON.stringify(testCase.manifest);
        try {
          await Promise.all([
            writeFile(manifestPath, manifestJson, "utf8"),
            writeFile(sourcePath, WINDOWS_VIDEO_PROCESS_HOST_CSHARP, "utf8"),
          ]);
          const result = await runCaptured(
            powershellPath,
            encodedPowerShellArgs(),
            authenticatedHelperEnv(
              manifestPath,
              manifestJson,
              sourcePath,
              WINDOWS_VIDEO_PROCESS_HOST_CSHARP,
            ),
          );
          expect(result.exitCode).not.toBe(0);
          expect(result.stderr).toMatch(testCase.expected);
          await expect(readFile(manifestPath, "utf8")).rejects.toThrow();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
    30_000,
  );

  WINDOWS_ONLY(
    "rejects manifest and native-source tampering against trusted hashes",
    async () => {
      const powershellPath = path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const manifestJson = JSON.stringify({
        schemaVersion: 1,
        mode: "probe-avx2",
        environment: {},
        hostWatchdogMs: 10_000,
      });
      const cases = [
        {
          name: "manifest",
          manifestOnDisk: manifestJson + " ",
          sourceOnDisk: WINDOWS_VIDEO_PROCESS_HOST_CSHARP,
          expected: /Manifest authentication failed/i,
        },
        {
          name: "native-source",
          manifestOnDisk: manifestJson,
          sourceOnDisk: WINDOWS_VIDEO_PROCESS_HOST_CSHARP + "\n// tampered",
          expected: /Native source authentication failed/i,
        },
      ] as const;

      for (const testCase of cases) {
        const root = await canonicalMkDtemp(
          "nexus-auth-" + testCase.name + "-",
        );
        const manifestPath = path.join(root, "request.json");
        const sourcePath = path.join(root, "host.cs");
        try {
          await Promise.all([
            writeFile(manifestPath, testCase.manifestOnDisk, "utf8"),
            writeFile(sourcePath, testCase.sourceOnDisk, "utf8"),
          ]);
          const result = await runCaptured(
            powershellPath,
            encodedPowerShellArgs(),
            authenticatedHelperEnv(
              manifestPath,
              manifestJson,
              sourcePath,
              WINDOWS_VIDEO_PROCESS_HOST_CSHARP,
            ),
          );
          expect(result.exitCode).not.toBe(0);
          expect(result.stderr).toMatch(testCase.expected);
          await expect(readFile(manifestPath, "utf8")).rejects.toThrow();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
    30_000,
  );

  WINDOWS_ONLY(
    "round-trips hostile argv and probes AVX2 through the real host",
    async () => {
      const root = await canonicalMkDtemp("nexus-winhost-test-");
      const control = path.join(root, "control");
      const work = path.join(root, "work");
      await mkdir(work);
      try {
        const host = createWindowsVideoProcessHost({ scratchRoot: control });
        const hostile = [
          "",
          "two words",
          'quote"inside',
          "amp&pipe|caret^percent%semi;dollar$",
          "trailing\\",
          "unicode-\u03c0",
        ];
        expect(await readdir(work)).toEqual([]);
        const result = await host.run({
          executable: process.execPath,
          args: [
            "-e",
            "console.log(JSON.stringify({argv:process.argv.slice(1),apiKey:process.env.API_KEY??null,vk:process.env.VK_ICD_FILENAMES??null,safe:process.env.NEXUS_VIDEO_TEST_VALUE??null,hostAuth:Object.keys(process.env).filter((name)=>name.startsWith('NEXUS_VIDEO_HOST_'))}))",
            ...hostile,
          ],
          cwd: work,
          env: {
            ...process.env,
            NEXUS_VIDEO_TEST_VALUE: "unicode-\u03c0",
            API_KEY: "do-not-forward",
            VK_ICD_FILENAMES: "shadow.json",
          },
          timeoutMs: 55_000,
        });
        expect(result).toMatchObject({
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          terminationConfirmed: true,
        });
        const jsonLine = result.stdout
          .split(/\r?\n/)
          .find((line) => line.trim().startsWith("{"));
        expect(jsonLine).toBeDefined();
        expect(JSON.parse(jsonLine ?? "{}")).toEqual({
          argv: hostile,
          apiKey: null,
          vk: null,
          safe: "unicode-\u03c0",
          hostAuth: [],
        });
        expect(await readdir(work)).toEqual([]);
        expect(await readdir(control)).toEqual([]);

        const avx2 = await host.probeAvx2?.();
        expect(["supported", "unavailable"]).toContain(avx2?.status);
        expect(await readdir(control)).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    60_000,
  );

  WINDOWS_ONLY(
    "closes the job and kills a descendant when cancellation wins",
    async () => {
      const root = await canonicalMkDtemp("nexus-winjob-test-");
      const control = path.join(root, "control");
      const work = path.join(root, "work");
      await mkdir(work);
      const ready = path.join(root, "ready.txt");
      const escaped = path.join(root, "escaped.txt");
      const parentScript = path.join(root, "parent.cjs");
      const childScript = path.join(root, "child.cjs");
      try {
        await writeFile(
          childScript,
          `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(escaped)}, "escaped"), 1500); setTimeout(() => {}, 10000);`,
          "utf8",
        );
        await writeFile(
          parentScript,
          `const {spawn}=require("node:child_process"); const fs=require("node:fs"); spawn(process.execPath,[${JSON.stringify(childScript)}],{stdio:"ignore"}); fs.writeFileSync(${JSON.stringify(ready)},"ready"); setTimeout(() => {}, 10000);`,
          "utf8",
        );

        const controller = new AbortController();
        const host = createWindowsVideoProcessHost({
          scratchRoot: control,
        });
        const running = host.run({
          executable: process.execPath,
          args: [parentScript],
          cwd: work,
          env: scrubVideoProcessEnv(process.env),
          timeoutMs: 20_000,
          signal: controller.signal,
          gracefulShutdownMs: 10,
          forceKillMs: 100,
        });

        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          try {
            if ((await readFile(ready, "utf8")) === "ready") break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
        expect(await readFile(ready, "utf8")).toBe("ready");
        controller.abort();
        const result = await running;
        expect(result.cancelled).toBe(true);
        expect(result.terminationConfirmed).toBe(true);
        expect(await readdir(control)).toEqual([]);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        await expect(readFile(escaped, "utf8")).rejects.toThrow();
      } finally {
        await rmTree(root);
      }
    },
    60_000,
  );
});
