import { execFile, exec } from "child_process";
import { totalmem } from "os";
import type { GpuInfo, GpuVendor, DetectionResult } from "./GpuDetector.types.js";

const DETECTION_TIMEOUT_MS = 5000;

/**
 * Execute a command with a timeout. Returns stdout on success, null on any failure.
 */
function execWithTimeout(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  useShell = false,
): Promise<string | null> {
  return new Promise((resolve) => {
    const cb = (error: Error | null, stdout: string | Buffer) => {
      if (error) {
        console.debug(`[GpuDetector] Command failed: ${command} ${args.join(" ")} -- ${error.message}`);
        resolve(null);
        return;
      }
      resolve(typeof stdout === "string" ? stdout : stdout.toString());
    };

    if (useShell) {
      const fullCommand = [command, ...args].join(" ");
      const proc = exec(fullCommand, { timeout: timeoutMs }, cb);
      proc.on("error", () => resolve(null));
    } else {
      const proc = execFile(command, [...args], { timeout: timeoutMs }, cb);
      proc.on("error", () => resolve(null));
    }
  });
}

export class GpuDetector {
  private _cachedResult: DetectionResult | null = null;

  /** Main entry point: detect all available GPUs. Returns cached result if available. */
  async detect(): Promise<DetectionResult> {
    if (this._cachedResult) {
      return this._cachedResult;
    }

    const gpus: GpuInfo[] = [];
    let detectionMethod = "none";

    // Try NVIDIA first.
    const nvidiaGpus = await this._detectNvidia();
    if (nvidiaGpus && nvidiaGpus.length > 0) {
      gpus.push(...nvidiaGpus);
      detectionMethod = "nvidia-smi";
    }

    // Try AMD.
    const amdGpus = await this._detectAmd();
    if (amdGpus && amdGpus.length > 0) {
      gpus.push(...amdGpus);
      detectionMethod = detectionMethod === "none" ? "amd" : `${detectionMethod}+amd`;
    }

    // Try Apple (macOS only).
    if (process.platform === "darwin") {
      const appleGpus = await this._detectApple();
      if (appleGpus && appleGpus.length > 0) {
        gpus.push(...appleGpus);
        detectionMethod = detectionMethod === "none" ? "apple" : `${detectionMethod}+apple`;
      }
    }

    // Fallback detection if nothing found yet.
    if (gpus.length === 0) {
      const fallbackGpus = await this._detectFallback();
      if (fallbackGpus && fallbackGpus.length > 0) {
        gpus.push(...fallbackGpus);
        detectionMethod = "fallback";
      }
    }

    // Pick the GPU with the most total VRAM as primary.
    const primaryGpu = gpus.length > 0
      ? gpus.reduce((best, gpu) => gpu.totalVramMb > best.totalVramMb ? gpu : best)
      : null;

    const result: DetectionResult = {
      gpus,
      primaryGpu,
      detectionMethod,
      error: gpus.length === 0 ? "No GPU detected" : null,
    };

    this._cachedResult = result;
    return result;
  }

  /** Clear cached result so the next detect() re-runs detection. */
  refresh(): void {
    this._cachedResult = null;
  }

  /**
   * Detect NVIDIA GPUs via nvidia-smi.
   * Parses CSV output: name, memory.total (MB), memory.free (MB), driver_version.
   */
  async _detectNvidia(): Promise<GpuInfo[] | null> {
    const args = [
      "--query-gpu=name,memory.total,memory.free,driver_version",
      "--format=csv,noheader,nounits",
    ];

    // Try nvidia-smi on PATH first.
    let output = await execWithTimeout("nvidia-smi", args, DETECTION_TIMEOUT_MS);

    // On Windows, try the standard install location if not on PATH.
    if (output === null && process.platform === "win32") {
      output = await execWithTimeout(
        "C:\\Windows\\System32\\nvidia-smi.exe",
        args,
        DETECTION_TIMEOUT_MS,
      );
    }

    if (!output) return null;

    const gpus: GpuInfo[] = [];
    for (const line of output.trim().split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(",").map((p) => p.trim());
      if (parts.length < 4) continue;

      const name = parts[0] ?? "";
      const totalVram = parseInt(parts[1] ?? "0", 10);
      const freeVram = parseInt(parts[2] ?? "0", 10);
      const driver = parts[3] ?? null;

      if (name && !isNaN(totalVram)) {
        gpus.push({
          vendor: "nvidia",
          name,
          totalVramMb: totalVram,
          freeVramMb: isNaN(freeVram) ? 0 : freeVram,
          driverVersion: driver || null,
        });
      }
    }

    return gpus.length > 0 ? gpus : null;
  }

