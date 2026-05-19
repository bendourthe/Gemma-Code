import * as fs from "fs";
import * as path from "path";
import { formatForUser } from "../utils/errors.js";
import {
  shouldCompress,
  compressSync,
  compressSyncLarge,
  decompressSync,
  SYNC_COMPRESS_CEILING,
} from "../utils/Compressor.js";
import type {
  ToolHandler,
  ToolResult,
  TailOutputParams,
  GrepOutputParams,
} from "./types.js";

/** Result returned when output is redirected to a file. */
export interface RedirectedResult {
  readonly redirectedPath: string;
  readonly summary: string;
  readonly lineCount: number;
  readonly charCount: number;
  /** True when the on-disk payload was Brotli-compressed. */
  readonly compressed: boolean;
}

const PREVIEW_CHARS = 500;
const OUTPUT_SUBDIR = ".nexus-output";

/** Marker suffix appended to redirected output files when their bytes are Brotli-compressed. */
export const COMPRESSED_FILE_SUFFIX = ".br";

// ---------------------------------------------------------------------------
// Universal byte-cap (Phase 2.1 — agent-friendly tools)
// ---------------------------------------------------------------------------

/** Default per-tool byte-cap (64 KB) applied to every successful tool output. */
export const DEFAULT_MAX_BYTES = 64 * 1024;

/** Hard ceiling on per-call `max_bytes` overrides (1 MB). */
export const MAX_BYTES_CEILING = 1024 * 1024;

/** Marker substring written into truncated outputs; used by tests and meta-checks. */
export const TRUNCATION_MARKER = "=== TRUNCATED at";

/** Result of applying the byte-cap to an output payload. */
export interface ByteCapResult {
  readonly output: string;
  readonly originalBytes: number;
  readonly truncated: boolean;
  readonly maxBytes: number;
}

/** Aggregate counters for the byte-cap, exposed for observability and tests. */
export interface TruncationStats {
  readonly truncatedCount: number;
  readonly totalBytesSeen: number;
  readonly totalBytesTruncated: number;
}

const _truncationStats = {
  truncatedCount: 0,
  totalBytesSeen: 0,
  totalBytesTruncated: 0,
};

/** Reset the global truncation counters. Test-only helper. */
export function resetTruncationStats(): void {
  _truncationStats.truncatedCount = 0;
  _truncationStats.totalBytesSeen = 0;
  _truncationStats.totalBytesTruncated = 0;
}

/** Snapshot the global truncation counters. */
export function getTruncationStats(): TruncationStats {
  return { ..._truncationStats };
}

/**
 * Resolve a per-call `max_bytes` override. Throws an Error containing the
 * parameter name and a usage hint when the override is invalid. Returns
 * `DEFAULT_MAX_BYTES` when `override` is undefined or null.
 */
export function resolveMaxBytes(override: unknown): number {
  if (override === undefined || override === null) return DEFAULT_MAX_BYTES;
  if (typeof override !== "number" || !Number.isFinite(override) || override <= 0) {
    throw new Error(
      `Invalid max_bytes parameter: must be a positive number. ` +
        `Usage: pass max_bytes=<positive integer up to ${MAX_BYTES_CEILING}>.`,
    );
  }
  if (override > MAX_BYTES_CEILING) {
    throw new Error(
      `max_bytes=${override} exceeds the per-call ceiling of ${MAX_BYTES_CEILING} bytes. ` +
        `Usage: pass max_bytes=<positive integer up to ${MAX_BYTES_CEILING}> or omit max_bytes.`,
    );
  }
  return Math.floor(override);
}

/**
 * Truncate `output` so the final UTF-8 byte length does not exceed `maxBytes`,
 * appending a structured truncation hint footer that teaches the agent how to
 * narrow the request. Multi-byte characters at the boundary are not split.
 */
