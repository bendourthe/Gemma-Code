import type { HookBus } from "../../../../core/lifecycle/HookBus.js";
import type { LLMClient } from "../../../../modules/coding/llm/types.js";
import { createHeadlessOllamaClient } from "../../../../modules/coding/llm/headlessOllamaClient.js";
import type { HeadlessScheduledRun } from "../../../../modules/coding/autonomy/AgentRunScheduler.js";
import { HeadlessAgentSession } from "../../../../modules/coding/runtime/HeadlessAgentSession.js";
import type { HeadlessTool } from "../../../../modules/coding/runtime/headlessTools.js";
import { createSidecarHeadlessTools } from "./sidecarHeadlessTools.js";
import { runEnrichedHeadlessSession } from "./headlessRunEnrichment.js";

export interface ScheduledHeadlessRunnerOptions {
  readonly llm?: LLMClient;
  readonly catalogDir?: string;
  readonly hookBus?: HookBus;
  readonly systemInstructions?: string;
  readonly toolsForRun?: (run: HeadlessScheduledRun) => HeadlessTool[];
  readonly log?: (message: string) => void;
}

export function createScheduledHeadlessRunner(
  options: ScheduledHeadlessRunnerOptions = {},
): (run: HeadlessScheduledRun) => Promise<void> {
  const llm = options.llm ?? createHeadlessOllamaClient();
  return async (run) => {
    const tools =
      options.toolsForRun?.(run) ?? createSidecarHeadlessTools({ confirm: run.confirm });
    const session = new HeadlessAgentSession(llm, tools);
    await runEnrichedHeadlessSession({
      session,
      sessionId: run.runId,
      message: run.prompt,
      workspacePath: run.primaryRoot ?? run.workspacePath,
      workspaceRoots: run.workspaceRoots ?? [run.workspacePath],
      workspaceId: run.workspaceId,
      model: process.env.NEXUS_SCHEDULER_MODEL ?? process.env.NEXUS_ACP_MODEL ?? "gemma4:e4b",
      baseSystemInstructions: options.systemInstructions,
      catalogDir: options.catalogDir,
      hookBus: options.hookBus,
      log: options.log,
    });
  };
}