  /**
   * Detect AMD GPUs.
   * Linux: rocm-smi. Windows: PowerShell Get-CimInstance.
   */
  async _detectAmd(): Promise<GpuInfo[] | null> {
    if (process.platform === "linux") {
      return this._detectAmdLinux();
    }
    if (process.platform === "win32") {
      return this._detectAmdWindows();
    }
    return null;
  }

  private async _detectAmdLinux(): Promise<GpuInfo[] | null> {
    const output = await execWithTimeout(
      "rocm-smi",
      ["--showmeminfo", "vram", "--csv"],
      DETECTION_TIMEOUT_MS,
    );
    if (!output) return null;

    const lines = output.trim().split("\n");
    // First line is header: GPU, VRAM Total, VRAM Used
    const gpus: GpuInfo[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;
      const parts = line.split(",").map((p) => p.trim());
      const totalBytes = parseInt(parts[1] ?? "0", 10);
      const usedBytes = parseInt(parts[2] ?? "0", 10);
      if (!isNaN(totalBytes) && totalBytes > 0) {
        const totalMb = Math.round(totalBytes / (1024 * 1024));
        const freeMb = Math.round((totalBytes - usedBytes) / (1024 * 1024));
        gpus.push({
          vendor: "amd",
          name: `AMD GPU ${parts[0] ?? i}`,
          totalVramMb: totalMb,
          freeVramMb: isNaN(freeMb) ? 0 : Math.max(0, freeMb),
          driverVersion: null,
        });
      }
    }
    return gpus.length > 0 ? gpus : null;
  }

