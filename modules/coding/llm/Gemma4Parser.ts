/**
 * v0.8.0 Phase 4 sub-task 4.3 (item F3) -- Gemma 4 channel parser.
 *
 * Pure parsing module with no runtime dependencies. Extracts the visible
 * answer, the hidden thought, and (when present) the tool response from a
 * raw Gemma 4 channel-formatted response.
 *
 * Channel tokens this parser recognises (best-effort, the model's exact
 * spelling has shifted across releases so we accept a small family):
 *
 *   <|channel>thought
 *   ...content...
 *   <channel|>
 *
 *   <|tool_response>
 *   ...content...
 *   <tool_response|>
 *
 *   <turn|>                  (turn separator)
 *   <start_function_call>    (start-of-function marker)
 *   <think>...</think>       (legacy single-block reasoning span)
 *
 * The parser also strips a leading `<think>...</think>` block so multi-turn
 * replay (via `ConversationManager.replayForCompaction()`) does not
 * accumulate stale reasoning into the prompt history.
 *
 * Implementation note: an Apache-2.0-clean rewrite. No code lines are
 * copied from `omlx/adapter/gemma4.py`; only the channel-token vocabulary
 * is shared, which is part of the Gemma 4 model output contract.
 */

export interface Gemma4ParsedChannels {
  /** User-visible content (with all channel tokens stripped). */
  readonly visible: string;
  /** Concatenated thought blocks (empty string when none present). */
  readonly thought: string;
  /** Tool response block (undefined when none present). */
  readonly toolResponse?: string;
}

const CHANNEL_THOUGHT_OPEN = /<\|channel>thought\s*/g;
const CHANNEL_THOUGHT_CLOSE = /<channel\|>/g;
const TOOL_RESPONSE_OPEN = /<\|tool_response>\s*/g;
const TOOL_RESPONSE_CLOSE = /<tool_response\|>/g;
const TURN_TOKEN = /<turn\|>/g;
const START_FN_TOKEN = /<start_function_call>/g;
const THINK_BLOCK = /<think>([\s\S]*?)<\/think>/g;

/**
 * Parse a raw Gemma 4 channel-formatted string. Returns an object with the
 * three split channels. Any unrecognised tokens pass through unchanged so a
 * model-side format shift does not silently mangle output.
 */
export function parseChannel(text: string): Gemma4ParsedChannels {
  if (!text) {
    return { visible: "", thought: "" };
  }

  let working = text;
  const thoughts: string[] = [];
  let toolResponse: string | undefined;

  // Extract <think>...</think> spans first because their delimiters do not
  // overlap with the channel-token family. The legacy block historically
  // surfaced at the very start of a reply; the replacement is global so
  // mid-stream blocks are also dropped from the visible channel.
  working = working.replace(THINK_BLOCK, (_m, body: string) => {
    const cleaned = body.trim();
    if (cleaned) thoughts.push(cleaned);
    return "";
  });

  // <|channel>thought ... <channel|>
  working = working.replace(
    /<\|channel>thought\s*([\s\S]*?)<channel\|>/g,
    (_m, body: string) => {
      const cleaned = body.trim();
      if (cleaned) thoughts.push(cleaned);
      return "";
    },
  );

  // <|tool_response> ... <tool_response|>
  const toolMatch = /<\|tool_response>\s*([\s\S]*?)<tool_response\|>/.exec(working);
  if (toolMatch && typeof toolMatch[1] === "string") {
    toolResponse = toolMatch[1].trim();
    working = working.replace(/<\|tool_response>\s*[\s\S]*?<tool_response\|>/g, "");
  }

  // Remaining stand-alone tokens have no semantic content; drop them.
  working = working
    .replace(CHANNEL_THOUGHT_OPEN, "")
    .replace(CHANNEL_THOUGHT_CLOSE, "")
    .replace(TOOL_RESPONSE_OPEN, "")
    .replace(TOOL_RESPONSE_CLOSE, "")
    .replace(TURN_TOKEN, "")
    .replace(START_FN_TOKEN, "");

  return {
    visible: working.trim(),
    thought: thoughts.join("\n\n").trim(),
    ...(toolResponse !== undefined ? { toolResponse } : {}),
  };
}

/**
 * Strip leading `<think>...</think>` blocks from a multi-turn replay buffer.
 * Unlike `parseChannel`, this preserves the rest of the document byte-for-byte
 * so downstream renderers see the same layout as the original.
 *
 * Used by `ConversationManager.replayForCompaction()` to keep the compaction
 * prompt focused on visible content.
 */
export function stripLeadingThinkBlocks(text: string): string {
  if (!text) return "";
  let working = text;
  // Strip ALL <think>...</think> blocks (leading or otherwise) so the
  // compaction input is dominated by the user-facing answer.
  working = working.replace(THINK_BLOCK, "");
  return working.trim();
}

