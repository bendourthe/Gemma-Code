/**
 * v1.1.0 Phase 4.2 -- typed lifecycle event surface.
 *
 * `HookBus` is a typed pub/sub wrapper around `TelemetryBus` that emits
 * the 12 lifecycle events from the agentmemory comparison Section 6b.
 * Internal subscribers (Memory panel, audit CLI, trace replay) get
 * compile-time typed payloads; external trace consumers still see the
 * events because every emit is republished onto the underlying
 * `TelemetryBus` under the `lifecycle.*` kind family.
 *
 * Adopts agentmemory A5 (see comparison-agentmemory.md Section 11.2 P0).
 *
 * Design note: the `TelemetryBus.publish` payload is `unknown`-typed at
 * the bus boundary, so the HookBus's value-add is the closed
 * discriminated union plus the strongly typed `on(kind, handler)`
 * overloads. Callers that want the raw stream can keep subscribing
 * directly to the underlying TelemetryBus.
 */

import type { TelemetryBus, Disposable } from "../telemetry/TelemetryBus.js";

// ---------------------------------------------------------------------------
// Closed lifecycle event discriminated union.
// ---------------------------------------------------------------------------

export interface LifecycleSessionStartEvent {
  readonly kind: "lifecycle.session.start";
  readonly sessionId: string;
  readonly modelId: string;
  readonly isoTime: string;
}

export interface LifecycleSessionStopEvent {
  readonly kind: "lifecycle.session.stop";
  readonly sessionId: string;
  readonly isoTime: string;
  readonly durationMs: number;
}

export interface LifecycleSessionEndEvent {
  readonly kind: "lifecycle.session.end";
  readonly sessionId: string;
  readonly summary?: string;
}

export interface LifecycleUserPromptEvent {
  readonly kind: "lifecycle.user.prompt";
  readonly sessionId: string;
  readonly message: string;
  readonly isoTime: string;
}

export interface LifecycleToolPreEvent {
  readonly kind: "lifecycle.tool.pre";
  readonly sessionId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly parentSpanId?: string;
}

export interface LifecycleToolPostEvent {
  readonly kind: "lifecycle.tool.post";
  readonly sessionId: string;
  readonly toolName: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly parentSpanId?: string;
}

export interface LifecycleToolFailedEvent {
  readonly kind: "lifecycle.tool.failed";
  readonly sessionId: string;
  readonly toolName: string;
  readonly redactedError: string;
  readonly parentSpanId?: string;
}

export interface LifecycleSubagentStartEvent {
  readonly kind: "lifecycle.subagent.start";
  readonly sessionId: string;
  readonly role: string;
  readonly parentSpanId?: string;
}

export interface LifecycleSubagentStopEvent {
  readonly kind: "lifecycle.subagent.stop";
  readonly sessionId: string;
  readonly role: string;
  readonly ok: boolean;
  readonly parentSpanId?: string;
}

export interface LifecycleContextPreCompactEvent {
  readonly kind: "lifecycle.context.preCompact";
  readonly sessionId: string;
  readonly beforeTokens: number;
  readonly afterTokens: number;
}

export interface LifecycleNotificationEvent {
  readonly kind: "lifecycle.notification";
  readonly notificationKind: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
}

export interface LifecycleSkillEntryEvent {
  readonly kind: "lifecycle.skill.entry";
  readonly sessionId: string;
  readonly skillId: string;
  readonly namespace: string;
  readonly parentSpanId?: string;
}

export type LifecycleEvent =
  | LifecycleSessionStartEvent
  | LifecycleSessionStopEvent
  | LifecycleSessionEndEvent
  | LifecycleUserPromptEvent
  | LifecycleToolPreEvent
  | LifecycleToolPostEvent
  | LifecycleToolFailedEvent
  | LifecycleSubagentStartEvent
  | LifecycleSubagentStopEvent
  | LifecycleContextPreCompactEvent
  | LifecycleNotificationEvent
  | LifecycleSkillEntryEvent;

export type LifecycleEventKind = LifecycleEvent["kind"];

