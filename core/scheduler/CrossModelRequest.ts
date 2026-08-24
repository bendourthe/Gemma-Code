/**
 * v2.2.0 Phase 4 (4.2) -- cross-model requests from an agentic session.
 *
 * An agentic task legitimately needs a different model mid-run: generate a UI
 * mockup with the image model, then keep coding with the coding model. On a
 * single GPU that means evicting and restoring, and the failure that matters
 * is ending the task with the WRONG model resident (or with a keep-alive hold
 * leaked), which silently degrades every following step.
 *
 * This orchestrator makes the restore unconditional. The hold on the agentic
 * model is taken before anything else and released in a `finally`, so an
 * abort, a swap failure, or a runtime crash all leave residency as it was.
 *
 * The user consented by starting the task, so no dialog is raised for a busy
 * job in their own module -- but consent never bypasses the VRAM checks in
 * `ModelSwitchPolicy`, which still defers when it cannot size a swap.
 *
 * Pure orchestration: ports are injected, so the whole thing is testable with
 * no GPU, no scheduler, and no model files.
 */

import {
  classifySwitch,
  isImmediate,
  type GpuModuleId,
  type ModelResidency,
  type SwitchRequest,
  type SwitchVerdict,
} from "./ModelSwitchPolicy.js";

/** Ref-counted keep-alive hold (structurally `ModelPinRegistry.holdForPanel`). */
export interface KeepAliveCoordinator {
  holdForPanel(models: readonly string[]): { release(): void };
}

export interface CrossModelPorts {
  /** Current GPU residency + free VRAM, read fresh at decision time. */
  readonly readResidency: () => Promise<{
    resident: readonly ModelResidency[];
    freeVramGB: number | null;
    activeJob: SwitchRequest["activeJob"];
  }>;
  /** True when the catalog says the model is installed. */
  readonly isInstalled: (modelId: string) => Promise<boolean>;
  /** VRAM estimate for a model id, in GB. */
  readonly vramFor: (modelId: string) => Promise<number>;
  /** Enqueue the actual work on the GpuScheduler and await its result. */
  readonly runJob: <T>(job: {
    moduleId: GpuModuleId;
    jobType: string;
    modelId: string;
    estimatedVramGB: number;
    signal?: AbortSignal;
    run: () => Promise<T>;
  }) => Promise<T>;
  readonly keepAlive: KeepAliveCoordinator;
  /** Progress for the coding Trace panel. */
  readonly onProgress?: (event: CrossModelProgress) => void;
}

export type CrossModelProgress =
  | { phase: "switching"; from: readonly string[]; to: string }
  | { phase: "running"; modelId: string }
  | { phase: "restoring"; modelId: string }
  | { phase: "done"; modelId: string }
  | { phase: "failed"; modelId: string; reason: string };

export class ModelNotInstalledError extends Error {
  readonly modelId: string;
  constructor(modelId: string) {
    super(
      `model-not-installed: ${modelId} is not installed. ` +
        "Install it in Settings > Models, then retry.",
    );
    this.name = "ModelNotInstalledError";
    this.modelId = modelId;
  }
}

export class CrossModelDeferredError extends Error {
  readonly modelId: string;
  constructor(modelId: string, reason: string) {
    super(`cross-model-deferred: ${modelId} could not be loaded: ${reason}`);
    this.name = "CrossModelDeferredError";
    this.modelId = modelId;
  }
}

export interface CrossModelRequestInput<T> {
  /** The model the agentic session is currently using. */
  readonly agenticModelId: string;
  /** The model the tool call needs. */
  readonly targetModelId: string;
  readonly requestingModule: GpuModuleId;
  readonly jobType: string;
  readonly run: () => Promise<T>;
  readonly signal?: AbortSignal;
}

export interface CrossModelOutcome<T> {
  readonly result: T;
  readonly verdict: SwitchVerdict;
  /** True when the agentic model stayed loaded throughout (co-residency). */
  readonly coResided: boolean;
}

/**
 * Run one cross-model step, restoring the agentic model afterward.
 *
 * Throws `ModelNotInstalledError` (nothing enqueued) or
 * `CrossModelDeferredError` (policy refused) so the agent can report the
 * reason in-context rather than failing opaquely.
 */
export async function runCrossModelRequest<T>(
  input: CrossModelRequestInput<T>,
  ports: CrossModelPorts,
): Promise<CrossModelOutcome<T>> {
  const { targetModelId, agenticModelId, requestingModule, jobType } = input;
  const progress = ports.onProgress ?? (() => undefined);

  if (!(await ports.isInstalled(targetModelId))) {
    // Typed and thrown BEFORE any hold or queue entry, so a bad tool call
    // leaves no scheduler state behind.
    throw new ModelNotInstalledError(targetModelId);
  }

  const [{ resident, freeVramGB, activeJob }, targetVramGB] = await Promise.all([
    ports.readResidency(),
    ports.vramFor(targetModelId),
  ]);

  const verdict = classifySwitch({
    targetModelId,
    targetVramGB,
    requestingModule,
    resident,
    freeVramGB,
    activeJob: activeJob ?? null,
    installed: true,
    // The user started this task; do not interrupt them with a dialog.
    userAlreadyConsented: true,
  });

  if (!isImmediate(verdict)) {
    const reason =
      verdict.kind === "defer"
        ? verdict.reason
        : verdict.kind === "confirm"
          ? `needs confirmation (${verdict.reason})`
          : verdict.kind;
    progress({ phase: "failed", modelId: targetModelId, reason });
    throw new CrossModelDeferredError(targetModelId, reason);
  }

  const coResided = verdict.kind === "coreside" || verdict.kind === "resident";

  // Hold the agentic model BEFORE the swap. Released in `finally`, so every
  // exit path -- success, swap failure, abort -- restores residency.
  const hold = ports.keepAlive.holdForPanel([agenticModelId]);
  try {
    if (verdict.kind === "auto-switch") {
      progress({ phase: "switching", from: verdict.evicting, to: targetModelId });
    }
    progress({ phase: "running", modelId: targetModelId });

    const result = await ports.runJob({
      moduleId: requestingModule,
      jobType,
      modelId: targetModelId,
      estimatedVramGB: targetVramGB,
      ...(input.signal ? { signal: input.signal } : {}),
      run: input.run,
    });

    progress({ phase: "done", modelId: targetModelId });
    return { result, verdict, coResided };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    progress({ phase: "failed", modelId: targetModelId, reason });
    throw err;
  } finally {
    progress({ phase: "restoring", modelId: agenticModelId });
    hold.release();
  }
}
