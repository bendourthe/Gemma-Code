import type { PostMessageFn } from "../chat/StreamingPipeline.js";
import type { SubAgentConfig, SubAgentResult } from "./types.js";

/**
 * v1.6.0 Phase 4 (A2) -- optional trace context threaded into a sub-agent run
 * so the swarm orchestrator can correlate sub-runs into one nested trace.
 *
 * All fields are optional; when omitted the sub-agent starts a fresh,
 * standalone trace exactly as before (the ReAct-path callers pass nothing).
 */
export interface SubAgentTraceContext {
  /** Join this existing trace instead of starting a fresh one. */
  readonly parentTraceId?: string;
  /** Within-trace span-tree parent for the sub-agent's root span. */
  readonly parentSpanId?: string;
  /** Swarm-dispatch group id shared by every sub-run of one `execute()`. */
  readonly groupId?: string | null;
  /** The parent run id (e.g. the planner run) for run-tree nesting. */
  readonly parentRunId?: string | null;
}

/**
 * Vendor-neutral seam between `AgentLoop` (which spawns verification and
 * research sub-agents) and the concrete `SubAgentManager` that knows how to
 * build them.
 *
 * Phase 4 (v0.6.0) sub-task 4.6: AgentLoop now imports only this interface,
 * not `SubAgentManager` itself. The runtime cycle
 *   `AgentLoop -> SubAgentManager -> AgentLoop`
 * collapses to a one-way edge: `SubAgentManager` may still import
 * `AgentLoop` to drive each spawned loop, but the reverse edge is mediated
 * by this port.
 */
export interface SubAgentSpawner {
  run(
    config: SubAgentConfig,
    postMessage: PostMessageFn,
    trace?: SubAgentTraceContext,
  ): Promise<SubAgentResult>;
}
