/**
 * Sub-agent kinds. `audit-worker` and `testgaps-worker` (v0.7.0 Phase 7,
 * C34) follow the same post-N-edits trigger pattern as `verification`, but
 * run deterministic external CLIs (`gemma-check`, `vitest --coverage`)
 * instead of an LLM-driven AgentLoop.
 */
export type SubAgentType =
  | "verification"
  | "research"
  | "planning"
  | "audit-worker"
  | "testgaps-worker";

export interface SubAgentConfig {
  readonly type: SubAgentType;
  readonly maxIterations: number;
  readonly userRequest: string;
  readonly modifiedFiles: readonly string[];
  readonly recentToolResults: readonly string[];
  readonly memoryContext?: string;
}

export interface SubAgentResult {
  readonly type: SubAgentType;
  readonly success: boolean;
  readonly output: string;
  readonly toolCallCount: number;
  readonly iterationsUsed: number;
  readonly error?: string;
}
