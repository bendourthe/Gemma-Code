import * as fs from "fs";
import * as path from "path";
import { matchesSecretPath } from "../../modules/coding/utils/secretPaths.js";
import { getLogger } from "../../modules/coding/utils/logger.js";
import { formatForLog } from "../../modules/coding/utils/errors.js";

/**
 * Phase 9 (v0.5.0) -- Opt-in append-only operation log.
 *
 * Writes one Markdown-friendly line per tool call to
 * `<workspace>/.nexus/operation-log.md` when
 * `nexus.operationLog.enabled` is true. Default off so the privacy and
 * disk-cost trade-off is opt-in.
 *
 * The log records ONLY tool metadata: tool name, outcome, optional path (or
 * "n/a"), session id, and ISO timestamp. Tool input contents (command
 * strings, file contents, search patterns, prose) are never written.
 *
 * Format:
 *   ## [<ISO timestamp>] tool=<name> outcome=<ok|error> path=<rel|n/a> session=<id>
 *
 * The leading `## [` keeps the file Markdown-renderable while remaining
 * grep-friendly (`grep '^## \['`). Writes are buffered for 1 s / 50 events
 * to amortize disk cost; `close()` performs a final synchronous flush.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ToolCallEvent {
  readonly toolName: string;
  readonly outcome: "ok" | "error";
  /** Workspace-relative path the tool acted on, or undefined if not applicable. */
  readonly path?: string;
  readonly sessionId?: string;
  /** Override timestamp for tests (ms since epoch). */
  readonly timestamp?: number;
}

export interface OperationLogStats {
  readonly enabled: boolean;
  readonly filePath: string | null;
  readonly fileSizeBytes: number;
  readonly lastLines: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const OPERATION_LOG_DIRNAME = ".nexus";
export const OPERATION_LOG_FILENAME = "operation-log.md";

const FLUSH_INTERVAL_MS = 1_000;
const FLUSH_BATCH_SIZE = 50;
const REDACTED_PATH = "<redacted>";
const TAIL_LINES = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLine(event: ToolCallEvent, redactedPath: string): string {
  const ts = new Date(event.timestamp ?? Date.now()).toISOString();
  const session = event.sessionId ?? "n/a";
  return `## [${ts}] tool=${event.toolName} outcome=${event.outcome} path=${redactedPath} session=${session}`;
}

// ---------------------------------------------------------------------------
// OperationLog
// ---------------------------------------------------------------------------

export class OperationLog {
  private _filePath: string | null = null;
  private _enabled = false;
  private _buffer: string[] = [];
  private _interval: NodeJS.Timeout | null = null;
  private readonly _extraSecretPatterns: readonly string[];

  constructor(options: { extraSecretPatterns?: readonly string[] } = {}) {
    this._extraSecretPatterns = options.extraSecretPatterns ?? [];
  }

  /**
   * Open the log against a workspace root. The directory is created lazily
   * if it does not exist; on POSIX the file is chmod'ed to 0o600.
   */
  open(workspaceRoot: string): void {
    if (this._filePath) return;

    const dir = path.join(workspaceRoot, OPERATION_LOG_DIRNAME);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      getLogger().debug(
        `[OperationLog] mkdir failed for "${dir}":`,
        formatForLog(err),
      );
    }

    this._filePath = path.join(dir, OPERATION_LOG_FILENAME);

    // Touch the file so chmod has a target on POSIX, then secure permissions.
    try {
      const fd = fs.openSync(this._filePath, "a");
      fs.closeSync(fd);
      if (process.platform !== "win32") {
        fs.chmodSync(this._filePath, 0o600);
      }
    } catch (err) {
      getLogger().debug(
        `[OperationLog] init failed for "${this._filePath}":`,
        formatForLog(err),
      );
    }
  }

