import type { PostMessageFn } from "../chat/StreamingPipeline.js";
import type { SubAgentConfig, SubAgentResult } from "./types.js";

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
    parentTraceId?: string,
    parentSpanId?: string,
  ): Promise<SubAgentResult>;
}
