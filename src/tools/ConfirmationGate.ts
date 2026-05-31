import type { PostMessageFn } from "../../modules/coding/chat/StreamingPipeline.js";
import type { ToolCallSource } from "./types.js";

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
 * v0.8.0 Phase 7.B -- option-builder callback contract. The shape mirrors
 * `PermissionPromptOption` in `src/panels/webview/render/permissionPrompt.ts`
 * but lives here so the gate has no `panels/` import (dep-cruiser
 * no-panels-from-tools).
 */
export interface PermissionPromptOptionSpec {
  key: "1" | "2" | "3" | "4";
  label: string;
  value: "yes" | "yes-for-all" | "no" | "freeform";
  aliases: string[];
}

/** Builder injected by the call site so the tool layer never reaches into panels. */
export type PermissionOptionsBuilder = (toolName: string) => PermissionPromptOptionSpec[];

/** Fallback used when the call site does not inject a builder (test seams only). */
const fallbackPermissionOptions: PermissionOptionsBuilder = (toolName) => [
  { key: "1", label: "Yes", value: "yes", aliases: ["y"] },
  {
    key: "2",
    label: `Yes, allow ${toolName} for all projects`,
    value: "yes-for-all",
    aliases: ["a"],
  },
  { key: "3", label: "No", value: "no", aliases: ["n"] },
  {
    key: "4",
    label: "Tell Gemma what to do instead",
    value: "freeform",
    aliases: ["t"],
  },
];

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
 *   2. `gate.resolve(id, approved)` -- called by NexusCodingPanel when it
 *      receives a confirmationResponse message from the webview.
 */
export class ConfirmationGate {
  private readonly _pending = new Map<string, (approved: boolean) => void>();
  private readonly _pendingPrompts = new Map<
    string,
    (result: PermissionPromptResult) => void
  >();

  private readonly _optionsBuilder: PermissionOptionsBuilder;

  constructor(
    private readonly _postMessage: PostMessageFn,
    optionsBuilder?: PermissionOptionsBuilder,
  ) {
    this._optionsBuilder = optionsBuilder ?? fallbackPermissionOptions;
  }

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
        options: this._optionsBuilder(toolName),
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
   * Called by NexusCodingPanel when a `confirmationResponse` webview message arrives.
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
