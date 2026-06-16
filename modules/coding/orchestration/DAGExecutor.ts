/**
 * DAGExecutor -- Walks a TaskDAG, dispatches ready nodes to sub-agents
 * (respecting GPU-tier concurrency limits), and handles failures.
 *
 * Uses a simple Promise-based semaphore for concurrency control.
 */

import type { SubAgentManager } from "../agents/SubAgentManager.js";
import type { SubAgentConfig, SubAgentType } from "../agents/types.js";
import type { HardwareTierConfig } from "../config/HardwareTier.types.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";
import type { TaskDAG, TaskNode, TaskNodeType } from "./TaskDAG.js";
import type { Reflection } from "./ReflexionEngine.js";
import type { CriticReviewer } from "./CriticAgent.js";
import type { Tracer } from "../observability/Tracer.js";
import { formatForUser } from "../utils/errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PostMessageFn = (message: ExtensionToWebviewMessage) => void;

export interface DAGExecutionResult {
  readonly dag: TaskDAG;
  readonly totalTimeMs: number;
  readonly nodesCompleted: number;
  readonly nodesFailed: number;
  readonly nodesSkipped: number;
}

/**
 * v1.6.0 Phase 4 (A2) -- the swarm trace context the Orchestrator threads in so
 * every worker (and its critic) records into one shared trace, nested under the
 * planner run. Built only when tracing is enabled; absent on the default path.
 */
export interface SwarmTraceContext {
  /** Shared tracer instance (the same one the SubAgentManager uses). */
  readonly tracer: Tracer;
  /** The trace every sub-run of this dispatch joins. */
  readonly traceId: string;
  /** Group id shared by every sub-run of this `execute()`. */
  readonly groupId: string;
  /** The planner run id -- workers nest directly under it. */
  readonly plannerRunId: string;
}

/**
 * v1.5.0 Phase 4 -- opt-in swarm-orchestration knobs (default off so the
 * legacy single-workspace, critic-less behavior is byte-equivalent when no
 * options are supplied).
 */
export interface DAGExecutorOptions {
  /**
   * T010 (closes v1.4.0 `T018.P3.A`): when true, write-capable nodes are
   * dispatched with `isolate: true` so each runs in its own git worktree and
   * concurrently-dispatched writers cannot collide on the shared working tree.
   * Read-only nodes are never isolated (no collision surface, no git cost).
   */
  readonly isolateWrites?: boolean;
  /**
   * T011 (closes the team-orchestration half of v1.4.0 `T018.P3.B`): when set,
   * a critic reviews each worker's output before the node is accepted. A
   * rejected node is routed through the existing reflexion + retry path.
   */
  readonly critic?: CriticReviewer;
  /**
   * v1.6.0 Phase 4 (A2): when set, each worker run is stamped with the swarm
   * group + planner run, and a critic review emits a `critic` span nested under
   * the worker run it reviews. Absent -> sub-runs trace standalone as before.
   */
  readonly swarmTrace?: SwarmTraceContext;
}

// ---------------------------------------------------------------------------
// Semaphore
// ---------------------------------------------------------------------------

class Semaphore {
  private _current = 0;
  private readonly _queue: Array<() => void> = [];

  constructor(private readonly _max: number) {}

  async acquire(): Promise<void> {
    if (this._current < this._max) {
      this._current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this._queue.push(resolve);
    });
  }

  release(): void {
    this._current--;
    const next = this._queue.shift();
    if (next) {
      this._current++;
      next();
    }
  }
}

// ---------------------------------------------------------------------------
// Node type mapping
// ---------------------------------------------------------------------------

const NODE_TYPE_TO_AGENT_TYPE: Record<TaskNodeType, SubAgentType> = {
  research: "research",
  code: "planning",
  test: "verification",
  verify: "verification",
};

/**
 * Agent types whose tool scope includes `run_terminal` -- the sole
 * file-mutation surface across every sub-agent scope per ADR-0004 (research /
 * planning are read-only). Only these need worktree isolation; isolating a
 * read-only agent would add git overhead with no collision to prevent.
 */