/**
 * v0.9.0 Phase 2.1 (from v0.8.0 known-gaps 10.O.K) -- streaming-friendly
 * Gemma 4 channel-token scrubber.
 *
 * Holds back any partial channel-token bytes across chunk boundaries so a
 * `<|tool_response>` split between two stream chunks does not leak the
 * literal `<|tool_` prefix to the webview. Once a complete channel-token
 * block is observed (open token + body + close token), the block is
 * removed from the emitted stream. Tokens with no body (turn separators,
 * start-function-call markers) are also stripped.
 *
 * Pure, stateful, single-threaded. Build one per stream attempt.
 */
const STREAM_CHANNEL_TOKEN_OPENERS = [
  "<|channel>thought",
  "<|tool_response>",
  "<think>",
] as const;

const STREAM_CHANNEL_TOKEN_CLOSERS: Readonly<Record<string, string>> = {
  "<|channel>thought": "<channel|>",
  "<|tool_response>": "<tool_response|>",
  "<think>": "</think>",
};

const STREAM_STANDALONE_TOKENS = ["<turn|>", "<start_function_call>"] as const;

const STREAM_MAX_HOLDBACK = 32; // longest opener / closer + small slack.

export class Gemma4StreamScrubber {
  private _buffer = "";
  private _insideToken: keyof typeof STREAM_CHANNEL_TOKEN_CLOSERS | null = null;

  /** Feed a new chunk; returns the user-visible portion to emit downstream. */
  feed(chunk: string): string {
    if (!chunk) return "";
    this._buffer += chunk;
    let out = "";

    // Drive the state machine until no further progress is possible without
    // more bytes.
    while (true) {
      if (this._insideToken !== null) {
        const closer = STREAM_CHANNEL_TOKEN_CLOSERS[this._insideToken];
        if (closer === undefined) {
          this._insideToken = null;
          continue;
        }
        const closeIdx = this._buffer.indexOf(closer);
        if (closeIdx === -1) {
          // Closer not yet seen. The body bytes are discarded (we are
          // stripping the block from the visible stream), but we must keep
          // enough trailing bytes to recognise a closer that straddles the
          // next chunk boundary.
          const safeKeep = closer.length - 1;
          if (this._buffer.length > safeKeep) {
            this._buffer = this._buffer.slice(this._buffer.length - safeKeep);
          }
          return out;
        }
        this._buffer = this._buffer.slice(closeIdx + closer.length);
        this._insideToken = null;
        continue;
      }

      const opener = this._findEarliestOpener();
      if (opener === null) {
        const partial = this._partialOpenerSuffix(this._buffer);
        if (partial > 0) {
          out += this._buffer.slice(0, this._buffer.length - partial);
          this._buffer = this._buffer.slice(this._buffer.length - partial);
        } else {
          out += parseChannelStripStandalone(this._buffer);
          this._buffer = "";
        }
        return out;
      }

      const preface = parseChannelStripStandalone(this._buffer.slice(0, opener.index));
      out += preface;
      this._buffer = this._buffer.slice(opener.index + opener.token.length);
      this._insideToken = opener.token as keyof typeof STREAM_CHANNEL_TOKEN_CLOSERS;
    }
  }

  /** Emit any residue once the upstream stream ends. */
  flush(): string {
    if (this._insideToken !== null) {
      this._buffer = "";
      this._insideToken = null;
      return "";
    }
    // Drop a trailing partial opener: the stream has closed without
    // completing the token, so emitting `<thi` etc. would leak gibberish.
    const partial = this._partialOpenerSuffix(this._buffer);
    const remainder = partial > 0
      ? this._buffer.slice(0, this._buffer.length - partial)
      : this._buffer;
    const out = parseChannelStripStandalone(remainder);
    this._buffer = "";
    return out;
  }

  private _findEarliestOpener(): { token: string; index: number } | null {
    let best: { token: string; index: number } | null = null;
    for (const token of STREAM_CHANNEL_TOKEN_OPENERS) {
      const idx = this._buffer.indexOf(token);
      if (idx === -1) continue;
      if (!best || idx < best.index) best = { token, index: idx };
    }
    return best;
  }

  /**
   * Return the size of the longest suffix of `text` that could be the start
   * of a partial channel opener. Used to hold back bytes across chunks so a
   * tag split mid-stream is not leaked.
   */
  private _partialOpenerSuffix(text: string): number {
    const limit = Math.min(text.length, STREAM_MAX_HOLDBACK);
    for (let n = limit; n > 0; n--) {
      const tail = text.slice(text.length - n);
      for (const token of STREAM_CHANNEL_TOKEN_OPENERS) {
        if (token.startsWith(tail)) return n;
      }
      for (const token of STREAM_STANDALONE_TOKENS) {
        if (token.startsWith(tail)) return n;
      }
    }
    return 0;
  }
}

function parseChannelStripStandalone(text: string): string {
  if (!text) return "";
  let working = text;
  for (const token of STREAM_STANDALONE_TOKENS) {
    while (working.includes(token)) {
      working = working.replace(token, "");
    }
  }
  return working;
}
