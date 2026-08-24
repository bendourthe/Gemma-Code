import { mkdirSync } from "node:fs";
import * as path from "node:path";

import { redactSecrets } from "../../../../core/observability/redactSecrets.js";
import { nexusHome } from "../../../../core/storage/paths.js";
import { EpisodicMemory } from "../../../../src/storage/EpisodicMemory.js";

export interface ChatMemoryRecordInput {
  readonly id: string;
  readonly content: string;
  readonly source?: string;
  readonly scopeId?: string | null;
}

export interface ChatMemorySearchInput {
  readonly query: string;
  readonly limit?: number;
  readonly scopeId?: string | null;
}

export interface ChatMemoryHit {
  readonly id: string;
  readonly content: string;
  readonly source?: string;
  readonly capturedAt: string;
  readonly scopeId?: string | null;
}

export interface ChatMemoryOps {
  record(input: ChatMemoryRecordInput): Promise<{ ok: true }>;
  search(input: ChatMemorySearchInput): Promise<{ hits: readonly ChatMemoryHit[] }>;
}

const MEMORY_DB_FILENAME = "memory.db";
let runtime: ChatMemoryRuntime | null = null;

export function resolveChatMemoryDbPath(homeDirFn?: () => string): string {
  return path.join(nexusHome(homeDirFn), MEMORY_DB_FILENAME);
}

export class ChatMemoryRuntime implements ChatMemoryOps {
  private readonly store: EpisodicMemory;

  constructor(dbPath = resolveChatMemoryDbPath()) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.store = new EpisodicMemory(dbPath, null);
  }

  async record(input: ChatMemoryRecordInput): Promise<{ ok: true }> {
    const timestamp = Date.now();
    const scopeId = input.scopeId ?? null;
    await this.store.record({
      sessionId: scopeId ?? "chat-global",
      action: input.source ?? "chat-turn",
      context: redactSecrets(input.content),
      outcome: null,
      timestamp,
      provenance: {
        source: "user_stated",
        sourceSessionId: scopeId,
        sourceMessageId: input.id,
        timestamp,
        confidence: 1,
      },
      tags: ["chat"],
    });
    return { ok: true };
  }

  async search(input: ChatMemorySearchInput): Promise<{ hits: readonly ChatMemoryHit[] }> {
    const limit = Math.min(Math.max(1, input.limit ?? 5), 20);
    const scopeId = input.scopeId ?? null;
    const candidates = this.store.searchKeyword(redactSecrets(input.query), limit * 4);
    const rows = candidates
      .filter(
        (entry) =>
          input.scopeId === undefined || entry.provenance.sourceSessionId === scopeId,
      )
      .slice(0, limit)
      .map((entry): ChatMemoryHit => ({
        id: entry.provenance.sourceMessageId ?? entry.id,
        content: entry.context,
        source: entry.action,
        capturedAt: new Date(entry.timestamp).toISOString(),
        scopeId: entry.provenance.sourceSessionId,
      }));
    return { hits: rows };
  }

  close(): void {
    this.store.close();
  }
}

export function chatMemoryRuntime(): ChatMemoryRuntime {
  runtime ??= new ChatMemoryRuntime();
  return runtime;
}

export function resetChatMemoryRuntime(): void {
  runtime?.close();
  runtime = null;
}
