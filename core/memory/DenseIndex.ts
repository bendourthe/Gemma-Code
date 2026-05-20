/**
 * v1.1.0 Phase 5.3 -- dense vector index over the embedded memory entries.
 *
 * Storage model: a flat `Float32Array[]` keyed by `entryId`. Search is a
 * linear cosine-similarity scan; at 1,000 entries x 384-dim the scan
 * completes in <2 ms on a modern CPU, so HNSW is not needed yet. The
 * upgrade path -- swap the linear scan for `hnswlib-node` when corpora
 * grow beyond ~50,000 entries -- is recorded for v1.2.0 follow-up.
 *
 * Persistence: the index can be saved to / loaded from a flat binary
 * file (`save` / `load` static helpers). The on-disk format is:
 *
 *     header  : "NXDI" (4 bytes) + uint32 dim + uint32 count
 *     entries : [ uint32 idLen | utf8 id bytes | dim * float32 vec ]*
 *
 * Tombstones: `delete(id)` marks the slot rather than splicing it out so
 * search remains O(N). The `compact()` helper rebuilds the slot array to
 * drop tombstones; the warm-build worker calls it on startup.
 *
 * Adopts agentmemory A1 (see docs/v1.1.0/comparison-agentmemory.md
 * Section 11.2 P1).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { cosineSimilarity, EMBEDDING_DIM } from "./LocalEmbedder.js";

export interface DenseHit {
  readonly entryId: string;
  readonly score: number;
}

export interface DenseIndexOptions {
  /** Vector dimensionality. Defaults to the embedder's 384. */
  readonly dim?: number;
}

interface Slot {
  readonly entryId: string;
  readonly vec: Float32Array;
  tombstoned: boolean;
}

const MAGIC = "NXDI";

export class DenseIndex {
  readonly dim: number;

  private _slots: Slot[] = [];
  /** entryId -> index into `_slots`. */
  private _byId = new Map<string, number>();

  constructor(opts: DenseIndexOptions = {}) {
    this.dim = opts.dim ?? EMBEDDING_DIM;
  }

  /** Number of live (non-tombstoned) entries. */
  get size(): number {
    let n = 0;
    for (const slot of this._slots) if (!slot.tombstoned) n++;
    return n;
  }

  /**
   * Add or replace the vector for `entryId`. Vectors that do not match the
   * configured dimensionality are silently zero-padded / truncated.
   */
  add(entryId: string, vec: Float32Array): void {
    const fitted = this._fit(vec);
    const existing = this._byId.get(entryId);
    if (existing !== undefined) {
      this._slots[existing] = {
        entryId,
        vec: fitted,
        tombstoned: false,
      };
      return;
    }
    this._byId.set(entryId, this._slots.length);
    this._slots.push({ entryId, vec: fitted, tombstoned: false });
  }

  /** Mark a slot as tombstoned. Returns `true` when the entry existed. */
  delete(entryId: string): boolean {
    const idx = this._byId.get(entryId);
    if (idx === undefined) return false;
    const slot = this._slots[idx];
    if (!slot || slot.tombstoned) return false;
    slot.tombstoned = true;
    return true;
  }

