import { createHash } from "crypto";
import * as fs from "fs";
import type { ToolHandler, ToolResult } from "../types.js";
import { resolveInsideWorkspace } from "./pathGuard.js";

const DEFAULT_WATCH_MS = 8_000;
const MIN_WATCH_MS = 50;
const MAX_WATCH_MS = 30_000;

function failResult(id: string, error: string): ToolResult {
  return { id, success: false, output: "", error };
}

function clampTimeout(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_WATCH_MS;
  return Math.min(MAX_WATCH_MS, Math.max(MIN_WATCH_MS, Math.floor(raw)));
}

/**
 * v1.19.1 Phase 2.8 -- observe filesystem events on a workspace path for a
 * bounded interval. Read-only; AUTO_APPROVE. Rejects paths outside the
 * workspace root via pathGuard.
 */
export class WatchPathTool implements ToolHandler {
  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const userPath = parameters["path"];
    if (typeof userPath !== "string" || userPath.length === 0) {
      return failResult(
        id,
        "Missing required parameter: path. " +
          "Usage: watch_path(path=<workspace-relative path>, timeout_ms=<optional 50..30000>).",
      );
    }

    let resolved: string;
    try {
      resolved = resolveInsideWorkspace(userPath);
    } catch (err) {
      return failResult(
        id,
        `${(err as Error).message} ` +
          `Usage: watch_path(path=<workspace-relative path inside the project root>).`,
      );
    }

    const timeoutMs = clampTimeout(parameters["timeout_ms"]);
    const events: Array<{ type: string; filename: string | null }> = [];

    await new Promise<void>((resolve) => {
      let watcher: fs.FSWatcher;
      try {
        watcher = fs.watch(resolved, { persistent: false }, (eventType, filename) => {
          events.push({
            type: eventType,
            filename: filename === null ? null : String(filename),
          });
        });
      } catch (err) {
        events.push({ type: "error", filename: (err as Error).message });
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        watcher.close();
        resolve();
      }, timeoutMs);
      watcher.on("error", (err) => {
        events.push({ type: "error", filename: err.message });
        clearTimeout(timer);
        watcher.close();
        resolve();
      });
    });

    return {
      id,
      success: true,
      output: JSON.stringify({
        path: userPath,
        timeout_ms: timeoutMs,
        events,
      }),
    };
  }
}

/**
 * v1.19.1 Phase 2.8 -- SHA-256 of a workspace file for integrity / change
 * detection. Read-only; AUTO_APPROVE. Rejects paths outside the workspace.
 */
export class HashFileTool implements ToolHandler {
  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const userPath = parameters["path"];
    if (typeof userPath !== "string" || userPath.length === 0) {
      return failResult(
        id,
        "Missing required parameter: path. " +
          "Usage: hash_file(path=<workspace-relative file>).",
      );
    }

    let resolved: string;
    try {
      resolved = resolveInsideWorkspace(userPath);
    } catch (err) {
      return failResult(
        id,
        `${(err as Error).message} ` +
          `Usage: hash_file(path=<workspace-relative path inside the project root>).`,
      );
    }

    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(resolved);
    } catch (err) {
      return failResult(
        id,
        `Failed to read file at path "${userPath}": ${(err as Error).message}. ` +
          `Usage: hash_file(path=<existing workspace-relative file>).`,
      );
    }

    const hash = createHash("sha256").update(bytes).digest("hex");
    return {
      id,
      success: true,
      output: JSON.stringify({
        path: userPath,
        algorithm: "sha256",
        hash,
        bytes: bytes.byteLength,
      }),
    };
  }
}