const WRITE_CAPABLE_AGENT_TYPES: ReadonlySet<SubAgentType> = new Set<SubAgentType>([
  "verification",
]);

// ---------------------------------------------------------------------------
// ReflexionEngine interface (optional dependency)
// ---------------------------------------------------------------------------

export interface ReflexionEngineInterface {
  reflect(
    failedTask: TaskNode,
    error: string,
    context: string,
  ): Promise<Reflection>;
  storeReflection(reflection: Reflection, sessionId?: string): Promise<void>;
  buildRetryContext(reflections: Reflection[]): string;
}

// ---------------------------------------------------------------------------
// DAGExecutor
// ---------------------------------------------------------------------------

export class DAGExecutor {
  private readonly _reflections = new Map<string, Reflection[]>();

  private readonly _isolateWrites: boolean;
  private readonly _critic: CriticReviewer | null;
  private readonly _swarmTrace: SwarmTraceContext | null;

  constructor(
    private readonly _subAgentManager: SubAgentManager,
    private readonly _profile: HardwareTierConfig,
    private readonly _postMessage: PostMessageFn,
    private readonly _reflexionEngine?: ReflexionEngineInterface,
    private readonly _sessionId?: string,
    options: DAGExecutorOptions = {},
  ) {
    this._isolateWrites = options.isolateWrites === true;
    this._critic = options.critic ?? null;
    this._swarmTrace = options.swarmTrace ?? null;
  }

  async execute(dag: TaskDAG): Promise<DAGExecutionResult> {
    const startTime = Date.now();
    const semaphore = new Semaphore(this._profile.maxConcurrentSubAgents);
    const running = new Map<string, Promise<void>>();

    while (!dag.isComplete()) {
      const readyNodes = dag.getReadyNodes();

      // Deadlock detection: no ready nodes and nothing running.
      if (readyNodes.length === 0 && running.size === 0) {
        break;
      }

      // If nothing is ready but tasks are running, wait for one to finish.
      if (readyNodes.length === 0 && running.size > 0) {
        await Promise.race(Array.from(running.values()));
        continue;
      }

      // Launch ready nodes up to the concurrency limit.
      for (const node of readyNodes) {
        await semaphore.acquire();
        dag.markRunning(node.id);

        const task = this._executeNode(node, dag)
          .finally(() => {
            semaphore.release();
            running.delete(node.id);
          });

        running.set(node.id, task);
      }

      // Wait for at least one task to complete before checking for new ready nodes.
      if (running.size > 0) {
        await Promise.race(Array.from(running.values()));
      }
    }

    // Wait for any still-running tasks to finish.
    if (running.size > 0) {
      await Promise.all(Array.from(running.values()));
    }

    const progress = dag.getProgress();
    return {
      dag,
      totalTimeMs: Date.now() - startTime,
      nodesCompleted: progress.completed,
      nodesFailed: progress.failed,
      nodesSkipped: progress.skipped,
    };
  }

