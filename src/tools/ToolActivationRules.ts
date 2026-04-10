import type { DynamicToolMetadata } from "./ToolCatalog.js";
import type { BuiltinToolName, ToolName } from "./types.js";

/** Maximum number of tools to include in the prompt for reliable Gemma 4 tool calling. */
const MAX_TOOL_COUNT = 15;

export interface ToolActivationContext {
  readonly ollamaReachable: boolean;
  readonly networkAvailable: boolean;
  readonly readOnlySession: boolean;
  readonly subAgentType?: "research" | "verification" | null;
  readonly totalToolCount: number;
}

export interface ToolActivationResult {
  readonly disabledTools: Set<ToolName>;
  readonly reasons: Map<ToolName, string>;
}

const NETWORK_TOOLS: readonly BuiltinToolName[] = ["web_search", "fetch_page"];

const WRITE_TOOLS: readonly BuiltinToolName[] = [
  "write_file",
  "edit_file",
  "create_file",
  "delete_file",
  "run_terminal",
];

const RESEARCH_DISABLED: readonly BuiltinToolName[] = [
  "write_file",
  "edit_file",
  "create_file",
  "delete_file",
];

const VERIFICATION_DISABLED: readonly BuiltinToolName[] = [
  "write_file",
  "create_file",
  "delete_file",
];

/**
 * Compute which tools should be disabled based on the current runtime context.
 * Rules are applied in order; a tool disabled by an earlier rule stays disabled.
 */
export function computeToolActivation(
  allTools: readonly DynamicToolMetadata[],
  context: ToolActivationContext,
): ToolActivationResult {
  const disabled = new Set<ToolName>();
  const reasons = new Map<ToolName, string>();

  function disable(names: readonly ToolName[], reason: string): void {
    for (const name of names) {
      if (!disabled.has(name)) {
        disabled.add(name);
        reasons.set(name, reason);
      }
    }
  }

  // Rule 1: Ollama unreachable — disable all tools.
  if (!context.ollamaReachable) {
    disable(
      allTools.map((t) => t.name),
      "Ollama is not reachable",
    );
    return { disabledTools: disabled, reasons };
  }

  // Rule 2: No network — disable network-dependent tools.
  if (!context.networkAvailable) {
    disable(NETWORK_TOOLS, "Network is unavailable");
  }

  // Rule 3: Read-only session — disable all write/execute tools.
  if (context.readOnlySession) {
    disable(WRITE_TOOLS, "Read-only session");
  }

  // Rule 4: Research sub-agent — disable write tools (but not run_terminal).
  if (context.subAgentType === "research") {
    disable(RESEARCH_DISABLED, "Research sub-agent is read-only");
  }

  // Rule 5: Verification sub-agent — disable create/delete tools (can read + edit).
  if (context.subAgentType === "verification") {
    disable(VERIFICATION_DISABLED, "Verification sub-agent cannot create or delete files");
  }

  // Rule 6: Tool count cap — trim lowest-priority MCP tools when exceeding MAX_TOOL_COUNT.
  const enabledTools = allTools.filter((t) => !disabled.has(t.name));
  if (enabledTools.length > MAX_TOOL_COUNT) {
    const mcpTools = enabledTools
      .filter((t) => t.source === "mcp")
      .sort((a, b) => b.priority - a.priority); // highest priority number = lowest importance

    let toDisable = enabledTools.length - MAX_TOOL_COUNT;
    for (const tool of mcpTools) {
      if (toDisable <= 0) break;
      disable([tool.name], `Exceeds ${MAX_TOOL_COUNT}-tool limit (priority: ${tool.priority})`);
      toDisable--;
    }
  }

  return { disabledTools: disabled, reasons };
}
