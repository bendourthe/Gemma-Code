/**
 * v1.0.0 Phase 2.6 -- TelemetryBus stub.
 *
 * In-process publish/subscribe surface for telemetry events emitted by any
 * pillar. Phase 8 wires `nvidia-smi` polling, the GpuScheduler queue, and
 * the Local Model Status dashboard into this bus.
 *
 * Local-only: this bus never leaves the host. Nexus does not phone home.
 */

export type TelemetryEventKind =
  | "model.load.start"
  | "model.load.complete"
  | "model.unload"
  | "job.queued"
  | "job.started"
  | "job.completed"
  | "job.failed"
  | "gpu.sample"
  | "vram.sample"
  | "module.activated"
  | "module.deactivated"
  // v1.3.0 Phase 2 (adoption-skill-cleaner T006, insight I-07): emitted when
  // two logical skill paths resolve to the same physical path and one is
  // dropped during realpath dedup. Payload carries the kept + dropped paths.
  | "skills.dedup"
  // v1.16.0 Phase 2.1 (adoption item A2): emitted once per completed LLM
  // request. Payload is an `InferenceMetricRecord`
  // (core/observability/InferenceMetrics.ts): model, token counts, TTFT, wall
  // time, derived tokens/sec, and memory footprint. Stays on this in-process
  // bus like every other kind -- it never leaves the host.
  | "model.inference.complete"
  // v2.1.0 Phase 2 -- Switchyard-derived routing. Payload is a routing
  // decision snapshot (session, role, model, reason, signal counts).
  | "routing.decision"
  // v2.1.0 Phase 2 -- GPU scheduler honor/defer/degrade of a routing swap.
  | "scheduler.swap"
  // v2.1.0 Phase 6 -- signed audit log families (chat turns + tool calls).
  | "chat.turn"
  | "tool.call";

export interface TelemetryEvent<TPayload = unknown> {
  kind: TelemetryEventKind;
  /** Originating pillar / subsystem (e.g. `coding`, `image`, `gpu-scheduler`). */
  source: string;
  /** Wall-clock ISO timestamp captured by the bus. */
  ts: string;
  payload?: TPayload;
}

export interface EventFilter {
  /** Match these `kind`s. Omit for "any". */
  kinds?: ReadonlyArray<TelemetryEventKind>;
  /** Match this `source`. Omit for "any". */
  source?: string;
}

export interface Disposable {
  dispose(): void;
}

export interface TelemetryBus {
  publish<TPayload>(event: Omit<TelemetryEvent<TPayload>, "ts">): void;
  subscribe(
    filter: EventFilter,
    handler: (event: TelemetryEvent) => void,
  ): Disposable;
}

interface Subscription {
  filter: EventFilter;
  handler: (event: TelemetryEvent) => void;
}

export class InProcessTelemetryBus implements TelemetryBus {
  private readonly _subs = new Set<Subscription>();

  publish<TPayload>(event: Omit<TelemetryEvent<TPayload>, "ts">): void {
    const enriched: TelemetryEvent<TPayload> = {
      ...event,
      ts: new Date().toISOString(),
    };
    for (const sub of this._subs) {
      if (!matches(sub.filter, enriched)) continue;
      try {
        sub.handler(enriched as TelemetryEvent);
      } catch {
        // A misbehaving subscriber must not take the bus down.
      }
    }
  }

  subscribe(
    filter: EventFilter,
    handler: (event: TelemetryEvent) => void,
  ): Disposable {
    const sub: Subscription = { filter, handler };
    this._subs.add(sub);
    return {
      dispose: () => {
        this._subs.delete(sub);
      },
    };
  }

  /** Test-only: introspect current subscriber count. */
  get subscriberCount(): number {
    return this._subs.size;
  }
}

function matches(filter: EventFilter, event: TelemetryEvent): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.source && event.source !== filter.source) return false;
  return true;
}
