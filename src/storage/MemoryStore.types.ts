export type MemoryType =
  | "decision"
  | "fact"
  | "preference"
  | "file_pattern"
  | "error_resolution";

export interface MemoryEntry {
  readonly id: string;
  readonly sessionId: string | null;
  readonly content: string;
  readonly type: MemoryType;
  readonly embedding: number[] | null;
  readonly createdAt: number;
  readonly accessedAt: number;
  readonly accessCount: number;
  readonly relevanceDecay: number;
}

export interface MemorySearchResult {
  readonly entry: MemoryEntry;
  /** Combined relevance score in the range 0..1. */
  readonly score: number;
  readonly matchSource: "keyword" | "semantic" | "both";
}

export interface MemoryStats {
  readonly totalEntries: number;
  readonly byType: Record<MemoryType, number>;
  readonly oldestEntryAt: number | null;
  readonly newestEntryAt: number | null;
  readonly embeddingCount: number;
}
