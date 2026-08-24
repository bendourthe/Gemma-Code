/**
 * v2.1.0 Phase 2 -- routing lane for the Traces dashboard.
 *
 * Per-step model attribution, escalation markers with reason tooltips, and
 * per-session swap counts. Empty when routing is off or the session predates
 * this phase. An uninstalled model degrades to the id string.
 */

export interface RoutingLaneDecision {
  readonly turn: number;
  readonly role: string;
  readonly modelId: string;
  readonly action: string;
  readonly reason: string;
  readonly previousModelId?: string;
  readonly notice?: string;
  /** False when the catalog no longer lists this model. */
  readonly modelInstalled?: boolean;
}

export interface RoutingLaneProps {
  readonly decisions: readonly RoutingLaneDecision[];
  readonly swapCount?: number;
}

/**
 * Project scheduler/model trace payloads into routing-lane rows.
 * Old sessions without a `routing.decision` payload yield an empty list
 * (empty state), never an error.
 */
export function routingDecisionsFromTrace(
  events: readonly {
    readonly payload?: Readonly<Record<string, unknown>>;
  }[],
): RoutingLaneDecision[] {
  const out: RoutingLaneDecision[] = [];
  for (const event of events) {
    const payload = event.payload;
    if (!payload || payload.kind !== "routing.decision") continue;
    const modelId = typeof payload.modelId === "string" ? payload.modelId : "";
    if (!modelId) continue;
    const turn = typeof payload.turn === "number" && Number.isFinite(payload.turn) ? payload.turn : 0;
    out.push({
      turn,
      role: typeof payload.role === "string" ? payload.role : "worker",
      modelId,
      action: typeof payload.action === "string" ? payload.action : "hold",
      reason: typeof payload.reason === "string" ? payload.reason : "",
      previousModelId:
        typeof payload.previousModelId === "string" ? payload.previousModelId : undefined,
      notice: typeof payload.notice === "string" ? payload.notice : undefined,
      modelInstalled: payload.modelInstalled === false ? false : true,
    });
  }
  return out;
}

export function RoutingLane({ decisions, swapCount }: RoutingLaneProps): JSX.Element {
  const swaps =
    swapCount ??
    decisions.filter((d) => d.modelId !== d.previousModelId && d.previousModelId).length;

  return (
    <section
      data-testid="trace-routing-lane"
      aria-label="Adaptive model routing"
      style={{ marginBottom: "var(--space-3)" }}
    >
      <header style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>
        Routing
        <span data-testid="trace-routing-swap-count" style={{ marginLeft: "var(--space-2)", fontWeight: 400, color: "var(--fg-muted)" }}>
          {swaps} swap{swaps === 1 ? "" : "s"}
        </span>
      </header>
      {decisions.length === 0 ? (
        <p data-testid="trace-routing-empty" style={{ color: "var(--fg-muted)" }}>
          No routing decisions in this session.
        </p>
      ) : (
        <ol data-testid="trace-routing-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {decisions.map((d) => {
            const label = d.modelInstalled === false ? d.modelId : d.modelId;
            const escalated = d.action === "escalate" || d.action === "de-escalate";
            return (
              <li
                key={`${d.turn}-${d.role}-${d.action}`}
                data-testid={`trace-routing-step-${d.turn}`}
                title={d.reason}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.8rem",
                  padding: "var(--space-1) 0",
                  borderBottom: "1px solid var(--border-1)",
                }}
              >
                <span data-testid={`trace-routing-model-${d.turn}`}>{label}</span>
                {d.modelInstalled === false ? (
                  <span data-testid={`trace-routing-uninstalled-${d.turn}`} title="Model is no longer installed">
                    {" "}
                    (uninstalled)
                  </span>
                ) : null}
                {" "}
                <span style={{ color: "var(--fg-muted)" }}>
                  t{d.turn} {d.role} {d.action}
                </span>
                {escalated ? (
                  <span data-testid={`trace-routing-escalation-${d.turn}`} title={d.reason}>
                    {" "}
                    *
                  </span>
                ) : null}
                {d.notice ? (
                  <span data-testid={`trace-routing-notice-${d.turn}`} style={{ color: "var(--fg-muted)" }}>
                    {" "}
                    {d.notice}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
