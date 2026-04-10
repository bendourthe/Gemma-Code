import type { SubAgentConfig } from "./types.js";

/**
 * Build a minimal system prompt context block for a sub-agent.
 * This is injected as the first user message to provide task context,
 * not as part of the system prompt (which is built by PromptBuilder).
 */
export function buildSubAgentContextMessage(config: SubAgentConfig): string {
  const sections: string[] = [];

  sections.push(`## Task\n\n${config.userRequest}`);

  if (config.modifiedFiles.length > 0) {
    const fileList = config.modifiedFiles.map((f) => `- ${f}`).join("\n");
    sections.push(`## Modified Files\n\n${fileList}`);
  }

  if (config.recentToolResults.length > 0) {
    const results = config.recentToolResults.join("\n\n---\n\n");
    sections.push(`## Recent Tool Results\n\n${results}`);
  }

  if (config.memoryContext) {
    sections.push(`## Relevant Context\n\n${config.memoryContext}`);
  }

  return sections.join("\n\n");
}

/** Sub-agent system prompt instructions keyed by type. */
const SUB_AGENT_INSTRUCTIONS: Record<string, string> = {
  verification:
    "You are a code verification agent. " +
    "Review the changes listed below for bugs, logic errors, missing edge cases, and test failures. " +
    "If test files exist for the modified code, run them using the terminal tool. " +
    "Report issues concisely with file paths and line references. " +
    "Do not create or delete files. Do not interact with the user directly.",

  research:
    "You are a research agent. " +
    "Gather information to answer the question below by reading files, searching the codebase, and browsing the web. " +
    "Synthesize your findings into a structured summary with references. " +
    "Do not modify any files. Do not interact with the user directly.",

  planning:
    "You are a planning agent. " +
    "Decompose the task below into concrete, numbered implementation steps. " +
    "Analyze the codebase to understand the current architecture before proposing changes. " +
    "Each step should reference specific file paths and describe what to change. " +
    "Do not modify any files. Do not interact with the user directly.",
};

/**
 * Returns the sub-agent-specific system prompt instruction block.
 * Used by PromptBuilder._buildSubAgentSection() to assemble the full sub-agent prompt.
 */
export function getSubAgentInstructions(type: string): string {
  return SUB_AGENT_INSTRUCTIONS[type] ?? SUB_AGENT_INSTRUCTIONS["research"]!;
}