  getReflections(): ReadonlyMap<string, readonly Reflection[]> {
    return this._reflections;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async _executeNode(node: TaskNode, dag: TaskDAG): Promise<void> {
    const agentType = NODE_TYPE_TO_AGENT_TYPE[node.type];

    // Build memory context from prior reflections if retrying.
    let memoryContext: string | undefined;
    if (this._reflexionEngine && node.retryCount > 0) {
      const nodeReflections = this._reflections.get(node.id);
      if (nodeReflections && nodeReflections.length > 0) {
        memoryContext = this._reflexionEngine.buildRetryContext(nodeReflections);
      }
    }

    // T010: write-capable nodes run in an isolated worktree when isolation is
    // enabled, so concurrently-dispatched writers cannot collide. The flag is
    // inert unless a WorktreeManager is wired into the SubAgentManager and the
    // workspace is a git repo (SubAgentManager degrades gracefully otherwise).
    const isolate =
      this._isolateWrites && WRITE_CAPABLE_AGENT_TYPES.has(agentType);

    const config: SubAgentConfig = {
      type: agentType,
      maxIterations: this._profile.subAgentMaxIterations,
      userRequest: `${node.title}: ${node.description}`,
      modifiedFiles: [],
      recentToolResults: [],
      memoryContext,
      ...(isolate ? { isolate: true } : {}),
    };

    // v1.6.0 Phase 4 (A2): stamp this worker run with the swarm group + planner
    // run so it nests under the planner in the trace. Undefined on the default
    // path keeps the sub-agent's standalone-trace behavior unchanged.
    const swarm = this._swarmTrace;
    const trace = swarm
      ? {
          parentTraceId: swarm.traceId,
          parentSpanId: swarm.plannerRunId,
          groupId: swarm.groupId,
          parentRunId: swarm.plannerRunId,
        }
      : undefined;

    try {
      const result = await this._subAgentManager.run(config, this._postMessage, trace);

      if (!result.success) {
        await this._handleNodeFailure(node, dag, result.error ?? "Sub-agent reported failure");
        this._postProgress(dag);
        return;
      }

      // T011: the critic gates merge. A worker that succeeded mechanically may
      // still have produced output that does not satisfy the task; the critic
      // reviews it before the node is accepted. A rejection is routed through
      // the same reflexion + retry path as a failure, with the critic feedback
      // as the context, so the worker can correct on retry. A critic that
      // errors fails open (the worker already succeeded; the critic must not
      // block legitimate work).
      if (this._critic) {
        let approved = true;
        let feedback = "";
        // v1.6.0 Phase 4 (A2): record the critic review as a `critic` span
        // nested under the worker run it reviews, so planner -> worker ->
        // critic is legible in the dashboard / export. Only when the swarm
        // trace is wired and the worker reported its run id.
        const criticSpanId =
          swarm && result.runId
            ? swarm.tracer.startSpan(
                swarm.traceId,
                `critic_${node.id}`,
                "critic",
                result.runId,
                { nodeId: node.id },
                { groupId: swarm.groupId, parentRunId: result.runId },
              )
            : "";
        try {
          const verdict = await this._critic.review(node, result.output);
          approved = verdict.approved;
          feedback = verdict.feedback;
        } catch {
          approved = true;
        }
        if (criticSpanId) {
          swarm!.tracer.endSpan(criticSpanId, approved ? "ok" : "error", { approved });
        }
        if (!approved) {
          await this._handleNodeFailure(
            node,
            dag,
            `Critic rejected the output: ${feedback || "no rationale provided"}`,
          );
          this._postProgress(dag);
          return;
        }
      }

      dag.markCompleted(node.id, result.output);
    } catch (err) {
      const errorMsg = formatForUser(err);
      await this._handleNodeFailure(node, dag, errorMsg);
    }

    this._postProgress(dag);
  }

  private async _handleNodeFailure(
    node: TaskNode,
    dag: TaskDAG,
    error: string,
  ): Promise<void> {
    // Generate reflection before marking failed (so we know if retries remain).
    if (this._reflexionEngine) {
      try {
        const reflection = await this._reflexionEngine.reflect(
          node,
          error,
          node.description,
        );
        await this._reflexionEngine.storeReflection(reflection, this._sessionId);

        if (!this._reflections.has(node.id)) {
          this._reflections.set(node.id, []);
        }
        this._reflections.get(node.id)!.push(reflection);
      } catch {
        // Reflection failure should not block execution.
      }
    }

    dag.markFailed(node.id, error);

    // If the node is now terminally failed, skip its dependents.
    if (node.status === "failed") {
      dag.skipDependents(node.id);
    }
  }

  private _postProgress(dag: TaskDAG): void {
    const progress = dag.getProgress();
    const running = dag
      .getNodes()
      .filter((n) => n.status === "running")
      .map((n) => n.title);

    this._postMessage({
      type: "dagProgress",
      total: progress.total,
      completed: progress.completed,
      failed: progress.failed,
      running: progress.running,
      currentNodes: running,
    });
  }
}
