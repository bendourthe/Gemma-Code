/**
 * Orchestrator -- Top-level coordinator that ties together PlannerAgent,
 * DAGExecutor, and ReflexionEngine for Plan-and-Execute orchestration.
 *
 * The Orchestrator is used for complex multi-step requests when plan mode
 * is active. Simple single-turn requests continue to use the ReAct-style
 * AgentLoop.
 */

import type { SubAgentManager } from "../agents/SubAgentManager.js";
import type { HardwareTierConfig } from "../config/HardwareTier.types.js";
import type { OllamaClient, OllamaOptions } from "../llm/types.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";
import type { MemoryStore } from "../../../src/storage/MemoryStore.js";
import { DAGExecutor } from "./DAGExecutor.js";
import type { DAGExecutionResult } from "./DAGExecutor.js";
import { PlannerAgent } from "./PlannerAgent.js";
import { ReflexionEngine } from "./ReflexionEngine.js";
import { CriticAgent } from "./CriticAgent.js";
import type { CriticReviewer } from "./CriticAgent.js";
import type { TaskDAG } from "./TaskDAG.js";
import {
  defaultComplexityClassifier,
  type ComplexityClassifier,
} from "./ComplexityClassifier.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PostMessageFn = (message: ExtensionToWebviewMessage) => void;

export interface OrchestratorConfig {
  readonly client: OllamaClient;
  readonly modelName: string;
  readonly ollamaOptions: OllamaOptions;
  readonly subAgentManager: SubAgentManager;
  readonly hardwareTier: HardwareTierConfig;
  readonly memoryStore: MemoryStore | null;
  readonly postMessage: PostMessageFn;
  /** Optional injection point for tests / alternative classifiers. */
  readonly complexityClassifier?: ComplexityClassifier;
  /**
   * v1.5.0 Phase 4 (item 36) -- opt-in swarm orchestration (default off). When
   * true, write-capable workers are dispatched in isolated git worktrees
   * (T010) and each worker's output is gated through a critic before merge
   * (T011). When false, the orchestrator runs the legacy single-workspace,
   * critic-less Plan-and-Execute loop unchanged.
   */
  readonly swarmEnabled?: boolean;
  /** Optional injection point for tests -- substitute a deterministic critic. */
  readonly critic?: CriticReviewer;
}

