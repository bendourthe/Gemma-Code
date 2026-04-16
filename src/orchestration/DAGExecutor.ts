/**
 * DAGExecutor -- Walks a TaskDAG, dispatches ready nodes to sub-agents
 * (respecting GPU-tier concurrency limits), and handles failures.
 *
 * Uses a simple Promise-based semaphore for concurrency control.
 */

import type { SubAgentManager } from "../agents/SubAgentManager.js";
import type { SubAgentConfig, SubAgentType } from "../agents/types.js";
import type { GpuTierProfile } from "../config/GpuTierConfig.js";
import type { ExtensionToWebviewMessage } from "../panels/messages.js";
import type { TaskDAG, TaskNode, TaskNodeType } from "./TaskDAG.js";
import type { Reflection } from "./ReflexionEngine.js";

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

  constructor(
    private readonly _subAgentManager: SubAgentManager,
    private readonly _profile: GpuTierProfile,
    private readonly _postMessage: PostMessageFn,
    private readonly _reflexionEngine?: ReflexionEngineInterface,
    private readonly _sessionId?: string,
  ) {}

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

    const config: SubAgentConfig = {
      type: agentType,
      maxIterations: this._profile.subAgentMaxIterations,
      userRequest: `${node.title}: ${node.description}`,
      modifiedFiles: [],
      recentToolResults: [],
      memoryContext,
    };

    try {
      const result = await this._subAgentManager.run(config, this._postMessage);

      if (result.success) {
        dag.markCompleted(node.id, result.output);
      } else {
        await this._handleNodeFailure(node, dag, result.error ?? "Sub-agent reported failure");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
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
