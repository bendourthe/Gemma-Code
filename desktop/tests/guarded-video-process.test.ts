import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  createPosixGuardedVideoProcess,
  parseLinuxAvx2,
  scrubVideoProcessEnv,
} from "../sidecar/src/video/GuardedVideoProcess.js";

class FakeChild extends EventEmitter {
  readonly pid = 41_337;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);

  close(exitCode: number | null): void {
    this.emit("close", exitCode);
  }
}

function spawnFake(child: FakeChild): typeof spawn {
  return vi.fn(
    () => child as unknown as ChildProcessWithoutNullStreams,
  ) as unknown as typeof spawn;
}

function request(signal?: AbortSignal) {
  return {
    executable: "/opt/video2x/video2x",
    args: ["--version"],
    cwd: "/tmp/nexus-video-work",
    env: {},
    timeoutMs: 10_000,
    signal,
    gracefulShutdownMs: 10,
    forceKillMs: 20,
  } as const;
}

describe("createPosixGuardedVideoProcess", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tears down the process group after a cancelled leader exits zero", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const signals: NodeJS.Signals[] = [];
    const controller = new AbortController();
    const runner = createPosixGuardedVideoProcess({
      platform: "linux",
      spawnFn: spawnFake(child),
      killProcessGroup: (_pid, signal) => signals.push(signal),
      probeProcessGroup: () => false,
      terminationAcknowledgementMs: 5,
    });

    const running = runner.run(request(controller.signal));
    controller.abort();
    child.close(0);
    await vi.advanceTimersByTimeAsync(40);

    await expect(running).resolves.toMatchObject({
      exitCode: 0,
      cancelled: true,
      timedOut: false,
      terminationConfirmed: true,
    });
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("does not downgrade a process-group signaling failure to parent-only kill", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const controller = new AbortController();
    const denied = Object.assign(new Error("denied"), { code: "EPERM" });
    const runner = createPosixGuardedVideoProcess({
      platform: "linux",
      spawnFn: spawnFake(child),
      killProcessGroup: () => {
        throw denied;
      },
      probeProcessGroup: () => {
        throw denied;
      },
      terminationAcknowledgementMs: 5,
    });

    const running = runner.run(request(controller.signal));
    controller.abort();
    child.close(0);
    await vi.advanceTimersByTimeAsync(40);
    const result = await running;

    expect(result).toMatchObject({
      exitCode: null,
      cancelled: true,
      timedOut: false,
      terminationConfirmed: false,
    });
    expect(result.stderr).toContain("termination could not be proven");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("settles a timed-out child that never emits close after bounded group teardown", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const signals: NodeJS.Signals[] = [];
    const runner = createPosixGuardedVideoProcess({
      platform: "linux",
      spawnFn: spawnFake(child),
      killProcessGroup: (_pid, signal) => signals.push(signal),
      probeProcessGroup: () => false,
      terminationAcknowledgementMs: 5,
    });

    const running = runner.run({
      ...request(),
      timeoutMs: 10,
      gracefulShutdownMs: 5,
      forceKillMs: 5,
    });
    await vi.advanceTimersByTimeAsync(30);

    await expect(running).resolves.toMatchObject({
      exitCode: null,
      cancelled: false,
      timedOut: true,
      terminationConfirmed: true,
    });
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("returns unconfirmed and runs only a bounded background reap when the group persists", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const signals: NodeJS.Signals[] = [];
    let probes = 0;
    const runner = createPosixGuardedVideoProcess({
      platform: "linux",
      spawnFn: spawnFake(child),
      killProcessGroup: (_pid, signal) => signals.push(signal),
      probeProcessGroup: () => {
        probes += 1;
        return true;
      },
      terminationAcknowledgementMs: 5,
    });

    const running = runner.run({
      ...request(),
      timeoutMs: 10,
      gracefulShutdownMs: 0,
      forceKillMs: 0,
    });
    await vi.advanceTimersByTimeAsync(20);
    const result = await running;

    expect(result).toMatchObject({
      exitCode: null,
      timedOut: true,
      cancelled: false,
      terminationConfirmed: false,
    });
    expect(probes).toBe(1);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);

    await vi.advanceTimersByTimeAsync(1_100);
    expect(probes).toBe(5);
    expect(signals).toEqual([
      "SIGTERM",
      "SIGKILL",
      "SIGKILL",
      "SIGKILL",
      "SIGKILL",
      "SIGKILL",
    ]);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(probes).toBe(5);
  });

  it("detaches output callbacks after bounded no-close settlement", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const onStdout = vi.fn();
    const onStderr = vi.fn();
    const runner = createPosixGuardedVideoProcess({
      platform: "linux",
      spawnFn: spawnFake(child),
      killProcessGroup: () => undefined,
      probeProcessGroup: () => true,
      terminationAcknowledgementMs: 5,
    });

    const running = runner.run({
      ...request(),
      timeoutMs: 10,
      gracefulShutdownMs: 0,
      forceKillMs: 0,
      onStdout,
      onStderr,
    });
    child.stdout.write("before-out");
    child.stderr.write("before-err");
    expect(onStdout).toHaveBeenCalledTimes(1);
    expect(onStderr).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20);
    const result = await running;
    child.stdout.write("late-out");
    child.stderr.write("late-err");
    await Promise.resolve();

    expect(result).toMatchObject({
      stdout: "before-out",
      timedOut: true,
      cancelled: false,
      terminationConfirmed: false,
    });
    expect(result.stderr).toContain("before-err");
    expect(result.stdout).not.toContain("late-out");
    expect(result.stderr).not.toContain("late-err");
    expect(onStdout).toHaveBeenCalledTimes(1);
    expect(onStderr).toHaveBeenCalledTimes(1);
    expect(child.stdout.isPaused()).toBe(true);
    expect(child.stderr.isPaused()).toBe(true);
  });

  it("reports termination confirmed when cancellation happens before spawn", async () => {
    const controller = new AbortController();
    controller.abort();
    const spawnFn = vi.fn() as unknown as typeof spawn;
    const runner = createPosixGuardedVideoProcess({
      platform: "linux",
      spawnFn,
    });

    await expect(runner.run(request(controller.signal))).resolves.toMatchObject(
      {
        cancelled: true,
        terminationConfirmed: true,
      },
    );
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("fails a normal exit closed when descendants remain", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const signals: NodeJS.Signals[] = [];
    let probes = 0;
    const runner = createPosixGuardedVideoProcess({
      platform: "linux",
      spawnFn: spawnFake(child),
      killProcessGroup: (_pid, signal) => signals.push(signal),
      probeProcessGroup: () => ++probes === 1,
      terminationAcknowledgementMs: 5,
    });

    const running = runner.run(request());
    child.close(0);
    await vi.advanceTimersByTimeAsync(30);
    const result = await running;

    expect(result.exitCode).toBeNull();
    expect(result.cancelled).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.terminationConfirmed).toBe(true);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("retains a byte-bounded UTF-8 tail without a split-codepoint marker", async () => {
    const child = new FakeChild();
    const runner = createPosixGuardedVideoProcess({
      platform: "linux",
      spawnFn: spawnFake(child),
      probeProcessGroup: () => false,
      maxCaptureBytes: 9,
    });

    const running = runner.run(request());
    child.stdout.write(`${"x".repeat(70_000)}πππ`);
    child.close(0);
    const result = await running;

    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(9);
    expect(result.stdout).not.toContain("�");
    expect(result.stdout).toContain("π");
  });

  it("requires flags evidence for every reported Linux processor", () => {
    expect(
      parseLinuxAvx2(
        "processor : 0\nflags : avx avx2\n\nprocessor : 1\nmodel name : CPU",
      ),
    ).toEqual({
      status: "unavailable",
      reason: "cpu_probe_failed",
      detail: "CPU feature flags were not present for every processor",
    });
  });

  it("types unreadable Linux CPU evidence as cpu_probe_failed", async () => {
    const runner = createPosixGuardedVideoProcess({
      platform: "linux",
      readCpuInfo: async () => {
        throw new Error("unreadable");
      },
    });

    await expect(runner.probeAvx2?.()).resolves.toEqual({
      status: "unavailable",
      reason: "cpu_probe_failed",
      detail: "unreadable",
    });
  });

  it("scrubs inherited loader and managed-runtime injection surfaces", () => {
    expect(
      scrubVideoProcessEnv({
        LANG: "en_US.UTF-8",
        LC_ALL: "C.UTF-8",
        TMPDIR: "/tmp/nexus-video",
        TEMP: "C:\\Temp",
        PATH: "/usr/local/bin:/usr/bin",
        APPDIR: "/tmp/attacker-appdir",
        LD_PRELOAD: "/tmp/preload.so",
        LD_LIBRARY_PATH: "/tmp/loader-path",
        LD_AUDIT: "/tmp/audit.so",
        LD_DEBUG_OUTPUT: "/tmp/loader-debug",
        GLIBC_TUNABLES: "glibc.malloc.check=3",
        DYLD_INSERT_LIBRARIES: "/tmp/insert.dylib",
        DYLD_PRINT_TO_FILE: "/tmp/dyld-debug",
        VK_ICD_FILENAMES: "/tmp/icd.json",
        VK_INSTANCE_LAYERS: "attacker-layer",
        COR_ENABLE_PROFILING: "1",
        COR_PROFILER: "{00000000-0000-0000-0000-000000000001}",
        CORECLR_ENABLE_PROFILING: "1",
        CORECLR_PROFILER_PATH: "/tmp/profiler.so",
        COMPlus_ReadyToRun: "0",
        DOTNET_STARTUP_HOOKS: "/tmp/startup-hook.dll",
        DOTNET_ADDITIONAL_DEPS: "/tmp/additional.deps.json",
        DOTNET_SHARED_STORE: "/tmp/shared-store",
        DOTNET_ROOT: "/tmp/dotnet",
        API_KEY: "ordinary-looking-secret",
        BENIGN_ALIAS: "ghp_" + "a".repeat(36),
        NEXUS_VIDEO_HOST_SOURCE_PATH: "/tmp/attacker-source.cs",
      }),
    ).toEqual({
      LANG: "en_US.UTF-8",
      LC_ALL: "C.UTF-8",
      TMPDIR: "/tmp/nexus-video",
      TEMP: "C:\\Temp",
      PATH: "/usr/local/bin:/usr/bin",
    });
  });
});
