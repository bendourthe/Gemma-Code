import type { ToolMetadata } from "./ToolCatalog.js";
import type { GetToolSchemaParams, ToolHandler, ToolResult } from "./types.js";

/**
 * Implements the get_tool_schema meta-tool. When the model calls
 * get_tool_schema(name), this handler looks up the full parameter schema
 * for the named tool and returns it as JSON.
 *
 * Used with lazy tool loading: only tool names and one-line descriptions
 * appear in the system prompt; the model calls get_tool_schema to get
 * full parameter details before invoking a tool.
 */
export class LazyToolLoader implements ToolHandler {
  private readonly _catalog: ReadonlyMap<string, ToolMetadata>;

  constructor(catalog: readonly ToolMetadata[]) {
    this._catalog = new Map(catalog.map((t) => [t.name, t]));
  }

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const params = parameters as unknown as GetToolSchemaParams;

    if (typeof params.name !== "string" || params.name.length === 0) {
      return {
        id,
        success: false,
        output: "",
        error: "Missing required parameter: name",
      };
    }

    const tool = this._catalog.get(params.name);
    if (!tool) {
      const available = [...this._catalog.keys()].join(", ");
      return {
        id,
        success: false,
        output: "",
        error: `Unknown tool: "${params.name}". Available tools: ${available}`,
      };
    }

    const schema = {
      name: tool.name,
      description: tool.description,
      parameters: Object.fromEntries(
        Object.entries(tool.parameters).map(([key, param]) => [
          key,
          {
            type: param.type,
            description: param.description,
            required: param.required ?? false,
          },
        ]),
      ),
    };

    return {
      id,
      success: true,
      output: JSON.stringify(schema, null, 2),
    };
  }
}
