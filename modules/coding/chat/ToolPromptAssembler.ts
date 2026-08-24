import type { DynamicToolMetadata, ToolMetadata } from "../../../src/tools/ToolCatalog.js";
import type { ToolName } from "../../../src/tools/types.js";
import { countTokens } from "../config/PromptBudget.js";

/**
 * Action-introspected tool docs (v1.19.1 Phase 2.9).
 *
 * Walks the live enabled-tool list (and optional extra registry names) and
 * emits compact ToolMetadata so a registered tool can never be missing from
 * the system prompt. Replaces hand-filtering of TOOL_CATALOG as the source of
 * what the model sees; catalog text still supplies descriptions for known
 * tools, and unknown registered names get a stub so tests can prove lockstep.
 *
 * Token cost is measured with the same `countTokens` helper PromptBuilder uses.
 * The generated block is bounded by {@link TOOL_PROMPT_TOKEN_BUDGET}.
 */

/** Soft cap on the serialized tool-declaration block (tokens). */
export const TOOL_PROMPT_TOKEN_BUDGET = 8_000;

export interface AssembledToolDocs {
  readonly tools: readonly ToolMetadata[];
  readonly estimatedTokens: number;
  readonly overBudget: boolean;
}

function stubMetadata(name: string): ToolMetadata {
  return {
    name: name as ToolName,
    description:
      `Registered tool "${name}" (live registry; not in the static catalog). ` +
      `Call get_tool_schema if you need parameters.`,
    parameters: {},
  };
}

export function assembleToolPromptDocs(
  enabledTools: readonly (ToolMetadata | DynamicToolMetadata)[],
  registeredNames?: readonly string[],
): AssembledToolDocs {
  const byName = new Map<string, ToolMetadata>();
  for (const tool of enabledTools) {
    byName.set(String(tool.name), tool);
  }
  if (registeredNames) {
    for (const name of registeredNames) {
      if (!byName.has(name)) {
        byName.set(name, stubMetadata(name));
      }
    }
  }
  const tools = [...byName.values()];
  const serialised = tools
    .map((t) => `${t.name}:${t.description}:${Object.keys(t.parameters).join(",")}`)
    .join("\n");
  const estimatedTokens = countTokens(serialised);
  return {
    tools,
    estimatedTokens,
    overBudget: estimatedTokens > TOOL_PROMPT_TOKEN_BUDGET,
  };
}
