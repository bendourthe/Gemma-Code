import { randomUUID } from "crypto";
import type { Message } from "../types.js";

/**
 * v0.7.0 Phase 3 sub-task 3.3 -- Durable state for the model-callable compress
 * tool. Tracks stable IDs (`m0001`, `b1`, ...) across the session so the model
 * can refer to messages and prior compression blocks by name, and can request
 * decompress / recompress operations.
 */

export type MessageRef = string; // Message.id (UUID)
export type BlockRef = string; // stable block id like `b1`

export type CompressionMode = "range" | "message";

export interface BlockSummary {
  readonly blockId: BlockRef;
  readonly startId: string; // mNNNN or bN -- inclusive
  readonly endId: string; // mNNNN or bN -- inclusive
  readonly summary: string;
  readonly nestedBlockIds: readonly string[];
  /** Snapshot of the messages that the block replaced, for decompression. */
  readonly snapshot: readonly Message[];
}

export interface CompressionRun {
  readonly runId: string;
  readonly topic: string;
  readonly mode: CompressionMode;
  readonly blockSummaries: readonly BlockSummary[];
  readonly createdAt: number;
  readonly decompressed: boolean;
}

export interface CompressionStateSnapshot {
  readonly messageIds: ReadonlyArray<readonly [MessageRef, string]>;
  readonly blockIds: ReadonlyArray<readonly [BlockRef, string]>;
  readonly compressionRuns: readonly CompressionRun[];
  readonly nextMessageSeq: number;
  readonly nextBlockSeq: number;
}

export class CompressionState {
  private readonly _messageIds = new Map<MessageRef, string>();
  private readonly _blockIds = new Map<BlockRef, string>();
  private readonly _runs: CompressionRun[] = [];
  private _nextMessageSeq = 1;
  private _nextBlockSeq = 1;
  /**
   * v0.7.0 Phase 3 sub-task 3.6 -- when true, the compress tool MUST refuse
   * autonomous calls; the user invokes /compact sweep instead. Toggled by
   * `/compact manual on|off`. Defaults to false.
   */
  private _manualOnly = false;

  /** Total number of compression runs that have been recorded. */
  get runCount(): number {
    return this._runs.length;
  }

  /** Whether the compress tool is currently in manual-only mode. */
  get manualOnly(): boolean {
    return this._manualOnly;
  }

  setManualOnly(value: boolean): void {
    this._manualOnly = value;
  }

  /** Allocate (or reuse) a stable `mNNNN` id for the given message. */
  allocateMessageId(message: Pick<Message, "id">): string {
    const existing = this._messageIds.get(message.id);
    if (existing !== undefined) return existing;
    const id = `m${String(this._nextMessageSeq).padStart(4, "0")}`;
    this._nextMessageSeq += 1;
    this._messageIds.set(message.id, id);
    return id;
  }

  /** Lookup the `mNNNN` id previously allocated for a message, if any. */
  getMessageId(messageRef: MessageRef): string | undefined {
    return this._messageIds.get(messageRef);
  }

  /** Resolve a `mNNNN` id back to the originating Message.id. */
  resolveMessageRef(stableId: string): MessageRef | undefined {
    for (const [ref, id] of this._messageIds) {
      if (id === stableId) return ref;
    }
    return undefined;
  }

  /** Allocate the next `bN` id. Monotonic across the session. */
  allocateBlockId(): BlockRef {
    const id = `b${this._nextBlockSeq}`;
    this._nextBlockSeq += 1;
    this._blockIds.set(id, id);
    return id;
  }

  /** Record a compression run. Snapshots are deep-copied as a safety net. */
  recordRun(input: {
    topic: string;
    mode: CompressionMode;
    blockSummaries: readonly BlockSummary[];
  }): CompressionRun {
    const run: CompressionRun = {
      runId: randomUUID(),
      topic: input.topic,
      mode: input.mode,
      blockSummaries: input.blockSummaries.map((b) => ({
        ...b,
        snapshot: b.snapshot.map((m) => ({ ...m })),
        nestedBlockIds: [...b.nestedBlockIds],
      })),
      createdAt: Date.now(),
      decompressed: false,
    };
    this._runs.push(run);
    return run;
  }

  /** List runs in insertion order (oldest first). */
  listRuns(): readonly CompressionRun[] {
    return this._runs;
  }

  /** Lookup a recorded block by its bN id. */
  findBlock(blockId: BlockRef): { run: CompressionRun; block: BlockSummary } | undefined {
    for (const run of this._runs) {
      for (const block of run.blockSummaries) {
        if (block.blockId === blockId) return { run, block };
      }
    }
    return undefined;
  }

  /**
   * Mark a block's owning run as decompressed and return the snapshot for the
   * caller to splice back into the conversation. Idempotent across calls.
   */
  decompressBlock(blockId: BlockRef): { restoredMessages: readonly Message[] } {
    const located = this.findBlock(blockId);
    if (!located) return { restoredMessages: [] };
    const idx = this._runs.indexOf(located.run);
    if (idx >= 0) {
      this._runs[idx] = { ...located.run, decompressed: true };
    }
    return { restoredMessages: located.block.snapshot };
  }

  /**
   * Re-apply a previously decompressed run: returns the same compression run
   * record so the caller can re-render the placeholder block(s).
   */
  recompressBlock(blockId: BlockRef): { rerunCompression: CompressionRun } | undefined {
    const located = this.findBlock(blockId);
    if (!located) return undefined;
    const idx = this._runs.indexOf(located.run);
    if (idx >= 0) {
      this._runs[idx] = { ...located.run, decompressed: false };
    }
    return { rerunCompression: this._runs[idx]! };
  }

  /** Serialise to JSON for persistence in the chat-history SQLite column. */
  serialise(): CompressionStateSnapshot {
    return {
      messageIds: [...this._messageIds.entries()],
      blockIds: [...this._blockIds.entries()],
      compressionRuns: this._runs.map((r) => ({
        ...r,
        blockSummaries: r.blockSummaries.map((b) => ({
          ...b,
          snapshot: b.snapshot.map((m) => ({ ...m })),
          nestedBlockIds: [...b.nestedBlockIds],
        })),
      })),
      nextMessageSeq: this._nextMessageSeq,
      nextBlockSeq: this._nextBlockSeq,
    };
  }

  /** Inverse of `serialise`. */
  static deserialise(snapshot: CompressionStateSnapshot): CompressionState {
    const out = new CompressionState();
    for (const [k, v] of snapshot.messageIds) out._messageIds.set(k, v);
    for (const [k, v] of snapshot.blockIds) out._blockIds.set(k, v);
    for (const r of snapshot.compressionRuns) {
      out._runs.push({
        ...r,
        blockSummaries: r.blockSummaries.map((b) => ({
          ...b,
          snapshot: b.snapshot.map((m) => ({ ...m })),
          nestedBlockIds: [...b.nestedBlockIds],
        })),
      });
    }
    out._nextMessageSeq = snapshot.nextMessageSeq;
    out._nextBlockSeq = snapshot.nextBlockSeq;
    return out;
  }
}
