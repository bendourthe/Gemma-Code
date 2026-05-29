/**
 * v1.2.0 Phase 6.1 -- incremental re-scan adapter for `RepoScanner`.
 *
 * The Phase 3.3 `RepoScanner` already supports full-repo scans with
 * SHA-256 content hashing for incremental skip detection. Phase 6.1
 * extends that surface so the watcher abstraction can drive *targeted*
 * re-scans: when `FileWatcher` reports that paths X, Y, Z changed, the
 * scanner re-parses only those paths and prunes their rows.
 *
 * The Phase 3.6 stability gate (tool-call reduction) is unchanged; this
 * adapter wires the watcher to an existing scanner, no extraction logic
 * lives here. The full-scan path still runs at sidecar startup; this
 * adapter handles the delta between startup and the present.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { FileWatcher, type FileChange, type FileWatcherOptions } from "../../storage/FileWatcher.js";
import type { CodeGraphLanguage, ScannedFileSummary } from "../types.js";
import type { SqliteGraphStore } from "../store/index.js";
import { extractSymbols, type RepoScanner } from "./RepoScanner.js";
import { CODEGRAPH_DEFAULT_MAX_FILE_BYTES } from "../manifest.js";

export interface WatchedRepoScannerOptions {
  readonly store: SqliteGraphStore;
  readonly rootPath: string;
  /** Re-uses the existing full-scan implementation for the initial pass. */
  readonly scanner: RepoScanner;
  /** Per-file byte cap forwarded to the incremental pass. Default 1 MB. */
  readonly maxFileBytes?: number;
  /** Watcher options forwarded to the underlying FileWatcher. */
  readonly watcherOptions?: FileWatcherOptions;
  /** Optional hook fired after each debounced re-scan completes. */
  readonly onReindex?: (summary: WatchedReindexSummary) => void;
}

export interface WatchedReindexSummary {
  readonly filesReindexed: number;
  readonly filesRemoved: number;
  readonly filesSkippedIgnored: number;
  readonly filesSkippedSizeCap: number;
  readonly filesSkippedUnknownLang: number;
  readonly symbolsUpserted: number;
}

const LANGUAGE_BY_EXTENSION: Record<string, CodeGraphLanguage> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
};

/**
 * Drive the code-graph store off a `FileWatcher` so the graph stays in
 * sync with on-disk edits between full sidecar-startup scans.
 */
export class WatchedRepoScanner {
  private readonly _opts: Required<Omit<WatchedRepoScannerOptions, "onReindex" | "watcherOptions">> & {
    onReindex: NonNullable<WatchedRepoScannerOptions["onReindex"]>;
    watcherOptions: NonNullable<WatchedRepoScannerOptions["watcherOptions"]>;
  };
  private _watcher: FileWatcher | null = null;

  constructor(opts: WatchedRepoScannerOptions) {
    this._opts = {
      store: opts.store,
      rootPath: opts.rootPath,
      scanner: opts.scanner,
      maxFileBytes: opts.maxFileBytes ?? CODEGRAPH_DEFAULT_MAX_FILE_BYTES,
      watcherOptions: opts.watcherOptions ?? {},
      onReindex: opts.onReindex ?? (() => {}),
    };
  }

  /** Start watching. The full-repo scan must already have been run. */
  start(): FileWatcher {
    if (this._watcher) return this._watcher;
    const watcher = new FileWatcher(this._opts.rootPath, this._opts.watcherOptions);
    watcher.watch((changes) => this._handle(changes));
    this._watcher = watcher;
    return watcher;
  }

  /** Stop watching. Safe to call without `start()`. */
  stop(): void {
    if (!this._watcher) return;
    this._watcher.stop();
    this._watcher = null;
  }

  /**
   * Re-scan a specific set of changes (exposed for tests + flush hooks).
   * Returns the summary the watcher consumes via `onReindex`.
   */
  reindex(changes: readonly FileChange[]): WatchedReindexSummary {
    let filesReindexed = 0;
    let filesRemoved = 0;
    let filesSkippedIgnored = 0;
    let filesSkippedSizeCap = 0;
    let filesSkippedUnknownLang = 0;
    let symbolsUpserted = 0;

    for (const change of changes) {
      const lang = languageFor(change.path);
      if (!lang) {
        filesSkippedUnknownLang += 1;
        continue;
      }
      if (change.kind === "removed") {
        const existing = this._opts.store.findFileByPath(change.path);
        if (existing) {
          this._opts.store.deleteCallerEdgesForFile(existing.id);
          this._opts.store.deleteSymbolsForFile(existing.id);
          this._opts.store.deleteFile(existing.id);
          filesRemoved += 1;
        }
        continue;
      }

      const abs = path.join(this._opts.rootPath, change.path);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        // File vanished between the native event and our re-scan; treat
        // as a removal so the store row reflects reality.
        const existing = this._opts.store.findFileByPath(change.path);
        if (existing) {
          this._opts.store.deleteCallerEdgesForFile(existing.id);
          this._opts.store.deleteSymbolsForFile(existing.id);
          this._opts.store.deleteFile(existing.id);
          filesRemoved += 1;
        }
        continue;
      }
      if (stat.size > this._opts.maxFileBytes) {
        filesSkippedSizeCap += 1;
        continue;
      }

      let content: string;
      try {
        content = fs.readFileSync(abs, "utf-8");
      } catch {
        filesSkippedIgnored += 1;
        continue;
      }

      const hash = createHash("sha256").update(content).digest("hex");
      const existing = this._opts.store.findFileByPath(change.path);
      if (existing && existing.contentHash === hash) {
        // No semantic change despite the native event (often a mtime
        // bump from a save-without-edit). Nothing to do.
        continue;
      }
      const fileId = this._opts.store.upsertFile({
        path: change.path,
        language: lang,
        lastIndexedAt: Math.floor(Date.now() / 1000),
        contentHash: hash,
      });
      this._opts.store.deleteCallerEdgesForFile(fileId);
      this._opts.store.deleteSymbolsForFile(fileId);
      const extracted = extractSymbols(content, lang);
      for (const sym of extracted.symbols) {
        this._opts.store.upsertSymbol({
          fileId,
          name: sym.name,
          kind: sym.kind,
          lineStart: sym.lineStart,
          lineEnd: sym.lineEnd,
          signatureText: sym.signatureText,
        });
        symbolsUpserted += 1;
      }
      filesReindexed += 1;
      // Per-file summary mirrors RepoScanner's onFile contract.
      const summary: ScannedFileSummary = {
        path: change.path,
        language: lang,
        skipped: false,
        symbolCount: extracted.symbols.length,
        edgeCount: 0,
      };
      void summary;
    }

    return Object.freeze({
      filesReindexed,
      filesRemoved,
      filesSkippedIgnored,
      filesSkippedSizeCap,
      filesSkippedUnknownLang,
      symbolsUpserted,
    });
  }

  private _handle(changes: readonly FileChange[]): void {
    const summary = this.reindex(changes);
    this._opts.onReindex(summary);
  }
}

function languageFor(relativePath: string): CodeGraphLanguage | null {
  const ext = path.extname(relativePath).toLowerCase();
  return LANGUAGE_BY_EXTENSION[ext] ?? null;
}
