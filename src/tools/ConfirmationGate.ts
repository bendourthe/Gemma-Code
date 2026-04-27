import type { PostMessageFn } from "../chat/StreamingPipeline.js";
import type { ToolCallSource } from "./types.js";

const TIMEOUT_MS = 60_000;

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

  constructor(private readonly _postMessage: PostMessageFn) {}

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
