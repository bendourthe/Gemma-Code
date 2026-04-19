import type { DynamicToolMetadata } from "./ToolCatalog.js";
import type { ToolCall, ToolHandler, ToolName, ToolResult, EditMode } from "./types.js";
import type { OutputRedirector } from "./OutputRedirector.js";
import type { ConfirmationGate } from "./ConfirmationGate.js";
import { getPermissionTier, shouldRequireConfirmation, getDangerousWarning, PermissionTier } from "../safety/PermissionTiers.js";

// Tools that fire their own diff-bearing confirmation in `ask` mode and a
// diff-preview in `plan` mode. The centralized gate is skipped for these
// tools when the edit mode is ask/plan to avoid a double confirmation card.
const TOOLS_WITH_PER_TOOL_DIFF_CONFIRMATION: ReadonlySet<ToolName> = new Set([
  "write_file",
  "edit_file",
  "create_file",
]);

export class ToolRegistry {
  private readonly _handlers = new Map<ToolName, ToolHandler>();
  private readonly _enabled = new Map<ToolName, boolean>();
  private _redirector?: OutputRedirector;
  private _confirmationGate?: ConfirmationGate;
  private _permissionOverrides?: Record<string, number>;
  private _editMode: EditMode = "auto";

  register(name: ToolName, handler: ToolHandler): void {
    this._handlers.set(name, handler);
    if (!this._enabled.has(name)) {
      this._enabled.set(name, true);
    }
  }

  has(name: ToolName): boolean {
    return this._handlers.has(name);
  }

  /** Return the registered handler for a tool, or undefined if none. */
  get(name: ToolName): ToolHandler | undefined {
    return this._handlers.get(name);
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
   * Enable output redirection for large tool results. When set, execute()
   * will redirect results exceeding the character threshold to temp files.
   */
  setOutputRedirector(redirector: OutputRedirector): void {
    this._redirector = redirector;
  }

  /**
   * Set the centralized confirmation gate and permission overrides.
   * When configured, execute() checks the permission tier of each tool
   * and requests user confirmation for CONFIRM and DANGEROUS tiers.
   */
  setConfirmationGate(
    gate: ConfirmationGate,
    overrides?: Record<string, number>,
    editMode?: EditMode,
  ): void {
    this._confirmationGate = gate;
    this._permissionOverrides = overrides;
    if (editMode !== undefined) {
      this._editMode = editMode;
    }
  }

  /** Update the edit mode used to suppress duplicate confirmation prompts. */
  setEditMode(editMode: EditMode): void {
    this._editMode = editMode;
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

    // Centralized permission check: request user confirmation for CONFIRM/DANGEROUS tools.
    // Tools that fire their own diff-bearing confirmation in ask/plan mode are skipped
    // here so the user only sees one prompt per file edit.
    const handlesOwnConfirmation =
      TOOLS_WITH_PER_TOOL_DIFF_CONFIRMATION.has(call.tool) &&
      (this._editMode === "ask" || this._editMode === "plan");

    if (
      this._confirmationGate &&
      shouldRequireConfirmation(call.tool, this._permissionOverrides) &&
      !handlesOwnConfirmation
    ) {
      const tier = getPermissionTier(call.tool, this._permissionOverrides);
      const warning = tier === PermissionTier.DANGEROUS
        ? getDangerousWarning(call.tool, call.parameters)
        : `Tool "${call.tool}" requires confirmation.`;
      const approved = await this._confirmationGate.request(call.id, warning);
      if (!approved) {
        return {
          id: call.id,
          success: false,
          output: "",
          error: `Tool "${call.tool}" was rejected by user.`,
        };
      }
    }

    try {
      const result = await handler.execute(call.parameters);

      // Redirect large successful outputs to temp files.
      if (result.success && this._redirector?.shouldRedirect(result.output)) {
        const redirected = this._redirector.redirect(call.tool, call.id, result.output);
        if (redirected) {
          return { ...result, output: redirected.summary };
        }
      }

      return result;
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
