import type { DynamicToolMetadata } from "./ToolCatalog.js";
import type { ToolCall, ToolHandler, ToolName, ToolResult } from "./types.js";

export class ToolRegistry {
  private readonly _handlers = new Map<ToolName, ToolHandler>();
  private readonly _enabled = new Map<ToolName, boolean>();

  register(name: ToolName, handler: ToolHandler): void {
    this._handlers.set(name, handler);
    if (!this._enabled.has(name)) {
      this._enabled.set(name, true);
    }
  }

  has(name: ToolName): boolean {
    return this._handlers.has(name);
  }

  /** Set the enabled state for a tool. No-op if the tool is not registered. */
  setEnabled(name: ToolName, enabled: boolean): void {
    if (this._handlers.has(name)) {
      this._enabled.set(name, enabled);
    }
  }

  /** Returns true only if the tool is registered AND enabled. */
  isEnabled(name: ToolName): boolean {
    return this._handlers.has(name) && (this._enabled.get(name) ?? false);
  }

  /** Returns names of all registered and enabled tools. */
  getEnabledNames(): ToolName[] {
    return [...this._handlers.keys()].filter((n) => this._enabled.get(n) === true);
  }

  /** Filter a tool metadata catalog to only the tools that are registered and enabled. */
  getEnabledToolMetadata(catalog: readonly DynamicToolMetadata[]): DynamicToolMetadata[] {
    return catalog.filter((t) => this.isEnabled(t.name));
  }

  /**
   * Execute a tool call. Validates the tool exists and is enabled, delegates
   * to its handler, and wraps any thrown exception as a failure ToolResult so
   * the agent loop can continue rather than crash.
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

    if (!this.isEnabled(call.tool)) {
      return {
        id: call.id,
        success: false,
        output: "",
        error: `Tool "${call.tool}" is currently disabled.`,
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