export function applyByteCap(
  output: string,
  toolName: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
): ByteCapResult {
  const originalBytes = Buffer.byteLength(output, "utf8");
  _truncationStats.totalBytesSeen += originalBytes;

  if (originalBytes <= maxBytes) {
    return { output, originalBytes, truncated: false, maxBytes };
  }

  const buf = Buffer.from(output, "utf8");
  // Walk back from the maxBytes boundary until we land on a UTF-8 sequence
  // start byte (0xxxxxxx or 11xxxxxx). Continuation bytes are 10xxxxxx.
  let cut = Math.min(maxBytes, buf.length);
  while (cut > 0) {
    const byte = buf[cut]!;
    if ((byte & 0xc0) !== 0x80) break; // not a continuation byte
    cut -= 1;
  }
  const headBytes = buf.subarray(0, cut);
  const head = headBytes.toString("utf8");

  const hint = _truncationHint(toolName, cut, originalBytes);
  _truncationStats.truncatedCount += 1;
  _truncationStats.totalBytesTruncated += originalBytes - cut;

  return {
    output: head + hint,
    originalBytes,
    truncated: true,
    maxBytes,
  };
}

/**
 * Read a redirected output file's content as a string, transparently
 * Brotli-decompressing files whose path ends with `.br`. Plain `.txt` files
 * are read as utf-8.
 */
function _readRedirectedFile(filePath: string): string {
  if (filePath.endsWith(COMPRESSED_FILE_SUFFIX)) {
    const raw = fs.readFileSync(filePath);
    return decompressSync(raw);
  }
  return fs.readFileSync(filePath, "utf-8");
}

function _truncationHint(toolName: string, cutBytes: number, originalBytes: number): string {
  let narrow: string;
  switch (toolName) {
    case "read_file":
      narrow = "use range_start/range_end to fetch a sub-window";
      break;
    case "grep_codebase":
      narrow = "use max_results/next_offset to paginate, or pass a tighter glob";
      break;
    case "list_directory":
      narrow = "pass a deeper path or set recursive=false";
      break;
    default:
      narrow = "issue a narrower request";
      break;
  }
  return (
    `\n=== TRUNCATED at ${cutBytes} bytes; total ${originalBytes} bytes ===\n` +
    `To narrow: ${narrow}, or pass max_bytes=<larger value> on this tool call ` +
    `(ceiling: ${MAX_BYTES_CEILING}).`
  );
}

/**
 * Redirects large tool results to temporary workspace files and provides
 * helper tools (tail_output, grep_output) for the model to read subsets.
 */
export class OutputRedirector {
  private readonly _outputDir: string;

  constructor(
    workspaceRoot: string,
    private readonly _charThreshold: number = 5000,
  ) {
    this._outputDir = path.join(workspaceRoot, OUTPUT_SUBDIR);
  }

  /** Returns true when the output exceeds the character threshold. */
  shouldRedirect(output: string): boolean {
    return output.length > this._charThreshold;
  }

  /**
   * Write the full output to a file and return a summary pointer.
   * Outputs that pass the Compressor's `shouldCompress` gate are stored
   * Brotli-compressed at `<callId>.txt.br`; others land at `<callId>.txt`.
   * On write failure, returns null so the caller can fall back to the original output.
   */
  redirect(toolName: string, callId: string, output: string): RedirectedResult | null {
    try {
      if (!fs.existsSync(this._outputDir)) {
        fs.mkdirSync(this._outputDir, { recursive: true });
      }

      // Decide once whether to compress. shouldCompress emits its own
      // skipped_below_threshold / skipped_low_savings telemetry; compressSync
      // (or async compress for larger inputs) emits original/compressed bytes.
      let compressed = false;
      let filePath = path.join(this._outputDir, `${callId}.txt`);
      const eligible = shouldCompress(output);
      if (eligible) {
        try {
          // OutputRedirector is sync; use compressSync up to the 4 KB ceiling
          // and zlib.brotliCompressSync directly above it. compressSync still
          // updates telemetry for inputs at or below the ceiling; for larger
          // inputs we mirror the behavior inline.
          const byteLen = Buffer.byteLength(output, "utf8");
          const dataBuf =
            byteLen <= SYNC_COMPRESS_CEILING
              ? compressSync(output).data
              : compressSyncLarge(output).data;
          filePath = path.join(this._outputDir, `${callId}.txt${COMPRESSED_FILE_SUFFIX}`);
          fs.writeFileSync(filePath, dataBuf);
          compressed = true;
        } catch {
          // Fall back to plain write on any compression error.
          fs.writeFileSync(filePath, output, "utf-8");
        }
      } else {
        fs.writeFileSync(filePath, output, "utf-8");
      }

      const lineCount = output.split("\n").length;
      const charCount = output.length;
      const preview = output.slice(0, PREVIEW_CHARS);
      const summary =
        `[Output redirected to ${filePath}] (${lineCount} lines, ${charCount} chars)\n\n` +
        `Preview (first ${PREVIEW_CHARS} chars):\n${preview}\n\n` +
        "Use tail_output or grep_output to read specific parts.";

      return { redirectedPath: filePath, summary, lineCount, charCount, compressed };
    } catch {
      return null;
    }
  }

