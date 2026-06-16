/**
 * v1.6.0 Phase 3 (adoption-aisuite-harness A1 / AS005) -- content-addressed
 * local artifact store for session-state dehydration.
 *
 * The aisuite comparison (Section 3.5) noted that aisuite dehydrates large
 * message fields (>20KB) to an artifact store and rehydrates them on load.
 * Nexus already had the byte-cap + command-output compressor pieces but kept
 * everything inline in the persisted session, so resumed sessions carried the
 * full weight of every captured stdout / diff / patch. This store closes that
 * gap with a purely local, zero-outbound, content-addressed file store under
 * `<nexusHome>/session-artifacts/`.
 *
 * Design notes:
 *   - Content-addressed: the store key is the SHA-256 of the (redacted)
 *     payload, so identical payloads dedupe to one file and writes are
 *     idempotent. This mirrors the `CommandCompressor` tee discipline.
 *   - Redaction on the write path: every payload is run through
 *     `redactSecrets` BEFORE it is hashed and written, so a secret captured in
 *     a tool result is never persisted to the artifact store unredacted. The
 *     hash is therefore of the redacted text, and `get` returns the redacted
 *     text -- the original secret never touches disk.
 *   - Synchronous fs: the consuming `SessionStore` seam is synchronous, so the
 *     store matches it. Payloads are small (one message field) and writes are
 *     content-addressed no-ops on repeat, so the sync cost is negligible.
 *   - No new dependency: node `crypto` + `fs` only, per the plan's local-only
 *     constraint.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { redactSecrets } from "../observability/redactSecrets.js";

/** A valid store key is a lowercase 64-char hex SHA-256 digest. */
const REF_RE = /^[0-9a-f]{64}$/;

export interface PutResult {
  /** The content-addressed store key (SHA-256 hex of the redacted payload). */
  readonly ref: string;
  /** Byte length of the stored (redacted) payload. */
  readonly bytes: number;
  /** True when the artifact already existed (content-addressed dedupe hit). */
  readonly deduped: boolean;
}

/**
 * A content-addressed file artifact store rooted at a single directory. Files
 * are sharded one level by the first two hex chars of the key
 * (`<dir>/<aa>/<full-hash>`) to keep any single directory small.
 */
export class ArtifactStore {
  private readonly _dir: string;

  /**
   * @param dir base directory for the store, e.g.
   *   `path.join(nexusHome(), "session-artifacts")`. Created on demand by
   *   `put`; never read or created at construction time.
   */
  constructor(dir: string) {
    this._dir = dir;
  }

  /** The store's base directory (for diagnostics / cleanup). */
  public get dir(): string {
    return this._dir;
  }

  /** Resolve the on-disk path for a key without touching the filesystem. */
  private _pathFor(ref: string): string | null {
    if (!REF_RE.test(ref)) return null;
    return path.join(this._dir, ref.slice(0, 2), ref);
  }

  /**
   * Redact, hash, and store `text`. Returns the content-addressed key. A
   * second `put` of the same (post-redaction) content is a cheap no-op that
   * reports `deduped: true`.
   */
  public put(text: string): PutResult {
    const redacted = redactSecrets(text);
    const ref = crypto.createHash("sha256").update(redacted, "utf8").digest("hex");
    const bytes = Buffer.byteLength(redacted, "utf8");
    const full = this._pathFor(ref);
    // `ref` is a freshly-computed digest, so `_pathFor` cannot return null;
    // the guard exists for the symmetric `get` path.
    if (full === null) {
      throw new Error("ArtifactStore.put: failed to derive a valid store key");
    }
    if (fs.existsSync(full)) {
      return { ref, bytes, deduped: true };
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    // Atomic-ish write: temp file + rename so a crash mid-write never leaves a
    // truncated artifact under the content-addressed name.
    const tmp = `${full}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, redacted, "utf8");
    fs.renameSync(tmp, full);
    return { ref, bytes, deduped: false };
  }

  /** True when `ref` is a well-formed key with a backing file. */
  public has(ref: string): boolean {
    const full = this._pathFor(ref);
    return full !== null && fs.existsSync(full);
  }

  /**
   * Read the (redacted) payload for `ref`, or `null` when the key is
   * malformed or the artifact is missing / unreadable. Never throws, so a
   * pruned or hand-deleted artifact degrades a resume to its inline preview
   * rather than crashing session load.
   */
  public get(ref: string): string | null {
    const full = this._pathFor(ref);
    if (full === null) return null;
    try {
      return fs.readFileSync(full, "utf8");
    } catch {
      return null;
    }
  }
}
