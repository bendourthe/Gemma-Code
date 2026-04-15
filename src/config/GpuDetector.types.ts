export type GpuVendor = "nvidia" | "amd" | "apple" | "intel" | "unknown";

export interface GpuInfo {
  readonly vendor: GpuVendor;
  readonly name: string;
  readonly totalVramMb: number;
  readonly freeVramMb: number;
  readonly driverVersion: string | null;
}

export interface DetectionResult {
  readonly gpus: readonly GpuInfo[];
  readonly primaryGpu: GpuInfo | null;
  readonly detectionMethod: string;
  readonly error: string | null;
}
