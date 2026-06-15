// v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T018) -- persistent session store.
//
// Adopts report item 26 (`re-partial`, Hermes Desktop S5): cross-surface
// session resume. Sessions were previously held only in the in-memory
// `CodingSessionManager`, so a session started in one surface (CLI) could not
// resume in another (desktop). This store persists each session's summary +
// full message history to `<nexusHome>/sessions.json`, the daemon's shared
// `SessionStore` the `core/coding/SessionList` docstring anticipates. A second
// manager instance constructed over the same file observes sessions the first
// created, which is the cross-surface resume handshake.
//
// Local-only: a single JSON file under the per-user data root. No network, no
// new dependency.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { nexusHome } from "../../../../core/storage/paths.js";
import type { SidecarModelEntry } from "./models.js";

/** A session as persisted to disk: summary + the full message history. */
export interface PersistedSession {
  readonly id: string;
  /** The full model projection so a session resumes even if the model list changed. */
  readonly model: SidecarModelEntry;
  readonly title: string;
  readonly createdAt: string;
  readonly messages: readonly string[];
}

/** Persistence seam for `CodingSessionManager`. Synchronous to match the manager. */
export interface SessionStore {
  /** All persisted sessions (insertion order). */
  list(): readonly PersistedSession[];
  /** A single session by id, or undefined. */
  get(id: string): PersistedSession | undefined;
  /** Store (or overwrite) a session. */
  upsert(session: PersistedSession): void;
}

interface SessionsFile {
  readonly version: 1;
  readonly sessions: readonly PersistedSession[];
}

/** Default path for the shared session store: `<nexusHome>/sessions.json`. */
export function defaultSessionStorePath(homeDirFn?: () => string): string {
  return path.join(nexusHome(homeDirFn), "sessions.json");
}

/**
 * A {@link SessionStore} backed by a single JSON file. The file is loaded once
 * on construction and rewritten atomically (temp + rename) on every upsert. A
 * missing or corrupt file degrades to an empty store rather than throwing, so a
 * first launch (or a hand-mangled file) never breaks session start.
 */
export class JsonFileSessionStore implements SessionStore {
  private readonly _filePath: string;
  private readonly _sessions = new Map<string, PersistedSession>();

  constructor(filePath: string = defaultSessionStorePath()) {
    this._filePath = filePath;
    this._load();
  }

  private _load(): void {
    if (!existsSync(this._filePath)) return;
    try {
      const raw = readFileSync(this._filePath, "utf8");
      const parsed = JSON.parse(raw) as SessionsFile;
      if (!parsed || !Array.isArray(parsed.sessions)) return;
      for (const s of parsed.sessions) {
        if (s && typeof s.id === "string") this._sessions.set(s.id, s);
      }
    } catch {
      // Corrupt file: start empty rather than crash the daemon.
    }
  }

  private _persist(): void {
    const dir = path.dirname(this._filePath);
    mkdirSync(dir, { recursive: true });
    const payload: SessionsFile = {
      version: 1,
      sessions: Array.from(this._sessions.values()),
    };
    const tmp = `${this._filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    renameSync(tmp, this._filePath);
  }

  list(): readonly PersistedSession[] {
    return Array.from(this._sessions.values());
  }

  get(id: string): PersistedSession | undefined {
    return this._sessions.get(id);
  }

  upsert(session: PersistedSession): void {
    this._sessions.set(session.id, session);
    this._persist();
  }
}
