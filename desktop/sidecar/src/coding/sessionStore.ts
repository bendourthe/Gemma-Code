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
//
// v1.6.0 Phase 3 (adoption-aisuite-harness A1 / AS005): large message fields
// are dehydrated out-of-line to a content-addressed `ArtifactStore` on the
// disk-write path and rehydrated on load. The dehydration is purely an on-disk
// representation detail -- the in-memory `_sessions` map and the public
// `PersistedSession` surface always carry full message text, so neither
// `CodingSessionManager` nor the IPC contract changes. A file persisted before
// this change (schema v1, all inline strings) loads unchanged because
// `hydrateMessages` passes plain strings through verbatim.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { nexusHome } from "../../../../core/storage/paths.js";
import { ArtifactStore } from "../../../../core/memory/ArtifactStore.js";
import {
  DEFAULT_DEHYDRATION_THRESHOLD_BYTES,
  dehydrateMessages,
  hydrateMessages,
  type PersistedMessage,
} from "../../../../core/memory/sessionArtifacts.js";
import type { SidecarModelEntry } from "./models.js";

/** One persisted user prompt plus the assistant text that exists for that turn. */
export interface PersistedTurn {
  readonly prompt: string;
  readonly assistantText: string;
  readonly inputTokens?: number | null;
  readonly reasoningTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly tokensEstimated?: boolean;
  /** v2.2.7 Phase 4 -- ISO time for transcript chrome. Optional on older files. */
  readonly createdAt?: string;
}

/** A session as persisted to disk: summary + the full message history. */
export interface PersistedSession {
  readonly id: string;
  /** The full model projection so a session resumes even if the model list changed. */
  readonly model: SidecarModelEntry;
  readonly title: string;
  readonly createdAt: string;
  readonly messages: readonly string[];
  /** v2.2.6 Phase 4 -- optional because files written before this field omit it. */
  readonly turns?: readonly PersistedTurn[];
}

/** Persistence seam for `CodingSessionManager`. Synchronous to match the manager. */
export interface SessionStore {
  /** All persisted sessions (insertion order). */
  list(): readonly PersistedSession[];
  /** A single session by id, or undefined. */
  get(id: string): PersistedSession | undefined;
  /** Store (or overwrite) a session. */
  upsert(session: PersistedSession): void;
  /** Remove a session. Missing ids are a no-op. */
  delete(id: string): void;
}

/** A session as persisted to disk, where messages may be dehydration markers. */
interface DiskSession extends Omit<PersistedSession, "messages"> {
  readonly messages: readonly PersistedMessage[];
}

interface SessionsFile {
  /** Schema version: 1 = inline-only messages; 2 = dehydration-aware. */
  readonly version: number;
  readonly sessions: readonly DiskSession[];
}

/** Schema version this store writes. Bumped from 1 in v1.6.0 Phase 3 (A1). */
const SCHEMA_VERSION = 2;

/** Default path for the shared session store: `<nexusHome>/sessions.json`. */
export function defaultSessionStorePath(homeDirFn?: () => string): string {
  return path.join(nexusHome(homeDirFn), "sessions.json");
}

/** Options for {@link JsonFileSessionStore}. */
export interface JsonFileSessionStoreOptions {
  /**
   * Artifact store for out-of-line message dehydration. Defaults to a
   * `session-artifacts` directory next to the sessions file, which keeps
   * artifacts under the same per-user data root (`<nexusHome>/`).
   */
  readonly artifactStore?: ArtifactStore;
  /** Byte threshold above which a message is dehydrated. Defaults to 20KB. */
  readonly thresholdBytes?: number;
}

/**
 * A {@link SessionStore} backed by a single JSON file. The file is loaded once
 * on construction and rewritten atomically (temp + rename) on every upsert. A
 * missing or corrupt file degrades to an empty store rather than throwing, so a
 * first launch (or a hand-mangled file) never breaks session start.
 *
 * Large message fields are dehydrated to {@link ArtifactStore} on write and
 * rehydrated on read (v1.6.0 Phase 3 / A1), so the persisted JSON stays small
 * while the in-memory and public surfaces always carry full message text.
 */
export class JsonFileSessionStore implements SessionStore {
  private readonly _filePath: string;
  private readonly _sessions = new Map<string, PersistedSession>();
  private readonly _artifacts: ArtifactStore;
  private readonly _thresholdBytes: number;

  constructor(
    filePath: string = defaultSessionStorePath(),
    opts: JsonFileSessionStoreOptions = {},
  ) {
    this._filePath = filePath;
    this._artifacts =
      opts.artifactStore ??
      new ArtifactStore(path.join(path.dirname(filePath), "session-artifacts"));
    this._thresholdBytes = opts.thresholdBytes ?? DEFAULT_DEHYDRATION_THRESHOLD_BYTES;
    this._load();
  }

  private _load(): void {
    if (!existsSync(this._filePath)) return;
    try {
      const raw = readFileSync(this._filePath, "utf8");
      const parsed = JSON.parse(raw) as SessionsFile;
      if (!parsed || !Array.isArray(parsed.sessions)) return;
      for (const s of parsed.sessions) {
        if (!s || typeof s.id !== "string") continue;
        // Rehydrate dehydration markers back to full text. Plain strings (a
        // pre-v2 file) pass through unchanged -- the tolerant read path.
        const messages = hydrateMessages(
          Array.isArray(s.messages) ? s.messages : [],
          this._artifacts,
        );
        this._sessions.set(s.id, { ...s, messages });
      }
    } catch {
      // Corrupt file: start empty rather than crash the daemon.
    }
  }

  private _persist(): void {
    const dir = path.dirname(this._filePath);
    mkdirSync(dir, { recursive: true });
    const sessions: DiskSession[] = Array.from(this._sessions.values()).map((s) => ({
      ...s,
      messages: dehydrateMessages(s.messages, this._artifacts, {
        thresholdBytes: this._thresholdBytes,
      }),
    }));
    const payload: SessionsFile = { version: SCHEMA_VERSION, sessions };
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

  delete(id: string): void {
    if (!this._sessions.delete(id)) return;
    this._persist();
  }
}