  private async _detectAmdWindows(): Promise<GpuInfo[] | null> {
    const output = await execWithTimeout(
      "powershell",
      ["-NoProfile", "-Command", "Get-CimInstance -ClassName Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Csv -NoTypeInformation"],
      DETECTION_TIMEOUT_MS,
    );
    if (!output) return null;

    const gpus: GpuInfo[] = [];
    const lines = output.trim().split("\n");
    // First line is CSV header: "Name","AdapterRAM"
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;
      // Parse quoted CSV: "Name","AdapterRAM"
      const match = line.match(/"([^"]*)"[,\s]*"?(\d*)"?/);
      if (match) {
        const name = match[1] ?? "";
        const adapterRam = parseInt(match[2] ?? "0", 10);
        if (name.toLowerCase().includes("amd") || name.toLowerCase().includes("radeon")) {
          const totalMb = Math.round(adapterRam / (1024 * 1024));
          gpus.push({
            vendor: "amd",
            name,
            totalVramMb: totalMb,
            freeVramMb: 0, // Windows WMI does not report free VRAM
            driverVersion: null,
          });
        }
      }
    }
    return gpus.length > 0 ? gpus : null;
  }

  /**
   * Detect Apple GPUs on macOS.
   * Uses system_profiler for GPU name and sysctl/os.totalmem for unified memory.
   */
  async _detectApple(): Promise<GpuInfo[] | null> {
    if (process.platform !== "darwin") return null;

    const output = await execWithTimeout(
      "system_profiler",
      ["SPDisplaysDataType", "-json"],
      DETECTION_TIMEOUT_MS,
    );
    if (!output) return null;

    try {
      const data = JSON.parse(output) as Record<string, unknown>;
      const displays = (data["SPDisplaysDataType"] ?? []) as Array<Record<string, unknown>>;
      const gpus: GpuInfo[] = [];

      for (const display of displays) {
        const name = (display["sppci_model"] as string | undefined) ?? "Apple GPU";
        const vramStr = display["spdisplays_vram"] as string | undefined;
        let totalVramMb: number;

        if (vramStr && vramStr !== "System") {
          // Parse "2048 MB" or similar
          const match = vramStr.match(/(\d+)/);
          totalVramMb = match ? parseInt(match[1] ?? "0", 10) : 0;
        } else {
          // Apple Silicon unified memory: estimate 75% of system RAM as GPU-available.
          totalVramMb = Math.round((totalmem() / (1024 * 1024)) * 0.75);
        }

        if (totalVramMb > 0) {
          gpus.push({
            vendor: "apple",
            name,
            totalVramMb,
            freeVramMb: 0, // Not available for Apple Silicon
            driverVersion: null,
          });
        }
      }

      return gpus.length > 0 ? gpus : null;
    } catch {
      console.debug("[GpuDetector] Failed to parse system_profiler output");
      return null;
    }
  }

  /**
   * Fallback detection using WMI on Windows.
   * Note: wmic is deprecated on Windows 11 but still ships.
   * Future migration: replace with PowerShell Get-CimInstance.
   */
  async _detectFallback(): Promise<GpuInfo[] | null> {
    if (process.platform === "win32") {
      return this._detectWmiFallback();
    }
    if (process.platform === "linux") {
      return this._detectLspci();
    }
    return null;
  }

  private async _detectWmiFallback(): Promise<GpuInfo[] | null> {
    const output = await execWithTimeout(
      "wmic",
      ["path", "win32_VideoController", "get", "Name,AdapterRAM", "/format:csv"],
      DETECTION_TIMEOUT_MS,
      true, // wmic needs shell on some Windows configurations
    );
    if (!output) return null;

    const gpus: GpuInfo[] = [];
    const lines = output.trim().split("\n");
    // CSV format: Node,AdapterRAM,Name
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("Node")) continue;
      const parts = trimmed.split(",");
      if (parts.length < 3) continue;
      const adapterRam = parseInt(parts[1] ?? "0", 10);
      const name = parts[2]?.trim() ?? "";
      if (name && adapterRam > 0) {
        const vendor: GpuVendor = name.toLowerCase().includes("nvidia")
          ? "nvidia"
          : name.toLowerCase().includes("amd") || name.toLowerCase().includes("radeon")
            ? "amd"
            : name.toLowerCase().includes("intel")
              ? "intel"
              : "unknown";
        gpus.push({
          vendor,
          name,
          totalVramMb: Math.round(adapterRam / (1024 * 1024)),
          freeVramMb: 0,
          driverVersion: null,
        });
      }
    }
    return gpus.length > 0 ? gpus : null;
  }

  private async _detectLspci(): Promise<GpuInfo[] | null> {
    const output = await execWithTimeout(
      "lspci",
      [],
      DETECTION_TIMEOUT_MS,
    );
    if (!output) return null;

    const gpus: GpuInfo[] = [];
    for (const line of output.split("\n")) {
      if (line.includes("VGA") || line.includes("3D controller") || line.includes("Display controller")) {
        const name = line.replace(/^[^ ]+ /, "").trim();
        const vendor: GpuVendor = name.toLowerCase().includes("nvidia")
          ? "nvidia"
          : name.toLowerCase().includes("amd") || name.toLowerCase().includes("radeon")
            ? "amd"
            : name.toLowerCase().includes("intel")
              ? "intel"
              : "unknown";
        // lspci does not report VRAM; use 0 as placeholder.
        gpus.push({
          vendor,
          name,
          totalVramMb: 0,
          freeVramMb: 0,
          driverVersion: null,
        });
      }
    }
    return gpus.length > 0 ? gpus : null;
  }
}

let _singleton: GpuDetector | null = null;

/** Returns a singleton GpuDetector instance. */
export function getGpuDetector(): GpuDetector {
  if (!_singleton) {
    _singleton = new GpuDetector();
  }
  return _singleton;
}
