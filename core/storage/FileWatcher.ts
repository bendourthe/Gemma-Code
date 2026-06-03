/**
 * v1.2.0 Phase 6.1 -- shared OS-native file-watcher abstraction.
 *
 * Wraps Node's built-in `fs.watch` with a debounce + `.nexusignore` filter,
 * lifting the file-watching responsibility out of the Phase 3 code-graph
 * scanner (`core/codegraph/scanner/RepoScanner.ts`) into a reusable surface.
 * Memory ingest, code-graph re-index, and (future) skill-catalog refresh
 * all share this one debounced event source.
 *
 * DEVIATION (logged as DF in `docs/versions/v1/v1.2.0/known-gaps.md`): the plan prompt
 * says to wrap `chokidar`. The Nexus repo does not currently ship
 * `chokidar`, and the re-partial bucket does not justify adding a new
 * dependency. Node's `fs.watch` covers the OS-native event sources
 * required (FSEvents / inotify / ReadDirectoryChangesW) on every supported
 * platform; the debounce, recursion, and ignore-file honoring all live in
 * this module rather than in the underlying watcher. If chokidar becomes
 * justified later (e.g. for cross-platform recursive watching on Linux
 * without polling), the public API of `FileWatcher` was chosen to be
 * compatible -- only the internal `_subscribeNative` impl would swap.
 *
 * v1.4.0 Phase 8 (gap 6.1.P3.U, CLOSED keep-fs.watch): re-confirmed. `fs.watch`
 * has covered every supported platform across v1.2.0-v1.4.0 with no observed
 * miss; adding `chokidar` (a sizeable dependency tree) is not justified on
 * evidence. The swap-ready `_subscribeNative` seam remains if that changes.
 *
 * Surface required by the Phase 6.1 prompt:
 *   - `watch(rootPath, callback)`: subscribe; the callback receives the
 *     debounced batch of `FileChange` records.
 *   - `stop()`: unsubscribe and release native handles.
 *   - `pendingChanges()`: snapshot of debounced not-yet-fired changes.
 *
 * The 2-second debounce is configurable via constructor option for tests
 * that need a tighter window. Default `2000` ms per the plan.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  defaultIgnorePatterns,
  matchesIgnore,
  mergeIgnorePatterns,
  parseIgnoreFile,
  type IgnorePatterns,
} from "./NexusIgnore.js";

/** A single file-system event after debouncing. */
export interface FileChange {
  /** Repo-root-relative path with forward slashes (normalised). */
  readonly path: string;
  /** `added`, `modified`, or `removed` per the most recent native event. */
  readonly kind: "added" | "modified" | "removed";
}

export type FileWatcherCallback = (
  changes: readonly FileChange[],
) => void | Promise<void>;

export interface FileWatcherOptions {
  /** Debounce window in ms. Default 2000 (per Phase 6.1 plan). */
  readonly debounceMs?: number;
  /**
   * Whether to apply `.nexusignore` / `.gitignore` filtering. Default `true`.
   * Disable for tests that want every native event surfaced.
   */
  readonly honorIgnoreFiles?: boolean;
  /** Extra path-segment exclusions on top of the ignore-file set. */
  readonly extraExcludes?: readonly string[];
  /**
   * Inject the underlying watch implementation for tests. Returns an
   * `unsubscribe()` closure. The injected impl is responsible for raising
   * a `nativeEvent` for every fs change it sees.
   */
  readonly subscribe?: (
    rootPath: string,
    onEvent: (kind: NativeEventKind, relPath: string) => void,
  ) => () => void;
}

export type NativeEventKind = "create" | "modify" | "delete";

interface PendingEntry {
  readonly path: string;
  kind: "added" | "modified" | "removed";
}

/**
 * Debounced, ignore-aware file-system watcher. Construct one per root,
 * call `watch(callback)` once, and `stop()` when the consumer is torn
 * down. The constructor is intentionally synchronous; native handles are
 * acquired only on `watch()`.
 */
export class FileWatcher {
  private readonly _rootPath: string;
  private readonly _debounceMs: number;
  private readonly _honorIgnoreFiles: boolean;
  private readonly _extraExcludes: readonly string[];
  private readonly _subscribeImpl: NonNullable<FileWatcherOptions["subscribe"]>;

  private _ignorePatterns: IgnorePatterns | null = null;
  private _pending: Map<string, PendingEntry> = new Map();
  private _timer: NodeJS.Timeout | null = null;
  private _unsubscribe: (() => void) | null = null;
  private _callback: FileWatcherCallback | null = null;
  private _firing = false;

  constructor(rootPath: string, opts: FileWatcherOptions = {}) {
    this._rootPath = path.resolve(rootPath);
    this._debounceMs = opts.debounceMs ?? 2000;
    this._honorIgnoreFiles = opts.honorIgnoreFiles ?? true;
    this._extraExcludes = opts.extraExcludes ?? [];
    this._subscribeImpl = opts.subscribe ?? defaultSubscribe;
  }

  /**
   * Begin watching. The callback fires (a) at most once per debounce
   * window, (b) with the dedup-by-path batch of changes accumulated
   * during the window. A second call replaces the prior callback; the
   * native subscription is reused.
   */
  watch(callback: FileWatcherCallback): void {
    this._callback = callback;
    this._refreshIgnorePatterns();
    if (this._unsubscribe) return;
    this._unsubscribe = this._subscribeImpl(this._rootPath, (kind, relPath) => {
      this._ingestNativeEvent(kind, relPath);
    });
  }

