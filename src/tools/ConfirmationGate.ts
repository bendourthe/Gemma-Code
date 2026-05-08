import type { PostMessageFn } from "../chat/StreamingPipeline.js";
import type { ToolCallSource } from "./types.js";
import { defaultPermissionOptions } from "../panels/webview/render/permissionPrompt.js";

const TIMEOUT_MS = 60_000;

/**
 * Outcome of a numbered permission prompt (Phase 4.3). Decoupled from the
 * legacy boolean ConfirmationGate.request() so callers can branch on
 * "yes-for-all" (persist override) or "freeform" (treat as new user turn).
 */
export interface PermissionPromptResult {
  value: "yes" | "yes-for-all" | "no" | "freeform";
  freeformText?: string;
}

/**
 * Prefix the confirmation description with the originating peer so the user
 * can distinguish a local-agent request from an external MCP client request
 * or a verification sub-agent request. Pen-test F-004.
 */
function attributeDescription(
  description: string,
  source: ToolCallSource | undefined,
): string {
  switch (source) {
    case "mcp":
      return `External MCP client wants to: ${description}`;
    case "sub-agent":
      return `The verification sub-agent wants to: ${description}`;
    case "local-agent":
    case undefined:
    default:
      return description;
  }
}

/**
 * Bridges the webview confirmation UI to a Promise-based API.
 *
 * Usage:
 *   1. `await gate.request(id, description, detail, source?)` -- posts a
 *      confirmationRequest to the webview and resolves when the user
 *      approves or rejects (or times out). When `source` is provided, the
 *      description is prefixed with peer attribution so the user can tell a
 *      local-agent request from an MCP-driven request.
 *   2. `gate.resolve(id, approved)` -- called by GemmaCodePanel when it
 *      receives a confirmationResponse message from the webview.
 */
export class ConfirmationGate {
  private readonly _pending = new Map<string, (approved: boolean) => void>();
  private readonly _pendingPrompts = new Map<
    string,
    (result: PermissionPromptResult) => void
  >();

  constructor(private readonly _postMessage: PostMessageFn) {}

  /**
   * Phase 4.3 -- numbered permission prompt. Posts a `renderPermissionPrompt`
   * message with the canonical 4-option layout and resolves with the user's
   * choice. The legacy boolean `request()` API remains for callers that do
   * not yet branch on "yes-for-all"/"freeform" (they treat any non-"yes" as
   * a rejection). Auto-resolves to `{ value: "no" }` after TIMEOUT_MS.
   */
  requestPrompt(
    id: string,
    toolName: string,
    description: string,
    commandEcho: string | null,
    source?: ToolCallSource,
  ): Promise<PermissionPromptResult> {
    return new Promise<PermissionPromptResult>((resolve) => {
      this._pendingPrompts.set(id, resolve);

      this._postMessage({
        type: "renderPermissionPrompt",
        id,
        toolName,
        description: attributeDescription(description, source),
        commandEcho,
        options: defaultPermissionOptions(toolName),
      });

      setTimeout(() => {
        if (this._pendingPrompts.has(id)) {
          this._pendingPrompts.delete(id);
          resolve({ value: "no" });
        }
      }, TIMEOUT_MS);
    });
  }

  /** Phase 4.3 -- called by the panel when a `permissionPromptResponse` arrives. */
  resolvePrompt(id: string, result: PermissionPromptResult): void {
    const resolver = this._pendingPrompts.get(id);
    if (resolver !== undefined) {
      this._pendingPrompts.delete(id);
      resolver(result);
    }
  }

  /**
   * Post a confirmation request to the webview and wait for the user's response.
   * Returns true if approved, false if rejected or the 60-second timeout expires.
   */
  request(
    id: string,
    description: string,
    detail?: string,
    source?: ToolCallSource,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this._pending.set(id, resolve);

      this._postMessage({
        type: "confirmationRequest",
        id,
        description: attributeDescription(description, source),
        detail,
      });

      // Auto-reject after timeout so the agent loop is never blocked indefinitely.
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          resolve(false);
        }
      }, TIMEOUT_MS);
    });
  }

  /**
   * Post a diff-preview notification for "manual" edit mode — no confirmation is
   * needed, so this returns immediately after posting the message.
   */
  requestDiffPreview(callId: string, filePath: string, diff: string): Promise<void> {
    this._postMessage({
      type: "diffPreview",
      callId,
      filePath,
      diff,
      requiresConfirmation: false,
    });
    return Promise.resolve();
  }

  /**
   * Called by GemmaCodePanel when a `confirmationResponse` webview message arrives.
   * Silently ignores unknown ids (e.g., after a timeout already resolved the promise).
   */
  resolve(id: string, approved: boolean): void {
    const resolver = this._pending.get(id);
    if (resolver !== undefined) {
      this._pending.delete(id);
      resolver(approved);
    }
  }
}
