/**
 * v2.0.0 Phase 2 -- VS Code adapters for the `browser_*` tool family.
 *
 * Implementation lives in vscode-free `modules/coding/browser/`. These classes
 * exist so `AstToolScanner` and `ToolRegistryBuilder.registerLazy` see a
 * handler module under `src/tools/handlers/`, matching `codegraph.ts`.
 */

import { executeBrowserAction } from "../../../modules/coding/browser/actions.js";
import {
  getSharedBrowserSession,
  type BrowserSession,
} from "../../../modules/coding/browser/session.js";
import type { BrowserToolName } from "../../../modules/coding/browser/types.js";
import type { ToolHandler, ToolResult } from "../types.js";

function toResult(
  id: string,
  r: { success: boolean; output: string; error?: string },
): ToolResult {
  return {
    id,
    success: r.success,
    output: r.output,
    error: r.error,
    origin: "browser_snapshot",
  };
}

class BrowserToolHandler implements ToolHandler {
  constructor(
    private readonly _toolName: BrowserToolName,
    private readonly _resolveSession: () => BrowserSession,
  ) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? `browser-${Date.now()}`;
    const result = await executeBrowserAction(this._toolName, parameters, this._resolveSession());
    return toResult(id, result);
  }
}

const defaultSession = (): BrowserSession => getSharedBrowserSession();

export class BrowserNavigateTool extends BrowserToolHandler {
  constructor(resolveSession: () => BrowserSession = defaultSession) {
    super("browser_navigate", resolveSession);
  }
}

export class BrowserClickTool extends BrowserToolHandler {
  constructor(resolveSession: () => BrowserSession = defaultSession) {
    super("browser_click", resolveSession);
  }
}

export class BrowserTypeTool extends BrowserToolHandler {
  constructor(resolveSession: () => BrowserSession = defaultSession) {
    super("browser_type", resolveSession);
  }
}

export class BrowserAriaSnapshotTool extends BrowserToolHandler {
  constructor(resolveSession: () => BrowserSession = defaultSession) {
    super("browser_aria_snapshot", resolveSession);
  }
}

export class BrowserCloseTool extends BrowserToolHandler {
  constructor(resolveSession: () => BrowserSession = defaultSession) {
    super("browser_close", resolveSession);
  }
}