/** Map from event-kind string to the concrete event variant. */
export type LifecycleEventByKind = {
  "lifecycle.session.start": LifecycleSessionStartEvent;
  "lifecycle.session.stop": LifecycleSessionStopEvent;
  "lifecycle.session.end": LifecycleSessionEndEvent;
  "lifecycle.user.prompt": LifecycleUserPromptEvent;
  "lifecycle.tool.pre": LifecycleToolPreEvent;
  "lifecycle.tool.post": LifecycleToolPostEvent;
  "lifecycle.tool.failed": LifecycleToolFailedEvent;
  "lifecycle.subagent.start": LifecycleSubagentStartEvent;
  "lifecycle.subagent.stop": LifecycleSubagentStopEvent;
  "lifecycle.context.preCompact": LifecycleContextPreCompactEvent;
  "lifecycle.notification": LifecycleNotificationEvent;
  "lifecycle.skill.entry": LifecycleSkillEntryEvent;
};

// ---------------------------------------------------------------------------
// Bus.
// ---------------------------------------------------------------------------

export interface HookBus {
  emit(event: LifecycleEvent): void;
  on<K extends LifecycleEventKind>(
    kind: K,
    handler: (event: LifecycleEventByKind[K]) => void,
  ): Disposable;
  onAny(handler: (event: LifecycleEvent) => void): Disposable;
}

interface Subscription {
  kind: LifecycleEventKind | "*";
  handler: (event: LifecycleEvent) => void;
}

/**
 * Default `HookBus` implementation. Stores subscribers in a `Set` keyed
 * by reference identity so the returned `Disposable.dispose()` is O(1).
 * Every emit also re-publishes onto the supplied `TelemetryBus` so the
 * existing trace consumers see the lifecycle events without needing to
 * subscribe to the new bus.
 */
export class InProcessHookBus implements HookBus {
  private readonly _telemetry: TelemetryBus | null;
  private readonly _source: string;
  private readonly _subs = new Set<Subscription>();

  constructor(telemetry: TelemetryBus | null = null, source = "lifecycle") {
    this._telemetry = telemetry;
    this._source = source;
  }

  emit(event: LifecycleEvent): void {
    for (const sub of this._subs) {
      if (sub.kind !== "*" && sub.kind !== event.kind) continue;
      try {
        sub.handler(event);
      } catch {
        // A misbehaving subscriber must not take the bus down.
      }
    }

    if (this._telemetry) {
      // Re-publish onto TelemetryBus so trace-side consumers see the
      // lifecycle stream too. The kind is namespaced under `lifecycle.*`
      // so it co-exists with existing `model.*` / `job.*` events. We
      // cast through unknown because the TelemetryEventKind union does
      // not (yet) include the lifecycle namespace; subscribers reading
      // by name still see the events.
      try {
        this._telemetry.publish({
          kind: event.kind as unknown as Parameters<
            TelemetryBus["publish"]
          >[0]["kind"],
          source: this._source,
          payload: event,
        });
      } catch {
        // Telemetry republish failures are non-fatal -- HookBus
        // subscribers above have already received the event.
      }
    }
  }

  on<K extends LifecycleEventKind>(
    kind: K,
    handler: (event: LifecycleEventByKind[K]) => void,
  ): Disposable {
    const sub: Subscription = {
      kind,
      handler: handler as (event: LifecycleEvent) => void,
    };
    this._subs.add(sub);
    return { dispose: () => void this._subs.delete(sub) };
  }

  onAny(handler: (event: LifecycleEvent) => void): Disposable {
    const sub: Subscription = { kind: "*", handler };
    this._subs.add(sub);
    return { dispose: () => void this._subs.delete(sub) };
  }

  /** Test-only: introspect current subscriber count. */
  get subscriberCount(): number {
    return this._subs.size;
  }
}

/**
 * Convenience factory -- returns a fresh `InProcessHookBus` wired to the
 * supplied `TelemetryBus` so a single call site can build the pair
 * without importing both classes.
 */
export function createHookBus(telemetry: TelemetryBus | null = null): HookBus {
  return new InProcessHookBus(telemetry);
}
