/**
 * v2.2.0 Phase 4 (4.1) -- single-GPU model-switch policy.
 *
 * The decision layer between "the user did something that needs a model" and
 * the GpuScheduler. It exists because a consumer GPU holds one model at a
 * time, and the two obvious designs are both wrong:
 *
 *   - Switch silently whenever a surface asks. A stray click on Image Studio
 *     then evicts the model an agentic task is mid-way through using.
 *   - Ask every time. Every cross-modality step turns into a dialog, which
 *     makes agentic automation unusable.
 *
 * So the policy classifies each request instead. Tab navigation never reaches
 * here at all (see `assertNoLoadOnNavigation` and its test): only an actual
 * submit or an agentic tool call does.
 *
 * Pure and dependency-light, like `modelSwap.ts` beside it: no scheduler
 * reference, no telemetry bus, no I/O. Callers feed it a snapshot and act on
 * the verdict, which makes the whole decision matrix unit-testable.
 *
 * Boundary: core/** (no modules/**).
 */

import { evaluateModelSwap, type ModelSwapDecision } from "./modelSwap.js";

export type GpuModuleId = "coding" | "chat" | "image" | "video" | "tuning";

/**
 * Headroom required ON TOP of both models' VRAM before we co-reside them.
 * Loading two models to the exact byte leaves nothing for activations and
 * KV cache, which is how a "successful" co-residency OOMs mid-generation.
 */
export const CORESIDE_HEADROOM_GB = 2;

export type SwitchVerdict =
  /** The requested model is already loaded: proceed with no GPU work. */
  | { kind: "resident"; modelId: string }
  /** Both models fit with headroom: load alongside, no eviction, no dialog. */
  | { kind: "coreside"; modelId: string; withResident: readonly string[]; freeAfterGB: number }
  /** GPU is idle (or only this module is active): swap without asking. */
  | { kind: "auto-switch"; modelId: string; evicting: readonly string[] }
  /** Another module is busy, or we cannot see VRAM: the user decides. */
  | { kind: "confirm"; modelId: string; busyWith: BusyContext | null; reason: ConfirmReason }
  /** Cannot proceed and must not ask (nothing the user could usefully decide). */
  | { kind: "defer"; modelId: string; reason: string }
  /** The requested model is not installed. Never enqueue this. */
  | { kind: "not-installed"; modelId: string };

export interface BusyContext {
  readonly moduleId: GpuModuleId;
  readonly jobType: string;
  readonly modelId?: string;
}

export type ConfirmReason =
  /** An active job from another module would be evicted. */
  | "other-module-busy"
  /** Free VRAM is unknown, so a fit cannot be computed honestly. */
  | "vram-unknown";

export interface ModelResidency {
  readonly modelId: string;
  readonly vramGB: number;
}

export interface SwitchRequest {
  readonly targetModelId: string;
  readonly targetVramGB: number;
  readonly requestingModule: GpuModuleId;
  /** Models currently believed loaded on the GPU. */
  readonly resident: readonly ModelResidency[];
  /** Free VRAM in GB; null when telemetry is unavailable. */
  readonly freeVramGB: number | null;
  /** The scheduler's active job, if any. */
  readonly activeJob?: BusyContext | null;
  /** True when the catalog says this model is installed. */
  readonly installed: boolean;
  /**
   * Modality pairs the user chose to stop being asked about this session.
   * Keys come from `rememberKey()`.
   */
  readonly rememberedPairs?: ReadonlySet<string>;
  /**
   * Agentic tool calls set this: the user already consented by running the
   * task, so a busy job in the SAME module never raises a dialog. It does not
   * bypass the VRAM checks.
   */
  readonly userAlreadyConsented?: boolean;
}

/**
 * Stable key for the "remember for this session" set. Keyed by the module
 * PAIR plus the target model, so consenting to "coding -> image with
 * sana-1.6b-2k" does not silently consent to evicting something else later.
 */
export function rememberKey(
  requestingModule: GpuModuleId,
  busyModule: GpuModuleId | null,
  targetModelId: string,
): string {
  return `${busyModule ?? "idle"}->${requestingModule}:${targetModelId}`;
}

function totalResidentVram(resident: readonly ModelResidency[]): number {
  return resident.reduce((sum, r) => sum + Math.max(0, r.vramGB), 0);
}

/**
 * Classify one model request. Deterministic and side-effect free: the same
 * inputs always yield the same verdict, which is what makes the confirm-time
 * re-classification safe (see `reclassifyOnConfirm`).
 */