  /** Toggle whether subsequent `recordToolCall` calls write to disk. */
  setEnabled(enabled: boolean): void {
    if (enabled === this._enabled) return;
    this._enabled = enabled;
    if (enabled) {
      this._startInterval();
    } else {
      // Drain any buffered events with the previous "enabled" state before
      // disabling so writes recorded under enabled=true still hit disk.
      this._flush();
      this._stopInterval();
    }
  }

  /** Whether the log is currently writing to disk. */
  isEnabled(): boolean {
    return this._enabled;
  }

  /** Append-only file path, or null when `open()` has not been called. */
  filePath(): string | null {
    return this._filePath;
  }

  /**
   * Record one tool call. No-op when disabled. The path field is redacted
   * when it matches the secret-path denylist; tool inputs are never written.
   */
  recordToolCall(event: ToolCallEvent): void {
    if (!this._enabled || !this._filePath) return;

    let redactedPath = "n/a";
    if (event.path && event.path.length > 0) {
      redactedPath = matchesSecretPath(event.path, this._extraSecretPatterns)
        ? REDACTED_PATH
        : event.path;
    }

    this._buffer.push(formatLine(event, redactedPath));

    if (this._buffer.length >= FLUSH_BATCH_SIZE) {
      this._flush();
    }
  }

  /**
   * Flush the buffer synchronously. Surfaced for tests and for the
   * `/operation-log status` command path where the latest tail must reflect
   * very recent events.
   */
  flushImmediately(): void {
    this._flush();
  }

  /**
   * Close the log: drain the buffer synchronously and clear the timer. Idem-
   * potent so extension `dispose()` can call this freely.
   */
  close(): void {
    this._flush();
    this._stopInterval();
    this._filePath = null;
    this._enabled = false;
  }

  /** Snapshot of the log status -- used by `/operation-log status`. */
  status(): OperationLogStats {
    if (!this._filePath) {
      return { enabled: this._enabled, filePath: null, fileSizeBytes: 0, lastLines: [] };
    }
    this._flush();

    let fileSizeBytes = 0;
    let lastLines: string[] = [];
    try {
      const stat = fs.statSync(this._filePath);
      fileSizeBytes = stat.size;
      const content = fs.readFileSync(this._filePath, "utf8");
      const lines = content.split(/\r?\n/).filter((l) => l.startsWith("## ["));
      lastLines = lines.slice(-TAIL_LINES);
    } catch (err) {
      getLogger().debug(
        `[OperationLog] status read failed for "${this._filePath}":`,
        formatForLog(err),
      );
    }
    return {
      enabled: this._enabled,
      filePath: this._filePath,
      fileSizeBytes,
      lastLines,
    };
  }

  /** Truncate the file to zero bytes -- used by `/operation-log clear`. */
  clear(): void {
    if (!this._filePath) return;
    this._flush();
    try {
      fs.writeFileSync(this._filePath, "");
      if (process.platform !== "win32") {
        fs.chmodSync(this._filePath, 0o600);
      }
    } catch (err) {
      getLogger().debug(
        `[OperationLog] clear failed for "${this._filePath}":`,
        formatForLog(err),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _startInterval(): void {
    if (this._interval !== null) return;
    this._interval = setInterval(() => {
      try {
        this._flush();
      } catch {
        /* swallow -- interval continues */
      }
    }, FLUSH_INTERVAL_MS);
    if (typeof this._interval.unref === "function") {
      this._interval.unref();
    }
  }

  private _stopInterval(): void {
    if (this._interval === null) return;
    clearInterval(this._interval);
    this._interval = null;
  }

  private _flush(): void {
    if (this._buffer.length === 0 || !this._filePath) return;
    const lines = this._buffer.splice(0, this._buffer.length);
    const payload = lines.join("\n") + "\n";
    try {
      fs.appendFileSync(this._filePath, payload, { encoding: "utf8" });
    } catch (err) {
      getLogger().debug(
        `[OperationLog] append failed for "${this._filePath}":`,
        formatForLog(err),
      );
    }
  }
}
