import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";

import { scrubEnv } from "../../../../core/observability/scrubEnv.js";

const DEFAULT_MAX_CAPTURE_BYTES = 64 * 1024;
const DEFAULT_GRACEFUL_SHUTDOWN_MS = 250;
const DEFAULT_FORCE_KILL_MS = 1_000;
const DEFAULT_TERMINATION_ACK_MS = 100;
const MAX_ESCALATION_DELAY_MS = 60_000;
const MAX_NODE_TIMEOUT_MS = 2_147_483_647;
const BACKGROUND_REAP_ATTEMPTS = 4;
const BACKGROUND_REAP_INTERVAL_MS = 250;

const PROCESS_INJECTION_ENV_NAME =
  /^(?:APPDIR|GLIBC_TUNABLES|(?:LD|DYLD|VK|COR|CORECLR|COMPLUS|DOTNET)_.*)$/i;
const INTERNAL_VIDEO_HOST_ENV_NAME = /^NEXUS_VIDEO_HOST_/i;

export interface GuardedProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
  readonly graceInput?: string;
  readonly gracefulShutdownMs?: number;
  readonly forceKillMs?: number;
}

export interface GuardedProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly terminationConfirmed: boolean;
}

export type Avx2ProbeFailureReason =
  "process_host_unavailable" | "cpu_probe_failed";

export interface Avx2ProbeResult {
  readonly status: "supported" | "unsupported" | "unavailable";
  readonly reason?: Avx2ProbeFailureReason;
  readonly detail?: string;
}

export interface GuardedVideoProcess {
  run(request: GuardedProcessRequest): Promise<GuardedProcessResult>;
  probeAvx2?(): Promise<Avx2ProbeResult>;
}

export interface PosixGuardedVideoProcessOptions {
  readonly platform?: NodeJS.Platform;
  readonly spawnFn?: typeof spawn;
  readonly killProcessGroup?: (pid: number, signal: NodeJS.Signals) => void;
  readonly probeProcessGroup?: (pid: number) => boolean;
  readonly readCpuInfo?: () => Promise<string>;
  readonly maxCaptureBytes?: number;
  readonly terminationAcknowledgementMs?: number;
}

export function scrubVideoProcessEnv(
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const valueScrubbed = scrubEnv(base);
  const clean: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(valueScrubbed)) {
    if (value === undefined) continue;
    if (
      PROCESS_INJECTION_ENV_NAME.test(name) ||
      INTERNAL_VIDEO_HOST_ENV_NAME.test(name)
    ) {
      continue;
    }
    clean[name] = value;
  }
  return clean;
}

export function parseLinuxAvx2(cpuInfo: string): Avx2ProbeResult {
  const processorBlocks = cpuInfo
    .split(/\r?\n\s*\r?\n/)
    .filter((block) => /^\s*processor\s*:/im.test(block));
  const blocks = processorBlocks.length > 0 ? processorBlocks : [cpuInfo];
  const flagLinesByBlock = blocks.map((block) =>
    block
      .split(/\r?\n/)
      .filter((line) => /^\s*(?:flags|features)\s*:/i.test(line)),
  );
  if (flagLinesByBlock.some((lines) => lines.length === 0)) {
    return {
      status: "unavailable",
      reason: "cpu_probe_failed",
      detail: "CPU feature flags were not present for every processor",
    };
  }
  const flagLines = flagLinesByBlock.flat();
  if (flagLines.length === 0) {
    return {
      status: "unavailable",
      reason: "cpu_probe_failed",
      detail: "CPU feature flags were not present",
    };
  }
  const allFlagSetsContainAvx2 = flagLines.every((line) =>
    /(?:^|\s)avx2(?:\s|$)/i.test(line.slice(line.indexOf(":") + 1)),
  );
  return allFlagSetsContainAvx2
    ? { status: "supported" }
    : {
        status: "unsupported",
        detail: "AVX2 was not present on every processor",
      };
}

function appendBounded(
  current: string,
  chunk: string,
  maxBytes: number,
): string {
  const currentBytes = Buffer.from(current, "utf8");
  const chunkBytes = Buffer.from(chunk, "utf8");
  if (currentBytes.length + chunkBytes.length <= maxBytes)
    return current + chunk;
  const combined =
    chunkBytes.length >= maxBytes
      ? chunkBytes
      : Buffer.concat([
          currentBytes.subarray(
            Math.max(0, currentBytes.length - (maxBytes - chunkBytes.length)),
          ),
          chunkBytes,
        ]);
  let start = Math.max(0, combined.length - maxBytes);
  while (start < combined.length && (combined[start]! & 0xc0) === 0x80)
    start += 1;
  return combined.subarray(start).toString("utf8");
}

function emptyCancelledResult(): GuardedProcessResult {
  return {
    exitCode: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    cancelled: true,
    terminationConfirmed: true,
  };
}

