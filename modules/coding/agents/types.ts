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
  | "testgaps-worker"
  | "curator-worker"
  | "reflect-worker";

export interface SubAgentConfig {
  readonly type: SubAgentType;
  readonly maxIterations: number;
  readonly userRequest: string;
  readonly modifiedFiles: readonly string[];
  readonly recentToolResults: readonly string[];
  readonly memoryContext?: string;
  /**
   * v1.2.0 Phase 5.1 -- optional read-only intent flag. When set to
   * `'explore'`, the sub-agent is restricted to the read-only tool
   * allowlist in `core/coding/SubAgentPolicy.ts` (Read, Glob, Grep,
   * codegraph_*, plus a configurable run_terminal command allowlist).
   * Tool calls outside the allowlist are rejected by `SubAgentManager`
   * before they reach the AgentLoop.
   */
  readonly intent?: "explore" | "implement" | "verify" | "research";
  /**
   * v1.4.0 Phase 6 (A10, re-partial) -- opt-in git-worktree isolation. When
   * true AND a `WorktreeManager` is wired into `SubAgentManager` AND the
   * workspace is a git repo, the sub-agent's file-mutating tool surface
   * (`run_terminal`) executes inside a dedicated detached worktree checked out
   * from HEAD, so concurrently-dispatched write-capable sub-agents cannot
   * collide on the shared working tree. Default off (undefined/false preserves
   * the legacy shared-workspace behavior). The deterministic worker types
   * (audit / testgaps / curator / reflect) ignore the flag -- they run external
   * CLIs, not the AgentLoop. When isolation is requested but unavailable (no
   * manager wired, or not a git repo), the run degrades gracefully to the
   * shared workspace rather than failing.
   */
  readonly isolate?: boolean;
  /**
   * v1.5.0 Phase 7 (HUB.P3.AGENT) -- optional Nexus-Hub agent persona name. When
   * set AND a `HubAgentPersonaLoader` is wired into `SubAgentManager` AND a Hub
   * persona of that name resolves, the persona overrides the type-derived tool
   * scope and its instructions are prepended to the sub-agent's task context.
   * Unknown persona / no loader -> ignored (type-based behavior preserved).
   */
  readonly personaName?: string;
  /**
   * v2.1.0 Phase 2 -- override the manager's default model for this run
   * (adaptive routing). Absent keeps the SubAgentManager constructor model.
   */
  readonly modelName?: string;
}

export interface SubAgentResult {
  readonly type: SubAgentType;
  readonly success: boolean;
  readonly output: string;
  readonly toolCallCount: number;
  readonly iterationsUsed: number;
  readonly error?: string;
  /**
   * v1.6.0 Phase 4 (A2) -- the id of this sub-run's root span (when tracing is
   * active), so a caller (the swarm DAGExecutor) can nest a follow-on critic
   * run under it. Undefined when tracing is disabled.
   */
  readonly runId?: string;
}
