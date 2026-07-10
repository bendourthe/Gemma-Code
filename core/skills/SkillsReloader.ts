/**
 * v1.1.0 Phase 8.1 -- ACTIVE pointer watcher driving SkillLoader.reload().
 *
 * Watches `~/.nexus/skills/devai-hub/ACTIVE` and triggers a debounced
 * `reload()` on the supplied catalog when the pointer's content changes.
 *
 * `nexus skills sync --apply` rotates the active install with a
 * write-tmp-then-rename pattern. A naive `fs.watch` consumer would fire
 * twice (once for the tmp create, once for the rename); the debounce
 * collapses bursts within `debounceMs` (default 200 ms) into a single
 * reload. The watcher is deliberately tolerant of the parent directory
 * not existing yet -- the syncer creates it on first apply.
 *
 * Closes v1.0.0 carryforward `10.P1.GGG` (SkillLoader hot-reload).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { activeTagPointerPath, defaultSkillsRoot } from "./NexusHubSyncer.js";

export interface ReloadableCatalog {
  reload(): Promise<void> | void;
}

export interface SkillsReloaderOptions {
  /** Root of the user's `.nexus/skills/` tree. Defaults to `~/.nexus/skills`. */
  readonly skillsRoot?: string;
  /** Catalog whose `reload()` is invoked on pointer change. */
  readonly catalog: ReloadableCatalog;
  /** Debounce window in ms. Defaults to 200. */
  readonly debounceMs?: number;
  /** Injectable timer pair for tests. */
  readonly setTimeout?: (cb: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  /** Called after every successful reload. Used by UI ("Loaded N new skills"). */
  readonly onReload?: (tag: string | null) => void;
  /** Called when a reload throws. Defaults to a console.warn. */
  readonly onError?: (err: unknown) => void;
}

interface WatchHandle {
  close(): void;
}

/**
 * Open `fs.watch` on the ACTIVE pointer file. Returns a `WatchHandle`
 * with a `close()` method that detaches the watcher and clears any
 * pending debounce timer. Calling `start()` twice without `stop()` is
 * a no-op (idempotent).
 */
export class SkillsReloader {
  private readonly _skillsRoot: string;
  private readonly _catalog: ReloadableCatalog;
  private readonly _debounceMs: number;
  private readonly _setTimeout: (cb: () => void, ms: number) => unknown;
  private readonly _clearTimeout: (handle: unknown) => void;
  private readonly _onReload: (tag: string | null) => void;
  private readonly _onError: (err: unknown) => void;
  private _watcher: fs.FSWatcher | null = null;
  private _dirWatcher: fs.FSWatcher | null = null;
  private _pendingHandle: unknown = null;
  private _reloadCount = 0;

  constructor(opts: SkillsReloaderOptions) {
    this._skillsRoot = opts.skillsRoot ?? defaultSkillsRoot();
    this._catalog = opts.catalog;
    this._debounceMs = opts.debounceMs ?? 200;
    this._setTimeout =
      opts.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));
    this._clearTimeout =
      opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this._onReload = opts.onReload ?? (() => {});
    this._onError =
      opts.onError ??
      ((err) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[SkillsReloader] reload failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  /**
   * Begin watching the ACTIVE pointer. Returns a `WatchHandle` so callers
   * can detach on shutdown. Safe to call when the pointer file does not
   * yet exist; the directory watcher waits for the first `--apply` run
   * to create it before promoting to a file-level watch.
   */
  start(): WatchHandle {
    if (this._watcher || this._dirWatcher) {
      return { close: () => this.stop() };
    }
    const pointer = activeTagPointerPath(this._skillsRoot);
    const dir = path.dirname(pointer);

    if (fs.existsSync(pointer)) {
      this._attachFileWatcher(pointer);
    } else if (fs.existsSync(dir)) {
      this._attachDirWatcher(dir, pointer);
    } else {
      // Neither the file nor its parent dir exists yet. Watch the skills
      // root (which is always created at sidecar boot) for the `devai-hub`
      // subtree to appear.
      const skillsRootExists = fs.existsSync(this._skillsRoot);
      if (skillsRootExists) {
        this._attachDirWatcher(this._skillsRoot, pointer);
      }
    }

    return { close: () => this.stop() };
  }

  /** Detach watchers and clear any pending debounce timer. */
  stop(): void {
    this._watcher?.close();
    this._watcher = null;
    this._dirWatcher?.close();
    this._dirWatcher = null;
    if (this._pendingHandle !== null) {
      this._clearTimeout(this._pendingHandle);
      this._pendingHandle = null;
    }
  }

  /** Test surface: how many reloads have actually fired. */
  get reloadCount(): number {
    return this._reloadCount;
  }

  /** Force a reload immediately (used by tests + the explicit "Sync now" path). */
  async reloadNow(): Promise<void> {
    await this._fireReload();
  }

  /**
   * Test surface -- schedule a debounced reload as if the OS file watcher
   * had fired. Production code reaches this via the `fs.watch` callback;
   * tests use it to assert the debounce collapses bursts.
   */
  triggerForTest(): void {
    this._scheduleReload(activeTagPointerPath(this._skillsRoot));
  }

  private _attachFileWatcher(pointer: string): void {
    try {
      this._watcher = fs.watch(pointer, { persistent: false }, () => {
        this._scheduleReload(pointer);
      });
    } catch (err) {
      this._onError(err);
    }
  }

  private _attachDirWatcher(dir: string, pointer: string): void {
    try {
      this._dirWatcher = fs.watch(dir, { persistent: false }, (_evt, filename) => {
        if (!filename) {
          // Some platforms (notably Linux when an inotify rename fires
          // without a filename payload) deliver null. Re-check by hand.
          if (fs.existsSync(pointer)) this._promoteToFileWatch(pointer);
          return;
        }
        const candidate = path.basename(pointer);
        if (typeof filename === "string" && filename.endsWith(candidate)) {
          if (fs.existsSync(pointer)) {
            this._promoteToFileWatch(pointer);
            this._scheduleReload(pointer);
          }
        }
      });
    } catch (err) {
      this._onError(err);
    }
  }

  private _promoteToFileWatch(pointer: string): void {
    if (this._watcher) return;
    this._dirWatcher?.close();
    this._dirWatcher = null;
    this._attachFileWatcher(pointer);
  }

  private _scheduleReload(pointer: string): void {
    if (this._pendingHandle !== null) {
      this._clearTimeout(this._pendingHandle);
    }
    this._pendingHandle = this._setTimeout(() => {
      this._pendingHandle = null;
      void this._fireReload(pointer);
    }, this._debounceMs);
  }

  private async _fireReload(pointer?: string): Promise<void> {
    const ptr = pointer ?? activeTagPointerPath(this._skillsRoot);
    let activeTag: string | null = null;
    try {
      activeTag = fs.readFileSync(ptr, "utf-8").trim() || null;
    } catch {
      activeTag = null;
    }
    try {
      await this._catalog.reload();
      this._reloadCount++;
      this._onReload(activeTag);
    } catch (err) {
      this._onError(err);
    }
  }
}

/**
 * Convenience factory used by `codingBootstrap.ts`. Returns the reloader
 * already `start()`-ed against the default `~/.nexus/skills/` tree.
 */
export function startSkillsReloader(opts: SkillsReloaderOptions): SkillsReloader {
  const reloader = new SkillsReloader(opts);
  reloader.start();
  return reloader;
}
