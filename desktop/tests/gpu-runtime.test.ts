import { describe, expect, it, vi } from "vitest";

import {
  WINDOWS_NVIDIA_SMI,
  queryHostGpu,
} from "../sidecar/src/telemetry/gpuRuntime";

describe("queryHostGpu", () => {
  it("falls back to System32 nvidia-smi when PATH has no nvidia-smi", async () => {
    const exec = vi.fn(async (command: string) => {
      if (command === "nvidia-smi") return null;
      if (command === WINDOWS_NVIDIA_SMI) {
        return "12, 16384, 8000, NVIDIA GeForce RTX 3080 Ti Laptop GPU";
      }
      return null;
    });
    const result = await queryHostGpu(exec, "win32");
    expect(exec).toHaveBeenCalledWith("nvidia-smi", expect.any(Array));
    expect(exec).toHaveBeenCalledWith(WINDOWS_NVIDIA_SMI, expect.any(Array));
    expect(result?.device).toBe("cuda");
    expect(result?.deviceName).toContain("3080 Ti");
  });
});
