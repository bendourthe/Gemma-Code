import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { matchesSecretPath } from "../../modules/coding/utils/secretPaths.js";
import { getLogger } from "../../modules/coding/utils/logger.js";
import { formatForLog } from "../../modules/coding/utils/errors.js";

/**
 * v0.8.0 Phase 4 sub-task 4.1 (item G3) -- single bug-report file primitive.
 *
 * Unifies the existing `Tracer` + `OperationLog` event surface into one
 * user-facing JSONL dump suitable for attaching to bug reports. The file is
 * append-only while enabled; `disable()` stops new lines without truncating;
 * `dump(targetPath)` copies the active log to a chosen location; `clear()`
 * removes the on-disk file.
 *
 * Every event is redacted before writing:
 *   - any path-shaped field matching `secretPaths.ts` denylist is replaced
 *     with `<redacted>`;
 *   - rendered prompts have their body elided when the body contains an
 *     env-style secret pattern;
 *   - tool args / results are shallow-redacted by key heuristic
 *     (`password`, `token`, `secret`, `key`, `authorization`).
 *
 * The trace file is JSONL so callers can `tail -f` or open in any editor
 * without needing a custom reader. Each line is one JSON object with at
 * minimum `{timestamp, kind, ...}`.
 */

export type TraceEventKind =
  | "tool_call"
  | "system_prompt"
  | "compaction"
  | "cache_decision"
  | "sub_agent_spawn"
  | "plan_transition";

export interface TraceEvent {
  readonly kind: TraceEventKind;
  readonly attributes?: Record<string, unknown>;
  /** Override timestamp for tests. */
  readonly timestamp?: number;
}

export interface TraceFileStats {
  readonly enabled: boolean;
  readonly filePath: string | null;
  readonly fileSizeBytes: number;
  readonly eventCount: number;
}

const REDACTED = "<redacted>";
const SECRET_KEY_PATTERN = /(password|token|secret|api[_-]?key|authorization|bearer)/i;
const ENV_SECRET_VALUE_PATTERN =
  /(?:[A-Z][A-Z0-9_]{2,})=([A-Za-z0-9+/=_\-]{12,})/;

/**
 * Default trace-file location. Lives outside the workspace so multiple
 * workspaces do not clobber one another's traces. Tests inject a custom
 * path so production-style temp-dir handling is exercised end-to-end.
 */
export function defaultTracePath(sessionId?: string): string {
  const sid = sessionId && sessionId.length > 0 ? sessionId : "default";
  return path.join(os.homedir(), ".nexus", "trace", `${sid}.jsonl`);
}

export class TraceFile {
  private _filePath: string | null = null;
  private _enabled = false;
  private _eventCount = 0;
  private readonly _extraSecretPatterns: readonly string[];

  constructor(extraSecretPatterns: readonly string[] = []) {
    this._extraSecretPatterns = extraSecretPatterns;
  }

  /** Activate trace logging. When `targetPath` omitted, uses `defaultTracePath`. */
  enable(targetPath?: string, sessionId?: string): string {
    const target = targetPath ?? defaultTracePath(sessionId);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
    } catch (err) {
      getLogger().warn(`[TraceFile] mkdir failed: ${formatForLog(err)}`);
    }
    this._filePath = target;
    this._enabled = true;
    this._eventCount = 0;
    return target;
  }

  /** Stop appending new events. Existing file is left in place. */
  disable(): void {
    this._enabled = false;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get filePath(): string | null {
    return this._filePath;
  }

  /**
   * Append one event line (JSONL). Synchronous; we accept the disk cost
   * because the trace file is opt-in and the user is debugging.
   */
  append(event: TraceEvent): void {
    if (!this._enabled || !this._filePath) return;
    const redacted = this._redact(event);
    const line =
      JSON.stringify({
        timestamp: new Date(event.timestamp ?? Date.now()).toISOString(),
        kind: event.kind,
        ...redacted,
      }) + "\n";
    try {
      fs.appendFileSync(this._filePath, line, "utf8");
      this._eventCount++;
    } catch (err) {
      getLogger().debug(`[TraceFile] append failed: ${formatForLog(err)}`);
    }
  }

  /** Copy the current trace file to `targetPath`. Returns the destination. */
  dump(targetPath: string): string {
    if (!this._filePath) {
      throw new Error("TraceFile.dump: no active trace file (call enable first)");
    }
    if (!fs.existsSync(this._filePath)) {
      throw new Error(`TraceFile.dump: trace file does not exist at ${this._filePath}`);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(this._filePath, targetPath);
    return targetPath;
  }

  /** Delete the on-disk trace file. Idempotent. */
  clear(): void {
    if (!this._filePath) return;
    try {
      if (fs.existsSync(this._filePath)) fs.unlinkSync(this._filePath);
      this._eventCount = 0;
    } catch (err) {
      getLogger().debug(`[TraceFile] clear failed: ${formatForLog(err)}`);
    }
  }

  stats(): TraceFileStats {
    let size = 0;
    if (this._filePath && fs.existsSync(this._filePath)) {
      try {
        size = fs.statSync(this._filePath).size;
      } catch {
        size = 0;
      }
    }
    return {
      enabled: this._enabled,
      filePath: this._filePath,
      fileSizeBytes: size,
      eventCount: this._eventCount,
    };
  }

  // -------------------------------------------------------------------------
  // Redaction
  // -------------------------------------------------------------------------

  private _redact(event: TraceEvent): Record<string, unknown> {
    if (!event.attributes) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(event.attributes)) {
      out[k] = this._redactValue(k, v);
    }
    return out;
  }

  private _redactValue(key: string, value: unknown): unknown {
    if (SECRET_KEY_PATTERN.test(key)) return REDACTED;
    if (typeof value === "string") {
      if (this._looksLikePath(value) && matchesSecretPath(value, this._extraSecretPatterns)) {
        return REDACTED;
      }
      if (ENV_SECRET_VALUE_PATTERN.test(value)) {
        return value.replace(ENV_SECRET_VALUE_PATTERN, () => `<env=${REDACTED}>`);
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item, i) => this._redactValue(`${key}[${i}]`, item));
    }
    if (value && typeof value === "object") {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        obj[k] = this._redactValue(k, v);
      }
      return obj;
    }
    return value;
  }

  private _looksLikePath(s: string): boolean {
    if (!s) return false;
    if (s.length > 1024) return false;
    return /[\\/]/.test(s) || /\.[A-Za-z0-9]{1,8}$/.test(s);
  }
}
