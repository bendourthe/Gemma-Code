export type SubAgentType = "verification" | "research" | "planning";

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
