/**
 * v0.8.0 Phase 2 (item A2) -- streaming memory-context scrubber.
 *
 * The agent sometimes wraps memory recall content in `<memory-context>...
 * </memory-context>` spans inside its assistant turns (a hermes-agent
 * idiom). The user should never see this -- it is plumbing -- but a naive
 * `replace(/<memory-context>[\s\S]*?<\/memory-context>/g, "")` cannot run
 * on a streaming chunk because the tags often split across chunk
 * boundaries.
 *
 * `MemoryContextScrubber` is a three-state FSM that removes the spans
 * from a token stream chunk-by-chunk. It holds back the tail of each
 * chunk only as far as the longest possible partial-tag match
 * (`</memory-context>` is the longer of the two tags), so the worst-case
 * lag between input bytes and emitted bytes is bounded.
 *
 * Behaviour:
 *   - `outside`        emits text until it sees `<` -> `inside_tag`.
 *   - `inside_tag`     buffers until it can decide whether the partial
 *                      text is an opening or closing memory-context tag.
 *                      Other tags pass through unchanged.
 *   - `inside_span`    discards every byte until it sees the closing tag.
 *                      Stray `<` inside the span is ignored.
 *   - `flush()`        flushes any held-back tail. If we are still inside
 *                      a span at EOF, the unfinished span is dropped
 *                      (consistent with the agent abandoning the wrap);
 *                      a partial-tag tail in `inside_tag` is emitted
 *                      as-is so users see the text the model produced.
 */

const OPEN_TAG = "<memory-context>";
const CLOSE_TAG = "</memory-context>";

// `max prefix we may need to hold` -- the longer of the two tags (the
// closing tag wins).
const MAX_HELD = CLOSE_TAG.length;

type State = "outside" | "inside_tag" | "inside_span";

export class MemoryContextScrubber {
  private _state: State = "outside";
  /**
   * `outside` state buffer: stores the last few characters that might be
   * the start of an opening tag. Bounded at `OPEN_TAG.length - 1`.
   *
   * `inside_tag` buffer: stores the partial tag being decided.
   * Bounded at `MAX_HELD`.
   *
   * `inside_span` buffer: stores the most recent characters as we scan
   * for the closing tag. Bounded at `CLOSE_TAG.length - 1`.
   */
  private _held = "";

  /**
   * Feed one streaming chunk and return whatever text is safe to emit
   * downstream. The caller MUST eventually call `flush()` to release the
   * remaining held tail.
   */
  feed(chunk: string): string {
    if (chunk.length === 0) return "";
    let out = "";

    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]!;

      switch (this._state) {
        case "outside": {
          if (ch === "<") {
            this._held = "<";
            this._state = "inside_tag";
            break;
          }
          if (this._held.length > 0) {
            // Drain any leftover safe tail that we held back at the end of
            // a previous chunk.
            out += this._held;
            this._held = "";
          }
          out += ch;
          break;
        }

        case "inside_tag": {
          this._held += ch;
          // Definitive open tag.
          if (this._held === OPEN_TAG) {
            this._held = "";
            this._state = "inside_span";
            break;
          }
          // Definitive close tag while in tag state (rare -- only when
          // the model emits a stray `</memory-context>` without a paired
          // open. Treat as a no-op: drop the tag and resume.
          if (this._held === CLOSE_TAG) {
            this._held = "";
            this._state = "outside";
            break;
          }
          // Still could become either tag -> keep buffering.
          if (isPrefixOf(this._held, OPEN_TAG) || isPrefixOf(this._held, CLOSE_TAG)) {
            // Stay in inside_tag.
            break;
          }
          // The partial text turned out NOT to be a memory-context tag.
          // Emit the held buffer and return to outside. If the buffer
          // ends with another `<`, transition back into inside_tag with
          // just that char held.
          const lastLt = this._held.lastIndexOf("<");
          if (lastLt > 0) {
            out += this._held.slice(0, lastLt);
            this._held = this._held.slice(lastLt);
            // Stay in inside_tag with the new partial.
          } else {
            out += this._held;
            this._held = "";
            this._state = "outside";
          }
          break;
        }

        case "inside_span": {
          this._held += ch;
          if (this._held.endsWith(CLOSE_TAG)) {
            this._held = "";
            this._state = "outside";
            break;
          }
          // Bound the held buffer so it cannot grow unboundedly while we
          // are eating the body of the span.
          if (this._held.length > MAX_HELD) {
            this._held = this._held.slice(-MAX_HELD);
          }
          break;
        }
      }
    }

    return out;
  }

  /**
   * Release any held tail. After `flush()` the scrubber is ready to be
   * reused for a fresh stream via `reset()`.
   */
  flush(): string {
    let out = "";
    if (this._state === "outside" || this._state === "inside_tag") {
      // A partial-tag tail at EOF was not a memory-context tag, so emit
      // it verbatim. Users see whatever literal `<` chars the model
      // produced rather than silently losing them.
      out = this._held;
    }
    // inside_span at EOF -> the span was abandoned. Drop everything.
    this._held = "";
    return out;
  }

  reset(): void {
    this._state = "outside";
    this._held = "";
  }

  /** Exposed for tests. */
  getState(): State {
    return this._state;
  }
}

/**
 * `true` when `prefix` is a prefix of `full`. Empty `prefix` is treated
 * as not-a-prefix because we always have at least one char buffered when
 * we call this.
 */
function isPrefixOf(prefix: string, full: string): boolean {
  if (prefix.length === 0 || prefix.length > full.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== full[i]) return false;
  }
  return true;
}
