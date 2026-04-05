import type { PostMessageFn } from "../chat/StreamingPipeline.js";

const TIMEOUT_MS = 60_000;

/**
 * Bridges the webview confirmation UI to a Promise-based API.
 *
 * Usage:
 *   1. `await gate.request(id, description, detail)` — posts a confirmationRequest
 *      to the webview and resolves when the user approves or rejects (or times out).
 *   2. `gate.resolve(id, approved)` — called by GemmaCodePanel when it receives
 *      a confirmationResponse message from the webview.
 */
export class ConfirmationGate {
  private readonly _pending = new Map<string, (approved: boolean) => void>();

  constructor(private readonly _postMessage: PostMessageFn) {}

  /**
   * Post a confirmation request to the webview and wait for the user's response.
   * Returns true if approved, false if rejected or the 60-second timeout expires.
   */
  request(id: string, description: string, detail?: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this._pending.set(id, resolve);

      this._postMessage({
        type: "confirmationRequest",
        id,
        description,
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