export interface OrchestratorResult {
  readonly dag: TaskDAG;
  readonly summary: string;
  readonly totalTimeMs: number;
  readonly replanCount: number;
  readonly allDags: readonly TaskDAG[];
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class Orchestrator {
  private readonly _plannerAgent: PlannerAgent;
  private readonly _reflexionEngine: ReflexionEngine;
  private readonly _subAgentManager: SubAgentManager;
  private readonly _profile: HardwareTierConfig;
  private readonly _postMessage: PostMessageFn;
  private readonly _complexityClassifier: ComplexityClassifier;
  /** v1.5.0 Phase 4: opt-in worktree isolation for write-capable workers. */
  private readonly _isolateWrites: boolean;
  /** v1.5.0 Phase 4: critic that gates worker output before merge (null = off). */
  private readonly _critic: CriticReviewer | null;
  private _maxReplanAttempts = 2;
  private _replanThreshold = 0.3;

  constructor(config: OrchestratorConfig) {
    this._plannerAgent = new PlannerAgent(
      config.client,
      config.modelName,
      config.ollamaOptions,
    );
    this._reflexionEngine = new ReflexionEngine(
      config.client,
      config.modelName,
      config.ollamaOptions,
      config.memoryStore,
    );
    this._subAgentManager = config.subAgentManager;
    this._profile = config.hardwareTier;
    this._postMessage = config.postMessage;
    this._complexityClassifier = config.complexityClassifier ?? defaultComplexityClassifier;
    // v1.5.0 Phase 4 (item 36): when swarm orchestration is enabled, build the
    // critic once (an injected fake takes precedence in tests) and turn on
    // write-capable worktree isolation. Both stay off by default so the
    // existing Plan-and-Execute behavior is unchanged.
    this._isolateWrites = config.swarmEnabled === true;
    this._critic = config.swarmEnabled
      ? config.critic ??
        new CriticAgent(config.client, config.modelName, config.ollamaOptions)
      : null;
  }

  /**
   * Execute a complex request via Plan-and-Execute orchestration.
   *
   * 1. Generate a TaskDAG from the user request.
   * 2. Post DAG visualization to the webview.
   * 3. Execute the DAG with GPU-aware scheduling and Reflexion.
   * 4. If failure rate exceeds threshold, replan and retry.
   * 5. Return the final result.
   */
  async execute(
    userRequest: string,
    codebaseContext: string,
  ): Promise<OrchestratorResult> {
    const startTime = Date.now();
    const allDags: TaskDAG[] = [];
    let replanCount = 0;
    let currentResult: DAGExecutionResult | null = null;
    let completedContext = "";

    // Initial planning.
    let dag = await this._plannerAgent.plan(userRequest, codebaseContext);
    allDags.push(dag);
    this._postDAGVisualization(dag);

    // Execute with replanning loop.
    while (replanCount <= this._maxReplanAttempts) {
      const executor = new DAGExecutor(
        this._subAgentManager,
        this._profile,
        this._postMessage,
        this._reflexionEngine,
        undefined,
        {
          isolateWrites: this._isolateWrites,
          critic: this._critic ?? undefined,
        },
      );

      currentResult = await executor.execute(dag);

      // Check if replanning is needed.
      const progress = dag.getProgress();
      const effectiveTotal = progress.total - progress.skipped;
      const failureRate =
        effectiveTotal > 0 ? progress.failed / effectiveTotal : 0;

      if (
        failureRate > this._replanThreshold &&
        replanCount < this._maxReplanAttempts
      ) {
        replanCount++;

        // Collect completed work as context.
        const completedNodes = dag
          .getNodes()
          .filter((n) => n.status === "completed");
        completedContext = completedNodes
          .map((n) => `- ${n.title}: ${n.result ?? "completed"}`)
          .join("\n");

        // Collect reflections for replanning context.
        const reflections = executor.getReflections();
        const reflectionContext = Array.from(reflections.entries())
          .map(
            ([nodeId, refs]) =>
              `Node ${nodeId}: ${refs.map((r) => r.analysis).join("; ")}`,
          )
          .join("\n");

        // Build replanning prompt.
        const failedNodes = dag
          .getNodes()
          .filter((n) => n.status === "failed")
          .map((n) => n.title);

        this._postMessage({
          type: "replanning",
          attempt: replanCount,
          reason: `${Math.round(failureRate * 100)}% of nodes failed`,
          failedNodes,
        });

        const replanContext = [
          codebaseContext,
          "",
          "## Completed Work",
          completedContext,
          "",
          "## Failed Attempts",
          reflectionContext,
          "",
          "Generate a new plan for the REMAINING work only. Do not repeat completed tasks.",
        ].join("\n");

        dag = await this._plannerAgent.plan(userRequest, replanContext);
        allDags.push(dag);
        this._postDAGVisualization(dag);
        continue;
      }

      // No replanning needed or max replans exhausted.
      break;
    }

    const summary = this._buildSummary(allDags, currentResult, completedContext);

    return {
      dag: allDags[allDags.length - 1]!,
      summary,
      totalTimeMs: Date.now() - startTime,
      replanCount,
      allDags,
    };
  }

  /**
   * Synchronous heuristic to decide whether a request is complex enough
   * to warrant DAG orchestration vs. the simple ReAct loop. Delegates to
   * the injected ComplexityClassifier (default: HeuristicComplexityClassifier).
   */
  shouldUseOrchestrator(userRequest: string): boolean {
    return this._complexityClassifier.classify(userRequest).complex;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _postDAGVisualization(dag: TaskDAG): void {
    const nodes = dag.getNodes().map((n) => ({
      id: n.id,
      title: n.title,
      status: n.status,
      dependencies: [...n.dependencies],
    }));

    this._postMessage({
      type: "dagVisualization",
      nodes,
    });
  }

  private _buildSummary(
    allDags: readonly TaskDAG[],
    lastResult: DAGExecutionResult | null,
    completedContext: string,
  ): string {
    if (!lastResult) return "No execution results available.";

    const progress = lastResult.dag.getProgress();
    const lines: string[] = [
      `## Orchestration Complete`,
      ``,
      `- **Total nodes**: ${progress.total}`,
      `- **Completed**: ${progress.completed}`,
      `- **Failed**: ${progress.failed}`,
      `- **Skipped**: ${progress.skipped}`,
      `- **Duration**: ${lastResult.totalTimeMs}ms`,
    ];

    if (allDags.length > 1) {
      lines.push(`- **Replan attempts**: ${allDags.length - 1}`);
    }

    if (completedContext) {
      lines.push("", "### Completed Work", completedContext);
    }

    // List completed node results.
    const completedNodes = lastResult.dag
      .getNodes()
      .filter((n) => n.status === "completed" && n.result);
    if (completedNodes.length > 0) {
      lines.push("", "### Results");
      for (const node of completedNodes) {
        lines.push(`- **${node.title}**: ${node.result}`);
      }
    }

    return lines.join("\n");
  }
}