  /** Read the last N lines from a redirected output file. */
  readTail(filePath: string, lines: number): string {
    const content = _readRedirectedFile(filePath);
    const allLines = content.split("\n");
    return allLines.slice(-lines).join("\n");
  }

  /** Search a redirected file for regex matches, returning lines with numbers. */
  grepOutput(filePath: string, pattern: string, maxResults: number): string {
    const content = _readRedirectedFile(filePath);
    const regex = new RegExp(pattern, "g");
    const allLines = content.split("\n");
    const matches: string[] = [];

    for (let i = 0; i < allLines.length && matches.length < maxResults; i++) {
      if (regex.test(allLines[i]!)) {
        matches.push(`${i + 1}: ${allLines[i]}`);
      }
      // Reset lastIndex for global regex per line.
      regex.lastIndex = 0;
    }

    return matches.length > 0
      ? matches.join("\n")
      : `No matches found for pattern: ${pattern}`;
  }

  /**
   * Read the raw text of a redirected output file, transparently
   * Brotli-decompressing files written with the `.br` suffix. Used by
   * `readTail` and `grepOutput`; also exposed for advanced callers that need
   * direct content access. Idempotent: calling twice produces the same string.
   */
  static readDecoded(filePath: string): string {
    return _readRedirectedFile(filePath);
  }

  /** Remove all files in the output directory. */
  cleanup(): void {
    try {
      if (fs.existsSync(this._outputDir)) {
        const files = fs.readdirSync(this._outputDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this._outputDir, file));
        }
      }
    } catch {
      // Best-effort cleanup.
    }
  }
}

/**
 * Tool handler that reads the last N lines from a redirected output file.
 */
export class TailOutputTool implements ToolHandler {
  constructor(private readonly _redirector: OutputRedirector) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const params = parameters as unknown as TailOutputParams;

    if (typeof params.path !== "string" || params.path.length === 0) {
      return {
        id,
        success: false,
        output: "",
        error:
          "Missing required parameter: path. " +
          "Usage: tail_output(path=<redirected output file path>, lines=<optional integer>).",
      };
    }

    const lines = typeof params.lines === "number" ? params.lines : 50;

    try {
      const content = this._redirector.readTail(params.path, lines);
      return {
        id,
        success: true,
        output: JSON.stringify({ content, lines: content.split("\n").length }),
      };
    } catch (err) {
      return {
        id,
        success: false,
        output: "",
        error: formatForUser(err),
      };
    }
  }
}

/**
 * Tool handler that searches a redirected output file for regex matches.
 */
export class GrepOutputTool implements ToolHandler {
  constructor(private readonly _redirector: OutputRedirector) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const params = parameters as unknown as GrepOutputParams;

    if (typeof params.path !== "string" || params.path.length === 0) {
      return {
        id,
        success: false,
        output: "",
        error:
          "Missing required parameter: path. " +
          "Usage: grep_output(path=<redirected output file path>, pattern=<regex>, max_results=<optional>).",
      };
    }
    if (typeof params.pattern !== "string" || params.pattern.length === 0) {
      return {
        id,
        success: false,
        output: "",
        error:
          "Missing required parameter: pattern. " +
          "Usage: grep_output(path=<...>, pattern=<regex pattern>, max_results=<optional>).",
      };
    }

    const maxResults = typeof params.max_results === "number" ? params.max_results : 20;

    try {
      const matches = this._redirector.grepOutput(params.path, params.pattern, maxResults);
      return {
        id,
        success: true,
        output: JSON.stringify({ matches, count: matches.split("\n").length }),
      };
    } catch (err) {
      return {
        id,
        success: false,
        output: "",
        error: formatForUser(err),
      };
    }
  }
}
