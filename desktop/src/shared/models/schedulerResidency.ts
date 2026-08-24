import type {
  BusyContext,
  ModelResidency,
} from "../../../../core/scheduler/ModelSwitchPolicy";
import type {
  GenerationSchedulerActiveJobT,
  GenerationSchedulerSnapshotResponseT,
} from "../../../sidecar/src/protocol";
import { ipcCall } from "../../lib/ipc";

export type SchedulerActiveJob = GenerationSchedulerActiveJobT;
export type ResidencySessionMemory = Set<string>;

export async function fetchSchedulerSnapshot(): Promise<GenerationSchedulerSnapshotResponseT | null> {
  const reply = await ipcCall<GenerationSchedulerSnapshotResponseT>(
    "generation.scheduler.snapshot",
    {},
  );
  return reply.ok ? reply.value : null;
}

export function busyContextFromScheduler(
  active: SchedulerActiveJob | null | undefined,
): BusyContext | null {
  if (!active) return null;
  return {
    moduleId: active.moduleId,
    jobType: active.jobType,
    ...(active.modelId ? { modelId: active.modelId } : {}),
  };
}

export function residentModelsFromScheduler(
  active: SchedulerActiveJob | null | undefined,
): readonly ModelResidency[] {
  if (!active) return [];
  return [
    {
      modelId: active.modelId ?? `__active-${active.moduleId}-model__`,
      vramGB: active.estimatedVramGB,
    },
  ];
}

/** Missing catalog sizing must never become a false zero-cost co-residency. */
export function modelVramEstimate(vramGB: number | undefined): number {
  return typeof vramGB === "number" && Number.isFinite(vramGB) && vramGB >= 0
    ? vramGB
    : Number.POSITIVE_INFINITY;
}
