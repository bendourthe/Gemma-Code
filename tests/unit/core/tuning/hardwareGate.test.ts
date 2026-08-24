import { describe, expect, it } from "vitest";

import { evaluateTrainingHardware } from "../../../../core/tuning/hardwareGate.js";

describe("evaluateTrainingHardware", () => {
  it("allows NVIDIA at 16 GB on any OS", () => {
    expect(
      evaluateTrainingHardware({ osFamily: "windows", gpuVendor: "nvidia", vramGB: 16 }).supported,
    ).toBe(true);
  });

  it("allows AMD only on Linux and hides the rest", () => {
    expect(
      evaluateTrainingHardware({ osFamily: "linux", gpuVendor: "amd", vramGB: 24 }).supported,
    ).toBe(true);
    expect(
      evaluateTrainingHardware({ osFamily: "windows", gpuVendor: "amd", vramGB: 24 }).supported,
    ).toBe(false);
    expect(
      evaluateTrainingHardware({ osFamily: "macos", gpuVendor: "apple", vramGB: 32 }).supported,
    ).toBe(false);
    expect(
      evaluateTrainingHardware({ osFamily: "linux", gpuVendor: "intel", vramGB: 24 }).supported,
    ).toBe(false);
    expect(
      evaluateTrainingHardware({ osFamily: "linux", gpuVendor: "nvidia", vramGB: 8 }).supported,
    ).toBe(false);
  });
});