  /**
   * Stop watching, release native handles, drop any debounced state.
   * Idempotent.
   */
  stop(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._unsubscribe) {
      try {
        this._unsubscribe();
      } catch {
        // The native watcher may already be closed -- ignore.
      }
      this._unsubscribe = null;
    }
    this._pending.clear();
    this._callback = null;
  }

  /**
   * Snapshot of debounced changes that have not yet been delivered to
   * the callback. Order matches accumulation order (Map insertion).
   */
  pendingChanges(): readonly FileChange[] {
    const out: FileChange[] = [];
    for (const entry of this._pending.values()) {
      out.push(Object.freeze({ path: entry.path, kind: entry.kind }));
    }
    return Object.freeze(out);
  }

  /**
   * Force the next debounce cycle to fire immediately. Tests use this
   * to avoid sleeping the 2-second window; production code never calls
   * this directly.
   */
  flushForTest(): Promise<void> {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    return this._fire();
  }

  /**
   * Re-read `.gitignore` + `.nexusignore` from disk. Watchers re-load
   * patterns at the start of every debounce fire so callers can edit
   * the ignore files mid-session without restarting the watcher.
   */
  private _refreshIgnorePatterns(): void {
    if (!this._honorIgnoreFiles) {
      this._ignorePatterns = null;
      return;
    }
    const defaults = defaultIgnorePatterns();
    let gitignore: IgnorePatterns | null = null;
    let nexusignore: IgnorePatterns | null = null;
    try {
      gitignore = parseIgnoreFile(
        fs.readFileSync(path.join(this._rootPath, ".gitignore"), "utf-8"),
      );
    } catch {
      gitignore = null;
    }
    try {
      nexusignore = parseIgnoreFile(
        fs.readFileSync(path.join(this._rootPath, ".nexusignore"), "utf-8"),
      );
    } catch {
      nexusignore = null;
    }
    const extras = parseIgnoreFile(this._extraExcludes.join("\n"));
    this._ignorePatterns = mergeIgnorePatterns(
      defaults,
      gitignore ?? defaults,
      nexusignore ?? defaults,
      extras,
    );
  }

  private _ingestNativeEvent(kind: NativeEventKind, relPath: string): void {
    const normalised = relPath.replace(/\\/g, "/");
    if (this._honorIgnoreFiles && this._ignorePatterns) {
      if (matchesIgnore(normalised, this._ignorePatterns)) return;
    }
    const existing = this._pending.get(normalised);
    const mapped =
      kind === "create" ? "added" : kind === "delete" ? "removed" : "modified";
    if (existing) {
      // delete supersedes modify; modify supersedes create only if the
      // current state already records `added`. The simplest rule that
      // matches typical consumer expectations: the *last* event wins
      // unless it would downgrade a `removed` back to `modified` (which
      // would be misleading: a removed file is no longer modifiable).
      if (existing.kind === "removed" && mapped === "modified") return;
      existing.kind = mapped;
    } else {
      this._pending.set(normalised, { path: normalised, kind: mapped });
    }
    if (!this._timer) {
      this._timer = setTimeout(() => {
        this._timer = null;
        void this._fire();
      }, this._debounceMs);
    }
  }

  private async _fire(): Promise<void> {
    if (this._firing) return;
    if (this._pending.size === 0) return;
    // Refresh ignore patterns FIRST so the just-collected batch is
    // re-filtered against any `.nexusignore` writes that happened during
    // the debounce window (the common case is the user editing the
    // ignore file to silence noise the watcher is currently emitting).
    this._refreshIgnorePatterns();
    const filtered: FileChange[] = [];
    for (const entry of this._pending.values()) {
      if (
        this._honorIgnoreFiles &&
        this._ignorePatterns &&
        matchesIgnore(entry.path, this._ignorePatterns)
      ) {
        continue;
      }
      filtered.push(Object.freeze({ path: entry.path, kind: entry.kind }));
    }
    this._pending.clear();
    if (filtered.length === 0) return;
    const cb = this._callback;
    if (!cb) return;
    this._firing = true;
    try {
      await cb(Object.freeze(filtered));
    } finally {
      this._firing = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Default native subscription -- thin `fs.watch` wrapper
// ---------------------------------------------------------------------------

function defaultSubscribe(
  rootPath: string,
  onEvent: (kind: NativeEventKind, relPath: string) => void,
): () => void {
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(
      rootPath,
      { recursive: true, persistent: false },
      (eventType, filename) => {
        if (!filename) return;
        // Without an explicit `encoding` option `fs.watch` types filename
        // as `string`; cast through `unknown` so the Buffer branch (only
        // reachable with `encoding: 'buffer'`) does not narrow to `never`.
        const rel = String(filename as unknown);
        // `fs.watch` does not reliably distinguish create from modify on
        // every platform. We re-stat the absolute path and infer:
        //   - file exists -> create (if pending was none) or modify
        //   - file does not exist -> delete
        // The watcher above is the only call site that cares; consumers
        // see the debounced state, not the raw event.
        const abs = path.join(rootPath, rel);
        try {
          fs.statSync(abs);
          onEvent(eventType === "rename" ? "create" : "modify", rel);
        } catch {
          onEvent("delete", rel);
        }
      },
    );
  } catch {
    // Recursive watch is not supported on every Linux kernel <5.13 with
    // inotify. The Phase 6 stability gate documents this constraint;
    // callers degrade to "poll on demand" rather than crash.
    return () => {};
  }
  return () => {
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
      watcher = null;
    }
  };
}
