import { MemoryFiles, type MemoryFilesContents } from "./MemoryFiles.js";

/**
 * v0.8.0 Phase 2 (item A1) -- frozen memory snapshot for prefix-cache
 * preservation.
 *
 * `PromptBuilder` historically read `Instructions.md`, `Memory.md`, and
 * `Context.md` from disk on every turn through `MemoryFiles.read()` (which
 * is mtime-cached so the cost is small, but the *content* still flows
 * back into the rendered prompt). When the user edited Memory.md mid-
 * session the new bytes would land in the next prompt's prefix, busting
 * the LLM's prefix cache and forcing a full re-encode.
 *
 * The frozen snapshot semantics fix this: at session start the snapshot
 * captures the three files into an immutable object. Mid-session writes
 * still go to disk via `MemoryFiles.appendToMemory` / `MemoryFiles.import`
 * (so they survive a reload), but the rendered prompt keeps reading from
 * the captured snapshot until the next session.
 *
 * `live` mode (opt-in via `gemma-code.memorySnapshotMode = "live"`)
 * preserves the v0.7.0 behaviour for users who prefer real-time prompt
 * reflection over prefix-cache stability.
 */

export type MemorySnapshotMode = "frozen" | "live";

export interface MemorySnapshotInfo {
  readonly mode: MemorySnapshotMode;
  readonly capturedAt: number;
  readonly workspaceId: string;
}

/**
 * Immutable contents-shaped object the `PromptBuilder` can consume in
 * place of a live `MemoryFiles.read()`. The path fields are preserved so
 * downstream code that surfaces file locations (the memory panel, the
 * `/memory` command output) keeps working.
 */
export class MemorySnapshot {
  public readonly contents: Readonly<MemoryFilesContents>;
  public readonly info: MemorySnapshotInfo;

  private constructor(
    contents: MemoryFilesContents,
    info: MemorySnapshotInfo,
  ) {
    this.contents = Object.freeze({ ...contents });
    this.info = Object.freeze({ ...info });
  }

  /**
   * Capture the three memory files into an immutable snapshot. Any disk
   * failure surfaces as an empty-strings snapshot rather than throwing --
   * an absent Memory.md is a normal new-user state.
   */
  static captureAtSessionStart(
    workspaceId: string,
    memoryFiles: MemoryFiles,
    mode: MemorySnapshotMode = "frozen",
  ): MemorySnapshot {
    let contents: MemoryFilesContents;
    try {
      contents = memoryFiles.read();
    } catch {
      contents = {
        instructions: "",
        memory: "",
        context: "",
        instructionsPath: memoryFiles.instructionsPath,
        memoryPath: memoryFiles.memoryPath,
        contextPath: memoryFiles.contextPath,
      };
    }
    return new MemorySnapshot(contents, {
      mode,
      capturedAt: Date.now(),
      workspaceId,
    });
  }

  /**
   * Test-only constructor that lets a unit test pin both the contents and
   * the captured-at timestamp. Production code paths use `captureAtSessionStart`.
   */
  static fromContents(
    workspaceId: string,
    contents: MemoryFilesContents,
    mode: MemorySnapshotMode = "frozen",
    capturedAt: number = Date.now(),
  ): MemorySnapshot {
    return new MemorySnapshot(contents, { workspaceId, mode, capturedAt });
  }
}

/**
 * Read-shim for `PromptBuilder`. In `frozen` mode it returns the snapshot
 * contents (so the prompt remains byte-stable across mid-session writes).
 * In `live` mode it falls back to a fresh `memoryFiles.read()` call.
 */
export function readWithSnapshot(
  snapshot: MemorySnapshot | null,
  memoryFiles: MemoryFiles | null,
): MemoryFilesContents | null {
  if (snapshot && snapshot.info.mode === "frozen") {
    return snapshot.contents;
  }
  if (!memoryFiles) return null;
  try {
    return memoryFiles.read();
  } catch {
    return null;
  }
}
