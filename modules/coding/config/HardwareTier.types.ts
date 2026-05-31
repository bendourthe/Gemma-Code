export type HardwareTierId = 1 | 2 | 3;

export interface ModelRecommendation {
  readonly modelName: string;
  readonly contextWindow: number;
  readonly quantization: string;
  readonly effectiveParams: string;
  readonly vramRequired: number;
}

export interface HardwareTierConfig {
  readonly id: HardwareTierId;
  readonly name: string;
  readonly vramRange: { readonly min: number; readonly max: number };
  readonly recommendedModels: readonly ModelRecommendation[];
  readonly maxAgentIterations: number;
  readonly subAgentMaxIterations: number;
  readonly maxConcurrentSubAgents: number;
  readonly contextWindow: number;
  readonly budgetOverrides: {
    readonly systemPromptPercent: number;
    readonly memoryPercent: number;
    readonly conversationPercent: number;
    readonly responsePercent: number;
  };
  readonly compactionThreshold: number;
}
