/**
 * Orchestrator -- Top-level coordinator that ties together PlannerAgent,
 * DAGExecutor, and ReflexionEngine for Plan-and-Execute orchestration.
 *
 * The Orchestrator is used for complex multi-step requests when plan mode
 * is active. Simple single-turn requests continue to use the ReAct-style
 * AgentLoop.
 */

import type { SubAgentManager } from "../agents/SubAgentManager.js";
import type { GpuTierProfile } from "../config/GpuTierConfig.js";
import type { OllamaClient, OllamaOptions } from "../ollama/types.js";
import type { ExtensionToWebviewMessage } from "../panels/messages.js";
import type { MemoryStore } from "../storage/MemoryStore.js";
import { DAGExecutor } from "./DAGExecutor.js";
import type { DAGExecutionResult } from "./DAGExecutor.js";
import { PlannerAgent } from "./PlannerAgent.js";
import { ReflexionEngine } from "./ReflexionEngine.js";
import type { TaskDAG } from "./TaskDAG.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PostMessageFn = (message: ExtensionToWebviewMessage) => void;

export interface OrchestratorConfig {
  readonly client: OllamaClient;
  readonly modelName: string;
  readonly ollamaOptions: OllamaOptions;
  readonly subAgentManager: SubAgentManager;
  readonly gpuTierProfile: GpuTierProfile;
  readonly memoryStore: MemoryStore | null;
  readonly postMessage: PostMessageFn;
}

export interface OrchestratorResult {
  readonly dag: TaskDAG;
  readonly summary: string;
  readonly totalTimeMs: number;
  readonly replanCount: number;
  readonly allDags: readonly TaskDAG[];
}

// ---------------------------------------------------------------------------
// Heuristic keywords
// ---------------------------------------------------------------------------

const ORCHESTRATOR_TRIGGERS = [
  "implement",
  "refactor",
  "build",
  "create a feature",
  "fix all",
  "update across",
  "redesign",
  "migrate",
  "convert all",
  "rewrite",
  "restructure",
  "overhaul",
];

const SIMPLE_PREFIXES = [
  "what is",
  "what are",
  "explain",
  "read file",
  "show me",
  "help",
  "list",
  "describe",
  "how does",
  "where is",
];

const COMPLEXITY_LENGTH_THRESHOLD = 200;

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class Orchestrator {
  private readonly _plannerAgent: PlannerAgent;
  private readonly _reflexionEngine: ReflexionEngine;
  private readonly _subAgentManager: SubAgentManager;
  private readonly _profile: GpuTierProfile;
  private readonly _postMessage: PostMessageFn;
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
    this._profile = config.gpuTierProfile;
    this._postMessage = config.postMessage;
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
   * to warrant DAG orchestration vs. the simple ReAct loop.
   */
  shouldUseOrchestrator(userRequest: string): boolean {
    const lower = userRequest.toLowerCase().trim();

    // Short-circuit: simple queries should not use orchestration.
    for (const prefix of SIMPLE_PREFIXES) {
      if (lower.startsWith(prefix)) return false;
    }

    // Check for complexity keywords.
    for (const trigger of ORCHESTRATOR_TRIGGERS) {
      if (lower.includes(trigger)) return true;
    }

    // Long requests are likely complex.
    if (userRequest.length > COMPLEXITY_LENGTH_THRESHOLD) return true;

    return false;
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
