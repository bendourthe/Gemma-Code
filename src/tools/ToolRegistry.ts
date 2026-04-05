import type { ToolCall, ToolHandler, ToolName, ToolResult } from "./types.js";

export class ToolRegistry {
  private readonly _handlers = new Map<ToolName, ToolHandler>();

  register(name: ToolName, handler: ToolHandler): void {
    this._handlers.set(name, handler);
  }

  has(name: ToolName): boolean {
    return this._handlers.has(name);
  }

  /**
   * Execute a tool call. Validates the tool exists, delegates to its handler,
   * and wraps any thrown exception as a failure ToolResult so the agent loop
   * can continue rather than crash.
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    const handler = this._handlers.get(call.tool);

    if (handler === undefined) {
      return {
        id: call.id,
        success: false,
        output: "",
        error: `Unknown tool: "${call.tool}"`,
      };
    }

    try {
      return await handler.execute(call.parameters);
    } catch (err) {
      return {
        id: call.id,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