function normalizeEscalationDelay(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0 || value > MAX_ESCALATION_DELAY_MS) {
    throw new Error(`${name} must be between 0 and ${MAX_ESCALATION_DELAY_MS}`);
  }
  return Math.floor(value);
}

export function createPosixGuardedVideoProcess(
  options: PosixGuardedVideoProcessOptions = {},
): GuardedVideoProcess {
  const platform = options.platform ?? process.platform;
  if (platform !== "linux") {
    throw new Error("POSIX Video2X process groups are supported only on Linux");
  }
  const spawnFn = options.spawnFn ?? spawn;
  const killProcessGroup =
    options.killProcessGroup ??
    ((pid: number, signal: NodeJS.Signals) => {
      process.kill(-pid, signal);
    });
  const probeProcessGroup =
    options.probeProcessGroup ??
    ((pid: number) => {
      try {
        process.kill(-pid, 0);
        return true;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: unknown }).code === "ESRCH"
        ) {
          return false;
        }
        throw error;
      }
    });
  const readCpuInfo =
    options.readCpuInfo ?? (() => readFile("/proc/cpuinfo", "utf8"));
  const requestedCaptureBytes =
    options.maxCaptureBytes ?? DEFAULT_MAX_CAPTURE_BYTES;
  const maxCaptureBytes =
    Number.isFinite(requestedCaptureBytes) && requestedCaptureBytes > 0
      ? Math.min(DEFAULT_MAX_CAPTURE_BYTES, Math.floor(requestedCaptureBytes))
      : DEFAULT_MAX_CAPTURE_BYTES;
  const terminationAcknowledgementMs = normalizeEscalationDelay(
    options.terminationAcknowledgementMs,
    DEFAULT_TERMINATION_ACK_MS,
    "terminationAcknowledgementMs",
  );

  return {
    async probeAvx2(): Promise<Avx2ProbeResult> {
      try {
        return parseLinuxAvx2(await readCpuInfo());
      } catch (error) {
        return {
          status: "unavailable",
          reason: "cpu_probe_failed",
          detail:
            error instanceof Error ? error.message : "CPU feature probe failed",
        };
      }
    },

    async run(request: GuardedProcessRequest): Promise<GuardedProcessResult> {
      if (request.signal?.aborted) return emptyCancelledResult();
      if (
        !Number.isFinite(request.timeoutMs) ||
        request.timeoutMs <= 0 ||
        request.timeoutMs > MAX_NODE_TIMEOUT_MS
      ) {
        throw new Error(
          `timeoutMs must be between 1 and ${MAX_NODE_TIMEOUT_MS}`,
        );
      }
      const gracefulShutdownMs = normalizeEscalationDelay(
        request.gracefulShutdownMs,
        DEFAULT_GRACEFUL_SHUTDOWN_MS,
        "gracefulShutdownMs",
      );
      const forceKillMs = normalizeEscalationDelay(
        request.forceKillMs,
        DEFAULT_FORCE_KILL_MS,
        "forceKillMs",
      );

      const child = spawnFn(request.executable, [...request.args], {
        cwd: request.cwd,
        env: scrubVideoProcessEnv(request.env),
        shell: false,
        detached: true,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;

      child.stdin.on("error", () => {
        // Redirected stdin is a best-effort graceful-stop channel. Process-group
        // signals remain authoritative when the child closes stdin early.
      });

      return await new Promise<GuardedProcessResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        let stopReason: "cancel" | "timeout" | "orphan" | null = null;
        let stopping = false;
        let settled = false;
        let terminationFailed = false;
        let terminationDiagnosticAdded = false;
        let terminationConfirmed = false;
        let closeObserved = false;
        let observedExitCode: number | null = null;
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
        let gracefulTimer: ReturnType<typeof setTimeout> | undefined;
        let forceTimer: ReturnType<typeof setTimeout> | undefined;
        let acknowledgementTimer: ReturnType<typeof setTimeout> | undefined;

        const errorHasCode = (error: unknown, code: string): boolean =>
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: unknown }).code === code;

        const noteTerminationFailure = (): void => {
          terminationFailed = true;
          if (terminationDiagnosticAdded) return;
          terminationDiagnosticAdded = true;
          stderr = appendBounded(
            stderr,
            "\nVideo process-group termination could not be proven.",
            maxCaptureBytes,
          );
        };

        const finish = (): void => {
          if (settled) return;
          settled = true;
          if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
          if (gracefulTimer !== undefined) clearTimeout(gracefulTimer);
          if (forceTimer !== undefined) clearTimeout(forceTimer);
          if (acknowledgementTimer !== undefined)
            clearTimeout(acknowledgementTimer);
          request.signal?.removeEventListener("abort", onAbort);
          child.stdout.removeListener("data", onStdout);
          child.stderr.removeListener("data", onStderr);
          child.stdout.pause();
          child.stderr.pause();
          child.removeListener("error", onError);
          child.removeListener("close", onClose);
          resolve({
            exitCode: terminationFailed ? null : observedExitCode,
            stdout,
            stderr,
            timedOut: stopReason === "timeout",
            cancelled: stopReason === "cancel",
            terminationConfirmed,
          });
        };

        const signalGroup = (
          signal: NodeJS.Signals,
        ): "sent" | "gone" | "failed" => {
          if (child.pid === undefined) {
            try {
              child.kill(signal);
              return "sent";
            } catch {
              return closeObserved ? "gone" : "failed";
            }
          }
          try {
            killProcessGroup(child.pid, signal);
            return "sent";
          } catch (error) {
            if (errorHasCode(error, "ESRCH")) return "gone";
            noteTerminationFailure();
            return "failed";
          }
        };

        const groupExists = (): boolean | null => {
          if (child.pid === undefined) return closeObserved ? false : null;
          try {
            return probeProcessGroup(child.pid);
          } catch {
            noteTerminationFailure();
            return null;
          }
        };

        const startBackgroundReap = (): void => {
          const pid = child.pid;
          if (pid === undefined) return;
          let attemptsRemaining = BACKGROUND_REAP_ATTEMPTS;
          const reap = (): void => {
            if (attemptsRemaining <= 0) return;
            attemptsRemaining -= 1;
            let exists: boolean | null = null;
            try {
              exists = probeProcessGroup(pid);
            } catch {
              // The foreground result already records that proof was absent.
            }
            if (exists === false) return;
            try {
              killProcessGroup(pid, "SIGKILL");
            } catch {
              // Reaping is best-effort and cannot mutate the settled result.
            }
            if (attemptsRemaining > 0) {
              const timer = setTimeout(reap, BACKGROUND_REAP_INTERVAL_MS);
              (
                timer as ReturnType<typeof setTimeout> & {
                  unref?: () => void;
                }
              ).unref?.();
            }
          };
          const timer = setTimeout(reap, BACKGROUND_REAP_INTERVAL_MS);
          (
            timer as ReturnType<typeof setTimeout> & {
              unref?: () => void;
            }
          ).unref?.();
        };

        const acknowledgeTermination = (): void => {
          const exists = groupExists();
          terminationConfirmed = exists === false;
          if (!terminationConfirmed) {
            noteTerminationFailure();
            startBackgroundReap();
          }
          finish();
        };

        const forceStop = (): void => {
          const outcome = signalGroup("SIGKILL");
          if (outcome === "gone") {
            terminationConfirmed = true;
            finish();
            return;
          }
          acknowledgementTimer = setTimeout(
            acknowledgeTermination,
            Math.max(0, terminationAcknowledgementMs),
          );
        };

        const gracefulStop = (): void => {
          const outcome = signalGroup("SIGTERM");
          if (outcome === "gone") {
            terminationConfirmed = true;
            finish();
            return;
          }
          forceTimer = setTimeout(forceStop, forceKillMs);
        };

        const beginStop = (reason: "cancel" | "timeout" | "orphan"): void => {
          if (reason === "cancel" || stopReason === null) stopReason = reason;
          if (stopping) return;
          stopping = true;
          if (reason !== "orphan") {
            try {
              child.stdin.write(request.graceInput ?? "q\n");
            } catch {
              // Video2X 6.4.0 may not observe redirected stdin; process-group
              // termination below is the authoritative boundary.
            }
          }
          gracefulTimer = setTimeout(
            gracefulStop,
            reason === "orphan" ? 0 : gracefulShutdownMs,
          );
        };

        const onAbort = (): void => beginStop("cancel");
        const onStdout = (data: Buffer | string): void => {
          const chunk = data.toString();
          stdout = appendBounded(stdout, chunk, maxCaptureBytes);
          try {
            request.onStdout?.(chunk);
          } catch {
            // A capture consumer cannot control the subprocess lifecycle.
          }
        };
        const onStderr = (data: Buffer | string): void => {
          const chunk = data.toString();
          stderr = appendBounded(stderr, chunk, maxCaptureBytes);
          try {
            request.onStderr?.(chunk);
          } catch {
            // A capture consumer cannot control the subprocess lifecycle.
          }
        };
        const onError = (error: Error): void => {
          stderr = appendBounded(stderr, error.message, maxCaptureBytes);
        };
        const onClose = (exitCode: number | null): void => {
          if (settled) return;
          closeObserved = true;
          observedExitCode = exitCode;
          if (stopReason !== null) return;
          const descendantsRemain = groupExists();
          if (descendantsRemain === false) {
            terminationConfirmed = true;
            finish();
            return;
          }
          terminationFailed = true;
          beginStop("orphan");
        };

        child.stdout.on("data", onStdout);
        child.stderr.on("data", onStderr);
        child.once("error", onError);
        child.once("close", onClose);
        request.signal?.addEventListener("abort", onAbort, { once: true });
        if (request.signal?.aborted) beginStop("cancel");
        timeoutTimer = setTimeout(
          () => beginStop("timeout"),
          request.timeoutMs,
        );
      });
    },
  };
}
