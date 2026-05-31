/**
 * v0.8.0 Phase 6.9 (item E3) -- streaming-aware tool emission parser.
 *
 * Walks a sequence of incoming token chunks and emits three event types
 * to the caller:
 *
 *   - `toolCallHeader`   -- emitted once on the opening `<tool_use name="...">`
 *   - `toolCallArgDelta` -- emitted zero-or-more times as the argument JSON
 *                            streams in
 *   - `toolCallComplete` -- emitted once on the closing `</tool_use>` tag
 *
 * The parser is intentionally a tiny state machine that holds back any
 * partial-tag bytes across chunk boundaries (so a tag split mid-stream
 * does not produce ghost text), but otherwise streams every character
 * straight through. Pure module: no I/O, no timers.
 */

import { randomUUID } from "crypto";

export type ToolCallStreamEvent =
  | { readonly type: "toolCallHeader"; readonly callId: string; readonly toolName: string }
  | { readonly type: "toolCallArgDelta"; readonly callId: string; readonly delta: string }
  | { readonly type: "toolCallComplete"; readonly callId: string };

type ParserState = "idle" | "inside-tool";

const OPEN_PREFIX = "<tool_use";
const CLOSE_TAG = "</tool_use>";

export class ToolCallStreamParser {
  private _state: ParserState = "idle";
  private _buffer = "";
  private _currentCallId: string | null = null;
  private readonly _events: ToolCallStreamEvent[] = [];
  private readonly _idFactory: () => string;

  constructor(idFactory?: () => string) {
    this._idFactory = idFactory ?? randomUUID;
  }

  /** Feed a chunk of streamed text; returns any events that completed within. */
  feed(chunk: string): readonly ToolCallStreamEvent[] {
    this._events.length = 0;
    this._buffer += chunk;
    this._drive();
    return this._events.slice();
  }

  /**
   * Flush any pending arg-delta bytes. Always call once the upstream stream
   * has closed -- otherwise a final partial chunk would be silently dropped.
   */
  flush(): readonly ToolCallStreamEvent[] {
    this._events.length = 0;
    if (this._state === "inside-tool" && this._buffer.length > 0 && this._currentCallId) {
      this._events.push({
        type: "toolCallArgDelta",
        callId: this._currentCallId,
        delta: this._buffer,
      });
      this._buffer = "";
    }
    return this._events.slice();
  }

  private _drive(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      if (this._state === "idle") {
        progressed = this._tryEmitHeader() || progressed;
        progressed = this._flushTextBeforeTag() || progressed;
      } else if (this._state === "inside-tool") {
        progressed = this._tryEmitClose() || progressed;
        progressed = this._flushArgDelta() || progressed;
      }
    }
  }

  /**
   * Try to find a complete `<tool_use ...>` opening tag and emit the header.
   * Returns true if it transitioned to `inside-tool`.
   */
  private _tryEmitHeader(): boolean {
    const start = this._buffer.indexOf(OPEN_PREFIX);
    if (start === -1) return false;
    const end = this._buffer.indexOf(">", start);
    if (end === -1) {
      // Hold the partial tag back; wait for more bytes.
      this._buffer = this._buffer.slice(start);
      return false;
    }
    // We discard any prose ahead of the tag -- the caller had access to it
    // via prior `feed()` chunks (idle-state buffer flushing handles that).
    this._buffer = this._buffer.slice(start);
    const tag = this._buffer.slice(0, end + 1 - start);
    const toolName = this._extractName(tag) ?? "unknown";
    this._currentCallId = this._idFactory();
    this._events.push({
      type: "toolCallHeader",
      callId: this._currentCallId,
      toolName,
    });
    this._buffer = this._buffer.slice(end + 1 - start);
    this._state = "inside-tool";
    return true;
  }

  /**
   * Emit any prose that precedes the first opening tag as a no-op (the
   * streaming pipeline upstream handles non-tool tokens directly). This
   * method exists so the parser's buffer does not grow unbounded while
   * idle.
   */
  private _flushTextBeforeTag(): boolean {
    if (this._state !== "idle") return false;
    // Only buffer the last `<tool_use`.length-1 chars in case a tag is
    // beginning at the end of the buffer.
    const safeKeep = OPEN_PREFIX.length - 1;
    if (this._buffer.length > safeKeep) {
      const start = this._buffer.indexOf(OPEN_PREFIX);
      if (start === -1) {
        this._buffer = this._buffer.slice(this._buffer.length - safeKeep);
        return false;
      }
    }
    return false;
  }

  /** Try to find the closing `</tool_use>` tag and emit the complete event. */
  private _tryEmitClose(): boolean {
    if (this._currentCallId === null) return false;
    const idx = this._buffer.indexOf(CLOSE_TAG);
    if (idx === -1) return false;
    const argChunk = this._buffer.slice(0, idx);
    if (argChunk.length > 0) {
      this._events.push({
        type: "toolCallArgDelta",
        callId: this._currentCallId,
        delta: argChunk,
      });
    }
    this._events.push({ type: "toolCallComplete", callId: this._currentCallId });
    this._buffer = this._buffer.slice(idx + CLOSE_TAG.length);
    this._state = "idle";
    this._currentCallId = null;
    return true;
  }

  /**
   * In `inside-tool` state, flush the buffer as an arg-delta, holding back
   * only enough trailing bytes to cover a partial `</tool_use>` boundary.
   */
  private _flushArgDelta(): boolean {
    if (this._state !== "inside-tool" || this._currentCallId === null) return false;
    const safeKeep = CLOSE_TAG.length - 1;
    if (this._buffer.length <= safeKeep) return false;
    const safeEnd = this._buffer.length - safeKeep;
    const delta = this._buffer.slice(0, safeEnd);
    if (delta.length === 0) return false;
    this._events.push({
      type: "toolCallArgDelta",
      callId: this._currentCallId,
      delta,
    });
    this._buffer = this._buffer.slice(safeEnd);
    return true;
  }

  private _extractName(tag: string): string | null {
    const match = /name=["']([^"']+)["']/.exec(tag);
    return match?.[1] ?? null;
  }
}
