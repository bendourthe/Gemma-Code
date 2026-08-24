/**
 * v2.1.0 Phase 5 -- who may see the fine-tuning pillar.
 *
 * Conservative gate from the plan: NVIDIA on every OS, AMD on Linux only,
 * 16 GB VRAM minimum. Intel, Vulkan, Apple, and AMD-on-Windows are hidden.
 */

export interface TrainingHost {
  readonly osFamily: "windows" | "macos" | "linux" | "unknown";
  readonly gpuVendor: "nvidia" | "amd" | "apple" | "intel" | "none" | string;
  readonly vramGB: number;
}

export interface TrainingGate {
  readonly supported: boolean;
  readonly reason: string;
}

export const MIN_TRAINING_VRAM_GB = 16;

export function evaluateTrainingHardware(host: TrainingHost): TrainingGate {
  if (host.vramGB < MIN_TRAINING_VRAM_GB) {
    return {
      supported: false,
      reason: `Fine-tuning needs at least ${MIN_TRAINING_VRAM_GB} GB VRAM (this host reports ${host.vramGB} GB).`,
    };
  }
  const vendor = host.gpuVendor.toLowerCase();
  if (vendor === "nvidia") {
    return { supported: true, reason: "NVIDIA GPU with enough VRAM." };
  }
  if (vendor === "amd" && host.osFamily === "linux") {
    return { supported: true, reason: "AMD GPU on Linux with enough VRAM." };
  }
  if (vendor === "amd") {
    return {
      supported: false,
      reason: "AMD fine-tuning is Linux-only in this cycle. Windows AMD hosts are hidden.",
    };
  }
  if (vendor === "apple") {
    return {
      supported: false,
      reason: "Apple / Metal training is not provisioned in this cycle.",
    };
  }
  return {
    supported: false,
    reason: `GPU vendor '${host.gpuVendor}' is not in the training allowlist (NVIDIA, or AMD on Linux).`,
  };
}
