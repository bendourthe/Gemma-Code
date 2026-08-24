/**
 * v2.1.0 Phase 2 -- compose EscalationPolicy with the GPU swap gate.
 */

import type { GpuScheduler } from "../../../../core/scheduler/GpuScheduler.js";
import { unloadOllamaModel } from "../../llm/ollamaUnload.js";
import { EscalationPolicy, type RoutingDecision, type RoutingModels } from "./EscalationPolicy.js";
import type { RoutingRole, RoutingTurnEvent } from "./RoutingSignals.js";

export interface RouteTurnInput {
  readonly sessionId: string;
  readonly turn: number;
  readonly role: RoutingRole;
  readonly events: readonly RoutingTurnEvent[];
  readonly models: RoutingModels;
  readonly vramFor: (modelId: string) => number;
  readonly workerResident?: boolean;
  /** Tests inject a spy; production unloads via Ollama `keep_alive: 0`. */
  readonly onEvictWorker?: (modelId: string) => void;
}

export function routeTurn(
  policy: EscalationPolicy,
  input: RouteTurnInput,
  scheduler?: Pick<GpuScheduler, "evaluateRoutingSwap">,
): RoutingDecision {
  const intent = policy.decide(input);
  if (intent.modelId === intent.previousModelId) {
    return policy.acknowledge(intent);
  }
  // DEVIATION: without a scheduler, treat the swap as honored rather than
  // passing Infinity VRAM into evaluateModelSwap (finiteGb treats Infinity
  // as unavailable and would always defer). Unit tests and DAG hosts that
  // have not constructed GpuScheduler still see policy-only decisions.
  const swap = scheduler
    ? scheduler.evaluateRoutingSwap({
        sessionId: input.sessionId,
        fromModelId: intent.previousModelId,
        toModelId: intent.modelId,
        fromVramGB: input.vramFor(intent.previousModelId),
        toVramGB: input.vramFor(intent.modelId),
        workerResident: input.workerResident,
      })
    : { outcome: "honored" as const, reason: "no-scheduler", keepWorkerResident: true };
  const gated = policy.applySwapGate(intent, swap);
  if (
    gated.swapOutcome === "honored" &&
    swap.keepWorkerResident === false &&
    gated.modelId !== gated.previousModelId
  ) {
    if (input.onEvictWorker) {
      input.onEvictWorker(gated.previousModelId);
    } else {
      void unloadOllamaModel({ model: gated.previousModelId });
    }
  }
  return gated;
}
