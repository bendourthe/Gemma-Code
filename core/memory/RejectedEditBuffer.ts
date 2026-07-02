/**
 * v1.7.0 Phase 2 (adoption-self-optimizing-skills S4 / SO002) -- rejected-edit
 * buffer.
 *
 * When the Phase 3 skill optimizer proposes an edit that fails the held-out
 * validation gate, the edit is not discarded silently -- it is recorded here so
 * the loop never re-proposes a known-bad edit and a human can audit why an edit
 * was rejected. The buffer is content-addressed and redaction-on-write: the
 * (potentially large, potentially secret-bearing) edit / trajectory text is
 * stored through the {@link ArtifactStore}, which redacts before it hashes and
 * writes, so a rejected edit's trajectory text never lands on disk unredacted.
 *
 * Design notes:
 *   - Keyed by `skillId + editHash`: the index entry per `(skill, edit)` pair.
 *     Re-recording the same key is idempotent (first write wins; no duplicate
 *     index row, no second artifact write).
 *   - The lightweight index (skill id, edit hash, artifact ref, rejection
 *     reason, validation delta, timestamp) is a JSON array file alongside the
 *     artifact store. The bulky content lives only in the content-addressed
 *     store. The rejection `reason` is itself redacted before it is indexed.
 *   - Synchronous fs + atomic temp-then-rename writes, matching the
 *     `ArtifactStore` it composes. No new dependency: node `crypto` + `fs`.
 *   - `core/`-layer only: composes `ArtifactStore` (core/memory) and
 *     `redactSecrets` (core/observability); inputs are primitives, so the
 *     module never reaches into any pillar's types (no-core-from-modules).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { redactSecrets } from "../observability/redactSecrets.js";
import { ArtifactStore } from "./ArtifactStore.js";

/** Input describing one rejected skill edit to buffer. */
export interface RejectedEditInput {
  /** Id of the skill the edit targeted. */
  readonly skillId: string;
  /** Stable hash of the proposed edit (use {@link hashEdit} on the edit text). */
  readonly editHash: string;
  /** Why the edit was rejected (e.g. the validation gate's reason). Redacted on write. */
  readonly reason: string;
  /** The validation aggregate delta that drove the rejection. */
  readonly validationDelta: number;
  /**
   * The edit / failing-trajectory text. Stored content-addressed and redacted
   * via {@link ArtifactStore}; never persisted inline-raw.
   */
  readonly content: string;
}

/** A persisted rejected-edit index entry (the bulky content lives in the store). */
export interface RejectedEditRecord {
  /** `${skillId}:${editHash}`. */
  readonly key: string;
  readonly skillId: string;
  readonly editHash: string;
  /** Redacted rejection reason. */
  readonly reason: string;
  readonly validationDelta: number;
  /** Content-addressed key of the (redacted) content in the artifact store. */
  readonly artifactRef: string;
  /** Epoch milliseconds when the rejection was recorded. */
  readonly recordedAt: number;
}

/** A rejected edit resolved from the buffer: its record plus rehydrated (redacted) content. */
export interface ResolvedRejectedEdit {
  readonly record: RejectedEditRecord;
  /** The stored (redacted) content, or `""` if the artifact is missing. */
  readonly content: string;
}

/** Deterministic SHA-256 hex of an edit's text, for use as `editHash`. */
export function hashEdit(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function compositeKey(skillId: string, editHash: string): string {
  return `${skillId}:${editHash}`;
}

/**
 * A content-addressed, redaction-on-write buffer of rejected skill edits,
 * keyed by `skillId + editHash`.
 */
export class RejectedEditBuffer {
  private readonly _store: ArtifactStore;
  private readonly _indexPath: string;
  private readonly _now: () => number;

  /**
   * @param store artifact store for the (redacted) edit content
   * @param indexPath JSON file holding the lightweight record index
   * @param now injectable clock for deterministic `recordedAt` in tests
   */
  constructor(store: ArtifactStore, indexPath: string, now: () => number = Date.now) {
    this._store = store;
    this._indexPath = indexPath;
    this._now = now;
  }

  /** The backing artifact store (for diagnostics / cleanup). */
  public get store(): ArtifactStore {
    return this._store;
  }

  /** The index file path. */
  public get indexPath(): string {
    return this._indexPath;
  }

  /**
   * Record a rejected edit. The content is redacted + content-addressed into
   * the artifact store; a redacted index row is appended. Idempotent on
   * `skillId + editHash`: a repeat returns the existing record without writing
   * a duplicate.
   */
  public record(input: RejectedEditInput): RejectedEditRecord {
    const key = compositeKey(input.skillId, input.editHash);
    const index = this._readIndex();
    const existing = index.find((r) => r.key === key);
    if (existing) return existing;

    const { ref } = this._store.put(input.content);
    const record: RejectedEditRecord = {
      key,
      skillId: input.skillId,
      editHash: input.editHash,
      reason: redactSecrets(input.reason),
      validationDelta: input.validationDelta,
      artifactRef: ref,
      recordedAt: this._now(),
    };
    index.push(record);
    this._writeIndex(index);
    return record;
  }

  /** True when an edit with this `skillId + editHash` has been buffered. */
  public has(skillId: string, editHash: string): boolean {
    const key = compositeKey(skillId, editHash);
    return this._readIndex().some((r) => r.key === key);
  }

  /**
   * Resolve a buffered edit by `skillId + editHash`, rehydrating its (redacted)
   * content from the artifact store. Returns `null` when the key is unknown.
   */
  public get(skillId: string, editHash: string): ResolvedRejectedEdit | null {
    const key = compositeKey(skillId, editHash);
    const record = this._readIndex().find((r) => r.key === key);
    if (!record) return null;
    return { record, content: this._store.get(record.artifactRef) ?? "" };
  }

  /** List buffered records, optionally filtered to one skill, newest last. */
  public list(skillId?: string): readonly RejectedEditRecord[] {
    const index = this._readIndex();
    return skillId === undefined ? index : index.filter((r) => r.skillId === skillId);
  }

  /**
   * Read the index file. Returns `[]` when the file is missing or unreadable /
   * corrupt, so a hand-deleted or partially-written index degrades to empty
   * rather than throwing.
   */
  private _readIndex(): RejectedEditRecord[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this._indexPath, "utf8");
    } catch {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as RejectedEditRecord[]) : [];
    } catch {
      return [];
    }
  }

  /** Atomically (temp + rename) persist the index. */
  private _writeIndex(records: readonly RejectedEditRecord[]): void {
    fs.mkdirSync(path.dirname(this._indexPath), { recursive: true });
    const tmp = `${this._indexPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2), "utf8");
    fs.renameSync(tmp, this._indexPath);
  }
}

/**
 * Build a {@link RejectedEditBuffer} rooted at `dir`: edit content in
 * `<dir>/artifacts/` (content-addressed) and the index at `<dir>/index.json`.
 */
export function createRejectedEditBuffer(dir: string, now?: () => number): RejectedEditBuffer {
  return new RejectedEditBuffer(
    new ArtifactStore(path.join(dir, "artifacts")),
    path.join(dir, "index.json"),
    now,
  );
}