export function classifySwitch(request: SwitchRequest): SwitchVerdict {
  const {
    targetModelId,
    requestingModule,
    resident,
    freeVramGB,
    activeJob,
    installed,
  } = request;

  if (!installed) {
    return { kind: "not-installed", modelId: targetModelId };
  }

  // Already loaded: nothing to decide. Checked before everything else so a
  // busy GPU never blocks a request for the model that is already there.
  if (resident.some((r) => r.modelId === targetModelId)) {
    return { kind: "resident", modelId: targetModelId };
  }

  // Nothing is loaded, so nothing can be evicted. The confirm dialog exists to
  // protect an INCUMBENT model; with no incumbent there is nothing to warn
  // about, and asking anyway would gate every first generation on a dialog --
  // including on hosts where VRAM telemetry is simply unavailable. The
  // scheduler's own VRAM gate still refuses a model that cannot fit.
  if (resident.length === 0) {
    return { kind: "auto-switch", modelId: targetModelId, evicting: [] };
  }

  const busyOtherModule =
    activeJob != null && activeJob.moduleId !== requestingModule ? activeJob : null;

  // The user consented when they started the agentic task, so a busy job in
  // the same module is not a reason to interrupt them with a dialog.
  const remembered = request.rememberedPairs ?? new Set<string>();
  const consentKey = rememberKey(
    requestingModule,
    busyOtherModule?.moduleId ?? null,
    targetModelId,
  );
  const preConsented = request.userAlreadyConsented === true || remembered.has(consentKey);

  // Unknown VRAM: we cannot compute a fit, and guessing is how a machine
  // OOMs. Ask rather than defer indefinitely -- the user can see their own
  // machine. Pre-consent does not waive this: consenting to a swap is not
  // consenting to a swap we cannot size.
  if (freeVramGB === null || !Number.isFinite(freeVramGB)) {
    if (busyOtherModule || !preConsented) {
      return {
        kind: "confirm",
        modelId: targetModelId,
        busyWith: busyOtherModule,
        reason: "vram-unknown",
      };
    }
    // Pre-consented and nothing else is running: defer to the swap cost model,
    // which refuses to guess a fit and reports why.
    const decision = evaluateModelSwap({
      fromVramGB: totalResidentVram(resident),
      toVramGB: request.targetVramGB,
      freeVramGB: null,
    });
    return { kind: "defer", modelId: targetModelId, reason: decision.reason };
  }

  // Both fit with real headroom: keep the incumbent loaded. This is the path
  // that makes cross-modality work feel instant instead of asking.
  const freeAfter = freeVramGB - Math.max(0, request.targetVramGB);
  if (freeAfter >= CORESIDE_HEADROOM_GB) {
    return {
      kind: "coreside",
      modelId: targetModelId,
      withResident: resident.map((r) => r.modelId),
      freeAfterGB: Number(freeAfter.toFixed(2)),
    };
  }

  // They do not both fit: something must be evicted.
  if (busyOtherModule && !preConsented) {
    return {
      kind: "confirm",
      modelId: targetModelId,
      busyWith: busyOtherModule,
      reason: "other-module-busy",
    };
  }

  return {
    kind: "auto-switch",
    modelId: targetModelId,
    evicting: resident.map((r) => r.modelId),
  };
}

/**
 * Re-run the classification when the user answers a confirm dialog.
 *
 * The job that caused the dialog may have finished while the dialog sat on
 * screen. Acting on the ORIGINAL verdict would evict a model the user was
 * warned about but which is no longer in use, so the answer is applied to a
 * freshly-computed verdict instead.
 */
export function reclassifyOnConfirm(request: SwitchRequest): SwitchVerdict {
  return classifySwitch({ ...request, userAlreadyConsented: true });
}

/** Evaluate the underlying swap cost model for an honored verdict. */
export function swapPlanFor(request: SwitchRequest): ModelSwapDecision {
  return evaluateModelSwap({
    fromVramGB: totalResidentVram(request.resident),
    toVramGB: request.targetVramGB,
    freeVramGB: request.freeVramGB,
    ...(request.activeJob ? { activeModule: request.activeJob.moduleId } : {}),
    diffusionActive:
      request.activeJob?.moduleId === "image" || request.activeJob?.moduleId === "video",
  });
}

/** True when a verdict means "go ahead now" (no user input needed). */
export function isImmediate(verdict: SwitchVerdict): boolean {
  return verdict.kind === "resident" || verdict.kind === "coreside" || verdict.kind === "auto-switch";
}

/**
 * Guard for the invariant that navigation never loads a model.
 *
 * A route mount must never reach the policy: the studios list models, they do
 * not load them, and `setForegroundModule` is a scheduling hint only. Calling
 * this from a navigation path throws loudly in development rather than
 * silently evicting whatever the user was running.
 */
export function assertNoLoadOnNavigation(context: "navigation" | "submit" | "agent-tool"): void {
  if (context === "navigation") {
    throw new Error(
      "ModelSwitchPolicy: navigation must never request a model load " +
        "(tab clicks are not a reason to change GPU residency)",
    );
  }
}

/** Telemetry payload emitted for every decision, for the trace panel. */
export interface SwitchDecisionEvent {
  readonly kind: SwitchVerdict["kind"];
  readonly targetModelId: string;
  readonly requestingModule: GpuModuleId;
  readonly busyModule: GpuModuleId | null;
  readonly freeVramGB: number | null;
  readonly at: number;
}

export function toDecisionEvent(
  request: SwitchRequest,
  verdict: SwitchVerdict,
  now: number,
): SwitchDecisionEvent {
  return {
    kind: verdict.kind,
    targetModelId: request.targetModelId,
    requestingModule: request.requestingModule,
    busyModule: request.activeJob?.moduleId ?? null,
    freeVramGB: request.freeVramGB,
    at: now,
  };
}
