import { createHash } from "crypto";
import type { ToolCall } from "../tools/types.js";

export interface LoopVerdict {
  readonly action: "ok" | "warn" | "terminate";
  readonly message?: string;
}

export interface LoopDetectorConfig {
  readonly windowSize?: number;
  readonly repeatThreshold?: number;
}

const DEFAULT_WINDOW_SIZE = 4;
const DEFAULT_REPEAT_THRESHOLD = 3;

/**
 * Sliding-window hash-based loop detector for the agent tool-call loop.
 *
 * Tracks SHA-256 hashes of consecutive tool call payloads. When the same hash
 * appears `repeatThreshold` times within the last `windowSize` calls, a warning
 * is issued. If the pattern persists after the warning, execution is terminated.
 */
export class LoopDetector {
  private readonly _windowSize: number;
  private readonly _repeatThreshold: number;
  private readonly _hashes: string[] = [];
  private _warningIssued = false;

  constructor(config?: LoopDetectorConfig) {
    this._windowSize = config?.windowSize ?? DEFAULT_WINDOW_SIZE;
    this._repeatThreshold = config?.repeatThreshold ?? DEFAULT_REPEAT_THRESHOLD;
  }

  /**
   * Record a tool call and check for repetitive patterns.
   *
   * The hash is computed from the tool name and parameters only (the call `id`
   * and injected `_callId` are stripped because they change every invocation).
   */
  record(toolCall: ToolCall): LoopVerdict {
    const hash = this._hash(toolCall);

    this._hashes.push(hash);
    if (this._hashes.length > this._windowSize) {
      this._hashes.shift();
    }

    const count = this._countIdentical(hash);

    if (count >= this._repeatThreshold) {
      if (this._warningIssued) {
        return {
          action: "terminate",
          message: `Loop detected: tool "${toolCall.tool}" called identically ${count} times in the last ${this._windowSize} calls. Terminating agent loop.`,
        };
      }
      this._warningIssued = true;
      return {
        action: "warn",
        message: `Possible loop: tool "${toolCall.tool}" called identically ${count} times in the last ${this._windowSize} calls. Vary your approach or the loop will be terminated.`,
      };
    }

    return { action: "ok" };
  }

  /** Clear the hash buffer and reset warning state. */
  reset(): void {
    this._hashes.length = 0;
    this._warningIssued = false;
  }

  private _hash(call: ToolCall): string {
    // Strip transient fields that change per invocation (id, _callId).
    const params = { ...call.parameters } as Record<string, unknown>;
    delete params.id;
    delete params._callId;

    const payload = JSON.stringify({ tool: call.tool, parameters: params });
    return createHash("sha256").update(payload).digest("hex");
  }

  private _countIdentical(hash: string): number {
    let count = 0;
    for (const h of this._hashes) {
      if (h === hash) count++;
    }
    return count;
  }
}