  /**
   * Top-K nearest neighbours by cosine similarity. Returns at most `limit`
   * entries with score in descending order. Tombstoned slots are skipped.
   */
  search(query: Float32Array, limit = 10): DenseHit[] {
    if (this._slots.length === 0 || limit <= 0) return [];
    const fitted = this._fit(query);
    const hits: DenseHit[] = [];
    for (const slot of this._slots) {
      if (slot.tombstoned) continue;
      const score = cosineSimilarity(fitted, slot.vec);
      hits.push({ entryId: slot.entryId, score });
    }
    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entryId < b.entryId ? -1 : 1;
    });
    return hits.slice(0, limit);
  }

  /** Drop tombstoned slots and rebuild the id -> index map. */
  compact(): void {
    const next: Slot[] = [];
    const map = new Map<string, number>();
    for (const slot of this._slots) {
      if (slot.tombstoned) continue;
      map.set(slot.entryId, next.length);
      next.push(slot);
    }
    this._slots = next;
    this._byId = map;
  }

  /** Drop every entry. */
  clear(): void {
    this._slots = [];
    this._byId.clear();
  }

  /**
   * Persist the index to disk. The directory is created if needed; on
   * success the file at `filePath` contains the serialized live entries
   * (tombstones are dropped during save).
   */
  async save(filePath: string): Promise<void> {
    const live = this._slots.filter((s) => !s.tombstoned);
    const idBuffers: Buffer[] = [];
    let totalIdBytes = 0;
    for (const slot of live) {
      const buf = Buffer.from(slot.entryId, "utf8");
      idBuffers.push(buf);
      totalIdBytes += buf.length;
    }
    const headerBytes = 4 + 4 + 4; // magic + dim + count
    const perEntryFixed = 4; // uint32 idLen prefix
    const vecBytes = this.dim * 4;
    const totalSize =
      headerBytes + live.length * (perEntryFixed + vecBytes) + totalIdBytes;
    const buf = Buffer.alloc(totalSize);
    let offset = 0;
    buf.write(MAGIC, offset, 4, "utf8");
    offset += 4;
    buf.writeUInt32LE(this.dim, offset);
    offset += 4;
    buf.writeUInt32LE(live.length, offset);
    offset += 4;
    for (let i = 0; i < live.length; i++) {
      const slot = live[i]!;
      const idBuf = idBuffers[i]!;
      buf.writeUInt32LE(idBuf.length, offset);
      offset += 4;
      idBuf.copy(buf, offset);
      offset += idBuf.length;
      // writeFloatLE is endian-safe and does not require 4-byte alignment
      // (we cannot guarantee alignment because idBuf has variable length).
      for (let j = 0; j < this.dim; j++) {
        buf.writeFloatLE(slot.vec[j] ?? 0, offset + j * 4);
      }
      offset += vecBytes;
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buf);
  }

  /**
   * Load an index from disk. Returns an empty index when the file does
   * not exist (treated as "first launch / nothing to restore"). Throws
   * when the file exists but is malformed.
   */
  static async load(filePath: string): Promise<DenseIndex> {
    let buf: Buffer;
    try {
      buf = await fs.readFile(filePath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return new DenseIndex();
      }
      throw e;
    }
    if (buf.length < 12) throw new Error(`DenseIndex.load: file too small (${buf.length} bytes)`);
    const magic = buf.toString("utf8", 0, 4);
    if (magic !== MAGIC) {
      throw new Error(`DenseIndex.load: bad magic '${magic}' (expected '${MAGIC}')`);
    }
    const dim = buf.readUInt32LE(4);
    const count = buf.readUInt32LE(8);
    const idx = new DenseIndex({ dim });
    let offset = 12;
    for (let i = 0; i < count; i++) {
      if (offset + 4 > buf.length) {
        throw new Error("DenseIndex.load: truncated id length");
      }
      const idLen = buf.readUInt32LE(offset);
      offset += 4;
      if (offset + idLen + dim * 4 > buf.length) {
        throw new Error("DenseIndex.load: truncated entry payload");
      }
      const entryId = buf.toString("utf8", offset, offset + idLen);
      offset += idLen;
      const vec = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        vec[j] = buf.readFloatLE(offset + j * 4);
      }
      offset += dim * 4;
      idx.add(entryId, vec);
    }
    return idx;
  }

  /** Default on-disk location for the persisted index. */
  static defaultPath(): string {
    const home = process.env["NEXUS_HOME"] ?? path.join(
      process.env["HOME"] ?? process.env["USERPROFILE"] ?? ".",
      ".nexus",
    );
    return path.join(home, "memory", "dense.bin");
  }

  /** Test-only: list every entryId currently in the index (live + tombstoned). */
  allEntryIds(): readonly string[] {
    return this._slots.map((s) => s.entryId);
  }

  private _fit(vec: Float32Array): Float32Array {
    if (vec.length === this.dim) return vec;
    const fitted = new Float32Array(this.dim);
    const n = Math.min(vec.length, this.dim);
    for (let i = 0; i < n; i++) fitted[i] = vec[i] ?? 0;
    return fitted;
  }
}
