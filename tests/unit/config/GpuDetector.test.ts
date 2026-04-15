import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the module under test.
const mockExecFile = vi.fn();
const mockExec = vi.fn();

vi.mock("child_process", () => ({
  execFile: mockExecFile,
  exec: mockExec,
}));

// Import after mocks are established.
const { GpuDetector } = await import("../../../src/config/GpuDetector.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Configure mockExecFile to succeed with the given stdout for a specific command.
 * Calls that do not match any configured command will fail with ENOENT.
 */
function setupExecFile(responses: Record<string, string>): void {
  mockExecFile.mockImplementation(
    (cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      for (const [key, stdout] of Object.entries(responses)) {
        if (cmd.includes(key)) {
          cb(null, stdout);
          return { on: vi.fn() };
        }
      }
      // Command not found
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      cb(err, "");
      return { on: vi.fn() };
    },
  );
}

/** Configure mockExecFile to fail with ENOENT for all commands. */
function setupExecFileNotFound(): void {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      cb(err, "");
      return { on: vi.fn() };
    },
  );
}

/** Configure mockExec (shell commands) to fail for all commands. */
function setupExecNotFound(): void {
  mockExec.mockImplementation(
    (_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      cb(err, "");
      return { on: vi.fn() };
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GpuDetector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupExecNotFound(); // Default: shell commands fail
  });

  describe("_detectNvidia", () => {
    it("parses valid nvidia-smi CSV output for a single GPU", async () => {
      const csv = "NVIDIA GeForce RTX 4090, 24564, 22100, 546.33\n";
      setupExecFile({ "nvidia-smi": csv });

      const detector = new GpuDetector();
      const result = await detector._detectNvidia();

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0]).toEqual({
        vendor: "nvidia",
        name: "NVIDIA GeForce RTX 4090",
        totalVramMb: 24564,
        freeVramMb: 22100,
        driverVersion: "546.33",
      });
    });

    it("parses multi-GPU nvidia-smi output", async () => {
      const csv = [
        "NVIDIA GeForce RTX 3060, 12288, 10000, 545.00",
        "NVIDIA GeForce RTX 4090, 24564, 22000, 545.00",
      ].join("\n");
      setupExecFile({ "nvidia-smi": csv });

      const detector = new GpuDetector();
      const result = await detector._detectNvidia();

      expect(result).toHaveLength(2);
      expect(result![0]!.totalVramMb).toBe(12288);
      expect(result![1]!.totalVramMb).toBe(24564);
    });

    it("returns null when nvidia-smi is not found", async () => {
      setupExecFileNotFound();

      const detector = new GpuDetector();
      const result = await detector._detectNvidia();

      expect(result).toBeNull();
    });

    it("returns null when nvidia-smi times out", async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
          const err = new Error("Command timed out");
          (err as NodeJS.ErrnoException).killed = true;
          cb(err, "");
          return { on: vi.fn() };
        },
      );

      const detector = new GpuDetector();
      const result = await detector._detectNvidia();

      expect(result).toBeNull();
    });
  });

  describe("detect", () => {
    it("picks the GPU with highest VRAM as primaryGpu from multi-GPU output", async () => {
      const csv = [
        "NVIDIA GeForce RTX 3060, 12288, 10000, 545.00",
        "NVIDIA GeForce RTX 4090, 24564, 22000, 545.00",
      ].join("\n");
      setupExecFile({ "nvidia-smi": csv });

      const detector = new GpuDetector();
      const result = await detector.detect();

      expect(result.primaryGpu).not.toBeNull();
      expect(result.primaryGpu!.name).toBe("NVIDIA GeForce RTX 4090");
      expect(result.primaryGpu!.totalVramMb).toBe(24564);
      expect(result.gpus).toHaveLength(2);
      expect(result.detectionMethod).toBe("nvidia-smi");
      expect(result.error).toBeNull();
    });

    it("returns cached result on second call without re-running detection", async () => {
      const csv = "NVIDIA GeForce RTX 4090, 24564, 22100, 546.33\n";
      setupExecFile({ "nvidia-smi": csv });

      const detector = new GpuDetector();
      const result1 = await detector.detect();
      const result2 = await detector.detect();

      expect(result1).toBe(result2); // Same reference (cached)
      // execFile should have been called only for the first detect()
      const nvidiaCalls = mockExecFile.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("nvidia-smi"),
      );
      expect(nvidiaCalls.length).toBeLessThanOrEqual(2); // First call (PATH) + possible Windows fallback
    });

    it("refresh() clears cache and re-runs detection", async () => {
      const csv = "NVIDIA GeForce RTX 4090, 24564, 22100, 546.33\n";
      setupExecFile({ "nvidia-smi": csv });

      const detector = new GpuDetector();
      const result1 = await detector.detect();

      detector.refresh();
      const result2 = await detector.detect();

      expect(result1).not.toBe(result2); // Different references
      expect(result2.primaryGpu!.name).toBe("NVIDIA GeForce RTX 4090");
    });

    it("returns error when no GPU is detected", async () => {
      setupExecFileNotFound();

      const detector = new GpuDetector();
      const result = await detector.detect();

      expect(result.gpus).toHaveLength(0);
      expect(result.primaryGpu).toBeNull();
      expect(result.error).toBe("No GPU detected");
      expect(result.detectionMethod).toBe("none");
    });

    it("falls back to WMI on Windows when nvidia-smi is not available", async () => {
      // nvidia-smi not found
      setupExecFileNotFound();

      // WMI fallback returns a result via exec (shell)
      mockExec.mockImplementation(
        (cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
          if (cmd.includes("wmic")) {
            cb(null, "Node,AdapterRAM,Name\nPC,4294967296,NVIDIA GeForce GTX 1650\n");
            return { on: vi.fn() };
          }
          const err = new Error("ENOENT") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          cb(err, "");
          return { on: vi.fn() };
        },
      );

      // Temporarily override platform to win32 for this test
      const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      try {
        const detector = new GpuDetector();
        const result = await detector.detect();

        expect(result.gpus.length).toBeGreaterThanOrEqual(1);
        expect(result.detectionMethod).toBe("fallback");
      } finally {
        if (originalPlatform) {
          Object.defineProperty(process, "platform", originalPlatform);
        }
      }
    });
  });
});
